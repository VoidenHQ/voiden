import { ipcMain } from "electron";
import { recomposeAndInstall, uninstallClaudeSkill, uninstallCodexSkill } from "../skillsInstaller";
import { getAppState } from "../state";
import { getSettings, saveSettings } from "../settings";

// These toggles install/uninstall the agent-facing skill *text* only (the
// doc telling Claude/Codex how to use Voiden) — they never touch
// .mcp.json/config.toml. MCP registration is a separate, explicit,
// project-scoped action the user takes deliberately from the status bar's
// "Initialize MCP" button (see ipc/mcp.ts) — it must not be a side effect of
// an unrelated settings toggle, and must not silently overwrite whatever a
// user has manually configured there (e.g. testing against a local server
// build) just because this toggle happens to be on at app startup.

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
