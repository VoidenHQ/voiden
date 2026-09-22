/**
 * Drives a full, real OAuth 2.1 handshake against a remote MCP server —
 * the actual fix for the "Authorize" button's earlier limitation (opens a
 * login page, but you had to paste a token in manually afterward). Uses the
 * SDK's own auth() two-phase flow: called once with no code to run discovery
 * + Dynamic Client Registration + redirect the browser, then again with the
 * code the browser's redirect actually delivered, to complete the exchange.
 *
 * The one piece the SDK can't provide itself: something has to actually
 * receive that redirect. A loopback HTTP server on an ephemeral port is the
 * standard approach for a native app (RFC 8252) — started before auth() is
 * even called, so the exact redirect_uri is known up front and gets
 * registered as part of DCR, not guessed independently of what's listening.
 */

import { createServer, type Server } from 'node:http'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { McpOAuthProvider } from './mcpOAuthProvider.js'

// Long enough for a human to actually complete a login (including any
// "check your email" / SSO-through-a-third-IdP detours); short enough that
// an abandoned attempt doesn't leave a loopback port listening forever.
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000

export interface AuthorizeMcpServerResult {
  success: boolean
  error?: string
}

interface CallbackResult {
  code?: string
  error?: string
}

function renderCallbackPage(success: boolean, error?: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const heading = success ? 'Authorized' : 'Authorization failed'
  const body = success
    ? 'You can close this tab and go back to Voiden.'
    : `Something went wrong: ${escape(error || 'unknown error')}. You can close this tab and try again from Voiden.`
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Voiden</title>
<style>
  body { font: 15px -apple-system, system-ui, sans-serif; background: #0b0b0c; color: #e4e4e7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; max-width: 420px; padding: 0 24px; }
  .icon { font-size: 32px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✓' : '✗'}</div>
    <h2>${heading}</h2>
    <p>${body}</p>
  </div>
</body>
</html>`
}

/** Starts a loopback listener on an OS-assigned ephemeral port and resolves
 *  once it's actually bound — the caller needs the real port before it can
 *  register a redirect_uri that points at it. `onCallbackReceived` fires the
 *  moment the browser actually lands here, success or failure — this is
 *  what lets the caller bring Voiden itself back to the foreground the
 *  instant control returns from the browser, rather than leaving the user
 *  staring at a static "you can close this tab" page with the app still in
 *  the background. Fires exactly once, before the promise below resolves,
 *  so a caller reacting to it can rely on the HTTP response already having
 *  been sent to the browser. */
function startLoopbackListener(onCallbackReceived?: () => void): Promise<{
  server: Server
  port: number
  waitForCallback: () => Promise<CallbackResult>
}> {
  return new Promise((resolve, reject) => {
    let settled = false
    let resolveCallback: (v: CallbackResult) => void
    const callbackPromise = new Promise<CallbackResult>((res) => { resolveCallback = res })

    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code') || undefined
      const errorParam = url.searchParams.get('error') || undefined
      const errorDescription = url.searchParams.get('error_description') || undefined
      const error = errorParam ? (errorDescription || errorParam) : undefined
      res.writeHead(200, { 'content-type': 'text/html' }).end(renderCallbackPage(!!code, error))
      if (!settled) {
        settled = true
        try { onCallbackReceived?.() } catch { /* never let a focus-the-app hiccup break the actual auth result */ }
        resolveCallback({ code, error })
      }
    })

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        resolveCallback({ error: 'Timed out waiting for the browser to complete authorization (5 minutes).' })
      }
    }, AUTHORIZE_TIMEOUT_MS)

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        server,
        port,
        waitForCallback: () => callbackPromise.finally(() => clearTimeout(timeout)),
      })
    })
  })
}

/**
 * Runs the whole flow end to end. `openBrowser` and `onCallbackReceived` are
 * both injected rather than called directly (e.g. Electron's
 * shell.openExternal, and bringing an Electron BrowserWindow to the front)
 * so this package stays host-agnostic — see mcp.ts's own header comment for
 * why nothing else here imports electron either.
 */
export async function authorizeMcpServer(
  serverUrl: string,
  openBrowser: (url: string) => void,
  onCallbackReceived?: () => void,
): Promise<AuthorizeMcpServerResult> {
  const { server, waitForCallback, port } = await startLoopbackListener(onCallbackReceived)
  try {
    const provider = new McpOAuthProvider(serverUrl, `http://127.0.0.1:${port}/callback`, openBrowser)
    const initialResult = await auth(provider, { serverUrl })
    if (initialResult === 'AUTHORIZED') {
      // Had a valid (or freshly refreshed) token already — nothing to wait
      // on, the browser was never opened.
      return { success: true }
    }

    const { code, error: callbackError } = await waitForCallback()
    if (callbackError) return { success: false, error: callbackError }
    if (!code) return { success: false, error: 'No authorization code was received from the browser.' }

    const finalResult = await auth(provider, { serverUrl, authorizationCode: code })
    if (finalResult !== 'AUTHORIZED') {
      return { success: false, error: 'The server did not accept the token exchange.' }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  } finally {
    server.close()
  }
}
