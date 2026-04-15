import { ipcMain, BrowserWindow } from "electron";
import { getProjectLocked, setProjectLocked } from "../projectUtils";

export function registerProjectIpcHandlers() {
  ipcMain.handle("project:getLocked", async (_event, projectRoot: string) => {
    if (!projectRoot) return false;
    return getProjectLocked(projectRoot);
  });

  ipcMain.handle(
    "project:setLocked",
    async (_event, projectRoot: string, locked: boolean) => {
      if (!projectRoot) return false;
      const next = await setProjectLocked(projectRoot, !!locked);
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send("project:locked-changed", {
          projectRoot,
          locked: next,
        });
      }
      return next;
    },
  );
}
