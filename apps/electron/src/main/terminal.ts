import { BrowserWindow, ipcMain } from "electron";
import * as pty from "node-pty";
import { getActiveProject, getAppState } from "./state";
import { randomUUID } from "node:crypto";
import { getSettings } from "./settings";
import { saveState } from "./persistState";
import { getShells, nodeShellEnv, resolveShell } from "./shells";
import type { PanelElement, Tab } from "../shared/types";

// Registry of active terminals, keyed by session id (we'll use tabId as session id).
const terminals = new Map<string, pty.IPty>();
// Registry for buffering terminal output so we can rehydrate xterm on reattach.
const terminalBuffers = new Map<string, string>();
// Maximum buffer size per terminal (500KB to prevent memory bloat)
const MAX_BUFFER_SIZE = 500 * 1024;

// Output batching to reduce IPC overhead
const outputBatches = new Map<string, string>();
const batchTimeouts = new Map<string, NodeJS.Timeout>();
const BATCH_INTERVAL = 8; // Batch output every 8ms for faster response

function findTab(layout: PanelElement | undefined, tabId: string): Tab | null {
  if (!layout) return null;
  if (layout.type === "panel") return layout.tabs.find((t) => t.id === tabId) ?? null;
  for (const child of layout.children) {
    const found = findTab(child, tabId);
    if (found) return found;
  }
  return null;
}

/** The shell a terminal tab was opened with, or undefined to use the default from settings. */
function tabShell(event: Electron.IpcMainInvokeEvent, tabId: string): string | undefined {
  try {
    const appState = getAppState(event);
    const layout = appState.activeDirectory ? appState.directories[appState.activeDirectory]?.layout : appState.unsaved.layout;
    return findTab(layout, tabId)?.meta?.shell;
  } catch {
    return undefined;
  }
}

ipcMain.handle("terminal:listShells", (_event, refresh?: boolean) => {
  const shells = getShells(!!refresh);
  const configured = getSettings().terminal?.default_shell ?? "";
  const { profile } = resolveShell(configured, shells, nodeShellEnv());
  return { shells, defaultId: profile.id, configured };
});

/** Where each session's shell was started, so a shell switch restarts it in the same place. */
const sessions = new Map<string, { cwd: string }>();

/** Spawn a shell for a session and wire its output and exit to the renderer. */
function startShell(
  sessionId: string,
  webContents: Electron.WebContents,
  opts: { shell: string | undefined; cwd: string; cols: number; rows: number },
): { notice: string } {
  const { profile: shell, unavailable } = resolveShell(opts.shell, getShells(), nodeShellEnv());
  const notice = unavailable
    ? `\x1b[33mShell "${unavailable}" isn't available, so ${shell.name} was started instead. Choose another shell from the terminal's ▾ menu or in Settings.\x1b[0m\r\n`
    : "";
  const ptyProcess = pty.spawn(shell.path, shell.args, {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      PROMPT_EOL_MARK: "", // Disable zsh's end-of-partial-line marker (%)
    },
  });
  terminals.set(sessionId, ptyProcess);
  terminalBuffers.set(sessionId, notice);
  sessions.set(sessionId, { cwd: opts.cwd });
  (ptyProcess as any).webContents = webContents;
  // After a shell switch the replaced shell may still flush output or exit; ignore it.
  const isCurrent = () => terminals.get(sessionId) === ptyProcess;

  ptyProcess.onData((data) => {
    if (!isCurrent()) return;
    const currentBuffer = terminalBuffers.get(sessionId) || "";
    let newBuffer = currentBuffer + data;

    // Trim buffer if it exceeds max size (keep last MAX_BUFFER_SIZE bytes)
    if (newBuffer.length > MAX_BUFFER_SIZE) {
      newBuffer = newBuffer.slice(newBuffer.length - MAX_BUFFER_SIZE);
    }

    terminalBuffers.set(sessionId, newBuffer);

    // Batch output to reduce IPC calls
    const currentBatch = outputBatches.get(sessionId) || "";
    outputBatches.set(sessionId, currentBatch + data);

    // Clear existing timeout for this session
    const existingTimeout = batchTimeouts.get(sessionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule batched send
    const timeout = setTimeout(() => {
      const batchedData = outputBatches.get(sessionId);
      if (batchedData) {
        const wc = (ptyProcess as any).webContents;
        if (wc && !wc.isDestroyed()) {
          wc.send(`terminal:output:${sessionId}`, batchedData);
        }
        outputBatches.set(sessionId, "");
      }
      batchTimeouts.delete(sessionId);
    }, BATCH_INTERVAL);

    batchTimeouts.set(sessionId, timeout);
  });
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (!isCurrent()) return;
    // Clean up all resources for this session
    terminals.delete(sessionId);
    terminalBuffers.delete(sessionId);
    outputBatches.delete(sessionId);
    sessions.delete(sessionId);

    const timeout = batchTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      batchTimeouts.delete(sessionId);
    }

    const wc = (ptyProcess as any).webContents;
    if (wc && !wc.isDestroyed()) {
      wc.send(`terminal:exit:${sessionId}`, { exitCode, signal });
    }
  });
  return { notice };
}

ipcMain.handle("terminal:attachOrCreate", async (event, { tabId, cwd, cols, rows }) => {
  // Prefer the caller's own `cwd` — it comes from that window's own React
  // tree (Terminal.tsx's `cwd` prop), so it's already correctly scoped to
  // whichever window actually made this call, no window-timing race
  // possible. getActiveProject() used to be called bare (no `event`), which
  // falls back to windowManager's single global "currently focused window"
  // (see getAppState's own event?.sender-vs-fallback logic) — with multiple
  // windows open, that's whichever window last had focus, not necessarily
  // the one that actually issued THIS call, so switching focus right around
  // when a terminal opens could spawn it in the wrong window's directory.
  // getActiveProject(event) below is only a fallback for the (currently
  // nonexistent) case of an empty cwd, and is itself event-scoped so it
  // doesn't reintroduce the same bug.
  const activeDirectory = cwd || (await getActiveProject(event));
  if (terminals.has(tabId)) {
    const existingPty = terminals.get(tabId);
    if (existingPty) {
      (existingPty as any).webContents = event.sender;
      const buffer = terminalBuffers.get(tabId) || "";
      // Return both id and the buffered output, marking this as existing
      return { id: tabId, buffer, isNew: false };
    }
  }
  // Create a new terminal session in the tab's shell, else the default from settings (#598).
  const sessionId = tabId ? tabId : randomUUID();
  const { notice } = startShell(sessionId, event.sender, {
    shell: tabShell(event, tabId) ?? getSettings().terminal?.default_shell,
    cwd: activeDirectory || process.env.HOME || "",
    cols: cols || 80,
    rows: rows || 24,
  });
  // Return empty buffer for new terminals, shell will output prompt after resize
  return { id: sessionId, buffer: "", isNew: true, notice };
});

/**
 * Restart a terminal tab in another shell (the ▾ menu in the terminal header).
 * The new shell runs under the same session id, so the tab and its xterm stay
 * put; the old shell's exit is ignored rather than closing the tab.
 */
ipcMain.handle("terminal:switchShell", async (event, tabId: string, shell: string) => {
  const appState = getAppState(event);
  const layout = appState.activeDirectory ? appState.directories[appState.activeDirectory]?.layout : appState.unsaved.layout;
  const tab = findTab(layout, tabId);
  if (!tab || tab.type !== "terminal") throw new Error("Terminal tab not found.");

  const { profile } = resolveShell(shell, getShells(), nodeShellEnv());
  tab.meta = { ...tab.meta, shell };
  tab.title = profile.name;
  const windowId = (BrowserWindow.fromWebContents(event.sender) as any)?.windowInfo?.id;
  await saveState(appState, windowId);

  const old = terminals.get(tabId);
  if (old) {
    const session = sessions.get(tabId);
    const wc = (old as any).webContents ?? event.sender;
    // Unregister first so the old shell's exit doesn't close the tab, and drop
    // its queued output so none of it lands after the screen reset.
    terminals.delete(tabId);
    old.kill();
    clearTimeout(batchTimeouts.get(tabId));
    batchTimeouts.delete(tabId);
    outputBatches.delete(tabId);
    // Reset the screen, then start the new shell where the old one started.
    if (wc && !wc.isDestroyed()) wc.send(`terminal:output:${tabId}`, "\x1bc");
    const { notice } = startShell(tabId, wc, {
      shell,
      cwd: session?.cwd ?? (await getActiveProject(event)) ?? process.env.HOME ?? "",
      cols: old.cols,
      rows: old.rows,
    });
    if (notice && wc && !wc.isDestroyed()) wc.send(`terminal:output:${tabId}`, notice);
  }
  return { title: profile.name };
});

ipcMain.on("terminal:sendInput", (event, data: { id: string; data: string }) => {
  const term = terminals.get(data.id);
  if (term) {
    term.write(data.data);
  }
});

// Do not automatically kill a terminal when “detaching” (this is now a no‑op
// because the terminal should persist until the user closes the tab).
ipcMain.on("terminal:detach", (event, id: string) => {
  // Optionally, you can implement logic here if you want to free up resources.
});

// Helper to kill a terminal session (used when a terminal tab is closed).
export function killTerminal(sessionId: string) {
  const term = terminals.get(sessionId);
  if (term) {
    term.kill();
    terminals.delete(sessionId);
    terminalBuffers.delete(sessionId);
    outputBatches.delete(sessionId);
    sessions.delete(sessionId);

    const timeout = batchTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      batchTimeouts.delete(sessionId);
    }
  }
}

ipcMain.handle("terminal:kill", (event, sessionId: string) => {
  killTerminal(sessionId);
  return true;
});

// Handle terminal resize events
ipcMain.on("terminal:resize", (event, data: { id: string; cols: number; rows: number }) => {
  const term = terminals.get(data.id);
  if (term) {
    term.resize(data.cols, data.rows);
  }
});
