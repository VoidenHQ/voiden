import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppState } from "src/shared/types";

function getSkillsSourceDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills");
  }
  // Dev: __dirname resolves to apps/electron/.vite/build/main/
  return path.join(__dirname, "../../skills");
}

function getCoreExtensionSkillPath(extensionId: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills", "core", `${extensionId}.skill.md`);
  }
  // Dev: read directly from core-extensions source tree.
  // __dirname = apps/electron/.vite/build/main/ → 4 levels up reaches the monorepo root
  return path.join(__dirname, "../../../../core-extensions/src", extensionId, "skill.md");
}

/**
 * Reads skill.md files from the base + all enabled extensions and concatenates them.
 * Missing skill.md files are silently skipped.
 */
export function composeSkillMarkdown(appState: AppState): string {
  const parts: string[] = [];

  // 1. Base .void format overview
  const basePath = path.join(getSkillsSourceDir(), "base.skill.md");
  try {
    const base = fs.readFileSync(basePath, "utf-8").trim();
    if (base) parts.push(base);
  } catch {
    // Missing base — still compose extension content
  }

  // 2. Each enabled extension in state order (core extensions come first per syncCoreExtensions)
  const enabled = appState.extensions.filter((e) => e.enabled);
  for (const ext of enabled) {
    const skillPath =
      ext.type === "core"
        ? getCoreExtensionSkillPath(ext.id)
        : path.join(ext.installedPath!, "skill.md");

    try {
      const content = fs.readFileSync(skillPath, "utf-8").trim();
      if (content) parts.push(content);
    } catch {
      // Extension has no skill.md — silently skip
    }
  }

  return parts.join("\n\n---\n\n");
}
