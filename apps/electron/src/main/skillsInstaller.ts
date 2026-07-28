import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppState } from "src/shared/types";
import { composeSkillMarkdown } from "./skillsComposer";
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

// --- Claude Code ---

function installClaude(markdown: string): void {
  const skillDir = getClaudeSkillDir();
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), markdown, "utf-8");
  } catch {}
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

function installCodex(markdown: string): void {
  const skillDir = getCodexSkillDir();
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), markdown, "utf-8");
  } catch {}
}

export function uninstallCodexSkill(): void {
  try {
    const skillDir = getCodexSkillDir();
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
  } catch {}
  try { uninstallMcpCodexSkill(); } catch {}
}

// --- Public API ---

type SkillTargets = { claude: boolean; codex: boolean };

/**
 * Installs two distinct skills per target, always kept in sync with each other:
 *   - ~/.claude|codex/skills/voiden/SKILL.md     — authoring, composed fresh from
 *     all enabled extensions' skill.md (this app's own content)
 *   - ~/.claude|codex/skills/voiden-mcp/SKILL.md — running/verifying via the MCP
 *     tools, sourced from @voiden/executors so the CLI and the app never drift apart
 * Both are fully regenerated and overwritten on every call — there's no partial/stale
 * state between them.
 */
export async function recomposeAndInstall(appState: AppState, targets: SkillTargets): Promise<void> {
  const markdown = composeSkillMarkdown(appState);
  if (targets.claude) {
    installClaude(markdown);
    installMcpClaudeSkill(MCP_SKILL_MARKDOWN);
  }
  if (targets.codex) {
    installCodex(markdown);
    installMcpCodexSkill(MCP_SKILL_MARKDOWN);
  }
}

/**
 * Removes installed skills from all targets.
 */
export function uninstallSkills(): void {
  uninstallClaudeSkill();
  uninstallCodexSkill();
}
