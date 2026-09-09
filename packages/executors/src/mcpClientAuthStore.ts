/**
 * Client-side OAuth storage for connecting TO remote MCP servers from the
 * mcp-connection/mcp-operation blocks — the mirror image of
 * packages/voiden-mcp/src/oauthStore.ts, which persists the SERVER side of
 * an OAuth handshake (voiden-mcp's own registered clients/issued tokens).
 * This one persists what Voiden, acting as the CLIENT, got back from
 * someone else's MCP server: our own dynamically-registered client
 * information there, and the tokens that server issued us.
 *
 * Same conventions as that file: homedir()/.voiden/<name>.json, tolerant of
 * a missing/corrupt file, synchronous fs, 0600 (fixed up on every write,
 * since this holds real bearer secrets).
 *
 * Keyed by MCP server origin (protocol+host+port, not the full URL with
 * path) — one server, one registration, regardless of which mcp-connection
 * block or project points at it.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'

export interface StoredMcpClientInfo {
  client_id: string
  client_secret?: string
  [key: string]: any
}

export interface StoredMcpTokens {
  access_token: string
  token_type: string
  refresh_token?: string
  /** Seconds since epoch — computed from expires_in at save time, since
   *  that's relative and would silently go stale sitting in a file. */
  expiresAt?: number
  scope?: string
}

interface McpClientAuthStore {
  /** Keyed by server origin, e.g. "https://mcp.example.com". */
  clients: Record<string, StoredMcpClientInfo>
  tokens: Record<string, StoredMcpTokens>
}

export const MCP_CLIENT_AUTH_STORE_DIR = join(homedir(), '.voiden')
const STORE_PATH = join(MCP_CLIENT_AUTH_STORE_DIR, 'mcp-client-oauth.json')

function emptyStore(): McpClientAuthStore {
  return { clients: {}, tokens: {} }
}

function readStore(): McpClientAuthStore {
  if (!existsSync(STORE_PATH)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf-8'))
    return { clients: parsed.clients ?? {}, tokens: parsed.tokens ?? {} }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: McpClientAuthStore): void {
  mkdirSync(MCP_CLIENT_AUTH_STORE_DIR, { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  try { chmodSync(STORE_PATH, 0o600) } catch { /* best-effort */ }
}

/** Origin only (drops path/query) — so "https://x.com/mcp" and
 *  "https://x.com/mcp/v2" share one registration against the same server. */
export function originKeyFor(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin
  } catch {
    return serverUrl
  }
}

export function getStoredClientInfo(serverUrl: string): StoredMcpClientInfo | undefined {
  return readStore().clients[originKeyFor(serverUrl)]
}

export function saveClientInfo(serverUrl: string, info: StoredMcpClientInfo): void {
  const store = readStore()
  store.clients[originKeyFor(serverUrl)] = info
  writeStore(store)
}

export function getStoredTokens(serverUrl: string): StoredMcpTokens | undefined {
  return readStore().tokens[originKeyFor(serverUrl)]
}

/** Only returns tokens still valid (or with no known expiry) — an expired
 *  access_token is useless to attach to a request, and callers that just
 *  want "is there something usable right now" shouldn't each re-derive this
 *  expiry check themselves. Doesn't attempt a refresh — that's a distinct,
 *  explicit operation (see mcpAuthorize.ts), not implied by a read. */
export function getValidStoredTokens(serverUrl: string): StoredMcpTokens | undefined {
  const tokens = getStoredTokens(serverUrl)
  if (!tokens) return undefined
  if (tokens.expiresAt !== undefined && tokens.expiresAt < Math.floor(Date.now() / 1000)) return undefined
  return tokens
}

export function saveTokensFor(serverUrl: string, tokens: StoredMcpTokens): void {
  const store = readStore()
  store.tokens[originKeyFor(serverUrl)] = tokens
  writeStore(store)
}

export function deleteAuthFor(serverUrl: string): void {
  const store = readStore()
  const key = originKeyFor(serverUrl)
  delete store.clients[key]
  delete store.tokens[key]
  writeStore(store)
}
