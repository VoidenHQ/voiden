import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow } from "electron";
import simpleGit from "simple-git";
import { getActiveProject } from "../state";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { invalidateGitCache, getCachedIsRepo, invalidateRepoCache, getSharedGit } from "../git";
import { setCloning } from "../fileWatcher";
import { logger } from "../logger";

// In-flight deduplication: prevents polling intervals from stacking up
// concurrent git processes when a call takes longer than the poll interval.
// Keyed by project path so switching projects starts fresh.
function dedupeCall<T>(
  store: Map<string, Promise<T>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (store.has(key)) return store.get(key)!;
  const p = fn().finally(() => store.delete(key));
  store.set(key, p);
  return p;
}


function trackingToRemoteName(tracking: string | null | undefined): string | null {
  if (!tracking) return null;
  const slash = tracking.indexOf('/');
  if (slash <= 0) return null;
  return tracking.slice(0, slash);
}

function normalizeBranchForPush(branch: string, remote?: string | null): {
  localBranch: string;
  remoteBranch: string;
} {
  if (branch === 'HEAD') {
    return { localBranch: 'HEAD', remoteBranch: 'HEAD' };
  }

  if (branch.startsWith('refs/heads/')) {
    const name = branch.slice('refs/heads/'.length);
    return { localBranch: name, remoteBranch: name };
  }

  if (branch.startsWith('remotes/')) {
    const parts = branch.split('/');
    const remoteName = parts[1];
    const remoteBranch = parts.slice(2).join('/');
    return { localBranch: remoteBranch, remoteBranch };
  }

  if (remote && branch.startsWith(`${remote}/`)) {
    const remoteBranch = branch.slice(remote.length + 1);
    return { localBranch: remoteBranch, remoteBranch };
  }

  if (branch.includes('/')) {
    const remoteBranch = branch.split('/').slice(1).join('/');
    return { localBranch: remoteBranch, remoteBranch };
  }

  return { localBranch: branch, remoteBranch: branch };
}

function normalizeCurrentBranchName(branch: string | null | undefined): string | null {
  if (!branch) return null;
  if (branch.startsWith('refs/heads/')) {
    return branch.slice('refs/heads/'.length);
  }
  if (branch.startsWith('remotes/')) {
    return branch.split('/').slice(2).join('/');
  }
  const slash = branch.indexOf('/');
  if (slash > 0) {
    const prefix = branch.slice(0, slash);
    if (prefix === 'origin') {
      return branch.slice(slash + 1);
    }
  }
  return branch;
}

// Per-handler in-flight stores (keyed by project path)
const pendingStatus = new Map<string, Promise<any>>();
const pendingLog = new Map<string, Promise<any>>();
const pendingConflicts = new Map<string, Promise<any>>();
const pendingFetch = new Map<string, Promise<any>>();
const pendingTree = new Map<string, Promise<any>>();
const pendingStash = new Map<string, Promise<any>>();

// ── getRemoteUrl cache ────────────────────────────────────────────────────────
// Remote URLs rarely change; cache them to prevent repeated subprocess spawning
// on every panel/tab render. Invalidated by setRemoteUrl, add-remote, removeRemote.
interface RemoteUrlEntry { url: string | null; timestamp: number; }
const remoteUrlCache = new Map<string, RemoteUrlEntry>();
const REMOTE_URL_TTL = 600_000; // 10 minutes

function invalidateRemoteUrlCache(projectPath: string): void {
  remoteUrlCache.delete(projectPath);
}

export function registerGitIpcHandlers() {
  // Get git repository root directory
  ipcMain.handle("git:getRepoRoot", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      return null;
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        return null;
      }
      const root = await git.revparse(["--show-toplevel"]);
      return root.trim();
    } catch (error) {
      return null;
    }
  });

  // Clone a repository into the active project directory (or create a new one)
  ipcMain.handle("git:clone", async (event: IpcMainInvokeEvent, repoUrl: string, token?: string) => {
    const activeProject = await getActiveProject(event);

    try {
      // Inject token into URL for authenticated clones
      let cloneUrl = repoUrl;
      if (token) {
        const parsed = new URL(repoUrl);
        parsed.username = "oauth2";
        parsed.password = token;
        cloneUrl = parsed.toString();
      }

      // Derive the repo folder name from the URL (e.g. "my-repo" from ".../my-repo.git")
      const baseName = repoUrl.replace(/\.git$/, "").split("/").pop() || "repo";

      // Helper: async directory-exists check
      const dirExists = (p: string) =>
        fs.promises.access(p).then(() => true).catch(() => false);

      // Helper to send progress to the renderer safely
      const sendProgress = (stage: string, progress: number) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send("git:clone:progress", { stage, progress });
          }
        } catch { /* renderer disposed */ }
      };

      // Create a git instance that forwards clone progress to the renderer
      const makeProgressGit = (baseDir: string) =>
        simpleGit({
          baseDir,
          progress({ stage, progress }) {
            sendProgress(stage, progress);
          },
        });

      if (!activeProject) {
        // No active project — clone into ~/Voiden/<name>, then scaffold .voiden
        const voidenHome = path.join(os.homedir(), "Voiden");
        await fs.promises.mkdir(voidenHome, { recursive: true });

        // Find a unique folder name
        let newFolderName = baseName;
        let newCounter = 1;
        while (await dirExists(path.join(voidenHome, newFolderName))) {
          newFolderName = `${baseName}-${newCounter}`;
          newCounter++;
        }

        const newProjectPath = path.join(voidenHome, newFolderName);

        // Clone directly (git clone creates the directory).
        // Suppress watcher events for the clone destination so the IPC channel
        // isn't flooded with file:new events for every file being cloned.
        const gitParent = makeProgressGit(voidenHome);
        setCloning(newProjectPath, true);
        let newLfsWarning = false;
        try {
          await gitParent.clone(cloneUrl, newFolderName, ["--depth", "1", "--no-local"]);
        } catch (cloneErr: any) {
          const msg: string = cloneErr?.message || String(cloneErr);
          if (msg.includes("Clone succeeded, but checkout failed") || (msg.includes("git-lfs") && msg.includes("command not found"))) {
            newLfsWarning = true; // repo downloaded, LFS files missing — treat as success with warning
          } else {
            throw cloneErr;
          }
        } finally {
          setCloning(newProjectPath, false);
        }

        // Add .voiden scaffold after successful clone
        const voidenDir = path.join(newProjectPath, ".voiden");
        await fs.promises.mkdir(voidenDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(voidenDir, ".voiden-projects"),
          JSON.stringify({ project: newFolderName })
        );

        return { clonedPath: newProjectPath, clonedInPlace: false, isNewProject: true, lfsWarning: newLfsWarning };
      }

      // Find a unique folder name inside the active project (repo, repo-1, repo-2, ...)
      let folderName = baseName;
      let counter = 1;
      while (await dirExists(path.join(activeProject, folderName))) {
        folderName = `${baseName}-${counter}`;
        counter++;
      }

      const clonedPath = path.join(activeProject, folderName);
      const gitWithProgress = makeProgressGit(activeProject);
      setCloning(clonedPath, true);
      let lfsWarning = false;
      try {
        await gitWithProgress.clone(cloneUrl, folderName, ["--depth", "1", "--no-local"]);
      } catch (cloneErr: any) {
        const msg: string = cloneErr?.message || String(cloneErr);
        if (msg.includes("Clone succeeded, but checkout failed") || (msg.includes("git-lfs") && msg.includes("command not found"))) {
          lfsWarning = true;
        } else {
          throw cloneErr;
        }
      } finally {
        setCloning(clonedPath, false);
      }
      return { clonedPath, clonedInPlace: false, isNewProject: false, lfsWarning };
    } catch (error: any) {
      console.error("Error cloning repository:", error);
      const raw: string = (error?.message || String(error)).replace(/:[^@]*@/, ":***@");

      // Translate common git errors into friendly messages
      if (raw.includes("Repository not found") || raw.includes("does not exist")) {
        throw new Error("Repository not found. Check the URL and make sure it exists.");
      }
      if (raw.includes("Authentication failed") || raw.includes("could not read Username") || raw.includes("403")) {
        throw new Error("Authentication failed. Provide a valid access token for private repositories.");
      }
      if (raw.includes("invalid url") || raw.includes("not a valid URL") || raw.includes("unsupported protocol") || raw.includes("Unable to find remote helper")) {
        throw new Error("Invalid repository URL. Use https:// or git@ format.");
      }
      if (raw.includes("Name or service not known") || raw.includes("Could not resolve host")) {
        throw new Error("Could not reach the server. Check your internet connection and the URL.");
      }
      if (raw.includes("already exists and is not an empty directory")) {
        throw new Error("A folder with that name already exists in the project directory.");
      }

      throw new Error(raw);
    }
  });

  ipcMain.handle("git:initialize", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      await git.init();
      // Invalidate so subsequent isRepo checks reflect the newly created repo
      invalidateRepoCache(activeProject);
      return true;
    } catch (error) {
      console.error("Error initializing git repository:", error);
      throw error;
    }
  });

  // Get working directory status (all changed files)
  ipcMain.handle("git:getStatus", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;
    try { await fs.promises.access(activeProject); } catch { return null; }
    // Deduplicate: if a status call is already in-flight for this project,
    // return the same promise rather than spawning more git processes.
    return dedupeCall(pendingStatus, activeProject, async () => {
    try {
      // isRepo check is cached — no subprocess for projects we've seen before
      if (!await getCachedIsRepo(activeProject)) return null;

      const git = getSharedGit(activeProject);

      // subprocess 1: git status — gives files, branch name, tracking, ahead/behind
      const _t0 = Date.now();
      const status = await git.status();
      const _statusMs = Date.now() - _t0;
      if (_statusMs > 500) {
        logger.warn('git', `git:getStatus slow (${_statusMs}ms) — large repo`, {
          project: activeProject, statusMs: _statusMs,
          tip: 'Run: git config core.fsmonitor true && git config core.untrackedCache true',
        });
      }
      const currentBranch = normalizeCurrentBranchName(status.current);
      const rawTracking = status.tracking || null;

      let tracking = rawTracking;
      let resolvedRemoteRef: string | null = rawTracking ? `refs/remotes/${rawTracking}` : null;
      let ahead  = status.ahead;
      let behind = status.behind;

      const isRemoteTrackingBranch =
        currentBranch?.startsWith('remotes/') || currentBranch?.startsWith('origin/');

      // When status.tracking is absent, look up the upstream in one for-each-ref call
      // instead of the previous 4–6 separate rev-parse / config / show-ref subprocesses.
      if (!rawTracking && currentBranch && !isRemoteTrackingBranch) {
        try {
          // subprocess 2 (conditional): upstream short name + full ref from refs/heads/<branch>
          const upRaw = await git.raw([
            'for-each-ref', `refs/heads/${currentBranch}`,
            '--format=%(upstream:short)\t%(upstream)',
          ]);
          const parts  = upRaw.trim().split('\t');
          const upShort = parts[0] || null;
          const upFull  = parts[1] || null;
          if (upShort) {
            tracking = upShort;
            resolvedRemoteRef = upFull || `refs/remotes/${upShort}`;
          } else {
            // No upstream configured — search for a matching remote tracking branch
            // subprocess 3 (conditional): refs/remotes/*/<branch>
            const refRaw = await git.raw([
              'for-each-ref', `refs/remotes/*/${currentBranch}`, '--format=%(refname)',
            ]);
            const refs = refRaw.trim().split('\n').filter(Boolean);
            if (refs.length > 0) {
              resolvedRemoteRef = refs.find(r => r.includes('/origin/')) || refs[0];
              tracking = resolvedRemoteRef!.replace(/^refs\/remotes\//, '');
            }
          }
        } catch { /* no upstream — local-only branch */ }
      }

      const isPublished = isRemoteTrackingBranch || !!tracking;

      // subprocess 4 (conditional): accurate ahead/behind via rev-list
      if (resolvedRemoteRef && !isRemoteTrackingBranch) {
        try {
          const countsRaw = await git.raw([
            'rev-list', '--left-right', '--count', `HEAD...${resolvedRemoteRef}`,
          ]);
          const [a, b] = countsRaw.trim().split(/\s+/);
          ahead  = parseInt(a) || 0;
          behind = parseInt(b) || 0;
        } catch { /* fall back to status values */ }
      }

      // subprocess 5 (conditional): outgoing commits for unpublished branches
      let outgoing = ahead > 0;
      if (!resolvedRemoteRef) {
        try {
          const outRaw = await git.raw(['rev-list', '--count', 'HEAD', '--not', '--remotes']);
          const outgoingCount = parseInt(outRaw.trim()) || 0;
          if (outgoingCount > ahead) ahead = outgoingCount;
          outgoing = outgoingCount > 0 || ahead > 0;
        } catch { outgoing = false; }
      }

      return {
        files: [
          ...status.staged,
          ...status.modified,
          ...status.not_added,
          ...status.deleted,
        ].map((file) => ({
          path: file,
          status: status.staged.includes(file)
            ? "staged"
            : status.modified.includes(file)
              ? "modified"
              : status.not_added.includes(file)
                ? "untracked"
                : "deleted",
        })),
        staged:     status.staged,
        modified:   status.modified,
        untracked:  status.not_added,
        deleted:    status.deleted,
        conflicted: status.conflicted,
        published:  isPublished,
        tracking,
        current: currentBranch || status.current,
        ahead,
        behind,
        outgoing,
      };
    } catch (error) {
      console.error("Error getting git status:", error);
      return null;
    }
    }); // end dedupeCall
  });

  // Stage files
  ipcMain.handle("git:stage", async (event: IpcMainInvokeEvent, files: string[]) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }

      // Get current status to know which files are tracked by git
      const status = await git.status();
      const trackedFiles = new Set([...status.modified, ...status.deleted, ...status.staged]);

      // Filter: only stage files that exist on disk OR are tracked (staged deletion)
      // This prevents errors for untracked files deleted before staging
      const filesToStage = files.filter(file => {
        const fullPath = path.join(activeProject, file);
        return fs.existsSync(fullPath) || trackedFiles.has(file);
      });

      // Stage each file individually so one missing file never blocks the rest
      for (const file of filesToStage) {
        try {
          await git.add(file);
        } catch (_e) {
          // silently skip any file git still can't find
        }
      }

      return true;
    } catch (error: any) {
      // Never throw for pathspec errors — just return success
      if (error?.message?.includes('did not match any files')) {
        return true;
      }
      console.error("Error staging files:", error);
      throw error;
    }
  });

  // Unstage files
  ipcMain.handle("git:unstage", async (event: IpcMainInvokeEvent, files: string[]) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }
      await git.reset(['HEAD', '--', ...files]);
      return true;
    } catch (error) {
      console.error("Error unstaging files:", error);
      throw error;
    }
  });

  // Commit staged changes
  ipcMain.handle("git:commit", async (event: IpcMainInvokeEvent, message: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }
      const result = await git.commit(message);
      return result;
    } catch (error) {
      console.error("Error committing changes:", error);
      throw error;
    }
  });

  // Discard changes in working directory
  ipcMain.handle("git:discard", async (event: IpcMainInvokeEvent, files: string[]) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }

      const status = await git.status();
      const untrackedSet = new Set(status.not_added);

      const untrackedFiles = files.filter(f => untrackedSet.has(f));
      const trackedFiles = files.filter(f => !untrackedSet.has(f));

      // Show native confirmation dialog
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
      const isSingle = files.length === 1;
      const isUntrackedSingle = isSingle && untrackedFiles.length === 1;
      const message = isUntrackedSingle
        ? `Delete "${path.basename(files[0])}"?`
        : isSingle
          ? `Discard changes in "${path.basename(files[0])}"?`
          : `Discard changes in ${files.length} file(s)?`;
      const detail = isUntrackedSingle
        ? "This untracked file will be permanently deleted."
        : "This action cannot be undone.";

      const { response } = await dialog.showMessageBox(win!, {
        type: "warning",
        buttons: ["Cancel", isUntrackedSingle ? "Delete" : "Discard"],
        defaultId: 1,
        cancelId: 0,
        message,
        detail,
      });
      if (response === 0) return { canceled: true };

      // Delete untracked files from disk
      for (const file of untrackedFiles) {
        const fullPath = path.join(activeProject, file);
        try {
          await fs.promises.unlink(fullPath);
        } catch (_e) {
          // ignore if already gone
        }
      }

      // Use git restore (modern) or checkout (fallback) to discard tracked changes
      if (trackedFiles.length > 0) {
        try {
          await git.raw(['restore', ...trackedFiles]);
        } catch (restoreError) {
          await git.checkout(['--', ...trackedFiles]);
        }
      }

      return true;
    } catch (error: any) {
      console.error("Error discarding changes:", error);

      // Provide helpful error message for lock file issues
      if (error.message?.includes('index.lock')) {
        throw new Error(
          'Git index is locked. Another git process may be running. ' +
          'If not, remove .git/index.lock manually and try again.'
        );
      }

      throw error;
    }
  });

  // Get commit history/log with graph information
  ipcMain.handle("git:getLog", async (event: IpcMainInvokeEvent, limit: number = 50) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;
    try { await fs.promises.access(activeProject); } catch { return null; }
    return dedupeCall(pendingLog, `${activeProject}:${limit}`, async () => {
    try {
      const git = simpleGit(activeProject, { timeout: { block: 10000 } });
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        return null;
      }

      // Get log with parent information for graph building
      const log = await git.log({
        maxCount: limit,
        format: {
          hash: '%H',
          parents: '%P',
          message: '%s',
          author: '%an',
          date: '%ai',
          refs: '%D',
        }
      });

      return {
        all: log.all.map(commit => ({
          hash: commit.hash,
          shortHash: commit.hash.substring(0, 7),
          message: commit.message,
          author: commit.author,
          date: commit.date,
          refs: commit.refs || '',
          parents: (commit as any).parents ? (commit as any).parents.split(' ').filter(Boolean) : [],
        })),
        latest: log.latest,
      };
    } catch (error) {
      console.error("Error getting git log:", error);
      return null;
    }
    }); // end dedupeCall
  });

  // Get files changed in a specific commit
  ipcMain.handle("git:getCommitFiles", async (event, commitHash: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      return [];
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        return [];
      }

      // Check if this commit has a parent (initial commit does not)
      let diffSummary;
      try {
        diffSummary = await git.diffSummary([`${commitHash}^`, commitHash]);
      } catch {
        // Initial commit — no parent ref; use diff-tree to list introduced files
        const raw = await git.raw(['diff-tree', '--no-commit-id', '-r', '--numstat', commitHash]);
        return raw.trim().split('\n').filter(Boolean).map(line => {
          const [ins, del, ...rest] = line.split('\t');
          return {
            path: rest.join('\t'),
            changes: (parseInt(ins) || 0) + (parseInt(del) || 0),
            insertions: parseInt(ins) || 0,
            deletions: parseInt(del) || 0,
          };
        });
      }

      return diffSummary.files.map(file => ({
        path: file.file,
        changes: (file as any).changes ?? 0,
        insertions: (file as any).insertions ?? 0,
        deletions: (file as any).deletions ?? 0,
      }));
    } catch (error) {
      console.error("Error getting commit files:", error);
      return [];
    }
  });

  ipcMain.handle("git:get-remote", async (_event, _projectName: string) => {
    const activeProject = await getActiveProject(_event);
    if (!activeProject) {
      return null;
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        return null;
      }
      const remotes = await git.getConfig("remote.origin.url");
      return remotes;
    } catch (error) {
      console.error("Error getting git remote:", error);
      return null;
    }
  });

  ipcMain.handle("git:add-remote", async (_event, _projectName: string, remoteUrl: string) => {
    const activeProject = await getActiveProject(_event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }
      await git.addRemote("origin", remoteUrl);
      invalidateRemoteUrlCache(activeProject);
    } catch (error) {
      console.error("Error adding git remote:", error);
      throw error;
    }
  });

  // Push current branch to tracked remote (fallback: origin, then first remote)
  ipcMain.handle("git:pushBranch", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }
      const status = await git.status();
      const currentBranch = status.current;
      if (!currentBranch) {
        throw new Error("Could not determine current branch");
      }
      const remotes = await git.getRemotes(false);
      const trackedRemote = trackingToRemoteName(status.tracking || null);
      const fallbackRemote = remotes.find((r) => r.name === "origin")?.name || remotes[0]?.name;
      const remote = trackedRemote || fallbackRemote;
      if (!remote) {
        throw new Error("No remote configured for push");
      }

      // Prefer the configured/upstream branch name when available. This avoids pushing to
      // "HEAD" when the worktree is in a detached state but tracking still points to a branch.
      const branchForPush = status.tracking || currentBranch;
      const { localBranch, remoteBranch } = normalizeBranchForPush(branchForPush, remote);
      if (!remoteBranch || remoteBranch === 'HEAD') {
        throw new Error("Cannot push from detached HEAD without a target branch");
      }

      // Always use --set-upstream so tracking is configured after every Voiden push.
      // This ensures getStatus reliably detects published state via status.tracking.
      await git.raw(['push', '--set-upstream', remote, `HEAD:refs/heads/${remoteBranch}`]);

      // Push does not necessarily advance local refs/remotes/* immediately.
      // Update the remote-tracking ref locally so ahead/behind is correct right after push.
      try {
        const head = (await git.revparse(['HEAD'])).trim();
        await git.raw(['update-ref', `refs/remotes/${remote}/${remoteBranch}`, head]);
      } catch {
        // Ignore local ref update failures; push already succeeded.
      }

      return { branch: localBranch === 'HEAD' ? remoteBranch : localBranch };
    } catch (error) {
      console.error("Error pushing branch:", error);
      throw error;
    }
  });

  // Get the fetch URL of the tracked remote (fallback: origin, then first remote).
  // Cached for REMOTE_URL_TTL — remote URLs rarely change and this IPC fires on
  // every panel render, causing subprocess spam on non-git projects otherwise.
  ipcMain.handle("git:getRemoteUrl", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;

    const cached = remoteUrlCache.get(activeProject);
    if (cached && Date.now() - cached.timestamp < REMOTE_URL_TTL) return cached.url;

    try {
      if (!await getCachedIsRepo(activeProject)) {
        remoteUrlCache.set(activeProject, { url: null, timestamp: Date.now() });
        return null;
      }
      const git = getSharedGit(activeProject);
      const [status, remotes] = await Promise.all([git.status(), git.getRemotes(true)]);
      const trackedRemote = trackingToRemoteName(status.tracking || null);
      let url: string | null = null;
      if (trackedRemote) {
        const tracked = remotes.find((r) => r.name === trackedRemote);
        url = tracked?.refs?.fetch || tracked?.refs?.push || null;
      }
      if (!url) {
        const origin = remotes.find((r) => r.name === 'origin');
        url = origin?.refs?.fetch || origin?.refs?.push || null;
      }
      if (!url && remotes[0]) {
        url = remotes[0]?.refs?.fetch || remotes[0]?.refs?.push || null;
      }
      remoteUrlCache.set(activeProject, { url, timestamp: Date.now() });
      return url;
    } catch {
      remoteUrlCache.set(activeProject, { url: null, timestamp: Date.now() });
      return null;
    }
  });

  // Remove the origin remote entirely (disconnect without deleting history)
  ipcMain.handle("git:removeRemote", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) throw new Error("Not a git repository");
      await git.removeRemote("origin");
      invalidateRemoteUrlCache(activeProject);
      return true;
    } catch (error) {
      console.error("Error removing remote:", error);
      throw error;
    }
  });

  // Add or update the origin remote URL
  ipcMain.handle("git:setRemoteUrl", async (event: IpcMainInvokeEvent, remoteUrl: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) throw new Error("Not a git repository");
      const remotes = await git.getRemotes(false);
      if (remotes.some((r) => r.name === "origin")) {
        await git.raw(["remote", "set-url", "origin", remoteUrl]);
      } else {
        await git.addRemote("origin", remoteUrl);
      }
      invalidateRemoteUrlCache(activeProject);
      return true;
    } catch (error) {
      console.error("Error setting remote URL:", error);
      throw error;
    }
  });

  // Pull from origin for current branch
  // Fetch from remote (updates local remote-tracking refs so ahead/behind is accurate)
  ipcMain.handle("git:fetch", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;

    // Guard: directory must exist before attempting git operations
    try { await fs.promises.access(activeProject); } catch { return null; }
    return dedupeCall(pendingFetch, activeProject, async () => {
    const git = getSharedGit(activeProject);
    const isRepo = await getCachedIsRepo(activeProject);
    if (!isRepo) return null;
    const remotes = await git.getRemotes(false);
    if (remotes.length === 0) {
      await git.fetch(["--prune", "--all"]);
    } else {
      for (const remote of remotes) {
        await git.raw([
          'fetch',
          remote.name,
          '--prune',
          `+refs/heads/*:refs/remotes/${remote.name}/*`,
        ]);
      }
    }
    invalidateGitCache(activeProject);
    return true;
    }); // end dedupeCall git:fetch
  });

  // Stash current changes (with optional message)
  ipcMain.handle("git:stash", async (event: IpcMainInvokeEvent, message?: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = getSharedGit(activeProject);
    const isRepo = await getCachedIsRepo(activeProject);
    if (!isRepo) throw new Error("Not a git repository");
    const args = message ? ['push', '-m', message] : ['push'];
    await git.raw(['stash', ...args]);
    return true;
  });

  // List all stashes
  ipcMain.handle("git:stashList", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return [];
    return dedupeCall(pendingStash, activeProject, async () => {
      try {
        const git = getSharedGit(activeProject);
        const isRepo = await getCachedIsRepo(activeProject);
        if (!isRepo) return [];
        const raw = await git.raw(['stash', 'list', '--format=%gd|%s|%cr']);
        const entries = raw.trim().split('\n').filter(Boolean).map((line, index) => {
          const [ref, subject, date] = line.split('|');
          return { index, ref: ref?.trim(), message: subject?.trim(), date: date?.trim() };
        });
        return entries;
      } catch {
        return [];
      }
    });
  });

  // Pop a stash by index
  ipcMain.handle("git:stashPop", async (event: IpcMainInvokeEvent, index: number) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = getSharedGit(activeProject);
    const isRepo = await getCachedIsRepo(activeProject);
    if (!isRepo) throw new Error("Not a git repository");
    await git.raw(['stash', 'pop', `stash@{${index}}`]);
    return true;
  });

  // ── Conflict resolution ────────────────────────────────────────────────────

  function parseConflictSections(content: string): Array<{
    current: string;
    incoming: string;
    base: string | null;
    index: number;
  }> {
    const lines = content.split('\n');
    const sections: Array<{ current: string; incoming: string; base: string | null; index: number }> = [];
    let i = 0;
    let sectionIndex = 0;

    while (i < lines.length) {
      if (lines[i].startsWith('<<<<<<<')) {
        const currentLines: string[] = [];
        const incomingLines: string[] = [];
        const baseLines: string[] = [];
        let state: 'current' | 'base' | 'incoming' = 'current';
        i++;

        while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
          if (lines[i].startsWith('=======')) {
            state = 'incoming';
          } else if (lines[i].startsWith('|||||||')) {
            state = 'base';
          } else if (state === 'current') {
            currentLines.push(lines[i]);
          } else if (state === 'base') {
            baseLines.push(lines[i]);
          } else {
            incomingLines.push(lines[i]);
          }
          i++;
        }

        sections.push({
          current: currentLines.join('\n'),
          incoming: incomingLines.join('\n'),
          base: baseLines.length > 0 ? baseLines.join('\n') : null,
          index: sectionIndex++,
        });
      }
      i++;
    }
    return sections;
  }

  function resolveConflictContent(
    content: string,
    resolution: 'current' | 'incoming' | 'both',
    sectionIndex?: number,
  ): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;
    let currentSection = 0;

    while (i < lines.length) {
      if (lines[i].startsWith('<<<<<<<')) {
        const currentLines: string[] = [];
        const incomingLines: string[] = [];
        let state: 'current' | 'base' | 'incoming' = 'current';
        i++;

        while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
          if (lines[i].startsWith('=======')) {
            state = 'incoming';
          } else if (lines[i].startsWith('|||||||')) {
            state = 'base';
          } else if (state === 'current') {
            currentLines.push(lines[i]);
          } else if (state === 'incoming') {
            incomingLines.push(lines[i]);
          }
          i++;
        }

        // Resolve this section (or all if sectionIndex undefined)
        const shouldResolve = sectionIndex === undefined || sectionIndex === currentSection;
        if (shouldResolve) {
          if (resolution === 'current') {
            result.push(...currentLines);
          } else if (resolution === 'incoming') {
            result.push(...incomingLines);
          } else {
            result.push(...currentLines, ...incomingLines);
          }
        } else {
          // Keep conflict markers intact for this section
          result.push(`<<<<<<< HEAD`);
          result.push(...currentLines);
          result.push('=======');
          result.push(...incomingLines);
          result.push(`>>>>>>> incoming`);
        }
        currentSection++;
      } else {
        result.push(lines[i]);
      }
      i++;
    }

    return result.join('\n');
  }

  ipcMain.handle("git:getConflicts", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return [];
    try { await fs.promises.access(activeProject); } catch { return []; }
    return dedupeCall(pendingConflicts, activeProject, async () => {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) return [];

      const status = await git.status();
      const conflicted = status.conflicted;

      const conflicts = await Promise.all(
        conflicted.map(async (file) => {
          try {
            const filePath = path.join(activeProject, file);
            const content = await fs.promises.readFile(filePath, 'utf8');
            const sections = parseConflictSections(content);
            return { file, sections, hasConflict: sections.length > 0 };
          } catch {
            return { file, sections: [], hasConflict: false };
          }
        })
      );

      return conflicts;
    });
  });

  ipcMain.handle(
    "git:resolveConflict",
    async (
      event: IpcMainInvokeEvent,
      file: string,
      resolution: 'current' | 'incoming' | 'both',
      sectionIndex?: number,
    ) => {
      const activeProject = await getActiveProject(event);
      if (!activeProject) throw new Error("No active project selected.");

      const filePath = path.join(activeProject, file);
      const content = await fs.promises.readFile(filePath, 'utf8');
      const resolved = resolveConflictContent(content, resolution, sectionIndex);
      await fs.promises.writeFile(filePath, resolved, 'utf8');

      // If no conflict markers remain, auto-stage the file
      if (!resolved.includes('<<<<<<<')) {
        const git = getSharedGit(activeProject);
        await git.add(file);
      }

      return { resolved: !resolved.includes('<<<<<<<') };
    }
  );

  ipcMain.handle("git:getFileContent", async (event: IpcMainInvokeEvent, file: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const filePath = path.join(activeProject, file);
    return fs.promises.readFile(filePath, 'utf8');
  });

  // Write resolved content to disk and stage the file
  ipcMain.handle("git:saveResolvedFile", async (event: IpcMainInvokeEvent, file: string, content: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const filePath = path.join(activeProject, file);
    fs.writeFileSync(filePath, content, 'utf8');
    const git = getSharedGit(activeProject);
    await git.add(file);
    invalidateGitCache(activeProject);
    return { success: true };
  });

  // Undo the last commit — moves changes back to the staging area (soft reset)
  ipcMain.handle("git:uncommit", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = getSharedGit(activeProject);
    const isRepo = await getCachedIsRepo(activeProject);
    if (!isRepo) throw new Error("Not a git repository");
    await git.reset(['--soft', 'HEAD~1']);
    invalidateGitCache(activeProject);
    return true;
  });

  ipcMain.handle("git:pull", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = getSharedGit(activeProject);
      const isRepo = await getCachedIsRepo(activeProject);
      if (!isRepo) {
        throw new Error("Not a git repository");
      }
      const status = await git.status();
      const remotes = await git.getRemotes(false);
      const trackedRemote = trackingToRemoteName(status.tracking || null);
      const fallbackRemote = remotes.find((r) => r.name === "origin")?.name || remotes[0]?.name;

      let result;
      if (status.tracking) {
        // Tracked upstream — plain pull
        result = await git.pull();
      } else if (fallbackRemote && status.current) {
        // No tracking — pull from origin/<currentBranch> explicitly
        result = await git.pull(trackedRemote || fallbackRemote, status.current);
      } else {
        throw new Error("No remote configured for pull");
      }
      return result;
    } catch (error) {
      console.error("Error pulling from remote:", error);
      throw error;
    }
  });
}
