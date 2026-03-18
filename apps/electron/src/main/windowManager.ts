// file: apps/electron/src/main/windowManager.ts

import { BrowserWindow, app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import EventBus from "./eventBus";
import { createWindow, initializeWelcomeTabs } from "./window";
import { setupMacOSFileHandler } from "./cliHandler";
import { AppState } from "../shared/types";
import { getDefaultLayout, saveState } from "./persistState";
import { initializeState, updateWindowState } from "./state";
import { removeFileWatcher } from "./fileWatcher";
import { setActiveDirectory } from "./ipc/directory";

interface WindowInfo {
  id: string;
}

// Extend Electron's BrowserWindow type
type ExtendedBrowserWindow = BrowserWindow & { windowInfo?: WindowInfo };

class WindowManager {
  private windows = new Map<string, AppState | null>();
  browserWindow: BrowserWindow | null = null;
  browserWindows = new Map<string, BrowserWindow>();

  private stateDir = '';
  activeWindowId: string | null = null;
  private activeStateDir = ''
  private initialized = false;

  /** Lazily resolve paths and create directories (must not run before app.ready) */
  private ensureInitialized() {
    if (this.initialized) return;
    this.stateDir = path.join(app.getPath("userData"), "window-states");
    this.activeStateDir = path.join(app.getPath("userData"), "active-states");
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
    if (!fs.existsSync(this.activeStateDir)) {
      fs.mkdirSync(this.activeStateDir, { recursive: true });
    }
    this.initialized = true;
  }

  getStateFilePath(windowId?: string): string {
    this.ensureInitialized();
    const id = windowId || this.activeWindowId;
    if (!id) {
      throw new Error("No window ID available");
    }
    return path.join(this.stateDir, `voiden-state-${id}.json`);
  }
  getActiveStateFilePath(windowId?: string): string {
    this.ensureInitialized();
    const id = windowId || this.activeWindowId;
    if (!id) {
      throw new Error("No window ID available");
    }
    return path.join(this.activeStateDir, `active-state-${id}.json`);
  }

  register(win: BrowserWindow, id: string) {
    const that = this;
    win.on("focus", () => {
      that.setActiveWindowId(id);
      updateWindowState();
      win.webContents.send('window:changed')
      that.browserWindow = win;
    });
    win.on('unresponsive',()=>{
      that.windows.delete(id);
      that.destroyWindow(id);
      win.close();
    })
    win.on("closed", () => {
      // Clean up in-memory state only, preserve state file for session restore
      that.windows.delete(id);
      this.browserWindows.delete(id);
    });
  }

  get(id: string): AppState | null | undefined {
    return this.windows.get(id);
  }

  getWindow(id: string): BrowserWindow {
    return this.browserWindows.get(id) as BrowserWindow;
  }

  setActiveWindowId(windowId: string | null) {
    this.activeWindowId = windowId;
  }

  getActiveWindowId(): string | null {
    return this.activeWindowId;
  }

  private async saveWindowState(windowId: string) {
    const state = this.windows.get(windowId);
    if (!state) return;
    await saveState(state);
  }

  private async loadWindowState(windowId: string): Promise<AppState | null> {
    try {
      const filePath = this.getStateFilePath(windowId);
      if (!fs.existsSync(filePath)) return null;

      const data = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error(`Failed to load window state for ${windowId}:`, error);
      return null;
    }
  }

  private deleteWindowStateFile(windowId: string) {
    // Delete voiden-state file
    try {
      const filePath = this.getStateFilePath(windowId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore deletion errors
    }
    // Also delete the active-state file
    try {
      const activeFilePath = path.join(this.activeStateDir, `active-state-${windowId}.json`);
      if (fs.existsSync(activeFilePath)) {
        fs.unlinkSync(activeFilePath);
      }
    } catch {
      // Ignore deletion errors
    }
  }

  private getAllStateFiles(): string[] {
    this.ensureInitialized();
    try {
      if (!fs.existsSync(this.stateDir)) return [];

      const files = fs.readdirSync(this.stateDir);
      const windowIds: string[] = [];

      for (const file of files) {
        const match = file.match(/^voiden-state-([a-f0-9-]+)\.json$/);
        if (match) {
          windowIds.push(match[1]);
        }
      }

      // Clean up orphaned active-state files
      this.cleanupOrphanedActiveStates(windowIds);

      return windowIds;
    } catch (error) {
      console.error("Failed to read state files:", error);
      return [];
    }
  }

  private cleanupOrphanedActiveStates(validWindowIds: string[]) {
    try {
      if (!fs.existsSync(this.activeStateDir)) return;

      const validIdSet = new Set(validWindowIds);
      const files = fs.readdirSync(this.activeStateDir);

      for (const file of files) {
        const match = file.match(/^active-state-([a-f0-9-]+)\.json$/);
        if (match && !validIdSet.has(match[1])) {
          // This active-state file has no corresponding window-state file
          try {
            fs.unlinkSync(path.join(this.activeStateDir, file));
          } catch {
            // Ignore deletion errors
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  async createWindow(windowId?: string,skipDefault?:boolean): Promise<BrowserWindow> {
    const win = await createWindow();

    // Generate a UUID for the window if not provided
    const id = windowId || randomUUID();

    try {
      this.setActiveWindowId(id);

      // Attach window info early so it's available for other operations
      (win as ExtendedBrowserWindow).windowInfo = {
        id: id
      };

      // Try to restore state
      const initializedState = await initializeState(skipDefault);
      const savedState = await this.loadWindowState(id);
      // Use savedState if available, otherwise fall back to the initialized state
      this.windows.set(id, savedState || initializedState);

      // Sync extensions from initialized state into window state.
      // Community extensions are loaded during initializeState() and may not
      // be present in a previously-saved window state file.
      const windowState = this.windows.get(id)!;
      windowState.extensions = initializedState.extensions;

      this.browserWindow = win;
      this.browserWindows.set(id, win);

      const state = this.windows.get(id);
      // If restored state has activeDirectory, set it up
      if (state?.activeDirectory) {
        try {
          await this.setActiveDirectory(id, state.activeDirectory);
        } catch (e) {
          console.error("Failed to set active directory:", e);
        }
      }

      win.webContents.on("did-finish-load", async () => {
        await initializeWelcomeTabs();
      });

      setupMacOSFileHandler(win);

      win.on("closed", () => {
        EventBus.unregisterWindow(win);
        removeFileWatcher(id); // unregister BEFORE removing reference
      });

      this.register(win, id);
    } catch (e) {
      console.error("Failed to initialize window:", e);
      // Clean up on failure
      this.windows.delete(id);
      this.browserWindows.delete(id);
    }

    return win;
  }

  destroyWindow(windowId: string) {
    const state = this.windows.get(windowId);
    if (!state) return;
    this.windows.delete(windowId);
    this.browserWindows.delete(windowId);
    this.deleteWindowStateFile(windowId);
  }

  /**
   * Close a window properly - saves state and closes the BrowserWindow
   * Use this instead of calling destroyWindow + close separately
   */
  closeWindow(windowId?: string) {
    const id = windowId || this.activeWindowId;
    if (!id) return;

    const win = this.browserWindows.get(id);
    if (win && !win.isDestroyed()) {
      win.close(); // This triggers the 'closed' event which handles cleanup
    }
  }

  /**
   * Close window from a webContents sender (for IPC handlers)
   * This is called from the menu close action, so it deletes state immediately
   */
  closeWindowFromSender(sender: Electron.WebContents) {
    const win = BrowserWindow.fromWebContents(sender) as ExtendedBrowserWindow | null;
    if (win && win.windowInfo?.id) {
      // Delete state immediately since this is an explicit menu close
      this.deleteWindowStateFile(win.windowInfo.id);
      this.closeWindow(win.windowInfo.id);
    } else if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  /**
   * Close window and delete its state (for explicit menu "Close Window" action)
   */
  closeWindowAndDeleteState(windowId?: string) {
    const id = windowId || this.activeWindowId;
    if (!id) return;

    // Delete state immediately since this is explicit menu close
    this.deleteWindowStateFile(id);
    this.closeWindow(id);
  }

  private isLoadingWindows = false;

  async loadAllWindows(): Promise<void> {
    // Prevent concurrent calls
    if (this.isLoadingWindows) return;
    this.isLoadingWindows = true;

    try {
      // First, close any duplicate windows that are already open (keep only one per project)
      const projectToWindowId = new Map<string, string>();
      const windowsToClose: string[] = [];

      for (const [windowId, state] of this.windows.entries()) {
        if (state?.activeDirectory) {
          const normalizedPath = path.normalize(state.activeDirectory);
          if (projectToWindowId.has(normalizedPath)) {
            // This is a duplicate - mark for closing
            windowsToClose.push(windowId);
          } else {
            projectToWindowId.set(normalizedPath, windowId);
          }
        }
      }

      // Close duplicate windows and delete their state files
      for (const windowId of windowsToClose) {
        const win = this.browserWindows.get(windowId);
        if (win && !win.isDestroyed()) {
          win.close();
        }
        this.deleteWindowStateFile(windowId);
        this.windows.delete(windowId);
        this.browserWindows.delete(windowId);
      }

      // Track which projects we've already opened
      const openedProjects = new Set<string>(projectToWindowId.keys());

      const savedWindowIds = this.getAllStateFiles();

      // Collect valid states with their modification times
      const statesWithTime: { windowId: string; state: AppState; mtime: number }[] = [];

      for (const windowId of savedWindowIds) {
        // Skip if this window is already loaded
        if (this.windows.has(windowId)) {
          continue;
        }

        try {
          const savedState = await this.loadWindowState(windowId);

          // Skip and delete windows without active directory
          if (!savedState?.activeDirectory) {
            this.deleteWindowStateFile(windowId);
            continue;
          }

          // Verify directory still exists
          if (!fs.existsSync(savedState.activeDirectory)) {
            this.deleteWindowStateFile(windowId);
            continue;
          }

          // Get file modification time
          const filePath = this.getStateFilePath(windowId);
          const stats = fs.statSync(filePath);
          statesWithTime.push({ windowId, state: savedState, mtime: stats.mtimeMs });
        } catch {
          this.deleteWindowStateFile(windowId);
        }
      }

      // Sort by modification time (newest first)
      statesWithTime.sort((a, b) => b.mtime - a.mtime);

      // Create windows, skipping duplicate projects
      for (const { windowId, state } of statesWithTime) {
        const normalizedPath = path.normalize(state.activeDirectory as string);

        // Skip if we already have a window for this project
        if (openedProjects.has(normalizedPath)) {
          this.deleteWindowStateFile(windowId);
          continue;
        }

        // Create window and restore state
        try {
          await this.createWindow(windowId);
          openedProjects.add(normalizedPath);
        } catch (error) {
          console.error(`Failed to restore window ${windowId}:`, error);
          this.deleteWindowStateFile(windowId);
        }
      }

      // If no windows were restored, create a fresh one
      if (this.windows.size === 0) {
        try {
          await this.createWindow();
        } catch (e) {
        }
      }
    } finally {
      this.isLoadingWindows = false;
    }
  }

  getWindowState(windowId?: string): AppState {
    const id = windowId || this.activeWindowId;
    if (!id) {
      throw new Error("No window ID available");
    }

    const st = this.windows.get(id);
    if (!st) {
      throw new Error(`Window state not found: ${id}`);
    }

    return st;
  }

  getStateFromEvent(sender: Electron.WebContents): AppState {
    const win = BrowserWindow.fromWebContents(sender) as ExtendedBrowserWindow | null;
    if (!win || !win.windowInfo) {
      throw new Error("Unknown window (no sender mapping)");
    }
    return this.getWindowState(win.windowInfo.id);
  }

  getAllWindows(): (AppState | null)[] {
    return Array.from(this.windows.values());
  }

  async setActiveDirectory(windowId: string, directory: string) {
    const state = this.getWindowState(windowId);
    directory = directory || state.activeDirectory as string;
    await setActiveDirectory(directory, this.getWindow(windowId));
    state.activeDirectory = directory;
    if (!state.directories[directory]) {
      state.directories[directory] = {
        layout:getDefaultLayout(),
      };
    }
    state.directories[directory]['hidden']=false;
    this.saveWindowState(windowId);
  }

  async saveAllWindowStates() {
    for (const windowId of this.windows.keys()) {
      await this.saveWindowState(windowId);
    }
  }
  focusWindowByProject(projectPath: string) {
    if (!projectPath) {
      return false;
    }

    const normalizedPath = path.normalize(projectPath);
    for (const [windowId] of this.windows.entries()) {
      const state = this.getWindowState(windowId);
      if (!state?.activeDirectory) {
        continue;
      }

      const normalizedWindowPath = path.normalize(state.activeDirectory);
      if (normalizedWindowPath === normalizedPath) {
        const win: BrowserWindow = this.browserWindows.get(windowId) as BrowserWindow;
        if (!win.isDestroyed()) {
          if (win.isMinimized()) {
            win.restore();
          }
          win.focus();
          if (process.platform === 'darwin') {
            win.show();
          }
          return true;
        } else {
          this.windows.delete(windowId);
        }
      }
    }
    return false;
  }
}

export const windowManager = new WindowManager();
