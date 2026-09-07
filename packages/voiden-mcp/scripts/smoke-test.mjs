#!/usr/bin/env node
/**
 * Real smoke test for @voiden/mcp — spawns the built dist/index.js and
 * talks to it as an actual MCP client would (via @modelcontextprotocol/sdk's
 * own Client class), not just a build/typecheck. Five modes:
 *
 *   node scripts/smoke-test.mjs <projectPath>                     # stdio (default)
 *   node scripts/smoke-test.mjs <projectPath> --http [port]        # streamable HTTP
 *   node scripts/smoke-test.mjs <projectPath> --http --oauth [port]   # HTTP + OAuth
 *   node scripts/smoke-test.mjs <projectPath> --http --api-key [port] # HTTP + static key
 *   node scripts/smoke-test.mjs <projectPath> --http --sso [port]      # HTTP + delegated OAuth
 *
 * --oauth drives the full DCR → /authorize (auto-approve) → /token →
 * bearer-gated tools/list handshake using the SDK's own client-side OAuth
 * helpers — this is the automated stand-in for what a CLI-based AI agent's
 * loopback OAuth flow (or claude.ai's connector) does when it connects.
 *
 * --api-key confirms the much simpler static-key path: right key -> through,
 * wrong/missing key -> 401. No OAuth dance involved.
 *
 * --sso spawns scripts/mock-idp.mjs (a real, standalone OAuth 2.1 + DCR
 * server with an actual login form) alongside voiden-mcp --sso-authorize-url/
 * --sso-token-url/--sso-registration-url pointed at it, and drives the full
 * delegated flow: register -> land on the mock IdP's real login page ->
 * wrong password rejected -> right password -> code -> token (minted by the
 * mock IdP, tracked by voiden-mcp) -> bearer-gated request.
 *
 * Exits non-zero on any failure — safe to wire into CI later, not just
 * manual use. Always rebuilds first (`npm run build`) so a stale dist can
 * never produce a false pass.
 */

import { spawn, spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { discoverOAuthServerInfo, registerClient, startAuthorization, exchangeAuthorization } from '@modelcontextprotocol/sdk/client/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const distIndex = resolve(pkgRoot, 'dist/index.js')
const mockIdpScript = resolve(__dirname, 'mock-idp.mjs')

const args = process.argv.slice(2)
const projectPath = resolve(args[0] ?? '.')
const useHttp = args.includes('--http')
const useOAuth = args.includes('--oauth')
const useApiKey = args.includes('--api-key')
const useSso = args.includes('--sso')
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3947)
const idpPort = port + 1000

function log(...msg) {
  console.log('[smoke-test]', ...msg)
}

function fail(msg) {
  console.error('[smoke-test] ✗', msg)
  process.exit(1)
}

log(`Rebuilding @voiden/mcp (npm run build)...`)
const build = spawnSync('npm', ['run', 'build'], { cwd: pkgRoot, stdio: 'inherit' })
if (build.status !== 0) fail('Build failed — see output above.')
if (!existsSync(distIndex)) fail(`Build reported success but ${distIndex} still doesn't exist.`)
log('Build OK, dist/index.js confirmed present.')

async function runToolChecks(client) {
  const { tools } = await client.listTools()
  log(`tools/list — ${tools.length} tool(s):`, tools.map((t) => t.name).join(', '))
  if (!tools.some((t) => t.name === 'list_void_files')) {
    fail('Expected fixed tool "list_void_files" missing from tools/list.')
  }
  const result = await client.callTool({ name: 'list_void_files', arguments: {} })
  const text = result?.content?.[0]?.text
  let files
  try { files = JSON.parse(text) } catch { fail(`tools/call list_void_files returned unparseable content: ${text}`) }
  log(`tools/call list_void_files — ${Array.isArray(files) ? files.length : '?'} .void file(s) found.`)
  log('✓ All checks passed.')
}

/**
 * Drives the full OAuth handshake with the SDK's own client-side helpers,
 * exactly as an OAuth-strict remote client (claude.ai's connector UI, or a
 * CLI agent doing an RFC 8252 loopback-redirect flow) would:
 *   discover metadata -> register a client (DCR) -> hit /authorize -> parse
 *   the auto-approve landing page's redirect link (no click/interaction
 *   needed) -> exchange the code for tokens -> call tools/list with the
 *   bearer token. Also asserts an unauthenticated call is rejected.
 */
async function runOAuthChecks(port) {
  const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`)

  log('Discovering OAuth server info (.well-known/oauth-protected-resource + oauth-authorization-server)...')
  const { authorizationServerUrl, authorizationServerMetadata } = await discoverOAuthServerInfo(mcpUrl)
  if (!authorizationServerMetadata) fail('No authorization server metadata discovered.')
  log(`Authorization server: ${authorizationServerUrl}`)

  const redirectUrl = 'http://127.0.0.1:8945/callback'
  log('Registering an OAuth client via Dynamic Client Registration (RFC 7591)...')
  const clientInformation = await registerClient(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientMetadata: {
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'smoke-test-oauth-client',
    },
  })
  log(`Registered client_id=${clientInformation.client_id}`)

  const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientInformation,
    redirectUrl,
    scope: 'mcp',
    state: 'smoke-test-state',
  })

  log('Hitting /authorize — must auto-approve with no click/interaction...')
  const authRes = await fetch(authorizationUrl)
  if (!authRes.ok) fail(`/authorize returned HTTP ${authRes.status}`)
  const html = await authRes.text()
  const linkMatch = /id="continue-link" href="([^"]+)"/.exec(html)
  if (!linkMatch) fail('Could not find the auto-redirect link in the /authorize landing page — did its markup change?')
  const redirectTarget = new URL(linkMatch[1].replace(/&amp;/g, '&'))
  const code = redirectTarget.searchParams.get('code')
  if (!code) fail('/authorize landing page did not carry an authorization code.')
  if (redirectTarget.searchParams.get('state') !== 'smoke-test-state') fail('state parameter was not round-tripped correctly.')
  log('✓ Got an authorization code with zero user interaction (auto-approve confirmed).')

  const tokens = await exchangeAuthorization(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientInformation,
    authorizationCode: code,
    codeVerifier,
    redirectUri: redirectUrl,
  })
  log(`✓ Exchanged code for an access token (expires_in=${tokens.expires_in}s).`)

  log('Verifying an unauthenticated request is rejected...')
  const unauthRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  if (unauthRes.status !== 401) fail(`Expected 401 with no bearer token, got ${unauthRes.status}.`)
  if (!unauthRes.headers.get('www-authenticate')) fail('401 response is missing a WWW-Authenticate header.')
  log('✓ Unauthenticated request correctly rejected with 401 + WWW-Authenticate.')

  log('Verifying the bearer token is accepted...')
  // A raw JSON-RPC call rather than Client.listTools() — this only needs to
  // prove the bearer-auth GATE let the request through the HTTP layer, not
  // that this particular project actually has tools registered (an
  // unrelated concern already covered by the non-OAuth smoke-test path).
  const authedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  if (authedRes.status === 401) fail(`A valid bearer token was rejected with 401 (${await authedRes.text()}).`)
  if (!authedRes.ok) fail(`Authenticated request failed unexpectedly: HTTP ${authedRes.status}.`)
  log(`✓ Authenticated request passed the bearer-auth gate (HTTP ${authedRes.status} — what the tool layer itself returns is outside this check's scope).`)

  log('✓ OAuth flow fully verified: DCR → authorize (auto-approve) → token exchange → bearer-gated request, plus 401 rejection for no token.')
}

/**
 * Confirms the much simpler static-key path: the right key gets through,
 * a wrong or missing key gets 401 — no OAuth machinery involved at all.
 * `apiKey` is parsed from the server's own startup log (see below) rather
 * than read from the store file directly, so this also exercises that the
 * printed value is the one actually enforced.
 */
async function runApiKeyChecks(port, apiKey) {
  const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`)
  const call = (headers) => fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })

  log('Verifying a request with no key is rejected...')
  const noKeyRes = await call({})
  if (noKeyRes.status !== 401) fail(`Expected 401 with no API key, got ${noKeyRes.status}.`)
  log('✓ No key correctly rejected with 401.')

  log('Verifying a request with the wrong key is rejected...')
  const wrongKeyRes = await call({ Authorization: 'Bearer not-the-right-key' })
  if (wrongKeyRes.status !== 401) fail(`Expected 401 with a wrong API key, got ${wrongKeyRes.status}.`)
  log('✓ Wrong key correctly rejected with 401.')

  log('Verifying a request with the correct key succeeds...')
  const rightKeyRes = await call({ Authorization: `Bearer ${apiKey}` })
  if (rightKeyRes.status === 401) fail(`The correct API key was rejected with 401 (${await rightKeyRes.text()}).`)
  if (!rightKeyRes.ok) fail(`Correct-key request failed unexpectedly: HTTP ${rightKeyRes.status}.`)
  log(`✓ Correct key passed the bearer-auth gate (HTTP ${rightKeyRes.status}).`)

  log('✓ API key flow fully verified.')
}

/**
 * Drives the full delegated-login flow against scripts/mock-idp.mjs: unlike
 * runOAuthChecks (voiden-mcp's own auto-approve /authorize), this one's
 * /authorize is a REAL 302 to the external IdP — the browser never comes
 * back through voiden-mcp until the token exchange step. Proves both that a
 * wrong password is actually rejected there, and that a real login is
 * required before any token comes back.
 */
async function runSsoChecks(port, idpPort) {
  const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`)

  const { authorizationServerUrl, authorizationServerMetadata } = await discoverOAuthServerInfo(mcpUrl)
  if (!authorizationServerMetadata) fail('No authorization server metadata discovered from voiden-mcp itself.')

  const redirectUrl = 'http://127.0.0.1:8947/callback'
  log('Registering an OAuth client (forwarded by voiden-mcp to the mock IdP)...')
  const clientInformation = await registerClient(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientMetadata: {
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'smoke-test-sso-client',
    },
  })
  log(`Registered client_id=${clientInformation.client_id} (this is the mock IdP's own client_id — proxied through as-is).`)

  const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientInformation,
    redirectUrl,
    scope: 'mcp',
    state: 'sso-smoke-test-state',
  })

  log('Hitting voiden-mcp\'s /authorize — expecting a real redirect to the mock IdP, not an auto-approve page...')
  const proxyRedirect = await fetch(authorizationUrl, { redirect: 'manual' })
  if (proxyRedirect.status < 300 || proxyRedirect.status >= 400) fail(`Expected a redirect (3xx) from voiden-mcp's /authorize, got ${proxyRedirect.status}.`)
  const idpAuthorizeUrl = proxyRedirect.headers.get('location')
  if (!idpAuthorizeUrl || !idpAuthorizeUrl.includes(`:${idpPort}`)) fail(`Expected the redirect to land on the mock IdP (port ${idpPort}), got: ${idpAuthorizeUrl}`)
  log(`✓ Landed on the mock IdP's real /authorize (${idpAuthorizeUrl.split('?')[0]}) — not auto-approved by voiden-mcp.`)

  const loginPageHtml = await (await fetch(idpAuthorizeUrl)).text()
  const requestIdMatch = /name="request_id" value="([^"]+)"/.exec(loginPageHtml)
  if (!requestIdMatch) fail('Could not find the login form\'s request_id on the mock IdP\'s page — did its markup change?')
  const loginUrl = new URL('/login', idpAuthorizeUrl).toString()

  log('Submitting the WRONG password — must be rejected, no code issued...')
  const wrongLoginRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request_id: requestIdMatch[1], username: 'testuser', password: 'definitely-wrong' }),
  })
  if (wrongLoginRes.status >= 300 && wrongLoginRes.status < 400) fail('A wrong password still produced a redirect (code issued?) — login is not actually being checked.')
  log('✓ Wrong password correctly rejected — no redirect, no code.')

  log('Submitting the CORRECT password...')
  const rightLoginRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request_id: requestIdMatch[1], username: 'testuser', password: 'testpass123' }),
  })
  if (rightLoginRes.status < 300 || rightLoginRes.status >= 400) fail(`Expected a redirect after correct login, got ${rightLoginRes.status}.`)
  const finalRedirect = new URL(rightLoginRes.headers.get('location'))
  const code = finalRedirect.searchParams.get('code')
  if (!code) fail('No authorization code in the post-login redirect.')
  if (finalRedirect.searchParams.get('state') !== 'sso-smoke-test-state') fail('state was not round-tripped correctly through the mock IdP.')
  log('✓ Correct password accepted — got an authorization code from the real login.')

  const tokens = await exchangeAuthorization(authorizationServerUrl, {
    metadata: authorizationServerMetadata,
    clientInformation,
    authorizationCode: code,
    codeVerifier,
    redirectUri: redirectUrl,
  })
  log(`✓ Exchanged code for a token via voiden-mcp's /token (proxied to the mock IdP, expires_in=${tokens.expires_in}s).`)

  const unauthRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  if (unauthRes.status !== 401) fail(`Expected 401 with no bearer token, got ${unauthRes.status}.`)

  const authedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', Authorization: `Bearer ${tokens.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  if (authedRes.status === 401) fail(`The mock-IdP-issued token was rejected with 401 (${await authedRes.text()}).`)
  log(`✓ Mock-IdP-issued token passed voiden-mcp's bearer-auth gate (HTTP ${authedRes.status}).`)

  log('✓ SSO-delegated flow fully verified: register -> real external login (wrong password rejected, right password accepted) -> token -> bearer-gated request.')
}

if (useHttp) {
  let idpChild
  if (useSso) {
    log(`Starting mock IdP on 127.0.0.1:${idpPort}...`)
    idpChild = spawn('node', [mockIdpScript, '--port', String(idpPort)], { stdio: ['ignore', 'pipe', 'pipe'] })
    idpChild.stdout.on('data', (d) => process.stderr.write(`  [mock-idp] ${d}`))
    idpChild.stderr.on('data', (d) => process.stderr.write(`  [mock-idp] ${d}`))
    await new Promise((res) => setTimeout(res, 1000)) // let it bind before voiden-mcp starts registering against it
  }

  log(`Starting HTTP server on 127.0.0.1:${port}${useOAuth ? ' (--oauth)' : ''}${useApiKey ? ' (--api-key)' : ''}${useSso ? ' (--sso)' : ''}...`)
  const serverArgs = [distIndex, projectPath, '--http', '--port', String(port)]
  if (useOAuth) serverArgs.push('--oauth')
  if (useApiKey) serverArgs.push('--api-key')
  if (useSso) {
    serverArgs.push(
      '--sso-authorize-url', `http://127.0.0.1:${idpPort}/authorize`,
      '--sso-token-url', `http://127.0.0.1:${idpPort}/token`,
      '--sso-registration-url', `http://127.0.0.1:${idpPort}/register`,
    )
  }
  const child = spawn('node', serverArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
  let capturedApiKey
  const captureApiKey = (chunk) => {
    const match = /API key required.*Bearer ([^"]+)"/.exec(chunk.toString())
    if (match) capturedApiKey = match[1]
  }
  child.stdout.on('data', (d) => process.stderr.write(`  [server stdout] ${d}`))
  child.stderr.on('data', (d) => { process.stderr.write(`  [server] ${d}`); captureApiKey(d) })

  const shutdown = (code) => {
    child.kill('SIGTERM')
    if (idpChild) idpChild.kill('SIGTERM')
    setTimeout(() => process.exit(code), 300)
  }

  await new Promise((res) => setTimeout(res, 1500)) // let it bind

  try {
    if (useOAuth) {
      await runOAuthChecks(port)
    } else if (useApiKey) {
      if (!capturedApiKey) fail('Server did not print its auto-generated API key at startup — startup log format changed?')
      await runApiKeyChecks(port, capturedApiKey)
    } else if (useSso) {
      await runSsoChecks(port, idpPort)
    } else {
      const client = new Client({ name: 'smoke-test-client', version: '1.0.0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
      log(`Connected to http://127.0.0.1:${port}/mcp`)
      await runToolChecks(client)
      await client.close()
    }
    shutdown(0)
  } catch (err) {
    console.error(err)
    shutdown(1)
  }
} else {
  log(`Starting stdio server for ${projectPath}...`)
  const client = new Client({ name: 'smoke-test-client', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: 'node', args: [distIndex, projectPath] })
  try {
    await client.connect(transport)
    log('Connected over stdio.')
    await runToolChecks(client)
    await client.close()
    process.exit(0)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
