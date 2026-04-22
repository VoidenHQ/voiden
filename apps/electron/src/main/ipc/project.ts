import { ipcMain, BrowserWindow } from "electron";
import { getProjectLocked, setProjectLocked } from "../projectUtils";
import { getAppState } from "../state";

function normalizePath(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function registerProjectIpcHandlers() {
  ipcMain.handle("project:getLocked", async (_event, projectRoot: string) => {
    if (!projectRoot) return false;
    return getProjectLocked(projectRoot);
  });

  ipcMain.handle("project:isPathInsideLocked", async (_event, filePath: string) => {
    if (!filePath) return false;
    const appState = getAppState();
    const activeDirectory = appState?.activeDirectory ?? null;
    if (!activeDirectory) return false;

    const root = normalizePath(activeDirectory);
    const path = normalizePath(filePath);
    if (path !== root && !path.startsWith(root + "/")) return false;

    const locked = await getProjectLocked(activeDirectory);
    if (!locked) return false;

    const voidenDir = root + "/.voiden";
    if (path === voidenDir || path.startsWith(voidenDir + "/")) return false;

    return true;
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
