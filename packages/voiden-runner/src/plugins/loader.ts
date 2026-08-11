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
import { getCorePlugins, hasCoreRunner, getCoreRunnerImportUrl, getCoreRunnerPath } from './registry.js'
import {
  fetchCommunityPlugins,
  findCommunityPlugin,
  hasCommunityRunner,
  getCommunityRunnerImportUrl,
} from './community.js'
import { createHeadlessPluginContext } from '../headlessContext.js'
import { clearSchemas } from '../blockSchemaRegistry.js'
import { clearRequestContainers } from '../requestContainerRegistry.js'
import { clearToolProviders } from '../toolRegistry.js'
import { clearMcpToolCapabilityProvider } from '../mcpToolCapability.js'
import { readStore, setPluginVersion } from './store.js'
import * as https from 'https'
import { mkdirSync, createWriteStream, existsSync } from 'fs'
import { dirname } from 'path'

// Follows redirects (GitHub release assets 302 to signed blob-storage URLs).
function downloadToFile(url: string, destPath: string, hops = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'voiden-runner' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (hops <= 0) { reject(new Error('Too many redirects')); return }
        downloadToFile(res.headers.location, destPath, hops - 1).then(resolve, reject)
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const file = createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', reject)
  })
}

/**
 * Download a core plugin runner bundle from its GitHub repo release, pinned to
 * the version published in the registry — mirrors the Electron app's
 * `getExtensionFiles` (which fetches `releases/tags/v{version}`), so the
 * version we record locally always matches what we actually downloaded and
 * `plugin update` can detect drift against the registry.
 */
export async function downloadCoreRunner(pluginId: string, repo: string, assetName: string, version: string, verbose: boolean): Promise<boolean> {
  const destPath = getCoreRunnerPath(pluginId)
  mkdirSync(dirname(destPath), { recursive: true })

  const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/v${version}`
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
    if (verbose) console.warn(`  [plugins] No "${assetName}" asset in release v${version} of ${repo}`)
    return false
  }

  // Download the asset, following redirects — GitHub's browser_download_url
  // always 302s to a signed blob-storage URL, which https.get does not follow
  // automatically. Without this, the response piped to disk is the empty
  // redirect body, leaving a 0-byte runner.js.
  await downloadToFile(asset.browser_download_url, destPath)

  setPluginVersion(pluginId, version)
  if (verbose) console.log(`  [plugins] Downloaded ${assetName}@${version} → ${destPath}`)
  return true
}

// ─── Per-plugin enabled check ─────────────────────────────────────────────────

// Core plugins default to enabled; only skip if explicitly set to false in store.
export function isCorePluginEnabled(name: string): boolean {
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
    // Runner bundles are esbuild-compiled CJS (`export default factory` →
    // `module.exports = { __esModule: true, default: factory }`). Node's native
    // ESM loader then wraps that whole CJS object as `mod.default`, so the real
    // factory ends up nested at `mod.default.default`. Unwrap until we hit a
    // function or run out of `__esModule`-marked layers.
    let factory: unknown = mod.default ?? mod
    while (
      factory &&
      typeof factory === 'object' &&
      (factory as any).__esModule &&
      'default' in (factory as any)
    ) {
      factory = (factory as any).default
    }

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
  clearRequestContainers()
  clearToolProviders()
  clearMcpToolCapabilityProvider()

  const loaded: string[] = []

  // ── Core plugins ──────────────────────────────────────────────────────────
  // Core plugins default to enabled but can be disabled via ~/.voiden/plugins.json.
  // `run` never downloads anything — it only uses what's already bundled in the
  // package (see bundled-runners/) or previously cached via `plugin install` /
  // `plugin update`. A plugin that's neither gets a one-line install hint.
  const corePlugins = await getCorePlugins()
  for (const def of corePlugins) {
    if (skipPlugins.has(def.name)) {
      if (verbose) console.log(`  [plugins] Skipping plugin (--no-scripts): ${def.name}`)
      continue
    }
    if (!isCorePluginEnabled(def.name)) {
      if (verbose) console.log(`  [plugins] Skipping disabled core plugin: ${def.name}`)
      continue
    }

    if (!hasCoreRunner(def.name)) {
      console.log(`  [plugins] "${def.name}" not installed — run: voiden-runner plugin install ${def.name}`)
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

  const corePluginNames = new Set(corePlugins.map((p) => p.name))
  const store = readStore()
  for (const [name, record] of Object.entries(store.installedPlugins)) {
    if (!isCommunityPluginEnabled(name)) continue

    // Skip if it's a core plugin (already handled above)
    if (corePluginNames.has(name)) continue

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
