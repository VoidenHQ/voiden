/**
 * Plugin Registry
 *
 * Derives the list of runner-capable core plugins from the static
 * core-plugins-registry.json — no dependency on @voiden/core-extensions.
 *
 * Each core plugin that ships a runner.ts is built and released as
 * {pluginId}-runner.js in its own GitHub repo (VoidenHQ/plugin-{dir}).
 * voiden-runner downloads and caches these files the same way community
 * plugins do: ~/.voiden/extensions/{id}/runner.js
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { createRequire } from 'module'

// ─── Load static registry (no @voiden/core-extensions import) ─────────────────
// Resolve relative to this file so it works from any cwd.
const _require = createRequire(import.meta.url)

// Try monorepo path first, then installed-package path
function loadRegistry(): Record<string, any> {
  const candidates = [
    join(new URL('.', import.meta.url).pathname, '../../../../apps/electron/src/core-plugins-registry.json'),
    join(homedir(), '.voiden', 'core-plugins-registry.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return _require(p).plugins
  }
  return {}
}

const registryPlugins = loadRegistry()

// ─── Runner paths (priority: bundled-at-build-time > user cache > download) ───
const RUNNER_CACHE_DIR = join(homedir(), '.voiden', 'extensions')

// Bundled runners pre-downloaded by cleanup.sh at Voiden build time
function getBundledRunnerPath(pluginId: string): string | null {
  const candidates = [
    join(new URL('.', import.meta.url).pathname, '../../../../packages/voiden-runner/bundled-runners', `${pluginId}-runner.js`),
    join(new URL('.', import.meta.url).pathname, '../../../bundled-runners', `${pluginId}-runner.js`),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export function getCoreRunnerPath(pluginId: string): string {
  return join(RUNNER_CACHE_DIR, pluginId, 'runner.js')
}

export function hasCoreRunner(pluginId: string): boolean {
  return !!getBundledRunnerPath(pluginId) || existsSync(getCoreRunnerPath(pluginId))
}

export function getCoreRunnerImportUrl(pluginId: string): string {
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
  /** Import URL — file:// path to cached runner.js, or undefined if not cached */
  pluginPath: string | undefined
}

// ─── IDs that have a headless runner in their individual repo ─────────────────
const RUNNER_IDS = new Set([
  'voiden-rest-api',
  'voiden-graphql',
  'voiden-sockets-grpcs',
  'voiden-scripting',
  'simple-assertions',
  'voiden-faker',
  'voiden-advanced-auth',
])

// ─── Derive plugin definitions from the static registry ───────────────────────

export const CORE_PLUGINS: PluginDefinition[] = Object.values(registryPlugins)
  .filter((p: any) => RUNNER_IDS.has(p.id))
  .map((p: any) => ({
    name:        p.id,
    description: p.description,
    repo:        p.repo,                                   // e.g. VoidenHQ/plugin-voiden-rest-api
    runnerAsset: `${p.id}-runner.js`,
    pluginPath:  hasCoreRunner(p.id)
      ? getCoreRunnerImportUrl(p.id)
      : undefined,
  }))

export function findPlugin(name: string): PluginDefinition | undefined {
  return CORE_PLUGINS.find(p => p.name === name)
}

export function listPluginNames(): string[] {
  return CORE_PLUGINS.map(p => p.name)
}
