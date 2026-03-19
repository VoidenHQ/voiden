import { ipcMain } from "electron";
import { recomposeAndInstall, uninstallSkills } from "../skillsInstaller";
import { getAppState } from "../state";
import { getSettings, saveSettings } from "../settings";

export function registerSkillsIpcHandlers() {
  ipcMain.handle("skills:setEnabled", async (_e, enabled: boolean) => {
    try {
      if (enabled) {
        await recomposeAndInstall(getAppState());
      } else {
        uninstallSkills();
      }
      saveSettings({ skills: { enabled } });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error?.message ?? "Unknown error" };
    }
  });

  ipcMain.handle("skills:getEnabled", () => {
    return getSettings().skills?.enabled ?? false;
  });
}
