import { ipcMain } from "electron";
import { recomposeAndInstall, uninstallClaudeSkill, uninstallCodexSkill } from "../skillsInstaller";
import { getAppState } from "../state";
import { getSettings, saveSettings } from "../settings";

export function registerSkillsIpcHandlers() {
  ipcMain.handle("skills:setClaude", async (_e, enabled: boolean) => {
    try {
      const current = getSettings().skills;
      if (enabled) {
        await recomposeAndInstall(getAppState(), { claude: true, codex: current?.codex ?? false });
      } else {
        uninstallClaudeSkill();
      }
      saveSettings({ skills: { ...current, claude: enabled } });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error?.message ?? "Unknown error" };
    }
  });

  ipcMain.handle("skills:setCodex", async (_e, enabled: boolean) => {
    try {
      const current = getSettings().skills;
      if (enabled) {
        await recomposeAndInstall(getAppState(), { claude: current?.claude ?? false, codex: true });
      } else {
        uninstallCodexSkill();
      }
      saveSettings({ skills: { ...current, codex: enabled } });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error?.message ?? "Unknown error" };
    }
  });
}
