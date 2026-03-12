import { ipcMain, IpcMainInvokeEvent } from "electron";
import simpleGit from "simple-git";
import { getActiveProject } from "../state";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Local published-branch store
// Stored in <repo>/.git/voiden-published.json — git ignores unknown .git files.
// We write to this whenever we push from Voiden so that published state is
// known immediately without needing a remote fetch.
// ---------------------------------------------------------------------------

function publishedFilePath(repoPath: string): string {
  return path.join(repoPath, '.git', 'voiden-published.json');
}

function readPublishedBranches(repoPath: string): Set<string> {
  try {
    const raw = fs.readFileSync(publishedFilePath(repoPath), 'utf8');
    const data = JSON.parse(raw);
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

function markBranchPublished(repoPath: string, branch: string): void {
  try {
    const branches = readPublishedBranches(repoPath);
    branches.add(branch);
    fs.writeFileSync(publishedFilePath(repoPath), JSON.stringify([...branches]), 'utf8');
  } catch { /* ignore write errors */ }
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

      const currentBranch = branchSummary.current;

      // Determine if the current branch has been published to the remote.
      //
      // Two checks — either one being true means published:
      //   1. We pushed it from Voiden and recorded it in voiden-published.json
      //   2. The remote-tracking ref exists locally (branch was fetched/cloned)
      // Remote-tracking branches (remotes/origin/... or origin/...) are always published
      const isRemoteTrackingBranch = currentBranch?.startsWith('remotes/') || currentBranch?.startsWith('origin/');

      const publishedBranches = readPublishedBranches(activeProject);
      let isPublished = isRemoteTrackingBranch || publishedBranches.has(currentBranch);

      if (!isPublished) {
        try {
          await git.raw(['rev-parse', '--verify', `refs/remotes/origin/${currentBranch}`]);
          isPublished = true;
          // Cache it so future checks are instant
          markBranchPublished(activeProject, currentBranch);
        } catch {
          // Remote-tracking ref doesn't exist — branch is local-only
        }
      }

      // git status only gives accurate ahead/behind when the branch has a
      // configured upstream. If published but no tracking, compute manually
      // by comparing HEAD against refs/remotes/origin/<branch>.
      let ahead = status.ahead;
      let behind = status.behind;

      if (isPublished && !status.tracking && currentBranch && !isRemoteTrackingBranch) {
        try {
          const remoteRef = `refs/remotes/origin/${currentBranch}`;
          const [aheadRaw, behindRaw] = await Promise.all([
            git.raw(['rev-list', '--count', `${remoteRef}..HEAD`]),
            git.raw(['rev-list', '--count', `HEAD..${remoteRef}`]),
          ]);
          ahead = parseInt(aheadRaw.trim()) || 0;
          behind = parseInt(behindRaw.trim()) || 0;
        } catch {
          // remote ref not available — leave at defaults
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
        published: isPublished,
        tracking: status.tracking || null,
        current: status.current,
        ahead,
        behind,
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

      // Use git restore (modern) or checkout (fallback) to discard changes
      // Try restore first (Git 2.23+), fall back to checkout if it fails
      try {
        await git.raw(['restore', ...files]);
      } catch (restoreError) {
        // Fallback to checkout for older git versions
        await git.checkout(['--', ...files]);
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

  ipcMain.handle("git:push", async (_event, _projectName: string) => {
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
      await git.push("origin", "master", ["-uf"]);
    } catch (error) {
      console.error("Error pushing to git remote:", error);
      throw error;
    }
  });

  // Push current branch to origin
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
      const branch = status.current;
      if (!branch) {
        throw new Error("Could not determine current branch");
      }
      await git.push("origin", branch, ["--set-upstream"]);
      markBranchPublished(activeProject, branch);
      return { branch };
    } catch (error) {
      console.error("Error pushing branch:", error);
      throw error;
    }
  });

  // Get the fetch URL of the origin remote (or null if not configured)
  ipcMain.handle("git:getRemoteUrl", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;
    try {
      const git = simpleGit(activeProject);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return null;
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin");
      return origin?.refs?.fetch || null;
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
    await git.fetch(["--prune"]);
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
      const result = await git.pull();
      return result;
    } catch (error) {
      console.error("Error pulling from remote:", error);
      throw error;
    }
  });
}
