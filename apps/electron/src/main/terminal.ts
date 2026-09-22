import { ipcMain } from "electron";
import * as pty from "node-pty";
import { getActiveProject } from "./state";
import { randomUUID } from "node:crypto";

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
  // Create a new terminal session.
  const defaultShell = process.platform === "win32" ? "powershell.exe" : process.platform === "darwin" ? "zsh" : "bash";
  const shellArgs = process.platform === "win32" ? [] : ["-l"]; // -l for login shell to load .zshrc/.bashrc
  const ptyProcess = pty.spawn(defaultShell, shellArgs, {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: activeDirectory || process.env.HOME,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      PROMPT_EOL_MARK: "", // Disable zsh's end-of-partial-line marker (%)
    },
  });
  const sessionId = tabId ? tabId : randomUUID;
  terminals.set(sessionId, ptyProcess);
  terminalBuffers.set(sessionId, "");
  (ptyProcess as any).webContents = event.sender;
  ptyProcess.onData((data) => {
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
    // Clean up all resources for this session
    terminals.delete(sessionId);
    terminalBuffers.delete(sessionId);
    outputBatches.delete(sessionId);

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
  // Return empty buffer for new terminals, shell will output prompt after resize
  return { id: sessionId, buffer: "", isNew: true };
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
