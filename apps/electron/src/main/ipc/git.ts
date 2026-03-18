import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow } from "electron";
import simpleGit from "simple-git";
import { getActiveProject } from "../state";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { invalidateGitCache } from "../git";


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

export function registerGitIpcHandlers() {
  // Get git repository root directory
  ipcMain.handle("git:getRepoRoot", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      return null;
    }

    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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

      if (!activeProject) {
        // No active project — clone into ~/Voiden/<name>, then scaffold .voiden
        const voidenHome = path.join(os.homedir(), "Voiden");
        if (!fs.existsSync(voidenHome)) {
          await fs.promises.mkdir(voidenHome, { recursive: true });
        }

        // Find a unique folder name (same logic as createProjectDirectory)
        let newFolderName = baseName;
        let newCounter = 1;
        while (fs.existsSync(path.join(voidenHome, newFolderName))) {
          newFolderName = `${baseName}-${newCounter}`;
          newCounter++;
        }

        const newProjectPath = path.join(voidenHome, newFolderName);

        // Clone directly (don't pre-create the directory — git clone will create it)
        const gitParent = simpleGit(voidenHome);
        await gitParent.raw(["clone", "--depth", "1", cloneUrl, newFolderName]);

        // Add .voiden scaffold after successful clone
        const voidenDir = path.join(newProjectPath, ".voiden");
        await fs.promises.mkdir(voidenDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(voidenDir, ".voiden-projects"),
          JSON.stringify({ project: newFolderName })
        );

        return { clonedPath: newProjectPath, clonedInPlace: false, isNewProject: true };
      }

      // Find a unique folder name inside the active project (repo, repo-1, repo-2, ...)
      let folderName = baseName;
      let counter = 1;
      while (fs.existsSync(path.join(activeProject, folderName))) {
        folderName = `${baseName}-${counter}`;
        counter++;
      }

      const git = simpleGit(activeProject);
      await git.raw(["clone", "--depth", "1", cloneUrl, folderName]);
      return { clonedPath: path.join(activeProject, folderName), clonedInPlace: false, isNewProject: false };
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
      const git = simpleGit(activeProject);
      await git.init();
      return true;
    } catch (error) {
      console.error("Error initializing git repository:", error);
      throw error;
    }
  });

  // Get working directory status (all changed files)
  ipcMain.handle("git:getStatus", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      return null;
    }

    try {
      const git = simpleGit(activeProject);

      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return null;
      }

      const [status, branchSummary] = await Promise.all([
        git.status(),
        git.branch(),
      ]);

      const currentBranch = normalizeCurrentBranchName(branchSummary.current);
      const rawTracking = status.tracking || null;

      let upstreamShort: string | null = null;
      let upstreamFullRef: string | null = null;
      try {
        const [shortRaw, fullRaw] = await Promise.all([
          git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
          git.raw(['rev-parse', '--symbolic-full-name', '@{upstream}']),
        ]);
        upstreamShort = shortRaw.trim() || null;
        upstreamFullRef = fullRaw.trim() || null;
      } catch {
        upstreamShort = null;
        upstreamFullRef = null;
      }

      // Upstream can be configured but not actually exist as a local remote-tracking ref yet.
      // In that case, ignore it here and fall back to our resolved remote-ref lookup.
      if (upstreamFullRef) {
        try {
          await git.raw(['show-ref', '--verify', upstreamFullRef]);
        } catch {
          upstreamFullRef = null;
        }
      }

      let configuredTracking: string | null = null;
      if (currentBranch) {
        try {
          const [remoteRaw, mergeRaw] = await Promise.all([
            git.raw(['config', '--get', `branch.${currentBranch}.remote`]),
            git.raw(['config', '--get', `branch.${currentBranch}.merge`]),
          ]);
          const remote = remoteRaw.trim();
          const mergeRef = mergeRaw.trim();
          const mergeBranch = mergeRef.replace(/^refs\/heads\//, '');
          if (remote && remote !== '.' && mergeRef.startsWith('refs/heads/') && mergeBranch) {
            configuredTracking = `${remote}/${mergeBranch}`;
          }
        } catch {
          configuredTracking = null;
        }
      }

      // A branch is "published" if a remote-tracking ref exists for it.
      // Remote-tracking branches (remotes/origin/... or origin/...) are always published.
      const isRemoteTrackingBranch = currentBranch?.startsWith('remotes/') || currentBranch?.startsWith('origin/');

      // Resolve the remote-tracking ref: prefer configured upstream, then search all remotes.
      let resolvedRemoteRef: string | null =
        upstreamFullRef && upstreamFullRef.startsWith('refs/remotes/')
          ? upstreamFullRef
          : rawTracking
          ? `refs/remotes/${rawTracking}`
          : configuredTracking
            ? `refs/remotes/${configuredTracking}`
            : null;

      if (!resolvedRemoteRef && currentBranch && !isRemoteTrackingBranch) {
        try {
          const raw = await git.raw(['for-each-ref', `refs/remotes/*/${currentBranch}`, '--format=%(refname)']);
          const refs = raw.trim().split('\n').filter(Boolean);
          if (refs.length > 0) {
            resolvedRemoteRef = refs.find(r => r.includes('/origin/')) || refs[0];
          }
        } catch {
          // No remote-tracking refs found — branch is local-only
        }
      }

      // Published = has a remote-tracking ref we can compare against
      const isPublished =
        isRemoteTrackingBranch ||
        Boolean(rawTracking) ||
        Boolean(configuredTracking) ||
        Boolean(resolvedRemoteRef);

      // Return a stable tracking value even when the local branch has no configured upstream
      // but a matching remote branch exists.
      const tracking =
        upstreamShort ||
        rawTracking ||
        configuredTracking ||
        (resolvedRemoteRef ? resolvedRemoteRef.replace(/^refs\/remotes\//, "") : null);

      // Always compute ahead/behind via rev-list for ground-truth accuracy.
      // simple-git's status.ahead can be 0 when tracking info isn't fully resolved.
      let ahead = status.ahead;
      let behind = status.behind;

      let comparedWithUpstream = false;
      if (upstreamFullRef) {
        try {
          const countsRaw = await git.raw(['rev-list', '--left-right', '--count', `HEAD...${upstreamFullRef}`]);
          const [aheadRaw, behindRaw] = countsRaw.trim().split(/\s+/);
          ahead = parseInt(aheadRaw || '0', 10) || 0;
          behind = parseInt(behindRaw || '0', 10) || 0;
          comparedWithUpstream = true;
        } catch {
          comparedWithUpstream = false;
        }
      }

      if (!comparedWithUpstream && isPublished && resolvedRemoteRef && !isRemoteTrackingBranch) {
        try {
          const [aheadRaw, behindRaw] = await Promise.all([
            git.raw(['rev-list', '--count', `${resolvedRemoteRef}..HEAD`]),
            git.raw(['rev-list', '--count', `HEAD..${resolvedRemoteRef}`]),
          ]);
          ahead = parseInt(aheadRaw.trim()) || 0;
          behind = parseInt(behindRaw.trim()) || 0;
        } catch {
          // remote ref not available — fall back to status values
        }
      }

      // Ground-truth count of commits reachable from HEAD that are not reachable from any
      // fetched remote-tracking branch. This covers unpublished branches and cases where
      // upstream metadata is incomplete.
      let outgoingCount = 0;
      if (!resolvedRemoteRef) {
        try {
          const outgoingRaw = await git.raw(['rev-list', '--count', 'HEAD', '--not', '--remotes']);
          outgoingCount = parseInt(outgoingRaw.trim()) || 0;
        } catch {
          outgoingCount = 0;
        }

        if (outgoingCount > ahead) {
          ahead = outgoingCount;
        }
      }

      // For unpublished branches, determine whether HEAD contains local commits that are not
      // present on any fetched remote branch yet. This allows the UI to show "Publish" only
      // after a new commit exists on the branch.
      let outgoing = ahead > 0;
      if (!resolvedRemoteRef && !outgoing && !isPublished && currentBranch && !isRemoteTrackingBranch) {
        try {
          const containingRemoteBranches = await git.raw(['branch', '-r', '--contains', 'HEAD']);
          outgoing = containingRemoteBranches.trim().length === 0;
        } catch {
          outgoing = false;
        }
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
        staged: status.staged,
        modified: status.modified,
        untracked: status.not_added,
        deleted: status.deleted,
        conflicted: status.conflicted,
        published: isPublished,
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
  });

  // Stage files
  ipcMain.handle("git:stage", async (event: IpcMainInvokeEvent, files: string[]) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      throw new Error("No active project selected.");
    }

    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
    if (!activeProject) {
      return null;
    }

    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
  });

  // Get files changed in a specific commit
  ipcMain.handle("git:getCommitFiles", async (event, commitHash: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) {
      return [];
    }

    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        throw new Error("Not a git repository");
      }
      await git.addRemote("origin", remoteUrl);
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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

  // Get the fetch URL of the tracked remote (fallback: origin, then first remote)
  ipcMain.handle("git:getRemoteUrl", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;
    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return null;
      const status = await git.status();
      const remotes = await git.getRemotes(true);
      const trackedRemote = trackingToRemoteName(status.tracking || null);
      if (trackedRemote) {
        const tracked = remotes.find((r) => r.name === trackedRemote);
        if (tracked?.refs?.fetch || tracked?.refs?.push) {
          return tracked.refs.fetch || tracked.refs.push || null;
        }
      }
      const origin = remotes.find((r) => r.name === "origin");
      if (origin?.refs?.fetch || origin?.refs?.push) {
        return origin.refs.fetch || origin.refs.push || null;
      }
      const first = remotes[0];
      return first?.refs?.fetch || first?.refs?.push || null;
    } catch {
      return null;
    }
  });

  // Remove the origin remote entirely (disconnect without deleting history)
  ipcMain.handle("git:removeRemote", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) throw new Error("Not a git repository");
      await git.removeRemote("origin");
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) throw new Error("Not a git repository");
      const remotes = await git.getRemotes(false);
      if (remotes.some((r) => r.name === "origin")) {
        await git.raw(["remote", "set-url", "origin", remoteUrl]);
      } else {
        await git.addRemote("origin", remoteUrl);
      }
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

    const git = simpleGit(activeProject);
    const isRepo = await git.checkIsRepo();
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
  });

  // Stash current changes (with optional message)
  ipcMain.handle("git:stash", async (event: IpcMainInvokeEvent, message?: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = simpleGit(activeProject);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) throw new Error("Not a git repository");
    const args = message ? ['push', '-m', message] : ['push'];
    await git.raw(['stash', ...args]);
    return true;
  });

  // List all stashes
  ipcMain.handle("git:stashList", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return [];
    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return [];
      const raw = await git.raw(['stash', 'list', '--format=%gd|%s|%cr']);
      return raw.trim().split('\n').filter(Boolean).map((line, index) => {
        const [ref, subject, date] = line.split('|');
        return { index, ref: ref?.trim(), message: subject?.trim(), date: date?.trim() };
      });
    } catch {
      return [];
    }
  });

  // Pop a stash by index
  ipcMain.handle("git:stashPop", async (event: IpcMainInvokeEvent, index: number) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = simpleGit(activeProject);
    const isRepo = await git.checkIsRepo();
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
    const git = simpleGit(activeProject);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return [];

    const status = await git.status();
    const conflicted = status.conflicted;

    const conflicts = await Promise.all(
      conflicted.map(async (file) => {
        try {
          const filePath = path.join(activeProject, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const sections = parseConflictSections(content);
          return { file, sections, hasConflict: sections.length > 0 };
        } catch {
          return { file, sections: [], hasConflict: false };
        }
      })
    );

    return conflicts;
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
      const content = fs.readFileSync(filePath, 'utf8');
      const resolved = resolveConflictContent(content, resolution, sectionIndex);
      fs.writeFileSync(filePath, resolved, 'utf8');

      // If no conflict markers remain, auto-stage the file
      if (!resolved.includes('<<<<<<<')) {
        const git = simpleGit(activeProject);
        await git.add(file);
      }

      return { resolved: !resolved.includes('<<<<<<<') };
    }
  );

  ipcMain.handle("git:getFileContent", async (event: IpcMainInvokeEvent, file: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const filePath = path.join(activeProject, file);
    return fs.readFileSync(filePath, 'utf8');
  });

  // Write resolved content to disk and stage the file
  ipcMain.handle("git:saveResolvedFile", async (event: IpcMainInvokeEvent, file: string, content: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const filePath = path.join(activeProject, file);
    fs.writeFileSync(filePath, content, 'utf8');
    const git = simpleGit(activeProject);
    await git.add(file);
    invalidateGitCache(activeProject);
    return { success: true };
  });

  // Undo the last commit — moves changes back to the staging area (soft reset)
  ipcMain.handle("git:uncommit", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = simpleGit(activeProject);
    const isRepo = await git.checkIsRepo();
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
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
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
