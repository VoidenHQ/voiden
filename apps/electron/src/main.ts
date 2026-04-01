import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { ipcStateHandlers } from "./main/state";
import { registerSettingsIpc, getSettings } from "./main/settings";
import { registerFontsIpc } from "./main/fonts";
import { closeAllWatchers } from "./main/fileWatcher";
import { createWindow, initializeWelcomeTabs, setSplash } from "./main/window";
import { initializeUpdates, registerUpdateIpcHandlers } from "./main/updates";
import { handleCliArguments, getCliArguments, setupMacOSFileHandler } from "./main/cliHandler";
import { windowManager } from "./main/windowManager";
// IPC Handler Imports
import { registerFileIpcHandlers } from "./main/ipc/files";
import { registerGitIpcHandlers } from "./main/ipc/git";
import { registerDirectoryIpcHandlers } from "./main/ipc/directory";
import { registerTabIpcHandlers } from "./main/ipc/tabHandlers";
import { registerPluginIpcHandlers } from "./main/ipc/plugins";
import { registerAppIpcHandlers } from "./main/ipc/app";
import { registerRequestIpcHandler } from "./main/ipc/request";
import { registerSearchIpcHandler } from "./main/ipc/search";
import { registerContextMenuIpcHandlers } from "./main/ipc/contextMenus";
import { registerThemeIpcHandlers } from "./main/ipc/themes";
import { registerCliIpcHandlers } from "./main/ipc/cli";
import { registerSkillsIpcHandlers } from "./main/ipc/skills";
import { registerPythonScriptIpcHandler } from "./main/ipc/pythonScript";
import { registerNodeScriptIpcHandler } from "./main/ipc/nodeScript";
import { loadMainProcessExtensions, unloadMainProcessExtensions } from "./main/extensionLoader";
import { recomposeAndInstall } from "./main/skillsInstaller";
import { setupLoggerIPC, logger } from "./main/logger";
import { initializeIntegratedLogging } from "./main/loggerIntegration";
import { patchIpcMainHandle, setupProcessTrackerIPC } from "./main/processTracker";

// Patch ipcMain.handle BEFORE any side-effect imports that register handlers
patchIpcMainHandle();

// Import side-effect modules
import "./main/terminal";
import "./main/git";
import "./main/voiden";
import "./main/env";
import "./main/utils";
import "./main/variables";

// On macOS, "Open With" / double-click fires open-file before the app is ready.
// Queue those paths here and drain them after initial windows are loaded.
const pendingOpenFiles: string[] = [];
if (process.platform === "darwin") {
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    pendingOpenFiles.push(filePath);
  });
}

const gotTheLock = app.requestSingleInstanceLock({ args: getCliArguments() });

if (!gotTheLock) {
  app.quit();
}


app.on('second-instance', async (event, commandLine, workingDirectory, additionalData) => {
  try {
    // Extract CLI arguments per platform.
    let args: string[] = [];

    if (process.platform === 'linux') {
      // On Linux, commandLine has fewer Chromium flags so slice(N) loses user args.
      // Use additionalData which contains pre-parsed CLI arguments.
      args = (additionalData as { args?: string[] })?.args || [];
    } else if (process.platform === 'win32') {
      // On Windows, the number of Chromium flags in commandLine varies,
      // so use additionalData (passed via requestSingleInstanceLock) instead.
      args = (additionalData as { args?: string[] })?.args || [];
    } else {
      // macOS - commandLine reliably has 3 prefix entries (executable + 2 Chromium flags)
      args = commandLine.slice(3);
    }

    if (args.length > 0) {
      await handleCliArguments(args);
    } else {
      const windows = windowManager.browserWindows;
      if (windows.size === 0) {
        await windowManager.loadAllWindows()
        return;
      }
      // No args: create a new window
      await windowManager.createWindow(undefined, true);
    }
  } catch (error) {
  }
});

// Setup protocol client for deeplinks
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("voiden", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("voiden");
}


// Disable spell checker
app.on("web-contents-created", (_, contents) => {
  contents.session.setSpellCheckerEnabled(false);
});

// App ready event
app.on("ready", async () => {
  const appReadyTime = Date.now();
  // Create splash screen - will be destroyed by createWindow
  const splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
  });

  const isDev = !app.isPackaged;
  const splashPath = isDev
    ? path.resolve(__dirname, "../../splash.html")
    : path.join(process.resourcesPath, "splash.html");
  // console.debug("splash path " + splashPath);
  splashWindow.loadFile(splashPath);
  setSplash(splashWindow);

  // Register all IPC handlers BEFORE creating windows so the renderer
  // can call them as soon as it loads without hanging.
  ipcMain.handle('mainwindow:minimize', () => {
    if (!windowManager.browserWindow) return;
    windowManager.browserWindow.minimize();
  })

  ipcMain.handle('mainwindow:maximize', () => {
    if (!windowManager.browserWindow) return;
    if (windowManager.browserWindow.isMaximized()) {
      windowManager.browserWindow.unmaximize();
    } else {
      windowManager.browserWindow.maximize();
    }
  })

  ipcMain.handle('mainwindow:isMaximized', () => {
    if (!windowManager.browserWindow) return;
    return windowManager.browserWindow.isMaximized()
  })

  ipcMain.handle('mainwindow:close', (event) => {
    // Just close the window, preserve state for session restore
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
  })

  ipcMain.handle('mainwindow:closeAndDeleteState', (event) => {
    // Close window and delete its state (explicit "Close Window" from menu)
    windowManager.closeWindowFromSender(event.sender);
  })

  // Initialize logger system
  setupLoggerIPC();
  setupProcessTrackerIPC();
  initializeIntegratedLogging();
  logger.info('system', 'STARTUP: app:ready fired — registering IPC handlers', { t: appReadyTime });

  registerSettingsIpc();
  registerFontsIpc();
  registerUpdateIpcHandlers();
  registerFileIpcHandlers();
  registerGitIpcHandlers();
  registerDirectoryIpcHandlers();
  registerTabIpcHandlers();
  registerPluginIpcHandlers();
  registerAppIpcHandlers();
  registerRequestIpcHandler();
  registerSearchIpcHandler();
  registerContextMenuIpcHandlers();
  registerThemeIpcHandlers();
  registerCliIpcHandlers();
  registerSkillsIpcHandlers();
  registerPythonScriptIpcHandler();
  registerNodeScriptIpcHandler();
  ipcStateHandlers();

  // Initialize auto-updates with the configured channel
  const settings = getSettings();
  const updateChannel = settings.updates?.channel || "stable";
  initializeUpdates(updateChannel);

  logger.info('system', 'STARTUP: all IPC handlers registered — creating windows');

  // Create main window (after IPC handlers are ready)
  const cliArgs = getCliArguments();
  // On macOS, also include any open-file paths that arrived before ready
  const allInitialArgs = [...cliArgs, ...pendingOpenFiles];
  pendingOpenFiles.length = 0;

  if (allInitialArgs.length > 0) {
    await handleCliArguments(allInitialArgs);
    if (windowManager.getAllWindows().length === 0) {
      splashWindow?.destroy();
    }
  } else {
    await windowManager.loadAllWindows();
  }
  logger.perf('system', 'STARTUP: windows loaded', Date.now() - appReadyTime, {
    note: 'total time from app:ready to first window visible — if >5000ms check FileWatcher:ready and initializeState phases',
  });

  // Set up the ongoing macOS "Open With" handler (remove the pre-ready queuing
  // listener first so we don't accumulate duplicate listeners).
  if (process.platform === "darwin") {
    app.removeAllListeners("open-file");
  }
  setupMacOSFileHandler();

  // Load main-process extensions after state is initialized
  try {
    const { getAppState } = await import("./main/state");
    const appState = getAppState();
    if (appState?.extensions) {
      await loadMainProcessExtensions(appState.extensions);
    }
    // Recompose skills now that state (extensions list) is available
    const skills = settings.skills;
    if (appState && (skills?.claude || skills?.codex)) {
      recomposeAndInstall(appState, { claude: skills.claude ?? false, codex: skills.codex ?? false }).catch(() => {});
    }
  } catch (err) {
    console.error("[main] Failed to load main-process extensions:", err);
  }
});

// Handle Second Command line

// Window lifecycle events
app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  const windows = BrowserWindow.getAllWindows();
  // On macOS, windows are hidden instead of destroyed when the user clicks
  // the red X. Re-show any hidden windows on dock-icon click.
  const hiddenWindows = windows.filter(w => !w.isDestroyed() && !w.isVisible());
  if (hiddenWindows.length > 0) {
    hiddenWindows.forEach(w => { w.show(); w.focus(); });
  } else if (windows.length === 0) {
    await windowManager.loadAllWindows();
  }
});

// Cleanup on quit
app.on("before-quit", async () => {
  await unloadMainProcessExtensions();
  closeAllWatchers();
});


