import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAppState } from "../state";
import { updateComposedSkillOnly } from "../skillsInstaller";
import { registerClaudeMcpServer, upsertCodexMcpSection, getMcpStatus, type ServerCommand } from "@voiden/executors";

// Points at the SAME hidden `mcp-stdio` entry `voiden agent` registers (see
// apps/electron/src/voiden-cli.ts's own doc comment) — the lightweight
// 4-fixed-tools server, not @voiden/mcp (that's a separate, standalone
// server for publishing `/tool` blocks, unrelated to this button). This
// handler and `voiden agent` are two entry points — GUI button, CLI command
// — for the exact same registration, so they must always target the same
// command or one silently overwrites the other's working entry with a
// mismatched one under the same .mcp.json key.
//
// Dev builds register the in-repo bundled CLI (voiden-cli.ts is a normal
// VitePlugin build entry now — forge.config.ts + vite.cli.config.ts — built
// as a sibling of main.js in .vite/build/, so testing picks up local
// changes on the next `yarn start`/rebuild, no separate build/publish
// step); packaged builds register the packaged app's own `voiden` binary,
// which must be on PATH the same way `voiden agent` itself assumes when
// writing its own .mcp.json (see its inline `serverCommand` in
// apps/electron/src/voiden-cli.ts's `agent` action). app.isPackaged is the
// same dev-vs-packaged boundary already used by
// extensionLoader.ts/projectUtils.ts/skillsComposer.ts.
function resolveMcpStdioServerCommand(projectPath: string): ServerCommand | undefined {
  if (app.isPackaged) {
    return { command: "voiden", args: ["mcp-stdio", projectPath] };
  }
  // __dirname (compiled) is apps/electron/.vite/build — voiden-cli.js is
  // Forge's VitePlugin building src/voiden-cli.ts as a sibling entry right
  // alongside main.js in that same output directory (see forge.config.ts's
  // VitePlugin `build` array), not a separately-resourced bundle elsewhere.
  const bundledCliPath = path.join(__dirname, "voiden-cli.js");
  if (!fs.existsSync(bundledCliPath)) return undefined;
  return { command: "node", args: [bundledCliPath, "mcp-stdio", projectPath] };
}

export function registerMcpIpcHandlers() {
  // "Initialize MCP" — a discoverable, project-scoped shortcut for wiring up
  // .mcp.json/config.toml against the active project, without the user
  // needing to find Settings' "AI Skills" toggle. Deliberately does NOT
  // touch that toggle's own persisted enabled/disabled state, and installs
  // only the app's own composed `voiden` skill refresh — not the separate
  // standalone `voiden-mcp` skill the toggle also writes (see
  // updateComposedSkillOnly's own doc comment for why).
  //
  // This is also the ONLY place MCP registration happens automatically in
  // response to app state — not settings toggles, not app startup, not
  // project switching. See state.ts/main.ts/ipc/skills.ts's history: those
  // used to also auto-register, which meant an unrelated toggle or a plain
  // relaunch could silently overwrite a manually-configured .mcp.json.
  ipcMain.handle("mcp:initialize", async (event) => {
    const activeDirectory = getAppState(event).activeDirectory;
    if (!activeDirectory) {
      return { success: false, message: "No active project" };
    }
    try {
      const serverCommand = resolveMcpStdioServerCommand(activeDirectory);
      registerClaudeMcpServer(activeDirectory, serverCommand);
      upsertCodexMcpSection(activeDirectory, serverCommand);
      updateComposedSkillOnly(getAppState(event), { claude: true, codex: true });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error?.message ?? "Unknown error" };
    }
  });

  // Whether the active project is already registered — lets the status bar
  // button show a persistent "ready" state on open/project-switch, instead
  // of only flashing green right after a click.
  //
  // Deliberately keyed off Claude's status (.mcp.json — a real, per-project
  // file) only, not Codex's. isCodexMcpRegistered() checks a single GLOBAL
  // ~/.codex/config.toml for the mere presence of a [mcp_servers.voiden-mcp]
  // section — it isn't, and can't easily be, scoped to "is THIS project
  // registered". ORing it in meant every project showed "ready" forever
  // after Codex was registered for any one of them, .mcp.json or not.
  ipcMain.handle("mcp:status", async (event) => {
    const activeDirectory = getAppState(event).activeDirectory;
    if (!activeDirectory) return { registered: false };
    const status = getMcpStatus(activeDirectory);
    return { registered: status.claude.serverRegistered };
  });
}
