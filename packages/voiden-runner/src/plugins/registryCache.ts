/**
 * Shared registry cache — fetches the community plugin-registry's
 * `extensions.json` (the same source the Electron app reads, see
 * apps/electron/src/main/extension/extensionFetcher.ts) and caches it so
 * `voiden-runner` doesn't refetch on every invocation and keeps working
 * offline after the first successful fetch.
 */

import * as https from 'https'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const REGISTRY_URL = 'https://raw.githubusercontent.com/VoidenHQ/plugin-registry/main/extensions.json'
const CACHE_PATH = join(homedir(), '.voiden', 'registry-cache.json')
const CACHE_TTL = 24 * 60 * 60 * 1000 // 1 day

export interface RegistryEntry {
  type: 'core' | 'community'
  id: string
  name: string
  description: string
  author: string
  version: string
  repo: string
  hasRunner?: boolean
  runnerAsset?: string
  icon?: string
  voidenVersion?: string
  /** Set by plugin-registry maintainers when this plugin's runner should ship inside the @voiden/runner npm package (see bundled-runners/). */
  bundled?: boolean
}

let memCache: RegistryEntry[] | undefined

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

function readDiskCache(): { fetchedAt: number; entries: RegistryEntry[] } | undefined {
  if (!existsSync(CACHE_PATH)) return undefined
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    return undefined
  }
}

function writeDiskCache(entries: RegistryEntry[]): void {
  try {
    mkdirSync(join(homedir(), '.voiden'), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), entries }, null, 2), 'utf-8')
  } catch {
    // Best-effort — the on-disk cache is an offline optimization, not a requirement.
  }
}

/**
 * Returns the full plugin-registry catalogue (core + community plugins).
 * Cached in-memory for the process lifetime and on-disk for 24h. If the
 * registry is unreachable, falls back to the last known-good on-disk cache
 * (even if stale) so `run` keeps working offline.
 */
export async function getRegistry(): Promise<RegistryEntry[]> {
  if (memCache) return memCache

  const disk = readDiskCache()
  if (disk && Date.now() - disk.fetchedAt < CACHE_TTL) {
    memCache = disk.entries
    return memCache
  }

  try {
    const raw = await httpsGetText(REGISTRY_URL)
    const entries: RegistryEntry[] = JSON.parse(raw)
    memCache = entries
    writeDiskCache(entries)
    return entries
  } catch (err) {
    if (disk) {
      memCache = disk.entries
      return memCache
    }
    throw err
  }
}
