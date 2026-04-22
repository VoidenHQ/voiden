import chokidar from "chokidar";
import path from "node:path";
import eventBus from "./eventBus";
import { invalidateGitCache } from "./git";
import { clearTreeResultCache } from "./ipc/files";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────
interface WatcherEntry {
  watcher: chokidar.FSWatcher;
}

// ── State ─────────────────────────────────────────────────────────────────────
const watchers = new Map<string, WatcherEntry>();
const cloningPaths = new Set<string>();
const deletingPaths = new Set<string>();
const writingPaths = new Map<string, ReturnType<typeof setTimeout>>();

// ── Helpers ───────────────────────────────────────────────────────────────────
function isCloningActive(filePath: string): boolean {
  for (const dir of cloningPaths) {
    if (filePath.startsWith(dir)) return true;
  }
  return false;
}

function isDeletingActive(filePath: string): boolean {
  for (const dir of deletingPaths) {
    if (filePath === dir || filePath.startsWith(dir + path.sep)) return true;
  }
  return false;
}

function isWritingActive(filePath: string): boolean {
  return writingPaths.has(filePath);
}

function debounce(func: (...args: any[]) => void, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// ── Core watch logic ──────────────────────────────────────────────────────────
function startWatching(projectPath: string, watcherId: string) {
  stopWatching(watcherId);

  logger.info("system", "FileWatcher: startWatching", { projectPath, watcherId });

  // Phase 1 — project root, .git excluded entirely so the initial scan is fast.
  const gitPaths = [
    path.join(projectPath, ".git", "HEAD"),
    path.join(projectPath, ".git", "index"),
    path.join(projectPath, ".git", "refs", "**", "*"),
    path.join(projectPath, ".env"),
    path.join(projectPath, ".env.*"),
  ];

  const watcher = chokidar.watch(projectPath, {
    persistent: true,
    ignoreInitial: true,
    depth: 5,
    followSymlinks: false,
    usePolling: false,
    ignored: (filePath: string) => {
      if (filePath === projectPath) return false;
      if (/[/\\]node_modules([/\\]|$)/.test(filePath)) return true;
      if (/[/\\](dist|build|out|\.cache|\.next|\.nuxt|\.turbo|\.svelte-kit|coverage|__pycache__|\.pytest_cache)([/\\]|$)/.test(filePath)) return true;
      if (/[/\\]\.git([/\\]|$)/.test(filePath)) return true;
      return false;
    },
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 50,
    },
  });

  // Phase 2 — add git and env paths after the project scan completes.
  watcher.on("ready", () => {
    logger.info("system", "FileWatcher: ready — adding git/env paths", { projectPath, watcherId });
    watcher.add(gitPaths);
  });

  watcher.on("error", (error: any) => {
    if (error?.code === "EMFILE") {
      logger.warn("system", "FileWatcher: EMFILE — too many open files. Run: ulimit -n 65536", { projectPath });
      return;
    }
    logger.warn("system", `FileWatcher: error — ${error?.message}`, { projectPath, error: error?.message });
  });

  const emit = (channel: string, data: Record<string, any>) => {
    logger.info("system", `FileWatcher: ${channel}`, { path: data.path });
    if (channel === "git:changed" && data?.project) invalidateGitCache(data.project);
    if (channel === "file:new" || channel === "file:delete") clearTreeResultCache();
    eventBus.emitEvent(channel, data);
  };

  const emitGitChangedDebounced = debounce((data: { path: string }) => {
    emit("git:changed", { ...data, project: projectPath, watcherId });
  }, 500);

  const isEnvFile = (f: string) => { const b = path.basename(f); return b === ".env" || b.startsWith(".env."); };
  const isGitRelated = (f: string) => f.includes(`${path.sep}.git${path.sep}`);
  const isVoidFile = (f: string) => f.endsWith(".void");

  watcher
    .on("add", (filePath) => {
      logger.info("system", "FileWatcher: add", { filePath });
      if (isCloningActive(filePath)) return;
      if (isGitRelated(filePath)) emitGitChangedDebounced({ path: filePath });
      else emit("file:new", { path: filePath, project: projectPath, watcherId });
    })
    .on("addDir", (dirPath) => {
      logger.info("system", "FileWatcher: addDir", { dirPath });
      if (isCloningActive(dirPath)) return;
      if (isGitRelated(dirPath)) emitGitChangedDebounced({ path: dirPath });
      else emit("file:new", { path: dirPath, project: projectPath, watcherId });
    })
    .on("change", (filePath) => {
      logger.info("system", "FileWatcher: change", { filePath });
      if (isVoidFile(filePath)) {
        if (isWritingActive(filePath)) { writingPaths.delete(filePath); return; }
        emit("apy:changed", { path: filePath, project: projectPath, watcherId });
      } else if (isEnvFile(filePath)) {
        emit("env:changed", { path: filePath, project: projectPath, watcherId });
      } else if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      } else {
        emit("file:changed", { path: filePath, project: projectPath, watcherId });
      }
    })
    .on("unlink", (filePath) => {
      logger.info("system", "FileWatcher: unlink", { filePath });
      if (isDeletingActive(filePath)) return;
      if (isGitRelated(filePath)) emitGitChangedDebounced({ path: filePath });
      else emit("file:delete", { path: filePath, project: projectPath, watcherId });
    })
    .on("unlinkDir", (dirPath) => {
      logger.info("system", "FileWatcher: unlinkDir", { dirPath });
      if (isDeletingActive(dirPath)) return;
      if (isGitRelated(dirPath)) emitGitChangedDebounced({ path: dirPath });
      else emit("file:delete", { path: dirPath, project: projectPath, watcherId });
    });

  watchers.set(watcherId, { watcher });
}

function stopWatching(watcherId: string) {
  const entry = watchers.get(watcherId);
  if (!entry) return;
  entry.watcher.close().catch(() => {});
  watchers.delete(watcherId);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function updateFileWatcher(activeProject: string, watcherId?: string) {
  const id = watcherId ?? activeProject;
  logger.info("system", "FileWatcher: updateFileWatcher", { activeProject, watcherId: id });
  if (!activeProject) {
    stopWatching(id);
    return;
  }
  startWatching(activeProject, id);
}

export async function removeFileWatcher(watcherId: string) {
  stopWatching(watcherId);
}

export async function closeAllWatchers() {
  for (const id of [...watchers.keys()]) stopWatching(id);
}

export function setCloning(dir: string, active: boolean) {
  if (active) cloningPaths.add(dir);
  else cloningPaths.delete(dir);
}

export function setDeleting(dir: string, active: boolean) {
  if (active) deletingPaths.add(dir);
  else deletingPaths.delete(dir);
}

export function setWriting(filePath: string) {
  const existing = writingPaths.get(filePath);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => writingPaths.delete(filePath), 2000);
  writingPaths.set(filePath, timer);
}
