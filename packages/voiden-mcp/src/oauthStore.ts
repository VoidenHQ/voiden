/**
 * OAuth Store — persists registered MCP clients (RFC 7591 Dynamic Client
 * Registration) and issued access/refresh tokens to ~/.voiden/mcp-oauth.json.
 *
 * Follows the same convention as @voiden/runner's plugin store
 * (packages/voiden-runner/src/plugins/store.ts): homedir()/.voiden/<name>.json,
 * tolerant of a missing/corrupt file, synchronous fs, plain JSON. This file
 * additionally holds bearer secrets, so it's written with 0600 permissions —
 * fixed up on every write in case the file pre-existed with looser ones.
 *
 * Authorization codes are NOT persisted here — they're short-lived (minutes)
 * and only ever used mid-handshake, so losing them across a restart just
 * means the client redoes that one step; see oauthProvider.ts's in-memory map.
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { randomBytes } from 'crypto'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'

export interface StoredToken {
  clientId: string
  scopes: string[]
  /** Seconds since epoch. */
  expiresAt: number
  resource?: string
}

export interface StoredRefreshToken {
  clientId: string
  scopes: string[]
  resource?: string
}

export interface OAuthStore {
  clients: Record<string, OAuthClientInformationFull>
  tokens: Record<string, StoredToken>
  refreshTokens: Record<string, StoredRefreshToken>
}

export const OAUTH_STORE_DIR = join(homedir(), '.voiden')
const OAUTH_STORE_PATH = join(OAUTH_STORE_DIR, 'mcp-oauth.json')

function emptyStore(): OAuthStore {
  return { clients: {}, tokens: {}, refreshTokens: {} }
}

export function readOAuthStore(): OAuthStore {
  if (!existsSync(OAUTH_STORE_PATH)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(OAUTH_STORE_PATH, 'utf-8'))
    return {
      clients: parsed.clients ?? {},
      tokens: parsed.tokens ?? {},
      refreshTokens: parsed.refreshTokens ?? {},
    }
  } catch {
    return emptyStore()
  }
}

export function writeOAuthStore(store: OAuthStore): void {
  mkdirSync(OAUTH_STORE_DIR, { recursive: true })
  writeFileSync(OAUTH_STORE_PATH, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  // The `mode` option above only applies when the file is CREATED — if it
  // already existed (e.g. from before this line was added, or a permissive
  // umask was in effect the first time), fix the perms explicitly on every
  // write rather than just once.
  try { chmodSync(OAUTH_STORE_PATH, 0o600) } catch { /* best-effort */ }
}

// ─── Small helpers used by oauthProvider.ts ────────────────────────────────

export function getStoredClient(clientId: string): OAuthClientInformationFull | undefined {
  return readOAuthStore().clients[clientId]
}

export function putStoredClient(client: OAuthClientInformationFull): void {
  const store = readOAuthStore()
  store.clients[client.client_id] = client
  writeOAuthStore(store)
}

export function putToken(token: string, entry: StoredToken): void {
  const store = readOAuthStore()
  store.tokens[token] = entry
  writeOAuthStore(store)
}

export function getToken(token: string): StoredToken | undefined {
  return readOAuthStore().tokens[token]
}

export function deleteToken(token: string): void {
  const store = readOAuthStore()
  if (token in store.tokens) {
    delete store.tokens[token]
    writeOAuthStore(store)
  }
}

export function putRefreshToken(token: string, entry: StoredRefreshToken): void {
  const store = readOAuthStore()
  store.refreshTokens[token] = entry
  writeOAuthStore(store)
}

export function getRefreshToken(token: string): StoredRefreshToken | undefined {
  return readOAuthStore().refreshTokens[token]
}

export function deleteRefreshToken(token: string): void {
  const store = readOAuthStore()
  if (token in store.refreshTokens) {
    delete store.refreshTokens[token]
    writeOAuthStore(store)
  }
}

/** Issues a fresh access+refresh token pair for `clientId`, persisting both. */
export function issueTokenPair(
  clientId: string,
  scopes: string[],
  resource: string | undefined,
  accessTokenTtlSeconds: number,
): { accessToken: string; refreshToken: string; expiresAt: number } {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  const expiresAt = Math.floor(Date.now() / 1000) + accessTokenTtlSeconds

  const store = readOAuthStore()
  store.tokens[accessToken] = { clientId, scopes, expiresAt, resource }
  store.refreshTokens[refreshToken] = { clientId, scopes, resource }
  writeOAuthStore(store)

  return { accessToken, refreshToken, expiresAt }
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}
