import chokidar from "chokidar";
import path from "node:path";
import eventBus from "./eventBus";
import { invalidateGitCache } from "./git";
import { logger } from "./logger";

// Store multiple watchers keyed by project path or window ID
const fileWatchers = new Map<string, chokidar.FSWatcher>();

// Set of directories currently being cloned into — watcher events are
// suppressed for these paths so the IPC channel isn't flooded during clone.
const cloningPaths = new Set<string>();

export function setCloning(dir: string, active: boolean) {
  if (active) cloningPaths.add(dir);
  else cloningPaths.delete(dir);
}

function isCloningActive(filePath: string): boolean {
  for (const dir of cloningPaths) {
    if (filePath.startsWith(dir)) return true;
  }
  return false;
}

function debounce(func: (...args: any[]) => void, wait: number) {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function createDebouncedGitEmit(projectPath: string) {
  return debounce((data: { path: string }) => {
    invalidateGitCache(projectPath);
    eventBus.emitEvent("git:changed", { ...data, project: projectPath });
  }, 500);
}

/**
 * Update the file watcher for a specific project/window.
 *
 * Uses a two-phase approach to avoid EMFILE (too many open files) on large projects:
 *
 * Phase 1 — immediate, ~5 file descriptors:
 *   Watch only specific known files (git HEAD/index, .env). No globs, no recursion.
 *   This starts instantly and never hits the OS fd limit regardless of project size.
 *
 * Phase 2 — deferred 2 seconds after app is open and responsive:
 *   Add broader patterns (.void files, root-level changes) via watcher.add().
 *   File descriptors are opened gradually after the UI is already visible.
 */
export async function updateFileWatcher(
  activeProject: string,
  watcherId?: string
) {
  const id = watcherId || activeProject;

  // Close any existing watcher for this id
  if (fileWatchers.has(id)) {
    try {
      const existing = fileWatchers.get(id) as any;
      // Cancel the phase-2 timer before closing so it doesn't fire on a
      // closed watcher and potentially emit stale events for the old project.
      if (existing?._phase2Timer) clearTimeout(existing._phase2Timer);
      await existing?.close();
      fileWatchers.delete(id);
    } catch { /* ignore close errors */ }
  }

  if (!activeProject) {
    return;
  }

  // ── Phase 1 paths: exact files only, zero recursion ──────────────────────
  // Each entry is a single known file path — chokidar needs exactly 1 fd each.
  // Total: ~5 file descriptors no matter how large the project is.
  const phase1Paths = [
    path.join(activeProject, ".git", "HEAD"),
    path.join(activeProject, ".git", "index"),
    path.join(activeProject, ".env"),
  ];

  // ── Phase 2 paths: added after 2s delay via watcher.add() ────────────────
  // These are globs/patterns that may open many fds. By deferring them, the
  // app window is already open and responsive before any fd pressure begins.
  const phase2Paths = [
    path.join(activeProject, ".env.*"),
    path.join(activeProject, ".git", "refs", "**", "*"),
    path.join(activeProject, "**", "*.void"),
    // Root-level only (depth 0) for add/delete events on direct children
    path.join(activeProject, "*"),
  ];

  let emfileLogged = false;

  const watcher = chokidar.watch(phase1Paths, {
    persistent: true,
    ignoreInitial: true,
    // depth 0 — phase 1 paths are exact files, no recursion needed
    depth: 0,
    followSymlinks: false,
    usePolling: false,
    ignored: (filePath: string) => {
      if (/node_modules/.test(filePath)) return true;
      if (/(dist|build|\.cache|\.next|\.nuxt)/.test(filePath)) return true;
      if (/[/\\]\.git[/\\](objects|pack|logs|lfs|rr-cache|svn)/.test(filePath)) return true;
      return false;
    },
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  // ── Single error handler ──────────────────────────────────────────────────
  watcher.on("error", (error: any) => {
    // EMFILE = too many open files. Log once, suppress the rest.
    if (error?.code === 'EMFILE') {
      if (!emfileLogged) {
        emfileLogged = true;
        logger.warn('system', 'FileWatcher: EMFILE — OS file descriptor limit hit. Broad watching disabled for this project.', {
          path: activeProject,
          tip: 'Run: ulimit -n 65536 to increase the limit',
        });
      }
      return;
    }
    logger.warn('system', `FileWatcher: error — ${error?.message}`, {
      path: activeProject,
      error: error?.message,
    });
  });

  // ── Phase 2: add broader patterns after 2s ────────────────────────────────
  // By this point the main window is open and the app is responsive.
  // watcher.add() opens new fds incrementally — if EMFILE occurs it hits the
  // error handler above (logged once, suppressed) rather than flooding the loop.
  const phase2Timer = setTimeout(() => {
    logger.info('system', 'FileWatcher: phase 2 — adding broad patterns', { path: activeProject });
    watcher.add(phase2Paths);
  }, 2000);

  // ── Event helpers ─────────────────────────────────────────────────────────
  const emitGitChangedDebounced = createDebouncedGitEmit(activeProject);

  const isEnvFile = (filePath: string) => {
    const basename = path.basename(filePath);
    return basename === ".env" || basename.startsWith(".env.");
  };
  const isGitRelated = (filePath: string) =>
    filePath.includes(`${path.sep}.git${path.sep}`);
  const isVoidFile = (filePath: string) =>
    filePath.endsWith(".void");

  // ── Chokidar event handlers ───────────────────────────────────────────────
  watcher
    .on("add", (filePath: string) => {
      if (isCloningActive(filePath)) return;
      if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      } else {
        eventBus.emitEvent("file:new", { path: filePath, project: activeProject, watcherId: id });
      }
    })
    .on("addDir", (dirPath: string) => {
      if (isCloningActive(dirPath)) return;
      if (isGitRelated(dirPath)) {
        emitGitChangedDebounced({ path: dirPath });
      } else {
        eventBus.emitEvent("file:new", { path: dirPath, project: activeProject, watcherId: id });
      }
    })
    .on("change", (filePath: string) => {
      if (isVoidFile(filePath)) {
        eventBus.emitEvent("apy:changed", { path: filePath, project: activeProject, watcherId: id });
      } else if (isEnvFile(filePath)) {
        eventBus.emitEvent("env:changed", { path: filePath, project: activeProject, watcherId: id });
      } else if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      }
    })
    .on("unlink", (filePath: string) => {
      if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      } else {
        eventBus.emitEvent("file:delete", { path: filePath, project: activeProject, watcherId: id });
      }
    })
    .on("unlinkDir", (dirPath: string) => {
      if (isGitRelated(dirPath)) {
        emitGitChangedDebounced({ path: dirPath });
      } else {
        eventBus.emitEvent("file:delete", { path: dirPath, project: activeProject, watcherId: id });
      }
    });

  // Store the watcher. Attach the phase2 timer so closeAllWatchers can cancel it.
  (watcher as any)._phase2Timer = phase2Timer;
  fileWatchers.set(id, watcher);
}

/**
 * Remove a specific file watcher
 */
export async function removeFileWatcher(watcherId: string) {
  if (fileWatchers.has(watcherId)) {
    try {
      const w = fileWatchers.get(watcherId) as any;
      if (w?._phase2Timer) clearTimeout(w._phase2Timer);
      await w?.close();
      fileWatchers.delete(watcherId);
    } catch (error) {
      console.error('[FileWatcher] Error removing watcher:', error);
    }
  }
}

/**
 * Clean up all file watchers
 */
export async function closeAllWatchers() {
  const closePromises = Array.from(fileWatchers.values()).map((w: any) => {
    if (w?._phase2Timer) clearTimeout(w._phase2Timer);
    return w.close().catch((err: Error) => console.error('[FileWatcher] Close error:', err));
  });
  await Promise.all(closePromises);
  fileWatchers.clear();
}
