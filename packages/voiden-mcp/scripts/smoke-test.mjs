#!/usr/bin/env node
/**
 * Real smoke test for @voiden/mcp — spawns the built dist/index.js and
 * talks to it as an actual MCP client would (via @modelcontextprotocol/sdk's
 * own Client class), not just a build/typecheck. Two modes:
 *
 *   node scripts/smoke-test.mjs <projectPath>              # stdio (default)
 *   node scripts/smoke-test.mjs <projectPath> --http [port] # streamable HTTP
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const distIndex = resolve(pkgRoot, 'dist/index.js')

const args = process.argv.slice(2)
const projectPath = resolve(args[0] ?? '.')
const useHttp = args.includes('--http')
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

if (useHttp) {
  log(`Starting HTTP server on 127.0.0.1:${port}...`)
  const child = spawn('node', [distIndex, projectPath, '--http', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stderr.write(`  [server stdout] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`  [server] ${d}`))

  const shutdown = (code) => {
    child.kill('SIGTERM')
    setTimeout(() => process.exit(code), 300)
  }

  await new Promise((res) => setTimeout(res, 1500)) // let it bind

  try {
    const client = new Client({ name: 'smoke-test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
    log(`Connected to http://127.0.0.1:${port}/mcp`)
    await runToolChecks(client)
    await client.close()
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
