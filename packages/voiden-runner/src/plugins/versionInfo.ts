/**
 * Installed-plugin lookup for the run-time block-version check (runner.ts).
 * Thin wrapper over the existing core/community plugin state — no new store,
 * just a single call site for "what's installed, and is it enabled" that
 * works for both core and community plugins (both are recorded in the same
 * ~/.voiden/plugins.json store; `isCorePluginEnabled`'s default-true-when-absent
 * behaviour only matters when no version is present either, so it's safe to
 * reuse for community plugins here).
 */

import { getCoreRunnerVersion } from './registry.js'
import { isCorePluginEnabled } from './loader.js'

export interface InstalledPluginInfo {
  version?: string
  enabled?: boolean
}

export function getInstalledPluginInfo(pluginId: string): InstalledPluginInfo | undefined {
  const version = getCoreRunnerVersion(pluginId)
  if (!version) return undefined
  return { version, enabled: isCorePluginEnabled(pluginId) }
}
