/**
 * Core Plugin Registry
 *
 * Derives the list of runner-capable core plugins from the same
 * VoidenHQ/plugin-registry `extensions.json` that the Electron app reads
 * (see registryCache.ts) — no separate static snapshot to keep in sync.
 *
 * A core plugin is runner-capable when the registry marks it `hasRunner: true`
 * (set by plugin-registry maintainers when the plugin publishes a headless
 * runner.js bundle). Each such plugin is built and released as
 * {pluginId}-runner.js in its own GitHub repo (VoidenHQ/plugin-{dir}).
 * voiden-runner downloads and caches these files the same way community
 * plugins do: ~/.voiden/extensions/{id}/runner.js
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, statSync, readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { getRegistry, type RegistryEntry } from './registryCache.js'
import { getInstalledVersion, isPluginUninstalled } from './store.js'

// ─── Runner paths (priority: bundled-at-build-time > user cache > download) ───
const RUNNER_CACHE_DIR = join(homedir(), '.voiden', 'extensions')

// A failed/interrupted download can leave a 0-byte file behind; treat that as
// "not cached" so we fall back to the bundled copy instead of importing nothing.
function isValidRunnerFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 0
  } catch {
    return false
  }
}

// Resolves the bundled-runners/ directory shipped inside the @voiden/runner
// package itself (built by scripts/build-runners.mjs from plugins whose
// plugin-registry entry has `bundled: true`). Two candidates: monorepo dev
// layout vs. the npm-installed package layout.
function getBundledRunnersDir(): string | null {
  const candidates = [
    join(new URL('.', import.meta.url).pathname, '../../../../packages/voiden-runner/bundled-runners'),
    join(new URL('.', import.meta.url).pathname, '../../bundled-runners'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

function getBundledRunnerPath(pluginId: string): string | null {
  const dir = getBundledRunnersDir()
  if (!dir) return null
  const p = join(dir, `${pluginId}-runner.js`)
  return isValidRunnerFile(p) ? p : null
}

let bundledVersionsCache: Record<string, string> | undefined
function getBundledVersions(): Record<string, string> {
  if (bundledVersionsCache) return bundledVersionsCache
  const dir = getBundledRunnersDir()
  try {
    bundledVersionsCache = dir ? JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf-8')) : {}
  } catch {
    bundledVersionsCache = {}
  }
  return bundledVersionsCache!
}

/** Version of the copy currently bundled inside the package (not the latest registry version). */
export function getBundledVersion(pluginId: string): string | undefined {
  return getBundledVersions()[pluginId]
}

/**
 * The version actually present locally — cached download takes priority over
 * the bundled copy. Returns undefined once explicitly uninstalled, even
 * though a bundled file may still physically exist on disk — uninstalled
 * bundled plugins are treated as unavailable, not just "using the bundled
 * version", so `plugin list`/version checks correctly show "not installed".
 */
export function getCoreRunnerVersion(pluginId: string): string | undefined {
  if (isPluginUninstalled(pluginId)) return undefined
  return getInstalledVersion(pluginId) ?? getBundledVersion(pluginId)
}

export function getCoreRunnerPath(pluginId: string): string {
  return join(RUNNER_CACHE_DIR, pluginId, 'runner.js')
}

/** False once explicitly uninstalled, even if a bundled or cached file still exists on disk. */
export function hasCoreRunner(pluginId: string): boolean {
  if (isPluginUninstalled(pluginId)) return false
  return !!getBundledRunnerPath(pluginId) || isValidRunnerFile(getCoreRunnerPath(pluginId))
}

export function getCoreRunnerImportUrl(pluginId: string): string {
  // User cache (~/.voiden/extensions) takes priority over the bundled snapshot —
  // mirrors Electron's OTA-cache-over-bundled resolution (seedBundledPluginsToCache /
  // isOtaCached) — so `plugin update` can actually supersede a bundled runner.
  if (isValidRunnerFile(getCoreRunnerPath(pluginId))) return pathToFileURL(getCoreRunnerPath(pluginId)).href
  const bundled = getBundledRunnerPath(pluginId)
  if (bundled) return pathToFileURL(bundled).href
  return pathToFileURL(getCoreRunnerPath(pluginId)).href
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export interface PluginDefinition {
  /** Registry ID (e.g. 'voiden-rest-api') */
  name: string
  description: string
  /** GitHub repo slug for downloading the runner bundle */
  repo: string
  /** Asset name in the GitHub release (e.g. 'voiden-rest-api-runner.js') */
  runnerAsset: string
  /** Latest version published in the registry — used for update detection */
  version: string
  /** Import URL — file:// path to cached runner.js, or undefined if not cached */
  pluginPath: string | undefined
}

function toPluginDefinition(entry: RegistryEntry): PluginDefinition {
  return {
    name: entry.id,
    description: entry.description,
    repo: entry.repo,
    runnerAsset: entry.runnerAsset ?? `${entry.id}-runner.js`,
    version: entry.version,
    pluginPath: hasCoreRunner(entry.id) ? getCoreRunnerImportUrl(entry.id) : undefined,
  }
}

/** Core, runner-capable plugins — derived live from the plugin registry. */
export async function getCorePlugins(): Promise<PluginDefinition[]> {
  const entries = await getRegistry()
  return entries
    .filter((p) => p.type === 'core' && p.hasRunner)
    .map(toPluginDefinition)
}

export async function findPlugin(name: string): Promise<PluginDefinition | undefined> {
  const plugins = await getCorePlugins()
  return plugins.find((p) => p.name === name)
}

export async function listPluginNames(): Promise<string[]> {
  return (await getCorePlugins()).map((p) => p.name)
}
