/**
 * fileWatcher.ts — main-process side
 *
 * Spawns fileWatcher.worker.ts in an Electron UtilityProcess so chokidar's
 * initial directory scan runs in a separate OS process and never stalls the
 * main-process event loop (tabs, IPC, window creation all stay responsive).
 *
 * All public exports keep the same signature as before — callers don't change.
 */

import path from "node:path";
import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import eventBus from "./eventBus";
import { invalidateGitCache } from "./git";
import { logger } from "./logger";

// ── Process lifecycle ─────────────────────────────────────────────────────────
let watcherProc: UtilityProcess | null = null;

function getWorkerPath(): string {
  // Vite builds the worker to the same directory as main.js (.vite/build/)
  return path.join(__dirname, "fileWatcher.worker.js");
}

function spawnWorker() {
  if (watcherProc) return;

  watcherProc = utilityProcess.fork(getWorkerPath(), [], {
    serviceName: "VoidenFileWatcher",
  });

  watcherProc.on("message", (msg: any) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "event") {
      const { channel, data } = msg;
      // git:changed requires a cache bust before the event reaches the renderer
      if (channel === "git:changed" && data?.project) {
        invalidateGitCache(data.project);
      }
      eventBus.emitEvent(channel, data);
    } else if (msg.type === "log") {
      const meta = msg.meta ?? {};
      if (msg.level === "warn") {
        logger.warn("system", msg.message, meta);
      } else {
        logger.info("system", msg.message, meta);
      }
    }
  });

  watcherProc.on("exit", (code) => {
    logger.warn("system", `FileWatcher process exited (code ${code}) — will respawn on next watch call`);
    watcherProc = null;
  });
}

/** Send a message to the worker, spawning it first if needed. */
function send(msg: object) {
  spawnWorker();
  watcherProc?.postMessage(msg);
}

// ── Public API (same signatures as before) ────────────────────────────────────

/**
 * Start (or restart) watching a project directory.
 * Safe to call multiple times — the worker stops any previous watcher for
 * the same id before starting a new one.
 */
export async function updateFileWatcher(activeProject: string, watcherId?: string) {
  const id = watcherId ?? activeProject;
  if (!activeProject) {
    send({ type: "unwatch", watcherId: id });
    return;
  }
  send({ type: "watch", projectPath: activeProject, watcherId: id });
}

/** Stop watching a specific watcher by id. */
export async function removeFileWatcher(watcherId: string) {
  send({ type: "unwatch", watcherId });
}

/** Stop all watchers and let the worker process idle. */
export async function closeAllWatchers() {
  send({ type: "closeAll" });
}

/**
 * Suppress file:new events for a path while a clone is in progress.
 * Called synchronously — the message is queued before any clone events arrive.
 */
export function setCloning(dir: string, active: boolean) {
  send({ type: "setCloning", path: dir, active });
}

/**
 * Suppress unlink/unlinkDir events for a path while a delete is in progress.
 * Called synchronously — the message is queued before any delete events arrive.
 */
export function setDeleting(dir: string, active: boolean) {
  send({ type: "setDeleting", path: dir, active });
}
