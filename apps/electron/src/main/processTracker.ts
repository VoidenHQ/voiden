/**
 * Process Tracker
 * Patches ipcMain.handle globally to track every IPC call.
 * Import this module BEFORE any other module that calls ipcMain.handle.
 */

import { ipcMain, BrowserWindow } from 'electron';

export interface TrackedProcess {
  id: string;
  channel: string;
  category: string;
  startTime: number;
  status: 'active' | 'done' | 'error';
  duration?: number;   // ms — only set when done/error
  error?: string;
}

const MAX_HISTORY = 200;

class ProcessTracker {
  private active = new Map<string, TrackedProcess>();
  private history: TrackedProcess[] = []; // completed/error, newest first, capped at MAX_HISTORY
  private counter = 0;
  // Channels to skip — too fast / too noisy to be useful
  private readonly SKIP = new Set([
    'mainwindow:minimize', 'mainwindow:maximize', 'mainwindow:isMaximized',
    'mainwindow:close', 'mainwindow:closeAndDeleteState',
    'logger:getLogs', 'logger:getStats', 'logger:clearLogs', 'logger:exportLogs', 'logger:filterLogs',
    'process:getActive',
    'menu:newFile', 'menu:save', 'menu:reload', 'menu:forceReload',
    'menu:resetZoom', 'menu:zoomIn', 'menu:zoomOut', 'menu:toggleFullScreen',
    'menu:toggleDevTools', 'menu:quit', 'menu:toggleExplorer', 'menu:toggleTerminal',
    'menu:closeProject', 'menu:openFolder',
    'get-app-version', 'open-external',
  ]);

  private category(channel: string): string {
    if (channel.startsWith('git:')) return 'git';
    if (channel.startsWith('files:') || channel.startsWith('dialog:')) return 'filesystem';
    if (channel.startsWith('state:') || channel.startsWith('sidebar:') || channel.startsWith('panel:')) return 'state';
    if (channel.startsWith('extensions:') || channel.startsWith('plugins:')) return 'plugin';
    if (channel.startsWith('search-files')) return 'filesystem';
    if (channel.startsWith('tab:') || channel.startsWith('panel:')) return 'state';
    return 'ipc';
  }

  start(channel: string): string | null {
    if (this.SKIP.has(channel)) return null;
    const id = `${Date.now()}-${this.counter++}`;
    this.active.set(id, {
      id,
      channel,
      category: this.category(channel),
      startTime: Date.now(),
      status: 'active',
    });
    this.broadcast();
    return id;
  }

  end(id: string | null, error?: string) {
    if (!id) return;
    const proc = this.active.get(id);
    if (!proc) return;
    proc.duration = Date.now() - proc.startTime;
    proc.status = error ? 'error' : 'done';
    if (error) proc.error = error.slice(0, 120);
    this.active.delete(id);

    // Prepend to history and cap
    this.history.unshift(proc);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;

    this.broadcast();
  }

  clearHistory() {
    this.history = [];
    this.broadcast();
  }

  getAll(): TrackedProcess[] {
    const activeList = Array.from(this.active.values())
      .sort((a, b) => b.startTime - a.startTime);
    return [...activeList, ...this.history];
  }

  private broadcast() {
    const data = this.getAll();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('process:update', data);
      }
    }
  }
}

export const processTracker = new ProcessTracker();

/**
 * Patch ipcMain.handle to automatically track every registered handler.
 * Call this once before any handlers are registered.
 */
export function patchIpcMainHandle() {
  const original = ipcMain.handle.bind(ipcMain);

  (ipcMain as any).handle = (
    channel: string,
    handler: (event: any, ...args: any[]) => any,
  ) => {
    return original(channel, async (event: any, ...args: any[]) => {
      const id = processTracker.start(channel);
      try {
        const result = await handler(event, ...args);
        processTracker.end(id);
        return result;
      } catch (err) {
        processTracker.end(id, (err as Error)?.message ?? String(err));
        throw err;
      }
    });
  };
}

/**
 * Register the IPC handler that lets the renderer query active processes.
 */
export function setupProcessTrackerIPC() {
  ipcMain.handle('process:getActive', () => processTracker.getAll());
  ipcMain.handle('process:clearHistory', () => { processTracker.clearHistory(); return true; });
}
