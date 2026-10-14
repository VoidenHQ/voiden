import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAppState } from "../state";
import { updateComposedSkillOnly } from "../skillsInstaller";
import { isCliInstalled } from "../cliInstaller";
import { registerClaudeMcpServer, unregisterClaudeMcpServer, upsertCodexMcpSection, getMcpStatus, type ServerCommand } from "@voiden/executors";

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
    // Packaged builds register a bare `voiden` command, assuming it resolves
    // on PATH later when Claude/Codex actually spawns it — resolveMcpStdioServerCommand()
    // itself has no way to check that, since it's synchronous and doesn't
    // touch the filesystem. Without this check, a missing CLI produced no
    // error here at all: registration "succeeded" (the .mcp.json write
    // itself never fails), and the real failure only surfaced later,
    // invisibly, as a "command not found" inside Claude/Codex with no link
    // back to this button.
    if (app.isPackaged && !(await isCliInstalled())) {
      return {
        success: false,
        message: "The Voiden CLI isn't installed yet — install it from Settings before initializing MCP.",
      };
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

  // The inverse of mcp:initialize — deliberately project-scoped only
  // (unregisterClaudeMcpServer removes just this project's entry from its
  // own .mcp.json). Does NOT touch removeCodexMcpSection()/
  // uninstallClaudeSkill()/uninstallCodexSkill() — those write to a single
  // GLOBAL ~/.codex/config.toml and ~/.claude|codex/skills/<slug> dir
  // shared by every project, so "disable MCP for this project" must not
  // silently break Codex/skill access for every other one too. Same
  // per-project-vs-global reasoning mcp:status's own comment already
  // applies on the read side.
  ipcMain.handle("mcp:disable", async (event) => {
    const activeDirectory = getAppState(event).activeDirectory;
    if (!activeDirectory) {
      return { success: false, message: "No active project" };
    }
    try {
      unregisterClaudeMcpServer(activeDirectory);
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
  //
  // Also reports cliInstalled — a project can be registered from before the
  // CLI was ever removed (or on a machine that never had it installed at
  // all), in which case `registered: true` alone is misleading: the
  // .mcp.json entry is real, but the `voiden` command it points at won't
  // resolve, so Claude/Codex will fail to actually launch it. The renderer
  // uses this to show "needs the CLI" instead of a plain "ready" for that
  // case — see mcp:initialize's own isCliInstalled() check above for the
  // same reasoning on the write side.
  ipcMain.handle("mcp:status", async (event) => {
    const activeDirectory = getAppState(event).activeDirectory;
    if (!activeDirectory) return { registered: false, cliInstalled: true };
    const status = getMcpStatus(activeDirectory);
    const cliInstalled = app.isPackaged ? await isCliInstalled() : true;
    return { registered: status.claude.serverRegistered, cliInstalled };
  });
}
