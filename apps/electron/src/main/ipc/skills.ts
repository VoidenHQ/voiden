import { ipcMain } from "electron";
import { recomposeAndInstall, uninstallClaudeSkill, uninstallCodexSkill } from "../skillsInstaller";
import { getAppState } from "../state";
import { getSettings, saveSettings } from "../settings";
import {
  registerClaudeMcpServer,
  unregisterClaudeMcpServer,
  upsertCodexMcpSection,
  removeCodexMcpSection,
} from "@voiden/executors";

// The skill text (installed via recomposeAndInstall, above) tells the agent
// to use @voiden/mcp-server's tools — but that's only true if the server is
// actually registered for the current project. Toggling the skill on/off
// also registers/unregisters the MCP server against the active project, so
// the two halves (instructions + capability) stay in sync automatically.
// Registration is a no-op if no project is open (nothing to point the
// server at yet) — the skill install still proceeds either way.

function registerMcpForActiveProject(target: "claude" | "codex"): void {
  const activeDirectory = getAppState().activeDirectory;
  if (!activeDirectory) return;
  if (target === "claude") registerClaudeMcpServer(activeDirectory);
  else upsertCodexMcpSection(activeDirectory);
}

function unregisterMcpForActiveProject(target: "claude" | "codex"): void {
  const activeDirectory = getAppState().activeDirectory;
  if (target === "claude") {
    if (activeDirectory) unregisterClaudeMcpServer(activeDirectory);
  } else {
    removeCodexMcpSection();
  }
}

export function registerSkillsIpcHandlers() {
  ipcMain.handle("skills:setClaude", async (_e, enabled: boolean) => {
    try {
      const current = getSettings().skills;
      if (enabled) {
        await recomposeAndInstall(getAppState(), { claude: true, codex: current?.codex ?? false });
        registerMcpForActiveProject("claude");
      } else {
        uninstallClaudeSkill();
        unregisterMcpForActiveProject("claude");
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
        registerMcpForActiveProject("codex");
      } else {
        uninstallCodexSkill();
        unregisterMcpForActiveProject("codex");
      }
      saveSettings({ skills: { ...current, codex: enabled } });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error?.message ?? "Unknown error" };
    }
  });
}
