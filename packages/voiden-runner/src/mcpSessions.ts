/**
 * Per-client session state for the stateless streamable-HTTP MCP servers
 * (`voiden-runner mcp serve --http`, `@voiden/mcp --http`).
 *
 * Both servers build a fresh McpServer + transport per HTTP request with
 * the SDK's session management off (sessionIdGenerator: undefined), so a
 * scheduler tick's new tool decisions take effect on the very next request.
 * The catch: anything meant to persist *between* calls — {{process.*}}
 * runtime variables one tool captures for the next, select_environment's
 * choice — had nowhere to live but one process-wide object, shared by every
 * connected client. One user's captured token or id leaked into another's
 * calls.
 *
 * This keeps the stateless transport and does session identification
 * itself: a request with no Mcp-Session-Id header (the client's
 * `initialize`) gets a fresh id on its response, which the MCP spec
 * requires a streamable-HTTP client to echo on every later request. The
 * SDK's stateless transport ignores the header entirely, so nothing else
 * changes. A client that never echoes it just gets a fresh, isolated
 * session per request — no chaining for that client, but never another
 * client's values.
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const SESSION_HEADER = 'mcp-session-id'
const DEFAULT_IDLE_TTL_MS = 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

export interface McpSessionStore<T> {
  /** The calling client's session state — created on first use. Sets the
   *  Mcp-Session-Id response header when the request carried none, so call
   *  this before the transport writes the response. */
  forRequest(req: IncomingMessage, res: ServerResponse): T
  /** Stops the idle sweep (for shutdown). */
  close(): void
}

export function createMcpSessionStore<T>(create: () => T, opts?: { idleTtlMs?: number }): McpSessionStore<T> {
  const idleTtlMs = opts?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
  const sessions = new Map<string, { state: T; lastUsed: number }>()

  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleTtlMs
    for (const [id, s] of sessions) if (s.lastUsed < cutoff) sessions.delete(id)
  }, SWEEP_INTERVAL_MS)
  sweep.unref()

  return {
    forRequest(req, res) {
      const header = req.headers[SESSION_HEADER]
      let id = typeof header === 'string' && header ? header : undefined
      if (!id) {
        id = randomUUID()
        res.setHeader(SESSION_HEADER, id)
      }
      // DELETE is the client ending its session — drop the state now
      // rather than waiting out the idle TTL.
      if (req.method === 'DELETE') {
        sessions.delete(id)
        return create()
      }
      let s = sessions.get(id)
      if (!s) {
        s = { state: create(), lastUsed: Date.now() }
        sessions.set(id, s)
      }
      s.lastUsed = Date.now()
      return s.state
    },
    close() {
      clearInterval(sweep)
    },
  }
}
