import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { getActiveProject } from "./state";
import simpleGit from "simple-git";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";

interface GitStatusCache {
  timestamp: number;
  status: Map<string, any>;
}

interface BranchCache {
  timestamp: number;
  branchSummary: any;
}

function normalizeBranchDisplayName(branch: string, remoteNames: Set<string>): string {
  if (!branch) return branch;
  if (branch.startsWith("remotes/")) {
    const parts = branch.split("/");
    return parts.slice(2).join("/");
  }
  const slash = branch.indexOf("/");
  if (slash > 0) {
    const prefix = branch.slice(0, slash);
    if (remoteNames.has(prefix)) {
      return branch.slice(slash + 1);
    }
  }
  return branch;
}

function dedupeBranchNames(branches: string[], remoteNames: Set<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const branch of branches) {
    const normalized = normalizeBranchDisplayName(branch, remoteNames);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

const gitStatusCache = new Map<string, GitStatusCache>();
const branchCache = new Map<string, BranchCache>();
const CACHE_EXPIRATION = 30000; // 30 seconds — reduces redundant git status calls between tree reloads

// In-flight deduplication for getCachedGitStatus so concurrent callers
// (e.g. files:tree and git:getStatus firing simultaneously) share one git process.
const pendingGitStatusFetch = new Map<string, Promise<Map<string, any>>>();

// ── isRepo cache ─────────────────────────────────────────────────────────────
// Caches whether a path is a git repo. Both truthy and falsy results are cached
// to prevent repeated subprocess spawning on non-git projects. The long TTL
// means it survives the polling cycle — only git:initialize should invalidate it.
interface IsRepoEntry { isRepo: boolean; timestamp: number; }
const isRepoCacheMap = new Map<string, IsRepoEntry>();
const IS_REPO_TTL = 300_000; // 5 minutes
// In-flight dedup: concurrent callers for the same path share one subprocess.
const pendingIsRepoFetch = new Map<string, Promise<boolean>>();

export async function getCachedIsRepo(projectPath: string): Promise<boolean> {
  const entry = isRepoCacheMap.get(projectPath);
  if (entry && Date.now() - entry.timestamp < IS_REPO_TTL) return entry.isRepo;

  // Share in-flight check — prevents 3 simultaneous checkIsRepo subprocesses
  // for the same path when multiple IPC handlers fire at startup.
  if (pendingIsRepoFetch.has(projectPath)) {
    return pendingIsRepoFetch.get(projectPath)!;
  }

  const p = (async () => {
    try {
      // Fast-path: if .git doesn't exist at root, skip the subprocess entirely.
      const hasDotGit = await fs.promises
        .access(path.join(projectPath, '.git'))
        .then(() => true)
        .catch(() => false);
      if (!hasDotGit) {
        isRepoCacheMap.set(projectPath, { isRepo: false, timestamp: Date.now() });
        logger.debug('git', 'isRepo: no .git found (fast-path, no subprocess)', { path: projectPath });
        return false;
      }
      logger.debug('git', 'isRepo: cache miss — spawning checkIsRepo subprocess', { path: projectPath });
      const t0 = Date.now();
      const isRepo = await getSharedGit(projectPath).checkIsRepo();
      logger.debug('git', `isRepo: result cached (${Date.now() - t0}ms)`, { path: projectPath, isRepo });
      isRepoCacheMap.set(projectPath, { isRepo, timestamp: Date.now() });
      return isRepo;
    } catch {
      isRepoCacheMap.set(projectPath, { isRepo: false, timestamp: Date.now() });
      return false;
    }
  })().finally(() => pendingIsRepoFetch.delete(projectPath));

  pendingIsRepoFetch.set(projectPath, p);
  return p;
}

export function invalidateRepoCache(projectPath: string): void {
  isRepoCacheMap.delete(projectPath);
}

// ── Shared git instance pool ──────────────────────────────────────────────────
// All callers for the same project path share one SimpleGit instance.
// simple-git's maxConcurrentProcesses queue is per-instance, so sharing means
// concurrent IPC handlers (startup burst, polling, file-watcher events) all feed
// through the same limit instead of each spawning unlimited git subprocesses.
const sharedGitInstances = new Map<string, ReturnType<typeof simpleGit>>();
const GIT_MAX_CONCURRENT = 3;

export function getSharedGit(projectPath: string): ReturnType<typeof simpleGit> {
  let g = sharedGitInstances.get(projectPath);
  if (!g) {
    g = simpleGit(projectPath, { maxConcurrentProcesses: GIT_MAX_CONCURRENT });
    sharedGitInstances.set(projectPath, g);
    logger.debug('git', 'getSharedGit: new shared instance created', { path: projectPath, maxConcurrentProcesses: GIT_MAX_CONCURRENT });
  }
  return g;
}

export async function getCachedGitStatus(directory: string): Promise<Map<string, any>> {
  const cacheEntry = gitStatusCache.get(directory);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < CACHE_EXPIRATION) {
    return cacheEntry.status;
  }

  // Deduplicate: if a fetch is already in-flight for this directory, share it.
  if (pendingGitStatusFetch.has(directory)) {
    return pendingGitStatusFetch.get(directory)!;
  }

  const p = (async () => {
    const gitStatusMap = new Map<string, any>();
    try {
      if (await getCachedIsRepo(directory)) {
        const git = getSharedGit(directory);
        const t0 = Date.now();
        const status = await git.status();
        const statusMs = Date.now() - t0;
        if (statusMs > 1000) {
          logger.warn('git', `getCachedGitStatus: slow git status (${statusMs}ms) — large repo or I/O contention`, {
            path: directory, statusMs,
            tip: 'Enable core.fsmonitor in this repo: git config core.fsmonitor true',
          });
        }
        status.files.forEach((fileStatus) => {
          gitStatusMap.set(path.join(directory, fileStatus.path), fileStatus);
        });
        status.not_added.forEach((filePath) => {
          gitStatusMap.set(path.join(directory, filePath), { path: filePath, index: "??", working_dir: "??" });
        });
        gitStatusCache.set(directory, { timestamp: Date.now(), status: gitStatusMap });
      }
    } catch {
      // ignore
    }
    return gitStatusMap;
  })().finally(() => pendingGitStatusFetch.delete(directory));

  pendingGitStatusFetch.set(directory, p);
  return p;
}

async function getCachedBranchInfo(projectPath: string): Promise<any> {
  const cacheEntry = branchCache.get(projectPath);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < CACHE_EXPIRATION) {
    return cacheEntry.branchSummary;
  }

  if (!await getCachedIsRepo(projectPath)) return null;
  const git = getSharedGit(projectPath);
  const branchSummary = await git.branch(['-a']);

  branchCache.set(projectPath, {
    timestamp: Date.now(),
    branchSummary,
  });

  return branchSummary;
}

// Minimum age before a git status result can be invalidated by a file watcher
// event. On large repos (homebrew-cask, linux kernel) git status takes 3-6s.
// Without this guard, a burst of file watcher events clears the cache immediately
// after it warms, causing repeated 5s-blocking git status calls.
const GIT_STATUS_MIN_AGE_MS = 5_000;

export function invalidateGitCache(projectPath: string): void {
  branchCache.delete(projectPath);
  const entry = gitStatusCache.get(projectPath);
  if (!entry || Date.now() - entry.timestamp >= GIT_STATUS_MIN_AGE_MS) {
    gitStatusCache.delete(projectPath);
  }
}

ipcMain.handle("git:getBranches", async (event:IpcMainInvokeEvent): Promise<{ branches: string[]; activeBranch: string } | null> => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    return null;
  }

  try {
    if (!await getCachedIsRepo(projectPath)) return null;
    const git = getSharedGit(projectPath);

    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));

    const branchSummary = await getCachedBranchInfo(projectPath);
    if (!branchSummary) return null;

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    return { branches, activeBranch };
  } catch (error) {
    return null;
  }
});

ipcMain.handle("git:checkout", async (event, projectPath: string, branch: string) => {
  if (!projectPath) {
    throw new Error("No active project selected.");
  }
  try {
    const git = getSharedGit(projectPath);
    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));
    const localBranches = await git.branchLocal();
    const hasLocalBranch = localBranches.all.includes(branch);

    if (hasLocalBranch) {
      await git.checkout(branch);
    } else {
      const remoteCandidates = [
        ...Array.from(remoteNames).map((remote) => `${remote}/${branch}`),
        branch,
      ];

      let remoteBranch: string | null = null;
      for (const candidate of remoteCandidates) {
        try {
          const raw = await git.raw(['show-ref', '--verify', `refs/remotes/${candidate}`]);
          if (raw.trim()) {
            remoteBranch = candidate;
            break;
          }
        } catch {
          // remote ref not found
        }
      }

      if (remoteBranch) {
        const [remoteName, ...rest] = remoteBranch.split('/');
        const localBranchName = rest.join('/');
        await git.raw([
          'checkout',
          '-B',
          localBranchName,
          `refs/remotes/${remoteName}/${localBranchName}`,
        ]);
        await git.raw(['config', `branch.${localBranchName}.remote`, remoteName]);
        await git.raw(['config', `branch.${localBranchName}.merge`, `refs/heads/${localBranchName}`]);
      } else {
        await git.checkout(branch);
      }
    }

    invalidateGitCache(projectPath);

    const branchSummary = await git.branch();

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    BrowserWindow.fromWebContents(event.sender)?.webContents.send('git:changed', { path: projectPath });

    return { activeBranch, branches };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle("git:createBranch", async (_, projectPath: string, branch: string) => {
  if (!projectPath) {
    throw new Error("No active project selected.");
  }
  try {
    const git = getSharedGit(projectPath);
    await git.checkoutLocalBranch(branch);
    invalidateGitCache(projectPath);

    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));
    const branchSummary = await git.branch();

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    return { activeBranch, branches };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle("git:createBranchFrom", async (_, projectPath: string, branch: string, fromBranch: string) => {
  if (!projectPath) {
    throw new Error("No active project selected.");
  }
  try {
    const git = getSharedGit(projectPath);
    await git.checkoutBranch(branch, fromBranch);
    invalidateGitCache(projectPath);

    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));
    const branchSummary = await git.branch();

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    return { activeBranch, branches };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('git:updateGitignore', async (_event, filePatterns: string | string[], rootDir = '.') => {
  await updateGitignore(filePatterns, rootDir);
})

ipcMain.handle("git:diffBranches", async (event:IpcMainInvokeEvent, baseBranch: string, compareBranch: string) => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    throw new Error("No active project selected.");
  }

  try {
    if (!await getCachedIsRepo(projectPath)) throw new Error("Not a git repository");
    const git = getSharedGit(projectPath);

    const diffSummary = await git.diffSummary([`${baseBranch}..${compareBranch}`]);
    const diff = await git.diff([`${baseBranch}..${compareBranch}`, '--name-status']);
    const fileChanges = diff.split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split('\t');
      const status = parts[0];
      const filePath = parts[1];
      const oldPath = status.startsWith('R') ? parts[1] : null;
      const newPath = status.startsWith('R') ? parts[2] : filePath;

      return {
        status,
        path: newPath,
        oldPath,
      };
    });

    return {
      summary: {
        files: diffSummary.files.length,
        insertions: diffSummary.insertions,
        deletions: diffSummary.deletions,
      },
      files: fileChanges,
    };
  } catch (error) {
    console.error("Error getting diff between branches:", error);
    throw error;
  }
});

ipcMain.handle("git:diffFile", async (event:IpcMainInvokeEvent, baseBranch: string, compareBranch: string, filePath: string) => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    throw new Error("No active project selected.");
  }

  try {
    const git = getSharedGit(projectPath);
    const diff = await git.diff([`${baseBranch}..${compareBranch}`, '--', filePath]);

    return diff;
  } catch (error) {
    console.error("Error getting file diff:", error);
    throw error;
  }
});

ipcMain.handle("git:getFileAtBranch", async (event:IpcMainInvokeEvent, branch: string, filePath: string) => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    throw new Error("No active project selected.");
  }

  try {
    if (!await getCachedIsRepo(projectPath)) return null;
    const git = getSharedGit(projectPath);
    const content = await git.show([`${branch}:${filePath}`]);

    return content;
  } catch (error) {
    return null;
  }
});

export const aggregateGitStatus = (nodes: TreeNode[]): any => {
  let highestPriority = 0;
  let aggregatedStatus: any = null;
  nodes.forEach((child) => {
    const status = child.type === "file" ? child.git : child.aggregatedGitStatus;
    if (status) {
      let priority = 0;
      if (status.working_dir === "M" || status.index === "M") {
        priority = 2;
      } else if (
        status.working_dir === "A" ||
        status.index === "A" ||
        (status.working_dir && status.working_dir.startsWith("?")) ||
        (status.index && status.index.startsWith("?"))
      ) {
        priority = 1;
      }
      if (priority > highestPriority) {
        highestPriority = priority;
        aggregatedStatus = status;
      }
    }
  });
  return aggregatedStatus;
};

export async function ensureVoidenGitignore(rootDir: string): Promise<void> {
  const gitignorePath = path.join(rootDir, '.gitignore');

  let existing = '';
  try {
    existing = await fs.promises.readFile(gitignorePath, 'utf8');
  } catch {
    // file doesn't exist yet — create it
  }

  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes('.voiden/')) return; // already covered

  let content = existing;
  if (content && !content.endsWith('\n')) content += '\n';
  content += '\n# Voiden\n.voiden/\n!.voiden/env-public.yaml\n!.voiden/env-*-public.yaml\n';

  await fs.promises.writeFile(gitignorePath, content, 'utf8');
}

export async function updateGitignore(filePatterns: string | string[], rootDir = '.') {
  const gitignorePath = path.join(rootDir, '.gitignore');

  try {
    // Check if .gitignore exists
    if (!fs.existsSync(gitignorePath)) {
      return false;
    }

    // Read existing .gitignore content
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const existingLines = gitignoreContent.split('\n').map((line: string) => line.trim());

    // Ensure filePatterns is an array
    const patterns = Array.isArray(filePatterns) ? filePatterns : [filePatterns];
    const patternsToAdd = [];

    // Check which patterns are not already in .gitignore
    for (const pattern of patterns) {
      const isAlreadyPresent = existingLines.some((line: string) =>
        line === pattern || line === `/${pattern}`
      );

      if (!isAlreadyPresent) {
        patternsToAdd.push(pattern);
      }
    }

    // If no patterns to add, return early
    if (patternsToAdd.length === 0) {
      return true;
    }

    // Add new patterns to .gitignore
    let newContent = gitignoreContent.trim();

    // Add newline if content doesn't end with newline
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }

    // Add the new patterns
    newContent += patternsToAdd.join('\n') + '\n';

    // Write back to .gitignore
    fs.writeFileSync(gitignorePath, newContent, 'utf8');

  } catch (error) {
    console.error('Error updating .gitignore:', error.message);
  }
}

// Example implementation of buildFileTree.
