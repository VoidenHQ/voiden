import { ipcMain, app, shell, dialog, BrowserWindow } from "electron";
import { createNewDocumentTab } from "../state";
import { setActiveProject } from "../state";
import { windowManager } from "../windowManager";

export function registerAppIpcHandlers() {
  ipcMain.on("open-external", (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle("app:getUserDataPath", () => {
    return app.getPath("userData");
  });

  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  // Menu action: New File
  ipcMain.handle("menu:newFile", async () => {
    await createNewDocumentTab();
  });

  // Menu action: Open Folder
  ipcMain.handle("menu:openFolder", async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow) return;

    const result = await dialog.showOpenDialog(browserWindow, {
      properties: ["openDirectory", "createDirectory"],
    });

    if (!result.canceled) {
      await setActiveProject(result.filePaths[0]);
      windowManager.browserWindow?.webContents.send('folder:opened',{path:result.filePaths[0]})
    }
  });

  // Menu action: Save (trigger via event)
  ipcMain.handle("menu:save", (event) => {
    windowManager.browserWindow?.webContents.send("file-menu-command", { command: "save-file" });
  });

  // Menu action: Close Project
  ipcMain.handle("menu:closeProject", (event) => {
    windowManager.browserWindow?.webContents.send("directory:close-project", {});
  });

  // Menu action: Toggle Explorer
  ipcMain.handle("menu:toggleExplorer", (event) => {
    windowManager.browserWindow?.webContents.send("menu:toggle-explorer", {});
  });

  // Menu action: Toggle Terminal
  ipcMain.handle("menu:toggleTerminal", (event) => {
    windowManager.browserWindow?.webContents.send("menu:toggle-terminal", {});
  });


  // View menu actions
  ipcMain.handle("menu:reload", (event) => {
    const webContents = event.sender;
    webContents.reload();
  });

  ipcMain.handle("menu:forceReload", (event) => {
    const webContents = event.sender;
    webContents.reloadIgnoringCache();
  });

  ipcMain.handle("menu:resetZoom", (event) => {
    const webContents = event.sender;
    webContents.setZoomLevel(0);
  });

  ipcMain.handle("menu:zoomIn", (event) => {
    const webContents = event.sender;
    const currentZoom = webContents.getZoomLevel();
    // Limit max zoom to +5
    if (currentZoom < 3) {
      webContents.setZoomLevel(Math.min(currentZoom + 0.5, 5));
    }
  });

  ipcMain.handle("menu:zoomOut", (event) => {
    const webContents = event.sender;
    const currentZoom = webContents.getZoomLevel();
    // Limit min zoom to -2
    if (currentZoom > -2) {
      webContents.setZoomLevel(Math.max(currentZoom - 0.5, -2));
    }
  });

  ipcMain.handle("menu:toggleFullScreen", (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow) {
      browserWindow.setFullScreen(!browserWindow.isFullScreen());
    }
  });

  ipcMain.handle("menu:toggleDevTools", (event) => {
    const webContents = event.sender;
    webContents.toggleDevTools();
  });

  // Application actions
  ipcMain.handle("menu:quit",async () => {
    app.quit();
  });

  // App-wide process metrics (memory + CPU per process type)
  ipcMain.handle("app:metrics", () => {
    return app.getAppMetrics().map((m) => ({
      type: m.type,
      memory: m.memory.workingSetSize, // KB
      cpu: m.cpu.percentCPUUsage,
    }));
  });
}
