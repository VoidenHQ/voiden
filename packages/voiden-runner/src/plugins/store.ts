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

export function installPlugin(name: string): boolean {
  const store = readStore()
  const alreadyInstalled = !!store.installedPlugins[name]
  if (!alreadyInstalled) {
    store.installedPlugins[name] = {
      name,
      enabled: true,
      installedAt: new Date().toISOString(),
    }
    writeStore(store)
  }
  return !alreadyInstalled
}

export function uninstallPlugin(name: string): boolean {
  const store = readStore()
  if (!store.installedPlugins[name]) return false
  delete store.installedPlugins[name]
  writeStore(store)
  return true
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
  }
  writeStore(store)
}

export function getEnabledPlugins(): InstalledPlugin[] {
  const store = readStore()
  return Object.values(store.installedPlugins).filter(p => p.enabled)
}

export function getAllInstalledPlugins(): InstalledPlugin[] {
  return Object.values(readStore().installedPlugins)
}
