#!/usr/bin/env node
/**
 * Real smoke test for @voiden/mcp — spawns the built dist/index.js and
 * talks to it as an actual MCP client would (via @modelcontextprotocol/sdk's
 * own Client class), not just a build/typecheck. Three modes:
 *
 *   node scripts/smoke-test.mjs <projectPath>                  # stdio (default)
 *   node scripts/smoke-test.mjs <projectPath> --http [port]     # streamable HTTP
 *   node scripts/smoke-test.mjs <projectPath> --http --oauth [port] # HTTP + OAuth
 *
 * --oauth drives the full DCR → /authorize (auto-approve) → /token →
 * bearer-gated tools/list handshake using the SDK's own client-side OAuth
 * helpers — this is the automated stand-in for what a CLI-based AI agent's
 * loopback OAuth flow (or claude.ai's connector) does when it connects.
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

const args = process.argv.slice(2)
const projectPath = resolve(args[0] ?? '.')
const useHttp = args.includes('--http')
const useOAuth = args.includes('--oauth')
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3947)

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

if (useHttp) {
  log(`Starting HTTP server on 127.0.0.1:${port}${useOAuth ? ' (--oauth)' : ''}...`)
  const serverArgs = [distIndex, projectPath, '--http', '--port', String(port)]
  if (useOAuth) serverArgs.push('--oauth')
  const child = spawn('node', serverArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stderr.write(`  [server stdout] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`  [server] ${d}`))

  const shutdown = (code) => {
    child.kill('SIGTERM')
    setTimeout(() => process.exit(code), 300)
  }

  await new Promise((res) => setTimeout(res, 1500)) // let it bind

  try {
    if (useOAuth) {
      await runOAuthChecks(port)
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
