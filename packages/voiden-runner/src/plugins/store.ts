/**
 * Plugin Store — persists installed/enabled plugin state to ~/.voiden/plugins.json
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface InstalledPlugin {
  name: string
  enabled: boolean
  installedAt: string
  /** Runner bundle version that was downloaded — compared against the registry to detect updates */
  version?: string
  /**
   * True when explicitly removed via `plugin uninstall` — distinct from just
   * being disabled. Needed because core plugins can have a runner file
   * present (bundled, or a leftover cached download) even after uninstall;
   * without this flag there's no way to tell "explicitly uninstalled" apart
   * from "never touched" (which also reads as enabled by default for core
   * plugins — see loader.ts isCorePluginEnabled).
   */
  uninstalled?: boolean
}

export interface PluginStore {
  installedPlugins: Record<string, InstalledPlugin>
}

export const STORE_DIR = join(homedir(), '.voiden')
const STORE_PATH = join(STORE_DIR, 'plugins.json')

function emptyStore(): PluginStore {
  return { installedPlugins: {} }
}

export function readStore(): PluginStore {
  if (!existsSync(STORE_PATH)) return emptyStore()
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as PluginStore
  } catch {
    return emptyStore()
  }
}

function writeStore(store: PluginStore): void {
  mkdirSync(STORE_DIR, { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

/** True only when explicitly uninstalled — never-touched plugins return false. */
export function isPluginUninstalled(name: string): boolean {
  return !!readStore().installedPlugins[name]?.uninstalled
}

export function installPlugin(name: string, version?: string): boolean {
  const store = readStore()
  const existing = store.installedPlugins[name]
  // A record marked `uninstalled` doesn't count as "already installed" — this
  // is what lets re-installing a previously-uninstalled plugin actually take
  // effect instead of being treated as a no-op.
  const alreadyInstalled = !!existing && !existing.uninstalled
  if (!alreadyInstalled) {
    store.installedPlugins[name] = {
      name,
      enabled: true,
      installedAt: existing?.installedAt ?? new Date().toISOString(),
      version,
      uninstalled: false,
    }
    writeStore(store)
  }
  return !alreadyInstalled
}

/** Records the runner bundle version for an installed plugin (used by `plugin update`). */
export function setPluginVersion(name: string, version: string): void {
  const store = readStore()
  if (!store.installedPlugins[name]) {
    store.installedPlugins[name] = {
      name,
      enabled: true,
      installedAt: new Date().toISOString(),
      version,
    }
  } else {
    store.installedPlugins[name].version = version
    store.installedPlugins[name].uninstalled = false
  }
  writeStore(store)
}

/** Returns undefined once explicitly uninstalled, even if a stale version was recorded. */
export function getInstalledVersion(name: string): string | undefined {
  const record = readStore().installedPlugins[name]
  return record?.uninstalled ? undefined : record?.version
}

/**
 * Marks a plugin as explicitly uninstalled — keeps a record (rather than
 * deleting it) so it reads as disabled/unavailable, not "never touched"
 * (which defaults to enabled for core plugins — see loader.ts isCorePluginEnabled).
 *
 * `impliedInstalled` should be true when the caller already knows `name` is a
 * real, currently-active core plugin (bundled) even though it has no store
 * record yet — bundled plugins are enabled by default without ever going
 * through `plugin install`, so "no record" doesn't mean "not installed" the
 * way it does for community plugins. Without this, uninstalling a
 * never-explicitly-touched bundled plugin would report "not installed" and
 * do nothing, even though the plugin is clearly active.
 *
 * Returns true only if the plugin was actually installed/active before this call.
 */
export function uninstallPlugin(name: string, impliedInstalled = false): boolean {
  const store = readStore()
  const existing = store.installedPlugins[name]
  const wasInstalled = existing ? !existing.uninstalled : impliedInstalled
  if (!existing && !impliedInstalled) return false
  store.installedPlugins[name] = {
    name,
    enabled: false,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    version: undefined,
    uninstalled: true,
  }
  writeStore(store)
  return wasInstalled
}

export function setPluginEnabled(name: string, enabled: boolean): void {
  const store = readStore()
  if (!store.installedPlugins[name]) {
    store.installedPlugins[name] = {
      name,
      enabled,
      installedAt: new Date().toISOString(),
    }
  } else {
    store.installedPlugins[name].enabled = enabled
    if (enabled) store.installedPlugins[name].uninstalled = false
  }
  writeStore(store)
}

export function getEnabledPlugins(): InstalledPlugin[] {
  const store = readStore()
  return Object.values(store.installedPlugins).filter(p => p.enabled && !p.uninstalled)
}

export function getAllInstalledPlugins(): InstalledPlugin[] {
  return Object.values(readStore().installedPlugins).filter(p => !p.uninstalled)
}
