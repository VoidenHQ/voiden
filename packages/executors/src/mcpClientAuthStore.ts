/**
 * Reads the client-side OAuth tokens Voiden holds for remote MCP servers, so
 * mcp.ts can attach them to mcp-connection/mcp-operation calls — the mirror
 * image of packages/voiden-mcp/src/oauthStore.ts, which persists the SERVER
 * side of an OAuth handshake.
 *
 * Read-only here: the file is written by the voiden-mcp-client plugin's
 * Authorize flow (its main-process part), which owns registration, token
 * exchange, refresh and revocation recovery. The format is a contract with
 * that plugin: { clients: { [origin]: clientInfo }, tokens: { [origin]:
 * tokens } }, keyed by MCP server origin (protocol+host+port, not the full
 * URL with path), tokens carrying an absolute `expiresAt`.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export interface StoredMcpTokens {
  access_token: string
  token_type: string
  refresh_token?: string
  /** Seconds since epoch — computed from expires_in at save time, since
   *  that's relative and would silently go stale sitting in a file. */
  expiresAt?: number
  scope?: string
}

const STORE_PATH = join(homedir(), '.voiden', 'mcp-client-oauth.json')

function readTokens(): Record<string, StoredMcpTokens> {
  if (!existsSync(STORE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8')).tokens ?? {}
  } catch {
    return {}
  }
}

/** Origin only (drops path/query) — so "https://x.com/mcp" and
 *  "https://x.com/mcp/v2" share one registration against the same server. */
function originKeyFor(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin
  } catch {
    return serverUrl
  }
}

/** Only returns tokens still valid (or with no known expiry) — an expired
 *  access_token is useless to attach to a request. Never refreshes: a
 *  missing/expired/revoked token surfaces as a 401 (authRequired), and the
 *  user re-runs Authorize. */
export function getValidStoredTokens(serverUrl: string): StoredMcpTokens | undefined {
  const tokens = readTokens()[originKeyFor(serverUrl)]
  if (!tokens) return undefined
  if (tokens.expiresAt !== undefined && tokens.expiresAt < Math.floor(Date.now() / 1000)) return undefined
  return tokens
}
