/**
 * Plugin Loader — loads core and community plugins in headless Node.js context.
 *
 * All plugins are treated equally — there is no "always active" category.
 * Core plugins default to enabled (matching the `enabled` flag in coreExtensions
 * metadata), but can be disabled via ~/.voiden/plugins.json.  Community plugins
 * must be explicitly installed via `voiden-runner plugin install <id>`.
 *
 * Each plugin's runner.ts exports a RunnerFactory.  Its onload() can:
 *   • call context.onBuildRequest()     — register a block→request builder
 *   • call context.pipeline.registerHook() — wire into the shared pipeline
 *
 * If a plugin is disabled, its runner.ts never loads, so no handler is ever
 * registered — requests that require that plugin fail gracefully.
 */

import { requestOrchestrator, hookRegistry } from '@voiden/executors'
import { CORE_PLUGINS, hasCoreRunner, getCoreRunnerImportUrl, getCoreRunnerPath } from './registry.js'
import {
  fetchCommunityPlugins,
  findCommunityPlugin,
  hasCommunityRunner,
  getCommunityRunnerImportUrl,
} from './community.js'
import { createHeadlessPluginContext } from '../headlessContext.js'
import { clearSchemas } from '../blockSchemaRegistry.js'
import { readStore } from './store.js'
import { findPlugin } from './registry.js'
import * as https from 'https'
import { mkdirSync, createWriteStream, existsSync } from 'fs'
import { dirname } from 'path'

/** Download a core plugin runner bundle from its GitHub repo release. */
async function downloadCoreRunner(pluginId: string, repo: string, assetName: string, verbose: boolean): Promise<boolean> {
  const destPath = getCoreRunnerPath(pluginId)
  mkdirSync(dirname(destPath), { recursive: true })

  // Fetch latest release metadata from GitHub API
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`
  const meta: any = await new Promise((resolve, reject) => {
    https.get(apiUrl, { headers: { 'User-Agent': 'voiden-runner', 'Accept': 'application/vnd.github+json' } }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON from GitHub API')) }
      })
    }).on('error', reject)
  })

  const asset = (meta.assets ?? []).find((a: any) => a.name === assetName)
  if (!asset) {
    if (verbose) console.warn(`  [plugins] No "${assetName}" asset in latest release of ${repo}`)
    return false
  }

  // Download the asset
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(destPath)
    https.get(asset.browser_download_url, { headers: { 'User-Agent': 'voiden-runner' } }, res => {
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', reject)
  })

  if (verbose) console.log(`  [plugins] Downloaded ${assetName} → ${destPath}`)
  return true
}

// ─── Per-plugin enabled check ─────────────────────────────────────────────────

// Core plugins default to enabled; only skip if explicitly set to false in store.
function isCorePluginEnabled(name: string): boolean {
  const store = readStore()
  const record = store.installedPlugins[name]
  return record === undefined ? true : record.enabled
}

// Community plugins default to disabled; must be explicitly installed.
function isCommunityPluginEnabled(name: string): boolean {
  const store = readStore()
  const record = store.installedPlugins[name]
  return record !== undefined && record.enabled
}

// ─── Single plugin loader ─────────────────────────────────────────────────────

async function loadPlugin(
  pluginPath: string,
  pluginName: string,
  verbose: boolean,
): Promise<boolean> {
  try {
    const mod = await import(pluginPath)
    const factory: ((ctx: any) => { onload: () => void | Promise<void> }) | undefined =
      mod.default ?? mod

    if (typeof factory !== 'function') {
      if (verbose) {
        console.warn(`  [plugins] "${pluginName}" export is not a factory function — skipping`)
      }
      return false
    }

    const ctx = createHeadlessPluginContext(pluginName, verbose)
    await factory(ctx).onload()

    if (verbose) console.log(`  [plugins] Loaded plugin: ${pluginName}`)
    return true
  } catch (err: any) {
    if (verbose) {
      console.warn(`  [plugins] Failed to load "${pluginName}": ${err?.message ?? String(err)}`)
    }
    return false
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function loadEnabledPlugins(
  verbose = false,
  skipPlugins: ReadonlySet<string> = new Set()
): Promise<string[]> {
  // Clear previous run's state so plugins register fresh each time.
  // This matches the Electron app where plugins are loaded fresh on each open.
  requestOrchestrator.clear()
  hookRegistry.clearAll()
  clearSchemas()

  const loaded: string[] = []

  // ── Core plugins ──────────────────────────────────────────────────────────
  // Core plugins default to enabled but can be disabled via ~/.voiden/plugins.json.
  // Runner bundles are downloaded on-demand from each plugin's GitHub repo.
  for (const def of CORE_PLUGINS) {
    if (skipPlugins.has(def.name)) {
      if (verbose) console.log(`  [plugins] Skipping plugin (--no-scripts): ${def.name}`)
      continue
    }
    if (!isCorePluginEnabled(def.name)) {
      if (verbose) console.log(`  [plugins] Skipping disabled core plugin: ${def.name}`)
      continue
    }

    // Auto-download runner bundle if not cached locally
    if (!hasCoreRunner(def.name)) {
      if (verbose) console.log(`  [plugins] Downloading runner for ${def.name} from ${def.repo}...`)
      await downloadCoreRunner(def.name, def.repo, def.runnerAsset, verbose)
    }

    if (!hasCoreRunner(def.name)) {
      if (verbose) console.warn(`  [plugins] Runner not available for ${def.name} — skipping`)
      continue
    }

    const ok = await loadPlugin(getCoreRunnerImportUrl(def.name), def.name, verbose)
    if (ok) loaded.push(def.name)
  }

  // ── Community plugins — opt-in via `voiden-runner plugin install` ──────────
  // Mirrors how the Electron app loads community extensions that have been
  // installed by the user.  Each plugin must have a runner.js downloaded to
  // ~/.voiden/extensions/<id>/runner.js.
  let communityPlugins: Awaited<ReturnType<typeof fetchCommunityPlugins>>
  try {
    communityPlugins = await fetchCommunityPlugins()
  } catch {
    communityPlugins = []
  }

  const store = readStore()
  for (const [name, record] of Object.entries(store.installedPlugins)) {
    if (!isCommunityPluginEnabled(name)) continue

    // Skip if it's a core plugin (already handled above)
    if (findPlugin(name)) continue

    const commDef = findCommunityPlugin(name, communityPlugins)
    if (!commDef) {
      if (verbose) console.warn(`  [plugins] Unknown plugin "${name}" — not in community catalogue, skipping`)
      continue
    }

    if (!hasCommunityRunner(name)) {
      if (verbose) console.warn(`  [plugins] Community plugin "${name}" has no runner.js — run: voiden-runner plugin install ${name}`)
      continue
    }

    const ok = await loadPlugin(getCommunityRunnerImportUrl(name), name, verbose)
    if (ok) loaded.push(name)
  }

  return loaded
}
