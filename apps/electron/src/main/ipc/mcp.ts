import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAppState } from "../state";
import { updateComposedSkillOnly } from "../skillsInstaller";
import { registerClaudeMcpServer, upsertCodexMcpSection, getMcpStatus, type ServerCommand } from "@voiden/executors";

// Dev builds must register the in-repo @voiden/mcp-server build (so testing
// picks up local changes instantly); packaged/binary builds (yarn make, and
// anything installed from a release) must register the published npm
// package instead — a built app has no monorepo dist to point at, and a dev
// checkout shouldn't silently depend on whatever's currently on npm.
// app.isPackaged is exactly this boundary (same convention already used by
// extensionLoader.ts/projectUtils.ts/skillsComposer.ts for other
// dev-vs-packaged path resolution). Returning undefined here falls back to
// executors' own defaultServerCommand (npx @voiden/mcp-server@latest).
function devLocalServerCommand(projectPath: string): ServerCommand | undefined {
  if (app.isPackaged) return undefined;
  // __dirname (compiled) is apps/electron/.vite/build — four levels under
  // the repo root.
  const distPath = path.join(__dirname, "../../../../packages/voiden-mcp-server/dist/index.js");
  if (!fs.existsSync(distPath)) return undefined;
  return { command: "node", args: [distPath, projectPath] };
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
  ipcMain.handle("mcp:initialize", async () => {
    const activeDirectory = getAppState().activeDirectory;
    if (!activeDirectory) {
      return { success: false, message: "No active project" };
    }
    try {
      const serverCommand = devLocalServerCommand(activeDirectory);
      registerClaudeMcpServer(activeDirectory, serverCommand);
      upsertCodexMcpSection(activeDirectory, serverCommand);
      updateComposedSkillOnly(getAppState(), { claude: true, codex: true });
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
  ipcMain.handle("mcp:status", async () => {
    const activeDirectory = getAppState().activeDirectory;
    if (!activeDirectory) return { registered: false };
    const status = getMcpStatus(activeDirectory);
    return { registered: status.claude.serverRegistered };
  });
}
