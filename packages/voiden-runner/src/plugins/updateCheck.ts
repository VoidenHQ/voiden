/**
 * Plugin update detection — compares each plugin's currently-active runner
 * version against the latest version published in the shared plugin-registry
 * (registryCache.ts). Used by `plugin update` and the post-command update
 * notice in index.ts.
 *
 * Core plugins are checked even if never explicitly `plugin install`ed —
 * they're enabled by default and may only exist as the version bundled
 * inside the @voiden/runner package (see registry.ts:getCoreRunnerVersion),
 * so users still get notified when a newer release is available.
 */

import { getAllInstalledPlugins } from './store.js'
import { getRegistry } from './registryCache.js'
import { getCorePlugins, getCoreRunnerVersion } from './registry.js'
import { isCorePluginEnabled } from './loader.js'

export interface PluginUpdateInfo {
  id: string
  type: 'core' | 'community'
  installedVersion: string
  latestVersion: string
}

/** Compares dotted version strings numerically, segment by segment. */
function isNewer(latest: string, installed: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = installed.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export async function checkForPluginUpdates(): Promise<PluginUpdateInfo[]> {
  const registry = await getRegistry()
  const byId = new Map(registry.map((e) => [e.id, e]))
  const updates: PluginUpdateInfo[] = []

  // Core plugins: compare whatever version is actually present locally
  // (bundled copy, or a cached download from a previous `plugin install`/
  // `update`) against the registry's latest — regardless of explicit install.
  const corePlugins = await getCorePlugins()
  for (const def of corePlugins) {
    if (!isCorePluginEnabled(def.name)) continue
    const current = getCoreRunnerVersion(def.name)
    if (!current) continue
    if (isNewer(def.version, current)) {
      updates.push({ id: def.name, type: 'core', installedVersion: current, latestVersion: def.version })
    }
  }

  // Community plugins: only ones explicitly installed have a version to compare.
  for (const plugin of getAllInstalledPlugins()) {
    if (!plugin.version) continue
    const entry = byId.get(plugin.name)
    if (!entry || entry.type !== 'community') continue
    if (isNewer(entry.version, plugin.version)) {
      updates.push({ id: plugin.name, type: 'community', installedVersion: plugin.version, latestVersion: entry.version })
    }
  }
  return updates
}
