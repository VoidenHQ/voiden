/**
 * Community Plugin Registry — fetches the community extensions catalogue from
 * https://github.com/VoidenHQ/plugins and manages on-disk runner installation.
 *
 * Install flow (mirrors the Electron app's extensionManager):
 *   1. Fetch extensions.json → list of { id, name, repo, version, … }
 *   2. On `plugin install <id>`, hit the GitHub release for that repo at v{version}
 *   3. Look for a `runner.js` asset in the release
 *   4. Download it to ~/.voiden/extensions/<id>/runner.js
 *   5. At run-time, import() that file via a file:// URL
 *
 * If a community plugin's release has no runner.js it cannot be used headlessly.
 */

import * as https from 'https'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'

const EXTENSIONS_REPO = 'VoidenHQ/plugins'
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

// ─── extensions.json catalogue ───────────────────────────────────────────────

let _cache: CommunityPluginDefinition[] | null = null

export async function fetchCommunityPlugins(): Promise<CommunityPluginDefinition[]> {
  if (_cache) return _cache
  try {
    const raw = await httpsGetText(
      `https://api.github.com/repos/${EXTENSIONS_REPO}/contents/extensions.json?ref=main`
    )
    const fileJson = JSON.parse(raw)
    const decoded = Buffer.from(fileJson.content, 'base64').toString('utf8')
    _cache = JSON.parse(decoded) as CommunityPluginDefinition[]
    return _cache
  } catch {
    return []
  }
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
  return existsSync(getCommunityRunnerPath(pluginId))
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

  const runnerAsset = assets.find(a => a.name === 'runner.js')
  if (!runnerAsset) return 'no-runner'

  const source = await httpsGetText(runnerAsset.browser_download_url)

  const installDir = join(EXTENSIONS_DIR, plugin.id)
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'runner.js'), source, 'utf8')

  return 'installed'
}
