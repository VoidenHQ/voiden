import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppState } from "src/shared/types";
import { composeSkill, EXTENSION_GUIDES_DIR, type ComposedSkill } from "./skillsComposer";
import {
  installClaudeSkill as installMcpClaudeSkill,
  uninstallClaudeSkill as uninstallMcpClaudeSkill,
  installCodexSkill as installMcpCodexSkill,
  uninstallCodexSkill as uninstallMcpCodexSkill,
  MCP_SKILL_MARKDOWN,
} from "@voiden/executors";

function getClaudeSkillDir(): string {
  return path.join(app.getPath("home"), ".claude", "skills", "voiden");
}

function getCodexSkillDir(): string {
  return path.join(app.getPath("home"), ".codex", "skills", "voiden");
}

/**
 * Writes SKILL.md and the extension guides into a skill folder. The guides
 * folder is cleared first so a disabled extension's guide doesn't linger.
 */
function writeSkill(skillDir: string, skill: ComposedSkill): void {
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.rmSync(path.join(skillDir, EXTENSION_GUIDES_DIR), { recursive: true, force: true });
    for (const [relativePath, content] of Object.entries(skill.files)) {
      const filePath = path.join(skillDir, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
    }
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skill.skillMd, "utf-8");
  } catch {}
}

// --- Shared ~/.agents/skills folder ---

function getSharedAgentsSkillsDir(): string {
  return path.join(app.getPath("home"), ".agents", "skills");
}

/** True when the folder holds a skill whose SKILL.md frontmatter names it `name`. */
function isSkillNamed(skillDir: string, name: string): boolean {
  try {
    const head = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8").slice(0, 2000);
    const frontmatter = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    return frontmatter.split(/\r?\n/).some((line) => {
      const match = line.match(/^name:\s*(.+?)\s*$/);
      return match !== null && match[1].replace(/^["']|["']$/g, "") === name;
    });
  } catch {
    return false;
  }
}

/**
 * Keeps a Voiden skill that already exists in ~/.agents/skills in step with
 * the one just installed.
 *
 * Voiden does not install into that folder, but Codex and other agents read
 * it, and other tools copy skills into it. A copy made that way is never
 * refreshed, so an agent can pick up a months-old Voiden skill in place of
 * the current one. Only an existing copy is rewritten; none is ever created,
 * and a folder that is not a Voiden skill is left alone.
 */
function syncSharedAgentsSkills(skill: ComposedSkill, mcpSkillMarkdown?: string): void {
  const sharedDir = getSharedAgentsSkillsDir();

  const voidenDir = path.join(sharedDir, "voiden");
  if (isSkillNamed(voidenDir, "voiden")) writeSkill(voidenDir, skill);

  if (mcpSkillMarkdown) {
    const mcpDir = path.join(sharedDir, "voiden-mcp");
    if (isSkillNamed(mcpDir, "voiden-mcp")) {
      try {
        fs.writeFileSync(path.join(mcpDir, "SKILL.md"), mcpSkillMarkdown, "utf-8");
      } catch {}
    }
  }
}

// --- Claude Code ---

function installClaude(skill: ComposedSkill): void {
  writeSkill(getClaudeSkillDir(), skill);
}

export function uninstallClaudeSkill(): void {
  try {
    const skillDir = getClaudeSkillDir();
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
  } catch {}
  // Migrate: remove old ZIP-format skills if they exist
  try {
    const base = path.join(app.getPath("home"), ".claude", "skills");
    for (const old of ["voiden.skill", "voiden-creator.skill"]) {
      const p = path.join(base, old);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {}
  try { uninstallMcpClaudeSkill(); } catch {}
}

// --- Codex ---

function installCodex(skill: ComposedSkill): void {
  writeSkill(getCodexSkillDir(), skill);
}

export function uninstallCodexSkill(): void {
  try {
    const skillDir = getCodexSkillDir();
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
  } catch {}
  try { uninstallMcpCodexSkill(); } catch {}
}

// --- Public API ---

export type SkillTargets = { claude: boolean; codex: boolean };

/**
 * Installs two distinct skills per target, always kept in sync with each other:
 *   - ~/.claude|codex/skills/voiden/            — authoring: SKILL.md plus one guide
 *     per enabled extension under extensions/, composed fresh from each skill.md
 *   - ~/.claude|codex/skills/voiden-mcp/SKILL.md — running/verifying via the MCP
 *     tools, sourced from @voiden/executors so the CLI and the app never drift apart
 * Both are fully regenerated and overwritten on every call — there's no partial/stale
 * state between them.
 */
export async function recomposeAndInstall(appState: AppState, targets: SkillTargets): Promise<void> {
  const skill = composeSkill(appState);
  if (targets.claude) {
    installClaude(skill);
    installMcpClaudeSkill(MCP_SKILL_MARKDOWN);
  }
  if (targets.codex) {
    installCodex(skill);
    installMcpCodexSkill(MCP_SKILL_MARKDOWN);
  }
  if (targets.claude || targets.codex) syncSharedAgentsSkills(skill, MCP_SKILL_MARKDOWN);
}

/**
 * Removes installed skills from all targets.
 */
export function uninstallSkills(): void {
  uninstallClaudeSkill();
  uninstallCodexSkill();
}

/**
 * Recomposes and rewrites just the app's own `voiden` skill — not the
 * separate standalone `voiden-mcp` skill `recomposeAndInstall()` also
 * installs. Used by the "Initialize MCP" action: that action already
 * registers the real MCP server connection (`.mcp.json`/`config.toml`), so
 * installing the standalone `voiden-mcp` skill alongside it would just be a
 * second, more minimal skill file duplicating what the composed skill
 * already documents (it already includes `voiden-mcp-tool`'s own skill.md
 * content whenever that plugin is enabled, as its own guide file written by
 * composeSkill()) — this refreshes that existing skill without
 * writing the duplicate.
 */
export function updateComposedSkillOnly(appState: AppState, targets: SkillTargets): void {
  const skill = composeSkill(appState);
  if (targets.claude) installClaude(skill);
  if (targets.codex) installCodex(skill);
  if (targets.claude || targets.codex) syncSharedAgentsSkills(skill);
}
