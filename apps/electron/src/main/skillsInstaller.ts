import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppState } from "src/shared/types";
import { composeSkillMarkdown } from "./skillsComposer";

const CODEX_SECTION_START = "<!-- voiden-skills:start -->";
const CODEX_SECTION_END = "<!-- voiden-skills:end -->";

function getClaudeSkillsDir(): string {
  return path.join(app.getPath("home"), ".claude", "skills");
}

function getCodexInstructionsPath(): string {
  return path.join(app.getPath("home"), ".codex", "instructions.md");
}

// --- Claude Code ---

function installClaudeSkill(markdown: string): void {
  // Claude Code expects a directory ~/.claude/skills/voiden/ containing SKILL.md
  const skillDir = path.join(getClaudeSkillsDir(), "voiden");
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), markdown, "utf-8");
  } catch {
    // skip — non-critical
  }
}

function uninstallClaudeSkill(): void {
  const targetDir = getClaudeSkillsDir();
  // Remove current skill directory
  try {
    const skillDir = path.join(targetDir, "voiden");
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
  } catch {}
  // Migrate: remove old ZIP-format skills if they exist
  try {
    const oldZip = path.join(targetDir, "voiden.skill");
    if (fs.existsSync(oldZip)) fs.unlinkSync(oldZip);
  } catch {}
  try {
    const oldCreator = path.join(targetDir, "voiden-creator.skill");
    if (fs.existsSync(oldCreator)) fs.unlinkSync(oldCreator);
  } catch {}
}

// --- Codex ---

function installCodexSkills(composedMarkdown: string): void {
  if (!composedMarkdown.trim()) return;

  const section = `${CODEX_SECTION_START}\n${composedMarkdown.trim()}\n${CODEX_SECTION_END}`;
  const instructionsPath = getCodexInstructionsPath();

  try {
    fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
  } catch {
    return;
  }

  let existing = "";
  try {
    existing = fs.readFileSync(instructionsPath, "utf-8");
  } catch {
    // file doesn't exist yet
  }

  let updated: string;
  if (existing.includes(CODEX_SECTION_START)) {
    updated = existing.replace(
      new RegExp(`${CODEX_SECTION_START}[\\s\\S]*?${CODEX_SECTION_END}`),
      section
    );
  } else {
    const separator = existing && !existing.endsWith("\n\n") ? "\n\n" : "";
    updated = existing + separator + section + "\n";
  }

  try {
    fs.writeFileSync(instructionsPath, updated, "utf-8");
  } catch {}
}

function uninstallCodexSkills(): void {
  const instructionsPath = getCodexInstructionsPath();
  if (!fs.existsSync(instructionsPath)) return;

  try {
    const existing = fs.readFileSync(instructionsPath, "utf-8");
    if (!existing.includes(CODEX_SECTION_START)) return;

    const updated = existing
      .replace(new RegExp(`\\n?${CODEX_SECTION_START}[\\s\\S]*?${CODEX_SECTION_END}\\n?`), "")
      .trimEnd();

    if (updated) {
      fs.writeFileSync(instructionsPath, updated + "\n", "utf-8");
    } else {
      fs.unlinkSync(instructionsPath);
    }
  } catch {}
}

// --- Public API ---

/**
 * Composes skills from all enabled extensions and installs them to
 * ~/.claude/skills/voiden.skill and ~/.codex/instructions.md
 */
export async function recomposeAndInstall(appState: AppState): Promise<void> {
  const markdown = composeSkillMarkdown(appState);
  installClaudeSkill(markdown);
  installCodexSkills(markdown);
}

/**
 * Removes installed skills from ~/.claude/skills/ and ~/.codex/instructions.md
 */
export function uninstallSkills(): void {
  uninstallClaudeSkill();
  uninstallCodexSkills();
}
