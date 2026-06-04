import { ipcMain, app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { communityDir } from "../extension/paths";
import { getPlugins } from "../plugin";

export function registerPluginIpcHandlers() {
  ipcMain.handle("plugins:get", async () => {
    return await getPlugins();
  });

  ipcMain.handle("plugins:list", () => {
    const pluginDir = communityDir();
    try {
      const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(pluginDir, entry.name, "main.js"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  });
}
