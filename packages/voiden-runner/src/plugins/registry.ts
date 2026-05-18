/**
 * Plugin Registry
 *
 * Derives the list of runner-capable core extensions from the @voiden/core-extensions
 * metadata registry — the same source the Electron app uses.
 *
 * All plugins (parser and hook alike) are treated identically: they each have a
 * runner.ts that exports a RunnerFactory and are opt-out by default (enabled unless
 * explicitly disabled in ~/.voiden/plugins.json).  No plugin type is hard-coded as
 * "always active" — if a plugin is disabled its runner.ts never loads, so its
 * onBuildRequest / pipeline hooks are never registered.
 *
 * ID_TO_FOLDER handles the few cases where the registry ID differs from the
 * folder name inside @voiden/core-extensions/src/.
 */

import { coreExtensions } from '@voiden/core-extensions/registry.js'

export interface PluginDefinition {
  /** Registry ID (e.g. 'voiden-rest-api', 'simple-assertions') */
  name: string
  description: string
  /**
   * Import path for the runner entry point.
   * Always `@voiden/core-extensions/<folder>/runner`.
   * Community plugins use a `file://` URL instead.
   */
  pluginPath: string
}

// ─── ID → folder mapping ──────────────────────────────────────────────────────
// Most extension IDs match their folder name inside @voiden/core-extensions/src.
// List exceptions here.
const ID_TO_FOLDER: Record<string, string> = {
  'voiden-sockets-grpcs': 'voiden-sockets',
}

function folder(id: string): string {
  return ID_TO_FOLDER[id] ?? id
}

// ─── IDs that have a headless runner.ts in @voiden/core-extensions ────────────
// All core extensions listed here are treated equally: they are opt-out (enabled
// by default) and each owns its runner.ts entry point.
const RUNNER_IDS = new Set([
  'voiden-rest-api',
  'voiden-graphql',
  'voiden-sockets-grpcs',
  'voiden-scripting',
  'simple-assertions',
  'voiden-faker',
  'voiden-advanced-auth',
])

// ─── Derive plugin definitions from the shared registry ───────────────────────

export const CORE_PLUGINS: PluginDefinition[] = coreExtensions
  .filter(e => RUNNER_IDS.has(e.id))
  .map(e => ({
    name:        e.id,
    description: e.description,
    pluginPath:  `@voiden/core-extensions/${folder(e.id)}/runner`,
  }))

export function findPlugin(name: string): PluginDefinition | undefined {
  return CORE_PLUGINS.find(p => p.name === name)
}

export function listPluginNames(): string[] {
  return CORE_PLUGINS.map(p => p.name)
}
