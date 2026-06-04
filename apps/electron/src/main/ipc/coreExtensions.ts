import { ipcMain, app, net, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync, watch, readFileSync } from 'node:fs'
import { coreExtensions, fetchAndUpdateCoreRegistry, remoteVersions, remoteVoidenVersions, remoteNewPlugins } from '../config/coreExtensions'
import { getMainProcessExtensionResults } from '../extensionLoader'
import { coreCacheDir, githubCachePath, coreUninstalledPath } from '../extension/paths'

// builtInRegistry reflects what's actually loaded (remote if fetched, otherwise local fallback)
const builtInRegistry = {
  get plugins(): Record<string, { version: string }> {
    return Object.fromEntries(coreExtensions.map((e) => [e.id, { version: e.version }]))
  },
}

// Plugin registry — each plugin lives in its own VoidenHQ/plugin-* repo
const REGISTRY_URL = 'https://raw.githubusercontent.com/VoidenHQ/plugin-registry/main/extensions.json'

interface RegistryPlugin {
  id: string
  name: string
  dir: string
  repo: string           // e.g. "VoidenHQ/plugin-voiden-graphql"
  bundled?: boolean
  voidenVersion?: string
}

interface PluginManifest {
  id: string
  name: string
  version: string
  voidenVersion?: string
  description?: string
  author?: string
  priority?: number
  readme?: string
  capabilities?: Record<string, any>
  features?: string[]
  mainProcess?: boolean
}

// Per-plugin entry stored in local cache manifest
interface PluginCacheEntry {
  version: string
  name: string
  file: string           // filename of the .js asset, e.g. "voiden-graphql.js"
  voidenVersion?: string
  repo: string           // originating repo, e.g. "VoidenHQ/plugin-voiden-graphql"
  mainFile?: string      // filename of the main-process bundle, e.g. "1.2.3-main.js"
  skillFile?: string     // filename of the skill.md asset, e.g. "skill.md"
  manifestFile?: string  // filename of the saved manifest.json, e.g. "manifest.json"
}

interface LocalManifest {
  updatedAt: string
  plugins: Record<string, PluginCacheEntry>
}

export interface PluginUpdateInfo {
  pluginId: string
  currentVersion: string | null
  remoteVersion: string
  voidenVersion?: string
  hasUpdate: boolean
  compatible: boolean
  requiredAppVersion: string | null
}

/** Returns true only when version a is strictly greater than version b (semver). */
export function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/[-+].*$/, '').split('.').map(n => parseInt(n, 10) || 0)
  const av = parse(a), bv = parse(b)
  for (let i = 0; i < 3; i++) {
    if ((av[i] ?? 0) > (bv[i] ?? 0)) return true
    if ((av[i] ?? 0) < (bv[i] ?? 0)) return false
  }
  return false
}

/** Parse a semver range like ">=2.0.0" and check if appVersion satisfies it. */
export function satisfiesVersionRange(appVersion: string, range: string): boolean {
  const clean = (v: string) => v.replace(/[-+].*$/, '').trim()
  const parseVer = (v: string) => clean(v).split('.').map((n) => parseInt(n, 10) || 0)
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
    }
    return 0
  }
  // Strip pre-release suffix: 2.0.0-beta.1 satisfies >=2.0.0 because the app is on that major version
  const appVer = parseVer(appVersion)
  for (const part of range.trim().split(/\s+/)) {
    const match = part.match(/^(>=|<=|>|<|=|~\^?)(.+)$/)
    if (!match) continue
    const [, op, ver] = match
    const target = parseVer(ver)
    const diff = cmp(appVer, target)
    if (op === '>=' && diff < 0) return false
    if (op === '>' && diff <= 0) return false
    if (op === '<=' && diff > 0) return false
    if (op === '<' && diff >= 0) return false
    if ((op === '=' || op === '') && diff !== 0) return false
  }
  return true
}

const getCacheDir = coreCacheDir;

async function readLocalManifest(): Promise<LocalManifest | null> {
  try {
    const content = await fs.readFile(path.join(getCacheDir(), 'manifest.json'), 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function writeLocalManifest(manifest: LocalManifest): Promise<void> {
  await fs.mkdir(getCacheDir(), { recursive: true })
  await fs.writeFile(path.join(getCacheDir(), 'manifest.json'), JSON.stringify(manifest, null, 2))
}

/**
 * Copies bundled renderer and main-process plugin files into plugins/core/ so
 * all plugins are served from the same uniform location. Runs at startup; skips plugins
 * whose cached version already matches the bundled version.
 */
export async function seedBundledPluginsToCache(): Promise<void> {
  const cacheDir = getCacheDir()
  await fs.mkdir(cacheDir, { recursive: true })

  const localManifest = await readLocalManifest() ?? { updatedAt: new Date().toISOString(), plugins: {} }
  let changed = false

  const bundledDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bundled-plugins')
    : path.join(app.getAppPath(), 'bundled-plugins')
  const mainPluginsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bundled-main-plugins')
    : path.join(app.getAppPath(), 'bundled-main-plugins')

  for (const ext of coreExtensions) {
    const bundledJs = path.join(bundledDir, `${ext.id}.js`)
    if (!existsSync(bundledJs)) continue // Not a bundled plugin — OTA only

    const existing = localManifest.plugins[ext.id]
    // Skip if already cached at same or newer version — preserves OTA downloads that are ahead of the bundled version
    if (existing?.file && (existing.version === ext.version || semverGt(existing.version, ext.version))) {
      // Still seed changelog if it's missing from cache (may not have been bundled before)
      const changelogCachePath = path.join(cacheDir, ext.id, 'changelog.json')
      const bundledChangelog = path.join(bundledDir, `${ext.id}-changelog.json`)
      if (!existsSync(changelogCachePath) && existsSync(bundledChangelog)) {
        await fs.mkdir(path.join(cacheDir, ext.id), { recursive: true })
        await fs.copyFile(bundledChangelog, changelogCachePath)
      }
      continue
    }

    const pluginCacheDir = path.join(cacheDir, ext.id)
    await fs.mkdir(pluginCacheDir, { recursive: true })

    // Copy renderer bundle
    const destJs = `${ext.version}.js`
    await fs.copyFile(bundledJs, path.join(pluginCacheDir, destJs))

    // Copy changelog if bundled
    const bundledChangelog = path.join(bundledDir, `${ext.id}-changelog.json`)
    if (existsSync(bundledChangelog)) {
      await fs.copyFile(bundledChangelog, path.join(pluginCacheDir, 'changelog.json'))
    }

    // Copy main-process bundle if it exists (.cjs preferred, then .js)
    let mainFile: string | undefined
    for (const suffix of ['-main.cjs', '-main.js'] as const) {
      const mainSrc = path.join(mainPluginsDir, `${ext.id}${suffix}`)
      if (existsSync(mainSrc)) {
        mainFile = `${ext.version}${suffix}`
        await fs.copyFile(mainSrc, path.join(pluginCacheDir, mainFile))
        break
      }
    }

    // Write plugin manifest.json
    const manifestData: Record<string, any> = {
      id: ext.id,
      name: ext.name,
      version: ext.version,
      description: ext.description,
      author: ext.author,
      mainProcess: (ext as any).mainProcess ?? false,
    }
    if ((ext as any).priority !== undefined) manifestData.priority = (ext as any).priority
    if ((ext as any).capabilities) manifestData.capabilities = (ext as any).capabilities
    if ((ext as any).features) manifestData.features = (ext as any).features
    await fs.writeFile(path.join(pluginCacheDir, 'manifest.json'), JSON.stringify(manifestData, null, 2))

    // Update top-level manifest entry
    localManifest.plugins[ext.id] = {
      version: ext.version,
      name: ext.name,
      file: destJs,
      repo: ext.repo ?? '',
      manifestFile: 'manifest.json',
      ...(mainFile ? { mainFile } : {}),
    }
    changed = true
    console.log(`[CoreExtensions] Seeded bundled plugin to cache: ${ext.id} v${ext.version}${mainFile ? ' (+main)' : ''}`)
  }

  if (changed) {
    localManifest.updatedAt = new Date().toISOString()
    await writeLocalManifest(localManifest)
  }
}

const getApiCachePath = githubCachePath

async function readApiCache(): Promise<Record<string, { etag: string; data: any }>> {
  try {
    const content = await fs.readFile(getApiCachePath(), 'utf8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeApiCache(cache: Record<string, { etag: string; data: any }>): Promise<void> {
  await fs.writeFile(getApiCachePath(), JSON.stringify(cache, null, 2))
}

import * as https from 'node:https'

async function fetchJson(url: string, useCache = true): Promise<any> {
  const cache = useCache ? await readApiCache() : {}
  const cached = cache[url]

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      headers: {
        'User-Agent': 'Voiden-App',
        'Accept': 'application/vnd.github+json',
      },
    };

    if (cached?.etag) {
      (options.headers as Record<string, string>)['If-None-Match'] = cached.etag
    }

    https.get(url, options, (res) => {
      // 304 Not Modified — use cached data. GitHub does NOT count 304s against the rate limit.
      if (res.statusCode === 304 && cached) {
        resolve(cached.data);
        return;
      }

      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location, useCache).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        let errorData = '';
        res.on('data', (c) => errorData += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(errorData);
            if (parsed.message?.includes('rate limit exceeded')) {
              reject(new Error(`GitHub API rate limit exceeded. Please try again in an hour or use a GitHub token.`));
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || errorData}`));
            }
          } catch {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
        });
        return;
      }

      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          // If we got a new ETag, update the cache
          const etag = res.headers.etag;
          if (useCache && etag && typeof etag === 'string') {
            cache[url] = { etag, data: parsed };
            writeApiCache(cache).catch(() => {});
          }

          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e instanceof Error ? e.message : String(e)}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Network error fetching ${url}: ${err.message}`));
    });
  });
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Voiden-App' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadToFile(res.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      fs.mkdir(path.dirname(destPath), { recursive: true })
        .then(() => {
          const fileStream = require('node:fs').createWriteStream(destPath);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
          fileStream.on('error', (err: any) => {
            reject(new Error(`File error saving ${url}: ${err.message}`));
          });
        })
        .catch(reject);
    }).on('error', (err) => {
      reject(new Error(`Network error downloading ${url}: ${err.message}`));
    });
  });
}

/**
 * Like downloadToFile but returns false on 404 instead of throwing.
 * Used for optional release assets (main-process bundle, skill.md).
 */
async function downloadToFileOptional(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const attempt = (attemptUrl: string) => {
      https.get(attemptUrl, { headers: { 'User-Agent': 'Voiden-App' } }, (res) => {
        if (res.statusCode === 404) {
          res.resume()
          resolve(false)
          return
        }
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          attempt(res.headers.location)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${attemptUrl}`))
          return
        }
        fs.mkdir(path.dirname(destPath), { recursive: true })
          .then(() => {
            const fileStream = require('node:fs').createWriteStream(destPath)
            res.pipe(fileStream)
            fileStream.on('finish', () => { fileStream.close(); resolve(true) })
            fileStream.on('error', (err: any) => reject(new Error(`File error: ${err.message}`)))
          })
          .catch(reject)
      }).on('error', (err) => reject(new Error(`Network error: ${err.message}`)))
    }
    attempt(url)
  })
}

/**
 * Fetches plugin release info using direct GitHub download URLs — no GitHub API call,
 * no rate limiting. Uses /releases/latest/download/ which redirects to the latest release asset.
 */
async function fetchPluginReleaseInfoDirect(repo: string, pluginId: string): Promise<PluginReleaseInfo> {
  const cleanRepo = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
  const base = `https://github.com/${cleanRepo}/releases/latest/download`

  let manifest: PluginManifest | null = null
  try {
    manifest = await fetchJson(`${base}/manifest.json`, false)
  } catch (err) {
    throw new Error(`Could not read manifest.json for ${pluginId} from ${repo}: ${err instanceof Error ? err.message : err}`)
  }
  if (!manifest) throw new Error(`manifest.json for ${pluginId} is empty or invalid`)

  return {
    manifest,
    jsAsset:          { name: `${pluginId}.js`, browser_download_url: `${base}/${pluginId}.js` },
    // Try .cjs first (current convention), fall back to .js for older plugins
    mainProcessAsset: [
      { name: `${pluginId}-main.cjs`, browser_download_url: `${base}/${pluginId}-main.cjs` },
      { name: `${pluginId}-main.js`,  browser_download_url: `${base}/${pluginId}-main.js` },
    ],
    skillAsset:       { name: 'skill.md', browser_download_url: `${base}/skill.md` },
    tagName: manifest.version,
  }
}

let cachedRegistry: Record<string, RegistryPlugin> | null = null
let lastRegistryFetchAt = 0
const REGISTRY_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function fetchRegistry(): Promise<Record<string, RegistryPlugin>> {
  if (cachedRegistry) return cachedRegistry

  // Try to use the coreExtensions array from config, which might have been updated via fetchAndUpdateCoreRegistry()
  if (coreExtensions.length > 0) {
    cachedRegistry = Object.fromEntries(
      coreExtensions.map((e) => [
        e.id,
        {
          id: e.id,
          name: e.name,
          dir: e.id, // we use id as dir by convention
          repo: e.repo!,
          bundled: e.enabled && !e.repo, // rough approximation
          voidenVersion: e.voidenVersion,
        },
      ])
    )
    return cachedRegistry
  }

  // Fallback: try remote fetch directly if coreExtensions is empty (shouldn't happen as it's seeded with snapshot)
  try {
    const res = await net.fetch(REGISTRY_URL, { headers: { 'User-Agent': 'Voiden-App' } })
    if (res.ok) {
      const data = await res.json()
      const entries: any[] = Array.isArray(data) ? data.filter((p: any) => p.type === 'core') : Object.values(data?.plugins ?? {})
      cachedRegistry = Object.fromEntries(entries.map((p: any) => [p.id, p]))
      return cachedRegistry!
    }
  } catch (err) {
    console.warn('[CoreExtensions] Failed to fetch remote registry directly:', err);
  }

  // Final fallback: try local snapshot
  try {
    const snapshot = require('../../extensions.json')
    const entries: any[] = Array.isArray(snapshot) ? snapshot.filter((p: any) => p.type === 'core') : Object.values(snapshot?.plugins ?? {})
    cachedRegistry = Object.fromEntries(entries.map((p: any) => [p.id, p]))
    return cachedRegistry!
  } catch {
    return {}
  }
}

interface PluginReleaseInfo {
  manifest: PluginManifest
  jsAsset: { name: string; browser_download_url: string } | null
  mainProcessAsset: { name: string; browser_download_url: string }[]
  skillAsset: { name: string; browser_download_url: string } | null
  tagName: string
}


export function registerCoreExtensionsIpcHandlers(): void {
  ipcMain.handle('coreExtensions:getMainProcessResults', () => getMainProcessExtensionResults())

  /**
   * Checks all core plugins for available updates.
   * remoteVersions (populated by fetchAndUpdateCoreRegistry) is the source of truth for
   * what is available on GitHub. coreExtensions reflects the local snapshot and is never mutated.
   */
  ipcMain.handle('coreExtensions:checkForUpdates', async (_event, pluginId?: string): Promise<{
    plugins: PluginUpdateInfo[]
    error?: string
  }> => {
    try {
      const appVersion = app.getVersion()

      // Always fetch fresh when checking all plugins. For a single-plugin check
      // (manual "Check Update" on a specific card), use the TTL to avoid an
      // unnecessary round-trip.
      const now = Date.now()
      if (!pluginId || remoteVersions.size === 0 || now - lastRegistryFetchAt > REGISTRY_TTL_MS) {
        await fetchAndUpdateCoreRegistry()
        lastRegistryFetchAt = now
      }

      const localManifest = await readLocalManifest()

      const plugins: PluginUpdateInfo[] = []
      const extensionsToCheck = pluginId ? coreExtensions.filter(e => e.id === pluginId) : coreExtensions
      for (const ext of extensionsToCheck) {
        if (!ext.repo) continue

        // remoteVersion comes from the GitHub registry fetch — NOT from the local snapshot.
        // Falls back to the local snapshot version when remote is unavailable (offline).
        const remoteVersion = remoteVersions.get(ext.id) ?? ext.version
        // Prefer live-fetched voidenVersion over local snapshot — registry update takes effect immediately
        const voidenVersion = remoteVoidenVersions.get(ext.id) ?? (ext as any).voidenVersion as string | undefined
        const compatible = voidenVersion ? satisfiesVersionRange(appVersion, voidenVersion) : true

        const cachedVersion = localManifest?.plugins?.[ext.id]?.version ?? null
        const builtInVersion = builtInRegistry.plugins[ext.id]?.version ?? null
        const effectiveVersion = cachedVersion ?? builtInVersion
        // Flag an update/incompatible badge whenever we have any local version to compare against
        // (OTA-cached or bundled). Using only cachedVersion hides the badge for plugins running
        // from their bundled file after an uninstall/reinstall cycle.
        const hasUpdate = !!effectiveVersion && semverGt(remoteVersion, effectiveVersion)

        console.log(`[CoreExtensions]   ${ext.id}: cached=${cachedVersion ?? 'none'} effective=${effectiveVersion ?? 'none'} remote=${remoteVersion} hasUpdate=${hasUpdate} compatible=${compatible}`)

        plugins.push({
          pluginId: ext.id,
          currentVersion: effectiveVersion,
          remoteVersion,
          voidenVersion,
          hasUpdate,
          compatible,
          requiredAppVersion: (!compatible && voidenVersion) ? voidenVersion : null,
        })
      }

      return { plugins }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[CoreExtensions] checkForUpdates failed:', message)
      return { plugins: [], error: message }
    }
  })

  ipcMain.handle('coreExtensions:readPluginFile', async (_event, filePath: string): Promise<string | null> => {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch {
      return null
    }
  })

  /** Returns parsed changelog.json for a cached plugin, or null if not available. */
  ipcMain.handle('coreExtensions:getChangelog', async (_event, pluginId: string): Promise<any[] | null> => {
    const cachePath = path.join(getCacheDir(), pluginId, 'changelog.json')
    const bundledDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bundled-plugins')
      : path.join(app.getAppPath(), 'bundled-plugins')
    const bundledPath = path.join(bundledDir, `${pluginId}-changelog.json`)

    for (const filePath of [cachePath, bundledPath]) {
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        return JSON.parse(raw)
      } catch {
        // try next
      }
    }
    return null
  })

  /**
   * Returns { pluginId -> absoluteFilePath } for plugins.
   * Dev: scans plugins/<id>/dist/<id>.js in the monorepo root.
   * Packaged: reads from process.resourcesPath/bundled-plugins/.
   * Skips plugins whose voidenVersion is incompatible with the running app.
   */
  ipcMain.handle('coreExtensions:getBundledPlugins', async (): Promise<Record<string, string>> => {
    const appVersion = app.getVersion()
    const registry = await fetchRegistry()
    const result: Record<string, string> = {}

    if (app.isPackaged) {
      const bundledDir = path.join(process.resourcesPath, 'bundled-plugins')
      try {
        const files = await fs.readdir(bundledDir)
        for (const file of files) {
          if (!file.endsWith('.js')) continue
          const pluginId = file.slice(0, -3)
          const entry = registry[pluginId]
          if (entry?.voidenVersion && !satisfiesVersionRange(appVersion, entry.voidenVersion)) {
            console.log(`[CoreExtensions] Skipping bundled ${pluginId}: requires ${entry.voidenVersion}, app is ${appVersion}`)
            continue
          }
          result[pluginId] = path.join(bundledDir, file)
        }
      } catch { /* directory doesn't exist */ }
      return result
    }

    // Development: load from apps/electron/bundled-plugins/ (where the build script copies bundles)
    const bundledDir = path.join(app.getAppPath(), 'bundled-plugins')
    try {
      const files = await fs.readdir(bundledDir)
      for (const file of files) {
        if (!file.endsWith('.js')) continue
        const pluginId = file.slice(0, -3)
        const entry = registry[pluginId]
        if (entry?.voidenVersion && !satisfiesVersionRange(appVersion, entry.voidenVersion)) {
          console.log(`[CoreExtensions] Skipping bundled ${pluginId}: requires ${entry.voidenVersion}, app is ${appVersion}`)
          continue
        }
        result[pluginId] = path.join(bundledDir, file)
      }
    } catch { /* directory doesn't exist */ }
    return result
  })

  /** Delete the OTA-cached bundle for a core plugin and mark it as user-uninstalled. */
  ipcMain.handle('coreExtensions:deleteCache', async (_event, pluginId: string): Promise<void> => {
    const cacheDir = getCacheDir()
    // Mark as uninstalled so bundled plugins also show the Install button after removal.
    try {
      const raw = readFileSync(coreUninstalledPath(), 'utf8')
      const ids: string[] = JSON.parse(raw)
      if (!ids.includes(pluginId)) ids.push(pluginId)
      await fs.writeFile(coreUninstalledPath(), JSON.stringify(ids, null, 2))
    } catch {
      await fs.writeFile(coreUninstalledPath(), JSON.stringify([pluginId], null, 2))
    }
    const cached = await readLocalManifest()
    if (cached) {
      try {
        await fs.rm(path.join(cacheDir, pluginId), { recursive: true, force: true })
        delete cached.plugins[pluginId]
        await writeLocalManifest(cached)
      } catch { /* silently ignore */ }
    }
    // Refresh state so isLocallyAvailable becomes false immediately
    try {
      const { extensionManager } = await import('../state')
      if (extensionManager) extensionManager.syncCoreExtensions()
    } catch { /* state may not be ready */ }
  })

  /** Relaunch the Electron app. */
  ipcMain.handle('coreExtensions:restart', () => {
    app.relaunch()
    app.quit()
  })

  /** Returns the locally cached manifest (null if never downloaded). */
  ipcMain.handle('coreExtensions:getLocalManifest', async (): Promise<LocalManifest | null> => {
    return readLocalManifest()
  })

  ipcMain.handle('coreExtensions:fetchRegistry', async (): Promise<{ newPluginCount: number }> => {
    try {
      await fetchAndUpdateCoreRegistry();
      const { extensionManager } = await import('../state');
      if (extensionManager) {
        extensionManager.syncCoreExtensions();
      }
      // Clear the local cachedRegistry so it's re-built from the now-updated coreExtensions array
      cachedRegistry = null;
      return { newPluginCount: remoteNewPlugins.length };
    } catch (err) {
      console.warn('[CoreExtensions] fetchRegistry IPC failed:', err);
      return { newPluginCount: 0 };
    }
  })

  /** Returns { pluginId -> absoluteFilePath } for all locally cached plugin bundles.
   *  In dev: skips plugins that have a locally-built bundled version (prefer the fresh build).
   *  For OTA-only plugins with no bundled counterpart, returns the cached path even in dev. */
  ipcMain.handle('coreExtensions:getCachedPlugins', async (): Promise<Record<string, string>> => {
    const cacheDir = getCacheDir()
    const cached = await readLocalManifest()
    if (!cached) return {}

    // In dev, locally-built bundles live here — OTA cache should not override them.
    const bundledDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bundled-plugins')
      : path.join(app.getAppPath(), 'bundled-plugins')

    const result: Record<string, string> = {}
    for (const [pluginId, entry] of Object.entries(cached.plugins)) {
      const filePath = path.join(cacheDir, pluginId, `${entry.version}.js`)
      if (!existsSync(filePath)) continue
      // In dev: skip if a locally-built version exists (it takes priority in the renderer)
      if (!app.isPackaged && existsSync(path.join(bundledDir, `${pluginId}.js`))) continue
      result[pluginId] = filePath
    }
    return result
  })

  /**
   * Checks each plugin's own repo for updates, downloads changed bundles,
   * and saves them to the user-data cache directory.
   *
   * Pass pluginId to scope to a single plugin (used by the "Install" button).
   * Returns { updated, upToDate, incompatible }.
   */
  ipcMain.handle('coreExtensions:checkAndUpdate', async (_event, pluginId?: string): Promise<{
    updated: string[]
    upToDate: boolean
    incompatible: string[]
    incompatibleVersions: { [id: string]: { version: string; requiredVoidenVersion: string } }
    error?: string
  }> => {
    try {
      const cacheDir = getCacheDir()
      await fs.mkdir(cacheDir, { recursive: true })

      const appVersion = app.getVersion()
      const registry = await fetchRegistry()
      const localManifest = await readLocalManifest() ?? { updatedAt: new Date().toISOString(), plugins: {} }

      // Scope to one plugin or check all registered plugins
      const pluginsToCheck = Object.values(registry).filter((p) => p.repo && (!pluginId || p.id === pluginId))

      if (pluginId && pluginsToCheck.length === 0) {
        return { updated: [], upToDate: true, incompatible: [], incompatibleVersions: {}, error: `Plugin ${pluginId} not found in registry` }
      }

      const updated: string[] = []
      const incompatible: string[] = []
      const incompatibleVersions: { [id: string]: { version: string; requiredVoidenVersion: string } } = {}

      // Fetch release info for all target plugins in parallel.
      // Uses direct /releases/latest/download/ URLs — no GitHub API, no rate limits.
      const results = await Promise.allSettled(
        pluginsToCheck.map(async (p) => {
          const info = await fetchPluginReleaseInfoDirect(p.repo, p.id)
          return { plugin: p, info }
        })
      )

      for (const result of results) {
        if (result.status === 'rejected') {
          if (pluginId) {
            return { updated: [], upToDate: false, incompatible: [], incompatibleVersions: {}, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }
          }
          continue
        }
        const { plugin, info } = result.value
        const { id, repo } = plugin
        const remoteVersion = info.manifest.version
        const voidenVersion = info.manifest.voidenVersion ?? plugin.voidenVersion

        // Skip incompatible plugins — record version details so the UI can show a badge
        if (voidenVersion && !satisfiesVersionRange(appVersion, voidenVersion)) {
          console.log(`[CoreExtensions] Skipping ${id} — requires ${voidenVersion}, app is ${appVersion}`)
          incompatible.push(id)
          incompatibleVersions[id] = { version: remoteVersion, requiredVoidenVersion: voidenVersion }
          continue
        }

        const cachedVersion = localManifest.plugins[id]?.version
        console.log(`[CoreExtensions]   ${id}: cached=${cachedVersion ?? 'none'} remote=${remoteVersion}`)
        if (cachedVersion === remoteVersion) continue

        // Need the JS asset to download
        if (!info.jsAsset) {
          console.warn(`[CoreExtensions] No .js asset found for ${id} in release ${info.tagName} — skipping`)
          if (pluginId && id === pluginId) {
            return { updated: [], upToDate: false, incompatible: [], incompatibleVersions: {}, error: `Release ${info.tagName} for ${id} is missing a .js bundle. Please contact the plugin author.` }
          }
          continue
        }

        const destPath = path.join(cacheDir, id, `${remoteVersion}.js`)
        console.log(`[CoreExtensions] Downloading ${id} v${remoteVersion} from ${repo}...`)
        await downloadToFile(info.jsAsset.browser_download_url, destPath)

        // Save the full manifest.json so all metadata (mainProcess, capabilities, etc.) is preserved
        const manifestDestPath = path.join(cacheDir, id, 'manifest.json')
        try {
          await fs.mkdir(path.join(cacheDir, id), { recursive: true })
          await fs.writeFile(manifestDestPath, JSON.stringify(info.manifest, null, 2))
        } catch (err) {
          console.warn(`[CoreExtensions] Failed to save manifest.json for ${id}:`, err instanceof Error ? err.message : err)
        }

        // Update the local manifest entry for this plugin
        localManifest.plugins[id] = {
          version: remoteVersion,
          name: info.manifest.name,
          file: info.jsAsset.name,
          voidenVersion,
          repo,
          manifestFile: 'manifest.json',
        }

        // Download main-process bundle — try .cjs first, then .js (returns false on 404)
        for (const candidate of info.mainProcessAsset) {
          const ext = candidate.name.endsWith('.cjs') ? '.cjs' : '.js'
          const mainDestPath = path.join(cacheDir, id, `${remoteVersion}-main${ext}`)
          try {
            const ok = await downloadToFileOptional(candidate.browser_download_url, mainDestPath)
            if (ok) {
              localManifest.plugins[id].mainFile = `${remoteVersion}-main${ext}`
              console.log(`[CoreExtensions] Downloaded main-process bundle for ${id} (${candidate.name})`)
              break
            }
          } catch (err) {
            console.warn(`[CoreExtensions] Failed to download main-process bundle for ${id}:`, err instanceof Error ? err.message : err)
          }
        }

        // Download skill.md if the release includes one (optional — returns false on 404)
        if (info.skillAsset) {
          const skillDestPath = path.join(cacheDir, id, 'skill.md')
          try {
            const ok = await downloadToFileOptional(info.skillAsset.browser_download_url, skillDestPath)
            if (ok) {
              localManifest.plugins[id].skillFile = 'skill.md'
              console.log(`[CoreExtensions] Downloaded skill.md for ${id}`)
            }
          } catch (err) {
            console.warn(`[CoreExtensions] Failed to download skill.md for ${id}:`, err instanceof Error ? err.message : err)
          }
        }

        // Download changelog.json if present in the release (optional)
        try {
          const cleanedRepo = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
          const changelogUrl = `https://github.com/${cleanedRepo}/releases/latest/download/changelog.json`
          const changelogDestPath = path.join(cacheDir, id, 'changelog.json')
          await downloadToFileOptional(changelogUrl, changelogDestPath)
        } catch { /* optional asset, silently ignore */ }

        updated.push(id)
      }

      if (updated.length > 0) {
        localManifest.updatedAt = new Date().toISOString()
        await writeLocalManifest(localManifest)
        // Sync core extensions state so isLocallyAvailable and version update immediately
        try {
          const { extensionManager, getAppState } = await import('../state')
          if (extensionManager) extensionManager.syncCoreExtensions()
          // Load (or reload) the main-process bundle for any plugin that was just downloaded.
          // reloadMainProcessExtension handles the hasMainProcess detection internally so
          // plugins whose registry entry lacks mainProcess:true are still covered.
          const { reloadMainProcessExtension } = await import('../extensionLoader')
          const appState = getAppState()
          for (const id of updated) {
            const ext = appState?.extensions.find((ext: { id: string }) => ext.id === id)
            if (ext) {
              reloadMainProcessExtension(ext).catch((err) =>
                console.warn(`[CoreExtensions] Failed to reload main-process for ${id}:`, err)
              )
            }
          }
        } catch { /* state may not be ready yet on first install */ }
      }

      return { updated, upToDate: updated.length === 0, incompatible, incompatibleVersions }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[CoreExtensions] checkAndUpdate failed:', message)
      return { updated: [], upToDate: true, incompatible: [], incompatibleVersions: {}, error: message }
    }
  })
}

/**
 * In development only: watches plugins/<id>/dist/ for .js file changes
 * and signals all renderer windows to hot-reload plugins — no app restart needed.
 */
export function watchBundledPluginsForDevReload(): void {
  if (app.isPackaged) return

  const pluginsDir = path.join(app.getAppPath(), '..', '..', 'plugins')
  if (!existsSync(pluginsDir)) return

  let debounce: ReturnType<typeof setTimeout> | null = null

  // Watch the plugins/ root recursively and filter for <plugin>/dist/*.js changes
  watch(pluginsDir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const norm = filename.replace(/\\/g, '/')
    if (!norm.endsWith('.js')) return
    // Only react to changes inside a dist/ directory
    if (!norm.includes('/dist/') && !norm.startsWith('dist/')) return

    const isMainBundle = norm.endsWith('-main.js')

    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      if (isMainBundle) {
        // Main-process bundle changed — full restart needed to reload it
        console.log(`[CoreExtensions] Main-process plugin changed (${filename}) — restarting app`)
        app.relaunch()
        app.quit()
      } else {
        // Renderer bundle changed — hot-reload without restart
        console.log(`[CoreExtensions] Renderer plugin changed (${filename}) — signaling hot-reload`)
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('coreExtensions:bundledPluginsChanged')
        })
      }
    }, 400)
  })

  console.log('[CoreExtensions] Dev: watching plugins/*/dist/ for hot-reload + main-process restart')
}
