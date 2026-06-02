import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppState } from "src/shared/types";
import { coreCacheDir } from "./extension/paths";

function getSkillsSourceDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills");
  }
  // Dev: __dirname resolves to apps/electron/.vite/build/main/
  return path.join(__dirname, "../../skills");
}

function getCoreExtensionSkillPath(extensionId: string): string {
  if (app.isPackaged) {
    // Prefer OTA-cached skill.md if the plugin was updated at runtime
    const cacheDir = coreCacheDir();
    const cacheManifestPath = path.join(cacheDir, "manifest.json");
    try {
      const cacheManifest = JSON.parse(fs.readFileSync(cacheManifestPath, "utf-8"));
      const entry = cacheManifest.plugins?.[extensionId];
      if (entry?.skillFile) {
        const cachedSkillPath = path.join(cacheDir, extensionId, entry.skillFile);
        if (fs.existsSync(cachedSkillPath)) return cachedSkillPath;
      }
    } catch { /* no cache or malformed — fall through */ }
    return path.join(process.resourcesPath, "skills", "core", `${extensionId}.skill.md`);
  }
  // Dev: scan plugins/ repos for a manifest.json whose "id" matches extensionId.
  // __dirname = apps/electron/.vite/build/ → 4 levels up is the monorepo root.
  const repoRoot = path.join(__dirname, "../../../../");
  const pluginsDir = path.join(repoRoot, "plugins");
  if (fs.existsSync(pluginsDir)) {
    for (const pluginDir of fs.readdirSync(pluginsDir)) {
      if (!pluginDir.startsWith("plugin-")) continue;
      const manifestPath = path.join(pluginsDir, pluginDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (manifest.id === extensionId) {
          return path.join(pluginsDir, pluginDir, "src", "skill.md");
        }
      } catch { continue; }
    }
  }
  // Fallback: pre-built skills dir (populated by generateAssets or cleanup.sh)
  return path.join(repoRoot, "apps", "electron", "skills", "core", `${extensionId}.skill.md`);
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
