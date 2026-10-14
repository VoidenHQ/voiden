/**
 * Community Plugin Catalogue — reads community plugin metadata from the same
 * VoidenHQ/plugin-registry `extensions.json` the Electron app uses (see
 * registryCache.ts), so the CLI's catalogue never drifts from the desktop app.
 *
 * Install flow (mirrors the Electron app's extensionManager):
 *   1. Read the registry → list of { id, name, repo, version, … }
 *   2. On `plugin install <id>`, hit the GitHub release for that repo at v{version}
 *   3. Look for a `runner.js` asset in the release
 *   4. Download it to ~/.voiden/extensions/<id>/runner.js
 *   5. At run-time, import() that file via a file:// URL
 *
 * If a community plugin's release has no runner.js it cannot be used headlessly.
 */

import * as https from 'https'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import { getRegistry } from './registryCache.js'

const EXTENSIONS_DIR = join(homedir(), '.voiden', 'extensions')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunityPluginDefinition {
  /** Stable identifier used in CLI commands and the plugin store */
  id: string
  /** Human-readable display name */
  name: string
  /** Short description of what the plugin does */
  description: string
  /** Plugin author / maintainer */
  author: string
  /** Latest published version */
  version: string
  /** GitHub repo slug (owner/repo) — release assets are fetched from here */
  repo: string
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

// ─── HTTP helper (same pattern as the Electron app) ──────────────────────────

function httpsGetText(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'voiden-runner',
        'Accept': 'application/vnd.github.v3+json',
      },
    }
    function doGet(u: string, hops: number) {
      https.get(u, options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (hops <= 0) { reject(new Error('Too many redirects')); return }
          doGet(res.headers.location, hops - 1)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
        res.on('error', reject)
      }).on('error', reject)
    }
    doGet(url, maxRedirects)
  })
}

// ─── Community catalogue (from the shared plugin-registry) ──────────────────

export async function fetchCommunityPlugins(): Promise<CommunityPluginDefinition[]> {
  const entries = await getRegistry()
  return entries
    .filter((p) => p.type === 'community')
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      author: p.author,
      version: p.version,
      repo: p.repo,
    }))
}

export function findCommunityPlugin(
  id: string,
  plugins: CommunityPluginDefinition[],
): CommunityPluginDefinition | undefined {
  return plugins.find(p => p.id === id)
}

// ─── On-disk runner paths ─────────────────────────────────────────────────────

export function getCommunityRunnerPath(pluginId: string): string {
  return join(EXTENSIONS_DIR, pluginId, 'runner.js')
}

export function hasCommunityRunner(pluginId: string): boolean {
  // A failed/interrupted download can leave a 0-byte file behind; treat that
  // as "not installed" rather than importing an empty module.
  try {
    return existsSync(getCommunityRunnerPath(pluginId)) && statSync(getCommunityRunnerPath(pluginId)).size > 0
  } catch {
    return false
  }
}

export function getCommunityRunnerImportUrl(pluginId: string): string {
  return pathToFileURL(getCommunityRunnerPath(pluginId)).href
}

// ─── Install (download runner.js from GitHub release) ────────────────────────

/**
 * Downloads runner.js from the plugin's GitHub release into
 * ~/.voiden/extensions/<id>/runner.js.
 *
 * Returns 'installed' if the runner was downloaded successfully,
 * 'no-runner' if the release exists but has no runner.js asset, or
 * throws on network / API errors.
 */
export async function installCommunityRunner(
  plugin: CommunityPluginDefinition,
): Promise<'installed' | 'no-runner'> {
  const apiUrl = `https://api.github.com/repos/${plugin.repo}/releases/tags/v${plugin.version}`
  const releaseRaw = await httpsGetText(apiUrl)
  const release = JSON.parse(releaseRaw)
  const assets: ReleaseAsset[] = release.assets ?? []

  // Core plugins publish their runner bundle as `{id}-runner.js` (see registry.ts);
  // `@voiden/create-plugin` now scaffolds community plugins to follow the same
  // convention. Fall back to the generic `runner.js` for plugins built before
  // this convention was adopted.
  const runnerAsset =
    assets.find(a => a.name === `${plugin.id}-runner.js`) ??
    assets.find(a => a.name === 'runner.js')
  if (!runnerAsset) return 'no-runner'

  const source = await httpsGetText(runnerAsset.browser_download_url)

  const installDir = join(EXTENSIONS_DIR, plugin.id)
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'runner.js'), source, 'utf8')

  return 'installed'
}
