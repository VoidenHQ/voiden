/**
 * fileWatcher.worker.ts
 *
 * Runs inside an Electron UtilityProcess — completely isolated from the main
 * process so chokidar's initial directory scan never blocks the event loop
 * that handles IPC, window creation, and tab opens.
 *
 * Protocol
 * ────────
 * Main → Worker  (postMessage)
 *   { type: 'watch',      projectPath: string, watcherId: string }
 *   { type: 'unwatch',    watcherId: string }
 *   { type: 'closeAll' }
 *   { type: 'setCloning', path: string, active: boolean }
 *   { type: 'setDeleting', path: string, active: boolean }
 *
 * Worker → Main  (process.parentPort.postMessage)
 *   { type: 'event', channel: string, data: any }
 *   { type: 'log',   level: 'info'|'warn', message: string, meta?: any }
 */

import chokidar from "chokidar";
import path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────
interface WatcherEntry {
  watcher: chokidar.FSWatcher;
  phase2Timer: ReturnType<typeof setTimeout> | null;
}

// ── State ─────────────────────────────────────────────────────────────────────
const watchers = new Map<string, WatcherEntry>();
const cloningPaths = new Set<string>();
const deletingPaths = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────
const parentPort = (process as any).parentPort as {
  postMessage(value: any): void;
  on(event: "message", listener: (evt: { data: any }) => void): void;
};

function send(type: string, payload: Record<string, any>) {
  parentPort.postMessage({ type, ...payload });
}

function log(level: "info" | "warn", message: string, meta?: Record<string, any>) {
  send("log", { level, message, meta });
}

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

  // Phase 1 — exact known files, zero recursion cost, starts immediately.
  const phase1Paths = [
    path.join(projectPath, ".git", "HEAD"),
    path.join(projectPath, ".git", "index"),
    path.join(projectPath, ".env"),
  ];

  // Phase 2 — broader patterns added after 5s delay once the UI is responsive.
  // Depth 5 is fine here because the scan runs in a UtilityProcess and never
  // touches the main-process event loop. Capped to respect Linux inotify limits.
  const phase2Paths = [
    path.join(projectPath, ".env.*"),
    path.join(projectPath, ".git", "refs", "**", "*"),
    projectPath,
  ];

  let emfileLogged = false;

  const watcher = chokidar.watch(phase1Paths, {
    persistent: true,
    ignoreInitial: true,
    // Depth 5 is safe now that chokidar runs in a UtilityProcess — the scan
    // no longer blocks the main-process event loop regardless of project size.
    // Capped at 5 (not unlimited) to stay within Linux's default inotify limit
    // of 8 192 watch descriptors on very large repos (linux kernel, monorepos).
    depth: 5,
    followSymlinks: false,
    usePolling: false,
    ignored: (filePath: string) => {
      if (/[/\\]node_modules([/\\]|$)/.test(filePath)) return true;
      if (/[/\\](dist|build|out|\.cache|\.next|\.nuxt|\.turbo|\.svelte-kit|coverage|__pycache__|\.pytest_cache)([/\\]|$)/.test(filePath)) return true;
      if (/[/\\]\.git[/\\](objects|pack|logs|lfs|rr-cache|svn|worktrees|modules)/.test(filePath)) return true;
      return false;
    },
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 50,
    },
  });

  watcher.on("error", (error: any) => {
    if (error?.code === "EMFILE") {
      if (!emfileLogged) {
        emfileLogged = true;
        log("warn", "FileWatcher: EMFILE — OS file descriptor limit hit. Broad watching disabled for this project.", {
          path: projectPath,
          tip: "Run: ulimit -n 65536 to increase the limit",
        });
      }
      return;
    }
    log("warn", `FileWatcher: error — ${error?.message}`, { path: projectPath, error: error?.message });
  });

  // Debounced git event — batches rapid git-related changes (e.g. during checkout).
  const emitGitChangedDebounced = debounce((data: { path: string }) => {
    send("event", { channel: "git:changed", data: { ...data, project: projectPath, watcherId } });
  }, 500);

  const isEnvFile = (f: string) => { const b = path.basename(f); return b === ".env" || b.startsWith(".env."); };
  const isGitRelated = (f: string) => f.includes(`${path.sep}.git${path.sep}`);
  const isVoidFile = (f: string) => f.endsWith(".void");

  watcher
    .on("add", (filePath) => {
      if (isCloningActive(filePath)) return;
      if (isGitRelated(filePath)) emitGitChangedDebounced({ path: filePath });
      else send("event", { channel: "file:new", data: { path: filePath, project: projectPath, watcherId } });
    })
    .on("addDir", (dirPath) => {
      if (isCloningActive(dirPath)) return;
      if (isGitRelated(dirPath)) emitGitChangedDebounced({ path: dirPath });
      else send("event", { channel: "file:new", data: { path: dirPath, project: projectPath, watcherId } });
    })
    .on("change", (filePath) => {
      if (isVoidFile(filePath)) send("event", { channel: "apy:changed", data: { path: filePath, project: projectPath, watcherId } });
      else if (isEnvFile(filePath)) send("event", { channel: "env:changed", data: { path: filePath, project: projectPath, watcherId } });
      else if (isGitRelated(filePath)) emitGitChangedDebounced({ path: filePath });
      else send("event", { channel: "file:changed", data: { path: filePath, project: projectPath, watcherId } });
    })
    .on("unlink", (filePath) => {
      if (isDeletingActive(filePath)) return;
      if (isGitRelated(filePath)) emitGitChangedDebounced({ path: filePath });
      else send("event", { channel: "file:delete", data: { path: filePath, project: projectPath, watcherId } });
    })
    .on("unlinkDir", (dirPath) => {
      if (isDeletingActive(dirPath)) return;
      if (isGitRelated(dirPath)) emitGitChangedDebounced({ path: dirPath });
      else send("event", { channel: "file:delete", data: { path: dirPath, project: projectPath, watcherId } });
    });

  const phase2Timer = setTimeout(() => {
    log("info", "FileWatcher: phase 2 — adding broad patterns", { path: projectPath });
    watcher.add(phase2Paths);
  }, 5000);

  watchers.set(watcherId, { watcher, phase2Timer });
}

function stopWatching(watcherId: string) {
  const entry = watchers.get(watcherId);
  if (!entry) return;
  if (entry.phase2Timer) clearTimeout(entry.phase2Timer);
  entry.watcher.close().catch(() => {});
  watchers.delete(watcherId);
}

// ── Message handler ───────────────────────────────────────────────────────────
parentPort.on("message", ({ data }: { data: any }) => {
  switch (data?.type) {
    case "watch":
      startWatching(data.projectPath, data.watcherId);
      break;
    case "unwatch":
      stopWatching(data.watcherId);
      break;
    case "setCloning":
      if (data.active) cloningPaths.add(data.path);
      else cloningPaths.delete(data.path);
      break;
    case "setDeleting":
      if (data.active) deletingPaths.add(data.path);
      else deletingPaths.delete(data.path);
      break;
    case "closeAll":
      for (const id of [...watchers.keys()]) stopWatching(id);
      break;
  }
});
