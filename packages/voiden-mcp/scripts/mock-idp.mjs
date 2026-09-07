#!/usr/bin/env node
/**
 * A minimal, real, spec-compliant-enough OAuth 2.1 authorization server —
 * purpose-built to test --sso-authorize-url/--sso-token-url/
 * --sso-registration-url end to end, standing in for "an external IdP the
 * host already runs" from docs/mcp-tool-publish-guide.md.
 *
 * Unlike VoidenOAuthProvider (this package's own --oauth, which
 * auto-approves), this DOES show and require a real login — that's the
 * whole point: proving the browser actually lands on the external site and
 * a token only comes back after a real login there, not proving anything
 * about voiden-mcp itself.
 *
 * In-memory only, by design — this is throwaway test infrastructure, not
 * something to run for real. Never published (scripts/ isn't in this
 * package's `files`).
 *
 * Usage:
 *   node scripts/mock-idp.mjs [--port 4001] [--user testuser] [--pass testpass123]
 *
 * Then point voiden-mcp at it:
 *   voiden-mcp . --http --tunnel \
 *     --sso-authorize-url http://127.0.0.1:4001/authorize \
 *     --sso-token-url http://127.0.0.1:4001/token \
 *     --sso-registration-url http://127.0.0.1:4001/register
 */

import express from 'express'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const port = Number(argValue('--port', '4001'))
const validUser = argValue('--user', 'testuser')
const validPass = argValue('--pass', 'testpass123')

function log(...msg) {
  console.log('[mock-idp]', ...msg)
}

// ─── In-memory state — resets every restart, intentionally ────────────────
const clients = new Map() // client_id -> { client_id, client_secret?, redirect_uris, ... }
const pendingAuth = new Map() // request_id -> { clientId, redirectUri, codeChallenge, state, scope }
const codes = new Map() // code -> { clientId, redirectUri, codeChallenge, scope, expiresAt }
const tokens = new Map() // access_token -> { clientId, scope, expiresAt }
const refreshTokens = new Map() // refresh_token -> { clientId, scope }

const randomToken = () => randomBytes(24).toString('base64url')
const b64urlSha256 = (input) => createHash('sha256').update(input).digest('base64url')
const safeEqual = (a, b) => {
  const ah = createHash('sha256').update(a).digest()
  const bh = createHash('sha256').update(b).digest()
  return timingSafeEqual(ah, bh)
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const app = express()

app.get('/health', (_req, res) => res.json({ status: 'ok', clients: clients.size }))

// ─── RFC 7591 Dynamic Client Registration ──────────────────────────────────
app.post('/register', express.json(), (req, res) => {
  const body = req.body ?? {}
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' })
  }
  const client_id = randomToken()
  const isPublicClient = body.token_endpoint_auth_method === 'none'
  const client_secret = isPublicClient ? undefined : randomToken()
  const client = {
    ...body,
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(client_secret ? { client_secret } : {}),
  }
  clients.set(client_id, client)
  log(`Registered client "${body.client_name ?? client_id}" (${client_id})`)
  res.status(201).json(client)
})

// ─── Authorization endpoint — a REAL login form, not an auto-approve ──────
app.get('/authorize', (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge, state, scope } = req.query
  const client = clients.get(String(client_id ?? ''))
  if (response_type !== 'code' || !client) {
    return res.status(400).send('invalid_request: unknown client or unsupported response_type')
  }
  if (!client.redirect_uris.includes(String(redirect_uri ?? ''))) {
    return res.status(400).send('invalid_request: redirect_uri not registered for this client')
  }
  const requestId = randomToken()
  pendingAuth.set(requestId, {
    clientId: client.client_id,
    redirectUri: String(redirect_uri),
    codeChallenge: String(code_challenge ?? ''),
    state: state !== undefined ? String(state) : undefined,
    scope: scope !== undefined ? String(scope) : '',
  })
  res.status(200).type('html').send(renderLoginPage(client, requestId))
})

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { request_id, username, password } = req.body ?? {}
  const pending = pendingAuth.get(String(request_id ?? ''))
  if (!pending) return res.status(400).send('This login link has expired — go back and try connecting again.')
  const client = clients.get(pending.clientId)

  if (username !== validUser || password !== validPass) {
    log(`Login failed for client ${pending.clientId} — wrong credentials`)
    return res.status(200).type('html').send(renderLoginPage(client, request_id, 'Wrong username or password.'))
  }

  pendingAuth.delete(String(request_id))
  const code = randomToken()
  codes.set(code, { ...pending, expiresAt: Date.now() + 10 * 60 * 1000 })
  log(`Login succeeded for client ${pending.clientId} — issuing code`)

  const redirectUrl = new URL(pending.redirectUri)
  redirectUrl.searchParams.set('code', code)
  if (pending.state !== undefined) redirectUrl.searchParams.set('state', pending.state)
  res.redirect(redirectUrl.toString())
})

function renderLoginPage(client, requestId, error) {
  const name = escapeHtml(client?.client_name ?? client?.client_id ?? 'an application')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock IdP — Sign in</title>
<style>
  body { font: 15px -apple-system, system-ui, sans-serif; background: #0b0b0c; color: #e4e4e7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #18181b; padding: 32px; border-radius: 12px; width: 280px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p.sub { color: #a1a1aa; font-size: 13px; margin: 0 0 20px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #3f3f46; background: #09090b; color: #e4e4e7; }
  button { width: 100%; padding: 9px; border-radius: 6px; border: none; background: #4f46e5; color: white; font-weight: 600; cursor: pointer; }
  .err { color: #f87171; font-size: 13px; margin: 0 0 10px; }
</style></head>
<body>
  <div class="card">
    <h1>Mock IdP</h1>
    <p class="sub">${name} wants you to sign in</p>
    ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/login">
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
      <input type="text" name="username" placeholder="Username" autofocus>
      <input type="password" name="password" placeholder="Password">
      <button type="submit">Sign in</button>
    </form>
  </div>
</body></html>`
}

// ─── Token endpoint ─────────────────────────────────────────────────────────
app.post('/token', express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body ?? {}
  const client = clients.get(String(body.client_id ?? ''))
  if (!client) return res.status(400).json({ error: 'invalid_client' })
  if (client.client_secret && client.client_secret !== body.client_secret) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Wrong client_secret' })
  }

  if (body.grant_type === 'authorization_code') {
    const entry = codes.get(String(body.code ?? ''))
    if (!entry || entry.clientId !== client.client_id || entry.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown, expired, or mismatched code' })
    }
    codes.delete(String(body.code))
    if (entry.redirectUri !== body.redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
    }
    if (entry.codeChallenge && b64urlSha256(String(body.code_verifier ?? '')) !== entry.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier does not match code_challenge' })
    }
    return res.json(issueTokens(client.client_id, entry.scope))
  }

  if (body.grant_type === 'refresh_token') {
    const stored = refreshTokens.get(String(body.refresh_token ?? ''))
    if (!stored || stored.clientId !== client.client_id) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or mismatched refresh_token' })
    }
    refreshTokens.delete(String(body.refresh_token))
    return res.json(issueTokens(client.client_id, stored.scope))
  }

  res.status(400).json({ error: 'unsupported_grant_type' })
})

function issueTokens(clientId, scope) {
  const access_token = randomToken()
  const refresh_token = randomToken()
  const expires_in = 3600
  tokens.set(access_token, { clientId, scope, expiresAt: Date.now() / 1000 + expires_in })
  refreshTokens.set(refresh_token, { clientId, scope })
  return { access_token, token_type: 'Bearer', expires_in, refresh_token, scope }
}

// ─── Revocation (optional, matches --sso-revocation-url) ───────────────────
app.post('/revoke', express.urlencoded({ extended: false }), (req, res) => {
  tokens.delete(String(req.body?.token ?? ''))
  refreshTokens.delete(String(req.body?.token ?? ''))
  res.status(200).end()
})

app.listen(port, '127.0.0.1', () => {
  log(`Listening on http://127.0.0.1:${port}`)
  log(`Login with: ${validUser} / ${validPass}  (override with --user/--pass)`)
  log('')
  log('Point voiden-mcp at it:')
  log(`  voiden-mcp . --http --tunnel \\`)
  log(`    --sso-authorize-url http://127.0.0.1:${port}/authorize \\`)
  log(`    --sso-token-url http://127.0.0.1:${port}/token \\`)
  log(`    --sso-registration-url http://127.0.0.1:${port}/register`)
})
