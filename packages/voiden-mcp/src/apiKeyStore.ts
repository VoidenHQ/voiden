/**
 * API Key Store — persists an auto-generated static API key per project to
 * ~/.voiden/mcp-api-keys.json, keyed by absolute project path (one machine
 * can host different projects at different times, each with its own key).
 *
 * Follows the same convention as oauthStore.ts / @voiden/runner's plugin
 * store: homedir()/.voiden/<name>.json, tolerant of a missing/corrupt file,
 * synchronous fs, mode 0600 (fixed up on every write, since this holds a
 * real secret).
 *
 * Only used when --api-key is passed with no explicit value — an explicit
 * value (flag or VOIDEN_PUBLISH_API_KEY) is used as-is and never touches
 * this file, since the host already knows/controls it.
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { randomBytes } from 'crypto'

export const API_KEY_STORE_DIR = join(homedir(), '.voiden')
const API_KEY_STORE_PATH = join(API_KEY_STORE_DIR, 'mcp-api-keys.json')

interface ApiKeyStore {
  /** Absolute project path -> generated key */
  keys: Record<string, string>
}

function emptyStore(): ApiKeyStore {
  return { keys: {} }
}

function readStore(): ApiKeyStore {
  if (!existsSync(API_KEY_STORE_PATH)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(API_KEY_STORE_PATH, 'utf-8'))
    return { keys: parsed.keys ?? {} }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: ApiKeyStore): void {
  mkdirSync(API_KEY_STORE_DIR, { recursive: true })
  writeFileSync(API_KEY_STORE_PATH, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  try { chmodSync(API_KEY_STORE_PATH, 0o600) } catch { /* best-effort */ }
}

/**
 * Returns the persisted key for `projectRoot`, generating and persisting a
 * new one on first use — stable across restarts so a key already shared
 * with someone doesn't silently rotate out from under them.
 */
export function getOrCreateProjectApiKey(projectRoot: string): string {
  const store = readStore()
  const existing = store.keys[projectRoot]
  if (existing) return existing
  const key = randomBytes(24).toString('base64url')
  store.keys[projectRoot] = key
  writeStore(store)
  return key
}
