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

// Placeholder token in base.skill.md's frontmatter examples, substituted below
// with the real running app version — so an agent generating a new .void
// file can copy the shown `version` literally instead of guessing/inventing
// one (it has no other way to know what's actually installed).
const VOIDEN_VERSION_TOKEN = "__VOIDEN_APP_VERSION__";

// Placeholder in base.skill.md's "Read This First" section, replaced with the
// list of per-extension guide files that were actually written.
const EXTENSION_INDEX_TOKEN = "__VOIDEN_EXTENSION_INDEX__";

/** Folder, inside the installed skill, that holds one guide per extension. */
export const EXTENSION_GUIDES_DIR = "extensions";

export interface ComposedSkill {
  /** SKILL.md: the base format guide plus an index of the extension guides. */
  skillMd: string;
  /** Extension guides, keyed by path relative to the skill folder. */
  files: Record<string, string>;
}

/**
 * Title and one-line summary for an extension guide's index entry. The summary
 * is the guide's own "**Read this when:**" line if it has one, otherwise its
 * first paragraph.
 */
function describeExtensionGuide(content: string, fallbackTitle: string): { title: string; summary: string } {
  const title = content.match(/^##\s+Extension:\s*(.+)$/m)?.[1].trim() || fallbackTitle;

  const explicit = content.match(/^>?\s*\*\*Read this when:\*\*\s*(.+)$/m)?.[1];
  let summary = explicit ? `Read this when: ${explicit}` : "";
  if (!summary) {
    const lines = content.split("\n");
    const start = lines.findIndex((line) => /^##\s+Extension:/.test(line)) + 1;
    const paragraph: string[] = [];
    for (const line of lines.slice(start)) {
      const trimmed = line.trim();
      if (!trimmed) { if (paragraph.length) break; continue; }
      if (/^(#|>|```|\||-\s)/.test(trimmed)) { if (paragraph.length) break; continue; }
      paragraph.push(trimmed);
    }
    summary = paragraph.join(" ");
  }
  summary = summary.replace(/\s+/g, " ").trim();
  if (summary.length > 240) summary = `${summary.slice(0, 237).trimEnd()}...`;
  return { title, summary };
}

/**
 * Builds the installed skill from the base guide and every enabled extension's
 * skill.md. Missing skill.md files are silently skipped.
 *
 * The result is several files, not one: SKILL.md holds the base guide and an
 * index, and each extension's guide is its own file under extensions/. A
 * single concatenated file runs to thousands of lines, and agents that read
 * it with an output limit only ever saw the start of it, so guidance in a
 * later extension's section was never read. Split this way, an agent reads a
 * short SKILL.md in full and then opens the guides for the blocks it needs.
 */
export function composeSkill(appState: AppState): ComposedSkill {
  const withVersion = (text: string) => text.split(VOIDEN_VERSION_TOKEN).join(app.getVersion());
  const files: Record<string, string> = {};
  const index: string[] = [];

  // Each enabled extension in state order (core extensions come first per syncCoreExtensions)
  const enabled = appState.extensions.filter((e) => e.enabled);
  for (const ext of enabled) {
    const skillPath =
      ext.type === "core"
        ? getCoreExtensionSkillPath(ext.id)
        : path.join(ext.installedPath!, "skill.md");

    let content = "";
    try {
      content = fs.readFileSync(skillPath, "utf-8").trim();
    } catch {
      // Extension has no skill.md — silently skip
    }
    if (!content) continue;

    const relativePath = `${EXTENSION_GUIDES_DIR}/${ext.id}.md`;
    files[relativePath] = `${withVersion(content)}\n`;
    const { title, summary } = describeExtensionGuide(content, ext.name || ext.id);
    index.push(`- \`${relativePath}\` — **${title}.**${summary ? ` ${summary}` : ""}`);
  }

  const indexMarkdown = index.length > 0 ? index.join("\n") : "_No extension guides are installed._";

  let base = "";
  try {
    base = fs.readFileSync(path.join(getSkillsSourceDir(), "base.skill.md"), "utf-8").trim();
  } catch {
    // Missing base — still install the extension guides and their index
  }

  let skillMd: string;
  if (base.includes(EXTENSION_INDEX_TOKEN)) {
    skillMd = base.split(EXTENSION_INDEX_TOKEN).join(indexMarkdown);
  } else {
    skillMd = [base, "## Extension guides", indexMarkdown].filter(Boolean).join("\n\n");
  }

  return { skillMd: `${withVersion(skillMd)}\n`, files };
}
