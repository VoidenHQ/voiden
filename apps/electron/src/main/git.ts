import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getActiveProject } from "./state";
import simpleGit from "simple-git";
import * as fs from "fs";
import * as path from "path";

// Add caching to improve performance
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

// Cache for Git status and branch information
const gitStatusCache = new Map<string, GitStatusCache>();
const branchCache = new Map<string, BranchCache>();
const CACHE_EXPIRATION = 5000; // 5 seconds cache expiration

// Get cached Git status or fetch new status
export async function getCachedGitStatus(directory: string): Promise<Map<string, any>> {
  const cacheEntry = gitStatusCache.get(directory);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < CACHE_EXPIRATION) {
    return cacheEntry.status;
  }

  const gitStatusMap = new Map<string, any>();

  try {
    if (fs.existsSync(path.join(directory, ".git"))) {
      const git = simpleGit(directory);
      const isRepo = await git.checkIsRepo();

      if (isRepo) {
        const status = await git.status();

        status.files.forEach((fileStatus) => {
          const fullPath = path.join(directory, fileStatus.path);
          gitStatusMap.set(fullPath, fileStatus);
        });

        status.not_added.forEach((filePath) => {
          const fullPath = path.join(directory, filePath);
          gitStatusMap.set(fullPath, { path: filePath, index: "??", working_dir: "??" });
        });

        gitStatusCache.set(directory, {
          timestamp: Date.now(),
          status: gitStatusMap,
        });
      }
    }
  } catch (err) {
    // console.error("Error retrieving git status:", err);
  }

  return gitStatusMap;
}

// Get cached branch info or fetch new info
async function getCachedBranchInfo(projectPath: string): Promise<any> {
  const cacheEntry = branchCache.get(projectPath);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < CACHE_EXPIRATION) {
    return cacheEntry.branchSummary;
  }

  const git = simpleGit(projectPath);
  const branchSummary = await git.branch(['-a']);

  branchCache.set(projectPath, {
    timestamp: Date.now(),
    branchSummary,
  });

  return branchSummary;
}

// Invalidate caches after operations that modify Git state
export function invalidateGitCache(projectPath: string): void {
  branchCache.delete(projectPath);
  gitStatusCache.delete(projectPath);
}

// Original IPC handlers with optimized implementations
ipcMain.handle("git:getBranches", async (event:IpcMainInvokeEvent): Promise<{ branches: string[]; activeBranch: string } | null> => {
  // Get the active project directory.
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    // console.error("No active project selected.");
    return null;
  }

  const git = simpleGit(projectPath);

  try {
    // Check if the directory is a valid Git repository.
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return null;
    }

    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));

    // Use cached branch info if available.
    const branchSummary = await getCachedBranchInfo(projectPath);

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    return { branches, activeBranch };
  } catch (error) {
    // console.error("Error fetching git branches:", error);
    return null;
  }
});

ipcMain.handle("git:checkout", async (_, projectPath: string, branch: string) => {
  if (!projectPath) {
    throw new Error("No active project selected.");
  }
  try {
    // Initialize simple-git with the project path.
    const git = simpleGit(projectPath);
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

    // Invalidate caches after state change
    invalidateGitCache(projectPath);

    // Get fresh branch info
    const branchSummary = await git.branch();

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    return { activeBranch, branches };
  } catch (error) {
    // console.error("Error checking out branch:", error);
    throw error;
  }
});

ipcMain.handle("git:createBranch", async (_, projectPath: string, branch: string) => {
  if (!projectPath) {
    throw new Error("No active project selected.");
  }
  try {
    const git = simpleGit(projectPath);

    // Create and checkout the new branch
    await git.checkoutLocalBranch(branch);

    // Invalidate caches after state change
    invalidateGitCache(projectPath);

    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));

    // Get fresh branch info
    const branchSummary = await git.branch();

    const activeBranch = normalizeBranchDisplayName(branchSummary.current, remoteNames);
    const branches = dedupeBranchNames([
      branchSummary.current,
      ...branchSummary.all,
    ], remoteNames);

    return { activeBranch, branches };
  } catch (error) {
    // console.error("Error creating new branch:", error);
    throw error;
  }
});

ipcMain.handle("git:createBranchFrom", async (_, projectPath: string, branch: string, fromBranch: string) => {
  if (!projectPath) {
    throw new Error("No active project selected.");
  }
  try {
    const git = simpleGit(projectPath);

    // Create and checkout the new branch from the specified source branch
    await git.checkoutBranch(branch, fromBranch);

    // Invalidate caches after state change
    invalidateGitCache(projectPath);

    const remotes = await git.getRemotes(false);
    const remoteNames = new Set(remotes.map((r) => r.name));

    // Get fresh branch info
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

// Get diff summary between two branches
ipcMain.handle("git:diffBranches", async (event:IpcMainInvokeEvent, baseBranch: string, compareBranch: string) => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    throw new Error("No active project selected.");
  }

  try {
    const git = simpleGit(projectPath);

    // Check if repo exists
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error("Not a git repository");
    }

    // Get diff summary between branches (using two dots for direct comparison)
    const diffSummary = await git.diffSummary([`${baseBranch}..${compareBranch}`]);

    // Get list of changed files with their status
    const diff = await git.diff([`${baseBranch}..${compareBranch}`, '--name-status']);

    // Parse the diff to get file status (A=Added, M=Modified, D=Deleted, R=Renamed)
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

// Get diff for a specific file between two branches
ipcMain.handle("git:diffFile", async (event:IpcMainInvokeEvent, baseBranch: string, compareBranch: string, filePath: string) => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    throw new Error("No active project selected.");
  }

  try {
    const git = simpleGit(projectPath);

    // Get unified diff for the file
    const diff = await git.diff([`${baseBranch}..${compareBranch}`, '--', filePath]);

    return diff;
  } catch (error) {
    console.error("Error getting file diff:", error);
    throw error;
  }
});

// Get file content at a specific branch
ipcMain.handle("git:getFileAtBranch", async (event:IpcMainInvokeEvent, branch: string, filePath: string) => {
  const projectPath = await getActiveProject(event);
  if (!projectPath) {
    throw new Error("No active project selected.");
  }

  try {
    const git = simpleGit(projectPath);

    // First, get the repo root to ensure we're in a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return null;
    }

    // Get file content at the specified branch
    // Note: git show uses paths relative to the repository root
    const content = await git.show([`${branch}:${filePath}`]);

    return content;
  } catch (error) {
    // File might not exist in this branch or other git error
    console.error("Error getting file at branch:", error);
    return null;
  }
});

export const aggregateGitStatus = (nodes: TreeNode[]): any => {
  let highestPriority = 0;
  let aggregatedStatus: any = null;
  nodes.forEach((child) => {
    // For files, use the git status; for folders, use the aggregated status.
    const status = child.type === "file" ? child.git : child.aggregatedGitStatus;
    if (status) {
      // Define priorities: Modified > Added/Untracked.
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
