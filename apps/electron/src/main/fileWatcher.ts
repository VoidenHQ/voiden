import chokidar from "chokidar";
import path from "node:path";
import eventBus from "./eventBus"; // your singleton event bus

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

// Simple debounce utility to batch rapid Git changes.
function debounce(func: (...args: any[]) => void, wait: number) {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}


function createDebouncedGitEmit(projectPath: string) {
  return debounce((data: { path: string }) => {
    eventBus.emitEvent("git:changed", { ...data, project: projectPath });
  }, 200);
}

/**
 * Update the file watcher for a specific project/window.
 * Supports multiple windows watching different directories simultaneously.
 * 
 * @param activeProject - The project directory to watch
 * @param watcherId - Optional unique identifier (e.g., windowId or project path)
 */
export async function updateFileWatcher(
  activeProject: string,
  watcherId?: string
) {
  const id = watcherId || activeProject;
  if (fileWatchers.has(id)) {
    try {
      await fileWatchers.get(id)?.close();
      fileWatchers.delete(id);
    } catch (error) {
    }
  }

  if (!activeProject) {
    console.log('[FileWatcher] No active project. Skipping watcher initialization.');
    return;
  }

  const pathsToWatch = [
    // Watch .env files (including .env.local, .env.production, etc.)
    path.join(activeProject, ".env"),
    path.join(activeProject, ".env.*"),

    // Watch Git files
    path.join(activeProject, ".git/HEAD"),
    path.join(activeProject, ".git/index"),
    path.join(activeProject, ".git/refs/**/*"),

    // Watch .void files
    path.join(activeProject, "**/*.void"),

    // Watch the entire directory for add/delete events
    // This is necessary to catch new files and folders
    activeProject,
  ];


  const watcher = chokidar.watch(pathsToWatch, {
    persistent: true,
    ignoreInitial: true,
    depth: 10,
    followSymlinks: false,
    usePolling: false,
    interval: 100,
    ignored: (filePath: string, stats?: any) => {
      if (/node_modules/.test(filePath)) {
        return true;
      }
      if (/(dist|build|\.cache|\.next|\.nuxt)/.test(filePath)) {
        return true;
      }
      // Exclude .git internals that we don't need to watch.
      // HEAD, index, and refs are listed as explicit paths above so they
      // remain watched even though the bulk of .git is ignored here.
      if (/[/\\]\.git[/\\](objects|pack|logs|lfs|rr-cache|svn)/.test(filePath)) {
        return true;
      }
      return false;
    },
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  // Create debounced git emit for this watcher
  const emitGitChangedDebounced = createDebouncedGitEmit(activeProject);

  // Helper functions
  const isEnvFile = (filePath: string) => {
    const basename = path.basename(filePath);
    return basename === ".env" || basename.startsWith(".env.");
  };

  const isGitRelated = (filePath: string) =>
    filePath.includes(`${path.sep}.git${path.sep}`);

  const isVoidFile = (filePath: string) =>
    filePath.endsWith(".void");

  watcher
    .on('ready', () => {
      const watched = watcher.getWatched();
    })
    .on("add", (filePath: string) => {
      if (isCloningActive(filePath)) return; // suppress during clone
      if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      } else {
        eventBus.emitEvent("file:new", {
          path: filePath,
          project: activeProject,
          watcherId: id
        });
      }
    })
    .on("addDir", (dirPath: string) => {
      if (isCloningActive(dirPath)) return; // suppress during clone
      if (isGitRelated(dirPath)) {
        emitGitChangedDebounced({ path: dirPath });
      } else {
        eventBus.emitEvent("file:new", {
          path: dirPath,
          project: activeProject,
          watcherId: id
        });
      }
    })
    .on("change", (filePath: string) => {
      if (isVoidFile(filePath)) {
        eventBus.emitEvent("apy:changed", {
          path: filePath,
          project: activeProject,
          watcherId: id
        });
      } else if (isEnvFile(filePath)) {
        eventBus.emitEvent("env:changed", {
          path: filePath,
          project: activeProject,
          watcherId: id
        });
      } else if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      }
    })
    .on("unlink", (filePath: string) => {
      if (isGitRelated(filePath)) {
        emitGitChangedDebounced({ path: filePath });
      } else {
        eventBus.emitEvent("file:delete", {
          path: filePath,
          project: activeProject,
          watcherId: id
        });
      }
    })
    .on("unlinkDir", (dirPath: string) => {
      if (isGitRelated(dirPath)) {
        emitGitChangedDebounced({ path: dirPath });
      } else {
        eventBus.emitEvent("file:delete", {
          path: dirPath,
          project: activeProject,
          watcherId: id
        });
      }
    })
    .on("error", (error) => {
      eventBus.emitEvent("watcher:error", {
        error: error.message,
        project: activeProject,
        watcherId: id
      });
    });

  // Store the watcher
  fileWatchers.set(id, watcher);
}


/**
 * Remove a specific file watcher
 */
export async function removeFileWatcher(watcherId: string) {
  if (fileWatchers.has(watcherId)) {
    try {
      await fileWatchers.get(watcherId)?.close();
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
  const closePromises = Array.from(fileWatchers.values()).map(watcher =>
    watcher.close().catch(err => console.error('[FileWatcher] Close error:', err))
  );
  await Promise.all(closePromises);
  fileWatchers.clear();
}



