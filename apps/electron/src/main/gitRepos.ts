/**
 * Multiple git repositories inside one project (like VS Code's Source Control
 * repository picker). A project folder can be a repo itself, contain several
 * repos (e.g. ~/work/api, ~/work/web), or both.
 *
 * Performance:
 * - Discovery only reads directories (no git subprocesses), is bounded in depth,
 *   directory count and repo count, skips dependency/build folders, and is cached
 *   per project until the user rescans, clones or initialises a repo.
 * - Each repo's branch comes from reading .git/HEAD, not from `git`.
 * - Only the selected repo is ever polled; every git:* handler resolves its repo
 *   through getGitRepoPath, so the number of repos doesn't change git load.
 */

import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import { getActiveProject, getAppState } from "./state";
import { saveState } from "./persistState";
import { logger } from "./logger";

export interface GitRepoInfo {
  path: string;
  /** Folder name, or the project name for the root. */
  name: string;
  /** Path relative to the project root; "" for the root itself. */
  relativePath: string;
  /** Current branch, short commit for a detached HEAD, or null if unreadable. */
  branch: string | null;
}

const MAX_DEPTH = 3;
const MAX_DIRS = 2000;
const MAX_REPOS = 100;
const READ_BATCH = 16;
// Never contain repos worth listing, and can be huge.
const SKIP_DIRS = new Set([
  "node_modules", "bower_components", "vendor", "target", "dist", "build", "out", "coverage",
  "__pycache__", "venv", "Pods", "DerivedData",
]);

const repoListCache = new Map<string, string[]>();
const pendingScans = new Map<string, Promise<string[]>>();

const isInside = (root: string, candidate: string) => {
  const rel = path.relative(root, candidate);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Breadth-first scan for folders containing a .git entry (directory, or file for worktrees/submodules). */
export async function scanForRepos(root: string): Promise<string[]> {
  const t0 = Date.now();
  const repos: string[] = [];
  let level = [root];
  let dirsRead = 0;

  for (let depth = 0; depth <= MAX_DEPTH && level.length && dirsRead < MAX_DIRS && repos.length < MAX_REPOS; depth++) {
    const next: string[] = [];
    for (let i = 0; i < level.length && dirsRead < MAX_DIRS; i += READ_BATCH) {
      const batch = level.slice(i, i + READ_BATCH);
      dirsRead += batch.length;
      const listings = await Promise.all(
        batch.map((dir) => fs.promises.readdir(dir, { withFileTypes: true }).then((e) => ({ dir, entries: e })).catch(() => null)),
      );
      for (const listing of listings) {
        if (!listing) continue;
        if (listing.entries.some((e) => e.name === ".git")) repos.push(listing.dir);
        if (depth === MAX_DEPTH) continue;
        for (const entry of listing.entries) {
          // Symlinks are skipped (isDirectory is false for them), so loops can't happen.
          if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
            next.push(path.join(listing.dir, entry.name));
          }
        }
      }
    }
    level = next;
  }

  logger.debug("git", `gitRepos: scanned ${dirsRead} dirs, found ${repos.length} repos (${Date.now() - t0}ms)`, { root });
  return repos.slice(0, MAX_REPOS).sort((a, b) => (a === root ? -1 : b === root ? 1 : a.localeCompare(b)));
}

async function discoverRepos(root: string, refresh = false): Promise<string[]> {
  if (!refresh && repoListCache.has(root)) return repoListCache.get(root)!;
  if (pendingScans.has(root)) return pendingScans.get(root)!;
  const scan = scanForRepos(root)
    .then((repos) => {
      repoListCache.set(root, repos);
      return repos;
    })
    .finally(() => pendingScans.delete(root));
  pendingScans.set(root, scan);
  return scan;
}

/** Forget the repo list for a project, e.g. after a clone or `git init`. */
export function invalidateRepoList(root?: string): void {
  if (root) repoListCache.delete(root);
  else repoListCache.clear();
}

export async function readBranch(repo: string): Promise<string | null> {
  try {
    let gitDir = path.join(repo, ".git");
    const stat = await fs.promises.stat(gitDir);
    if (stat.isFile()) {
      // Worktrees and submodules: ".git" is a file pointing at the real git dir.
      const pointer = (await fs.promises.readFile(gitDir, "utf8")).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
      if (!pointer) return null;
      gitDir = path.resolve(repo, pointer);
    }
    const head = (await fs.promises.readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
    return ref ?? head.slice(0, 7);
  } catch {
    return null;
  }
}

function windowIdOf(event: IpcMainInvokeEvent): string | undefined {
  return (BrowserWindow.fromWebContents(event.sender) as any)?.windowInfo?.id;
}

function storedSelection(event: IpcMainInvokeEvent | undefined, project: string): string | undefined {
  return getAppState(event).directories[project]?.selectedGitRepo;
}

async function storeSelection(event: IpcMainInvokeEvent, project: string, repo: string | undefined): Promise<void> {
  const appState = getAppState(event);
  const dir = appState.directories[project];
  // The root is the default, so it isn't stored. Only write when it changes:
  // this runs on every repo-list refresh.
  const next = repo && repo !== project ? repo : undefined;
  if (!dir || dir.selectedGitRepo === next) return;
  if (next) dir.selectedGitRepo = next;
  else delete dir.selectedGitRepo;
  await saveState(appState, windowIdOf(event));
}

/**
 * The repo git commands should run in: an explicit repo (diff/conflict tabs
 * remember the repo they were opened from), else the repo selected in the
 * Source Control panel, else the project root. Paths outside the project are
 * never accepted.
 */
export async function getGitRepoPath(event?: IpcMainInvokeEvent, explicitRepo?: string | null): Promise<string | null> {
  const project = await getActiveProject(event);
  if (!project) return null;
  for (const candidate of [explicitRepo, storedSelection(event, project)]) {
    if (candidate && isInside(project, candidate) && fs.existsSync(candidate)) return candidate;
  }
  return project;
}

export function registerGitRepoIpcHandlers() {
  ipcMain.handle("git:listRepos", async (event: IpcMainInvokeEvent, refresh?: boolean) => {
    const project = await getActiveProject(event);
    if (!project) return { repos: [], selected: null };

    const paths = await discoverRepos(project, !!refresh);
    const repos: GitRepoInfo[] = await Promise.all(
      paths.map(async (repo) => ({
        path: repo,
        name: path.basename(repo),
        relativePath: path.relative(project, repo).split(path.sep).join("/"),
        branch: await readBranch(repo),
      })),
    );

    // Keep the selection valid: stored → root (if a repo) → first repo found.
    const stored = storedSelection(event, project);
    const selected =
      (stored && paths.includes(stored) && stored) || (paths.includes(project) ? project : paths[0]) || null;
    await storeSelection(event, project, selected ?? undefined);

    return { repos, selected };
  });

  ipcMain.handle("git:selectRepo", async (event: IpcMainInvokeEvent, repo: string) => {
    const project = await getActiveProject(event);
    if (!project) throw new Error("No active project selected.");
    const known = await discoverRepos(project);
    if (!known.includes(repo)) throw new Error(`"${repo}" is not a git repository in this project.`);
    await storeSelection(event, project, repo);
    return repo;
  });
}
