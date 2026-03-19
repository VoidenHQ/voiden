import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppState } from "src/shared/types";
import { composeSkillMarkdown } from "./skillsComposer";

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
}

// --- Public API ---

type SkillTargets = { claude: boolean; codex: boolean };

/**
 * Composes skills from all enabled extensions and installs them to the requested targets:
 * ~/.claude/skills/voiden/SKILL.md and/or ~/.codex/skills/voiden/SKILL.md
 */
export async function recomposeAndInstall(appState: AppState, targets: SkillTargets): Promise<void> {
  const markdown = composeSkillMarkdown(appState);
  if (targets.claude) installClaude(markdown);
  if (targets.codex) installCodex(markdown);
}

/**
 * Removes installed skills from all targets.
 */
export function uninstallSkills(): void {
  uninstallClaudeSkill();
  uninstallCodexSkill();
}
