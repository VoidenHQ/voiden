import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow } from "electron";
import { simpleGit, StatusResult } from "simple-git";
import { getActiveProject } from "../state";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { invalidateGitCache, getCachedIsRepo, invalidateRepoCache, getSharedGit, ensureVoidenGitignore } from "../git";
import { setCloning } from "../fileWatcher";
import { logger } from "../logger";
import { getSettings, getDefaultProjectsDirectory } from "../settings";
import {
  COMMIT_DETAILS_FORMAT,
  mergeCommitFileStats,
  parseCommitDetails,
  parseNameStatusZ,
  parseNumstatZ,
} from "./gitCommitParsers";
import { resolveAuthorAvatar } from "./gitAvatars";
import { SNIFF_BYTES, fileCategory, isBinaryCategory } from "../fileKind";

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

// simple-git's StatusSummary only fills `staged` for a handful of porcelain
// codes — renames (R), copies (C), type changes (T) and "staged then deleted"
// (AD/MD) are missing. Deleting a committed file and staging a similar new one
// makes git report the pair as a rename, so both vanished from Staged Changes.
// Classify straight from each file's index / working-tree codes instead.
function classifyStatusFiles(status: StatusResult) {
  const conflicted = new Set(status.conflicted);
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const deleted: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];

  for (const file of status.files) {
    const x = file.index;
    const y = file.working_dir;
    if (conflicted.has(file.path) || x === '!') continue;
    if (x === '?') {
      untracked.push(file.path);
      continue;
    }
    if (x !== ' ') staged.push(file.path);
    if ((x === 'R' || x === 'C') && file.from && file.from !== file.path) {
      renamed.push({ from: file.from, to: file.path });
    }
    if (x === 'M' || y === 'M' || y === 'T') modified.push(file.path);
    if (x === 'D' || y === 'D') deleted.push(file.path);
  }

  return { staged, modified, untracked, deleted, renamed, conflicted: status.conflicted };
}

// Env vars simple-git refuses to spawn with unless each is explicitly allowed,
// because they can make git run arbitrary programs. simple-git v4 guards every
// GIT_-prefixed key plus a few non-prefixed ones. Clone passes a custom env, so
// anything inherited from the user's shell (EDITOR, PAGER, a GIT_ASKPASS left
// by an IDE terminal, …) aborted the clone before git even ran. None of them
// matter for a clone; strip them and allow only what the auth mode itself sets
// (see CLONE_ALLOWED_ENV).
const SIMPLE_GIT_GUARDED_ENV = new Set(['editor', 'pager', 'prefix', 'ssh_askpass', 'visual']);

const CLONE_ALLOWED_ENV = ['GIT_TERMINAL_PROMPT', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSH_COMMAND'];

function cloneBaseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const lower = key.toLowerCase();
    if (SIMPLE_GIT_GUARDED_ENV.has(lower) || lower.startsWith('git_')) continue;
    env[key] = value;
  }
  // Always suppress interactive terminal prompts regardless of auth mode.
  // Without this, git can hang waiting for keyboard input inside Electron.
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
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


/** True for files that must never be read or written as text, like images (#610). */
async function isBinaryOnDisk(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const head = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
      return isBinaryCategory(fileCategory(filePath, head.subarray(0, bytesRead)), filePath);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

const BINARY_TEXT_SAVE = "This is a binary file, so it cannot be resolved as text. Keep the Current or the Incoming version instead.";

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

  ipcMain.handle("git:clone", async (
    event: IpcMainInvokeEvent,
    repoUrl: string,
    authOptions?: { token?: string; sshKeyPath?: string; sshPassphrase?: string; useSshAgent?: boolean },
  ) => {
    const activeProject = await getActiveProject(event);

    const { token, sshKeyPath, sshPassphrase, useSshAgent } = authOptions ?? {};

    // Strips embedded credentials from any URL in an error message (global).
    const redact = (s: string) => s.replace(/:[^@\s]*@/g, ':***@');

    // Temp files written for credential helpers — always cleaned up in finally.
    const tempFiles: string[] = [];
    const cleanupTempFiles = async () => {
      await Promise.all(tempFiles.map((f) => fs.promises.unlink(f).catch(() => {})));
      tempFiles.length = 0;
    };

    const writeTempScript = async (content: string): Promise<string> => {
      const scriptPath = path.join(os.tmpdir(), `voiden-git-helper-${Date.now()}.sh`);
      await fs.promises.writeFile(scriptPath, content, { mode: 0o700 });
      tempFiles.push(scriptPath);
      return scriptPath;
    };

    try {
      let cloneUrl = repoUrl;
      const baseEnv = cloneBaseEnv();
      let cloneEnv: NodeJS.ProcessEnv = baseEnv;
      // Per-command `git -c` config for this clone only (auth-mode specific).
      // Unlike `git clone -c`, this is not written into the new repo's config.
      let cloneConfig: string[] = [];

      if (token) {
        let parsed: URL;
        try {
          parsed = new URL(repoUrl);
        } catch {
          throw new Error("Invalid repository URL. For token authentication use an https:// URL.");
        }

        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error("Access tokens only work with HTTPS URLs. For SSH, configure an SSH key instead.");
        }

        // GIT_ASKPASS script echoes credentials without putting them on the command line.
        const scriptPath = await writeTempScript([
          '#!/bin/sh',
          'case "$1" in',
          '  *Username*) echo "oauth2" ;;',
          `  *) echo ${JSON.stringify(token)} ;;`,
          'esac',
        ].join('\n') + '\n');

        // Disable the system credential helper (-c credential.helper=) so GIT_ASKPASS
        // is the ONLY credential source. Without this, osxkeychain/etc. takes precedence
        // and the provided token is silently ignored when the system has cached credentials.
        cloneConfig = ['credential.helper='];
        cloneEnv = { ...baseEnv, GIT_ASKPASS: scriptPath };
        cloneUrl = parsed.toString(); // credential-free URL
      } else if (useSshAgent) {
        // SSH agent mode — no specific key, let the agent supply credentials.
        // StrictHostKeyChecking=accept-new avoids interactive prompts for new hosts.
        // BatchMode=yes makes ssh fail immediately instead of prompting when no key matches.
        cloneEnv = {
          ...baseEnv,
          GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
        };
      } else if (sshKeyPath) {
        // Specific key file — use it exclusively (IdentitiesOnly=yes ignores agent keys).
        let sshCmd = `ssh -i ${JSON.stringify(sshKeyPath)} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;

        if (sshPassphrase) {
          // SSH_ASKPASS supplies the passphrase non-interactively.
          const passScript = await writeTempScript([
            '#!/bin/sh',
            `echo ${JSON.stringify(sshPassphrase)}`,
          ].join('\n') + '\n');
          cloneEnv = {
            ...baseEnv,
            GIT_SSH_COMMAND: sshCmd,
            SSH_ASKPASS: passScript,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY ?? '',
          };
        } else {
          cloneEnv = { ...baseEnv, GIT_SSH_COMMAND: sshCmd };
        }
      } else {
        // Auto mode — let the OS credential helper (osxkeychain, Windows
        // Credential Manager, etc.) supply credentials automatically.
        // If the user has previously authenticated with the host, this just works.
        // cloneConfig and cloneEnv stay as their defaults (empty / baseEnv).
      }

      const baseName = repoUrl.replace(/\.git$/, "").split("/").pop() || "repo";

      const dirExists = (p: string) =>
        fs.promises.access(p).then(() => true).catch(() => false);

      const sendProgress = (stage: string, progress: number) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send("git:clone:progress", { stage, progress });
          }
        } catch { /* renderer disposed */ }
      };

      // simple-git rejects the credential helper override and the askpass / ssh
      // command env vars set above unless each is opted into. The env must go
      // through .env() — simpleGit({ env }) is not an option and was silently
      // dropped, so the token / key never reached git.
      const makeProgressGit = (baseDir: string) =>
        simpleGit({
          baseDir,
          config: cloneConfig,
          allowEnvironment: CLONE_ALLOWED_ENV.filter((key) => cloneEnv[key] !== undefined),
          unsafe: {
            allowUnsafeCredentialHelper: cloneConfig.length > 0,
            allowUnsafeAskPass: !!(cloneEnv.GIT_ASKPASS || cloneEnv.SSH_ASKPASS),
            allowUnsafeSshCommand: !!cloneEnv.GIT_SSH_COMMAND,
          },
          progress({ stage, progress }) {
            sendProgress(stage, progress);
          },
        }).env(cloneEnv);

      if (!activeProject) {
        const settings = getSettings();
        const voidenHome = settings.projects.default_directory || getDefaultProjectsDirectory();
        await fs.promises.mkdir(voidenHome, { recursive: true });

        let newFolderName = baseName;
        let newCounter = 1;
        while (await dirExists(path.join(voidenHome, newFolderName))) {
          newFolderName = `${baseName}-${newCounter}`;
          newCounter++;
        }

        const newProjectPath = path.join(voidenHome, newFolderName);

        const gitParent = makeProgressGit(voidenHome);
        setCloning(newProjectPath, true);
        let newLfsWarning = false;
        try {
          await gitParent.clone(cloneUrl, newFolderName, ["--no-local"]);
        } catch (cloneErr: any) {
          const msg: string = cloneErr?.message || String(cloneErr);
          if (msg.includes("Clone succeeded, but checkout failed") || (msg.includes("git-lfs") && msg.includes("command not found"))) {
            newLfsWarning = true;
          } else {
            throw cloneErr;
          }
        } finally {
          setCloning(newProjectPath, false);
        }

        // Detect empty repos — git clone exits 0 for repos with no commits,
        // so we have to check explicitly. `git log` throws on an empty repo.
        let newIsEmptyRepo = false;
        try {
          const clonedGit = simpleGit(newProjectPath);
          const log = await clonedGit.log({ maxCount: 1 });
          newIsEmptyRepo = log.all.length === 0;
        } catch {
          newIsEmptyRepo = true;
        }

        const voidenDir = path.join(newProjectPath, ".voiden");
        await fs.promises.mkdir(voidenDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(voidenDir, ".voiden-projects"),
          JSON.stringify({ project: newFolderName })
        );

        return { clonedPath: newProjectPath, clonedInPlace: false, isNewProject: true, lfsWarning: newLfsWarning, emptyRepo: newIsEmptyRepo };
      }

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
        await gitWithProgress.clone(cloneUrl, folderName, ["--no-local"]);
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

      // Detect empty repos — git clone exits 0 for repos with no commits.
      let isEmptyRepo = false;
      try {
        const clonedGit = simpleGit(clonedPath);
        const log = await clonedGit.log({ maxCount: 1 });
        isEmptyRepo = log.all.length === 0;
      } catch {
        isEmptyRepo = true;
      }

      return { clonedPath, clonedInPlace: false, isNewProject: false, lfsWarning, emptyRepo: isEmptyRepo };
    } catch (error: any) {
      // Sanitize before logging — error message from git may contain the repo URL
      const raw: string = redact(error?.message || String(error));
      logger.error('git', 'clone failed', { error: raw });

      // Translate common git errors into friendly messages
      if (raw.includes("Repository not found") || raw.includes("does not exist")) {
        throw new Error(token
          ? "Repository not found, or your access token can't see it. Check the URL and that the token has access to this repository."
          : "Repository not found. Check the URL — if the repository is private, switch to Access Token or SSH Key.");
      }
      if (raw.includes("Bad passphrase") || raw.includes("incorrect passphrase")) {
        throw new Error("The SSH key passphrase is incorrect. Re-enter it and try again.");
      }
      if (raw.includes("Host key verification failed")) {
        throw new Error("The server's SSH host key could not be verified. Connect once from a terminal (ssh -T git@<host>) to trust it, then try again.");
      }
      if (raw.includes("Permission denied (publickey)") || raw.includes("No such identity")) {
        if (useSshAgent) {
          throw new Error("SSH authentication failed. Add your key to the agent (ssh-add ~/.ssh/id_ed25519) and make sure it's registered with your git host.");
        }
        throw new Error("SSH authentication failed. Check the key file path and that the key is registered with your git host.");
      }
      if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|\b40[13]\b/.test(raw)) {
        throw new Error(token
          ? "The access token was rejected. Check that it's correct, hasn't expired, and has read access to this repository (e.g. the \"repo\" scope on GitHub)."
          : "This repository needs authentication. Switch to Access Token and paste a personal access token, or use SSH Key.");
      }
      if (raw.includes("invalid url") || raw.includes("not a valid URL") || raw.includes("unsupported protocol") || raw.includes("Unable to find remote helper")) {
        throw new Error("Invalid repository URL. Use an https:// or git@host:owner/repo URL.");
      }
      if (/Name or service not known|Could not resolve host|Failed to connect|Connection timed out|Network is unreachable/.test(raw)) {
        throw new Error("Couldn't reach the git server. Check your internet connection and the repository URL.");
      }
      if (/SSL certificate problem|server certificate verification failed/.test(raw)) {
        throw new Error("The server's SSL certificate couldn't be verified. If you're behind a corporate proxy, configure git's http.sslCAInfo.");
      }
      if (raw.includes("already exists and is not an empty directory")) {
        throw new Error("A folder with that name already exists in the project directory. Rename or remove it and try again.");
      }

      throw new Error(raw);
    } finally {
      await cleanupTempFiles();
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
      invalidateRepoCache(activeProject);
      // Make sure .voiden/* (except public env YAMLs) is ignored from the very
      // first commit — the file watcher's .gitignore handler then invalidates
      // the git/tree caches when this write lands.
      await ensureVoidenGitignore(activeProject).catch(() => {});
      return true;
    } catch (error) {
      console.error("Error initializing git repository:", error);
      throw error;
    }
  });

  ipcMain.handle("git:getStatus", async (event: IpcMainInvokeEvent) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;
    try { await fs.promises.access(activeProject); } catch { return null; }
    return dedupeCall(pendingStatus, activeProject, async () => {
    try {
      if (!await getCachedIsRepo(activeProject)) return null;

      // Don't ensureVoidenGitignore here: doing it on every refresh re-wrote
      // .gitignore (and re-untracked .voiden files) right after the user
      // discarded those changes. Commit still runs it as the last line of defence.

      const git = getSharedGit(activeProject);

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

      if (!rawTracking && currentBranch && !isRemoteTrackingBranch) {
        try {
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

      let outgoing = ahead > 0;
      if (!resolvedRemoteRef) {
        try {
          const outRaw = await git.raw(['rev-list', '--count', 'HEAD', '--not', '--remotes']);
          const outgoingCount = parseInt(outRaw.trim()) || 0;
          if (outgoingCount > ahead) ahead = outgoingCount;
          outgoing = outgoingCount > 0 || ahead > 0;
        } catch { outgoing = false; }
      }

      const { staged, modified, untracked, deleted, renamed, conflicted } = classifyStatusFiles(status);
      const fileStatuses = new Map(status.files.map((file) => [file.path, file]));

      return {
        files: [...new Set([...staged, ...modified, ...untracked, ...deleted])].map((file) => ({
          path: file,
          index: fileStatuses.get(file)?.index ?? ' ',
          workingTree: fileStatuses.get(file)?.working_dir ?? ' ',
          status: staged.includes(file)
            ? "staged"
            : modified.includes(file)
              ? "modified"
              : untracked.includes(file)
                ? "untracked"
                : "deleted",
        })),
        staged,
        modified,
        untracked,
        deleted,
        renamed,
        conflicted,
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
      // A staged rename is listed under its new path only — unstage the old
      // path with it so its deletion doesn't linger in Staged on its own.
      const status = await git.status();
      const targets = new Set(files);
      for (const file of status.files) {
        if (file.from && file.from !== file.path && targets.has(file.path)) targets.add(file.from);
      }
      await git.reset(['HEAD', '--', ...targets]);
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
      // Last line of defence: never let an ignored .voiden file (history,
      // process vars, private envs) be committed — and so never pushed.
      await ensureVoidenGitignore(activeProject).catch(() => {});
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

      // Diff against the first parent; the initial commit has none, so diff-tree --root lists what it introduced.
      let hasParent = true;
      try {
        await git.raw(['rev-parse', '--verify', '--quiet', `${commitHash}^`]);
      } catch {
        hasParent = false;
      }
      const diffArgs = hasParent
        ? ['diff', '-M', '-z', `${commitHash}^`, commitHash]
        : ['diff-tree', '-r', '-M', '-z', '--root', '--no-commit-id', commitHash];

      const [nameStatusRaw, numstatRaw] = await Promise.all([
        git.raw([...diffArgs, '--name-status']),
        git.raw([...diffArgs, '--numstat']),
      ]);

      return mergeCommitFileStats(parseNameStatusZ(nameStatusRaw), parseNumstatZ(numstatRaw));
    } catch (error) {
      console.error("Error getting commit files:", error);
      return [];
    }
  });

  // Full metadata for one commit (full message, emails, dates) for the history hover card
  ipcMain.handle("git:getCommitDetails", async (event, commitHash: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) return null;

    try {
      if (!await getCachedIsRepo(activeProject)) return null;
      const git = getSharedGit(activeProject);
      const raw = await git.raw(['show', '-s', `--format=${COMMIT_DETAILS_FORMAT}`, commitHash]);
      return parseCommitDetails(raw);
    } catch (error) {
      console.error("Error getting commit details:", error);
      return null;
    }
  });

  // Avatar URL for a commit author (GitHub, then Gravatar); null when unknown
  ipcMain.handle("git:getAuthorAvatar", async (event, email: string, commitHash: string) => {
    const activeProject = await getActiveProject(event);
    if (!activeProject || !email) return null;

    try {
      if (!await getCachedIsRepo(activeProject)) return await resolveAuthorAvatar(email, commitHash, null);
      const git = getSharedGit(activeProject);
      const remotes = await git.getRemotes(true);
      const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
      const remoteUrl = remote?.refs?.fetch || remote?.refs?.push || null;
      // Latest commit by this author on any remote branch (email matched literally, not as a regex).
      const findPushedCommit = async () =>
        (await git.raw(['log', '--remotes', '-n', '1', '--format=%H', '--fixed-strings', `--author=<${email}>`])).trim() || null;
      return await resolveAuthorAvatar(email, commitHash, remoteUrl, findPushedCommit);
    } catch (error) {
      console.error("Error resolving author avatar:", error);
      return null;
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
    // Clones made by older Voiden versions used --depth 1, so their history
    // stopped at a single commit. Pull the rest in once on the next fetch.
    let isShallow = false;
    try {
      isShallow = (await git.revparse(['--is-shallow-repository'])).trim() === 'true';
    } catch { /* git < 2.15 — leave as is */ }
    const unshallowRemote = remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name;
    if (remotes.length === 0) {
      await git.fetch(["--prune", "--all"]);
    } else {
      for (const remote of remotes) {
        await git.raw([
          'fetch',
          remote.name,
          '--prune',
          ...(isShallow && remote.name === unshallowRemote ? ['--unshallow'] : []),
          `+refs/heads/*:refs/remotes/${remote.name}/*`,
        ]);
      }
    }
    if (isShallow) logger.info('git', 'unshallowed repository on fetch', { project: activeProject });
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
      if (await isBinaryOnDisk(filePath)) throw new Error(BINARY_TEXT_SAVE);
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
    // Writing text over an image or other binary file would break it.
    if (await isBinaryOnDisk(filePath)) throw new Error(BINARY_TEXT_SAVE);
    fs.writeFileSync(filePath, content, 'utf8');
    const git = getSharedGit(activeProject);
    await git.add(file);
    invalidateGitCache(activeProject);
    return { success: true };
  });

  // Resolve a conflict in a binary file by keeping one whole version (#610).
  // When the chosen side deleted the file, keeping it means removing the file.
  ipcMain.handle("git:resolveBinaryConflict", async (event: IpcMainInvokeEvent, file: string, side: "current" | "incoming") => {
    const activeProject = await getActiveProject(event);
    if (!activeProject) throw new Error("No active project selected.");
    const git = getSharedGit(activeProject);
    const stage = side === "current" ? ":2" : ":3";
    let sideExists = true;
    try {
      await git.raw(["cat-file", "-e", `${stage}:${file}`]);
    } catch {
      sideExists = false;
    }
    if (sideExists) {
      await git.raw(["checkout", side === "current" ? "--ours" : "--theirs", "--", file]);
      await git.add(file);
    } else {
      await git.raw(["rm", "--quiet", "--", file]);
    }
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
