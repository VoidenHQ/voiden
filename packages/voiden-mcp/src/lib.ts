/**
 * @voiden/mcp — the package that actually runs the MCP server.
 *
 * Not a one-shot action: `runPublish()` discovers every /tool block under a
 * project, verifies it, and then STAYS UP (stdio or --http) — health checks,
 * graceful shutdown, an optional public tunnel, periodic re-verification —
 * until stopped. Nothing here sends files "to" a server; calling this *is*
 * the server starting.
 *
 * Standalone — nothing wraps or duplicates this logic. The `voiden` CLI's
 * `agent` command (see apps/electron) registers a project's `.mcp.json`/
 * `config.toml` to launch `npx @voiden/mcp <path>` so an agent editor starts
 * it automatically, but `agent` itself is pure registration — it never runs
 * a server. This package is also the thing you'd deploy standalone (a
 * Dockerfile, a systemd unit, a PaaS build step) — install just this.
 */

import { resolve, join, basename } from 'path'
import { existsSync, statSync } from 'fs'
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Command } from 'commander'
import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import type { OAuthTokenVerifier, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { timingSafeEqual, createHash } from 'node:crypto'
import { VoidenOAuthProvider } from './oauthProvider.js'
import { VoidenSsoOAuthProvider, type SsoEndpoints } from './oauthSsoProvider.js'
import { getOrCreateProjectApiKey } from './apiKeyStore.js'
import {
  loadEnabledPlugins,
  loadEnvFile,
  planServedTools,
  registerToolsFromDecisions,
  getCommitSha,
  type ServeDecision,
  type VerifyEntryCache,
} from '@voiden/runner'

// ─── CLI option definitions — factored out for this package's own top-level
// bin (src/index.ts) to attach to `program` directly. No other command
// shares these anymore now that @voiden/mcp-host has been retired. ────────

export function withPublishOptions(cmd: Command): Command {
  return cmd
    .option('--http', 'Serve over streamable HTTP instead of stdio')
    .option('--port <port>', 'HTTP port (env: VOIDEN_PUBLISH_PORT, default 3000)')
    .option('--host <host>', 'HTTP bind address — binding beyond 127.0.0.1 is a real exposure risk (env: VOIDEN_PUBLISH_HOST, default 127.0.0.1)')
    .option('--dynamic-tools', 'Expose exactly 2 tools instead of one per /tool block — search_tools (lists what\'s served) + call_tool (dispatches to one by name) — for projects with too many tools to put directly on the listing without blowing up an agent\'s context window. Off by default (every served /tool individually registered by name) (env: VOIDEN_PUBLISH_DYNAMIC_TOOLS)')
    .option('--tunnel', 'Wrap --http in a public cloudflared quick tunnel — only needed when this machine has no public IP of its own (env: VOIDEN_PUBLISH_TUNNEL)')
    .option('--public-url <url>', 'The externally-reachable base URL clients actually use to reach this server — e.g. a manually-configured port forward (VS Code\'s Ports panel, ngrok) or reverse proxy sitting in front of a --host 127.0.0.1 bind. With --oauth, this is required for anything other than --tunnel or genuine localhost use: without it, the advertised issuer/register/authorize/token URLs default to http://<host>:<port> — unreachable from outside this machine, which is exactly what makes DCR fail with a generic "couldn\'t register" error for a client connecting through an external forward. Also used by --print-config\'s printed URL. Not needed with --tunnel, which already knows its own public URL (env: VOIDEN_PUBLISH_PUBLIC_URL)')
    .option('--oauth', 'Require OAuth 2.1 (Dynamic Client Registration + authorization code + bearer tokens) on the --http endpoint — needed for clients that mandate an OAuth handshake before connecting (e.g. claude.ai\'s connector UI, some CLI agent tools). Off by default: --http/--tunnel stay exactly as unauthenticated as they are today unless this (or --api-key, or --sso-authorize-url+--sso-token-url) is passed (env: VOIDEN_PUBLISH_OAUTH)')
    .option('--api-key [key]', 'Require a static API key as a Bearer token on the MCP endpoint — independent of --oauth and needs none of its DCR/authorize/token machinery; can be combined with --oauth so either credential works. This flag is what turns the requirement on at all — VOIDEN_PUBLISH_API_KEY by itself, with no --api-key, does nothing (never silently requires auth just because that env var happens to be set from an earlier session). Pass --api-key with a value to set it explicitly (or set VOIDEN_PUBLISH_API_KEY instead, once --api-key is present, to avoid a literal value on the command line — visible to anything that can read this process\'s argv), or pass the flag alone to auto-generate one, persisted under ~/.voiden/mcp-api-keys.json and printed at startup')
    .option('--sso-authorize-url <url>', 'Delegate --oauth\'s login step to an external IdP\'s real authorization endpoint instead of auto-approving — requires --sso-token-url too. Passing both turns OAuth mode on by itself, no need to also pass --oauth (env: VOIDEN_PUBLISH_SSO_AUTHORIZE_URL)')
    .option('--sso-token-url <url>', 'The external IdP\'s token endpoint — required alongside --sso-authorize-url (env: VOIDEN_PUBLISH_SSO_TOKEN_URL)')
    .option('--sso-registration-url <url>', 'The external IdP\'s Dynamic Client Registration (RFC 7591) endpoint — required for --sso-authorize-url/--sso-token-url to work at all right now; an upstream that only supports one fixed, manually-created app (no DCR — this is how "Sign in with Google/GitHub" work) isn\'t supported yet, see the publish guide (env: VOIDEN_PUBLISH_SSO_REGISTRATION_URL)')
    .option('--sso-revocation-url <url>', 'Optional — the external IdP\'s token revocation endpoint, if it has one (env: VOIDEN_PUBLISH_SSO_REVOCATION_URL)')
    .option('--sso-client-id <id>', 'Not supported yet — a fixed, single pre-registered app (used when the IdP has no --sso-registration-url) needs a different bridging design. Exists only so passing this without --sso-registration-url fails with an explanatory error instead of silently doing nothing')
    .option('--sso-client-secret <secret>', 'See --sso-client-id — not supported yet for the same reason')
    .option('--no-scheduler', 'Disable periodic re-verification while the server stays up (on by default; env: VOIDEN_PUBLISH_SCHEDULER)')
    .option('--scheduler-interval-minutes <n>', 'How often the scheduler checks which verify items are due (env: VOIDEN_PUBLISH_SCHEDULER_INTERVAL_MINUTES, default 1). Each item is still only actually re-run when its own declared cadence (hourly/daily/weekly/monthly) says it\'s due — this just controls how often that check happens, not how often any given item is re-verified')
    .option('-e, --env <path>', 'Path to a .env or .voiden/env-*.yaml file to merge on top of process env')
    .option('--check', 'Print what would be served and exit, without starting a live server')
    .option('--print-config', 'Once the server is actually up, print a ready-to-paste mcpServers config entry for it (stdio: command/args; --http: the real listening or --tunnel URL) — for pasting into Claude Desktop/Claude Code/Cursor/etc.\'s own config, or into a Voiden .void file\'s mcp-connection block (env: VOIDEN_PUBLISH_PRINT_CONFIG)')
    .option('--no-restart', 'Disable automatic restart if the server crashes (on by default for a live server; env: VOIDEN_PUBLISH_RESTART). Never applies to --check.')
    .option('--verbose', 'Print plugin-load diagnostics — without this, a plugin (e.g. voiden-mcp-tool, the one that actually understands /tool blocks) that fails to load does so silently, and the server just serves 0 tools with no error, indistinguishable from a genuinely empty project (env: VOIDEN_PUBLISH_VERBOSE)')
}

export interface PublishOpts {
  http?: boolean
  port?: string
  host?: string
  dynamicTools?: boolean
  tunnel?: boolean
  publicUrl?: string
  oauth?: boolean
  apiKey?: string | boolean
  ssoAuthorizeUrl?: string
  ssoTokenUrl?: string
  ssoRegistrationUrl?: string
  ssoRevocationUrl?: string
  ssoClientId?: string
  ssoClientSecret?: string
  scheduler?: boolean
  schedulerIntervalMinutes?: string
  env?: string
  check?: boolean
  restart?: boolean
  printConfig?: boolean
  verbose?: boolean
}

// ─── Option resolution — CLI flag wins, then env var, then default ────────

function resolveString(cliValue: string | undefined, envVar: string, fallback: string): string {
  return cliValue ?? process.env[envVar] ?? fallback
}

function truthy(raw: string): boolean {
  return /^(1|true|yes|on)$/i.test(raw.trim())
}

function resolveBool(cliValue: boolean | undefined, envVar: string, fallback: boolean): boolean {
  if (cliValue !== undefined) return cliValue
  const raw = process.env[envVar]
  return raw !== undefined ? truthy(raw) : fallback
}

function isRunningInCi(): boolean {
  return Boolean(process.env.GITHUB_ACTIONS || process.env.GITLAB_CI || process.env.CI)
}

function excludeTools(decisions: ServeDecision[], badToolKeys: Set<string>, reason: (toolName: string) => string): ServeDecision[] {
  return decisions.map((d) => {
    if (!badToolKeys.has(d.tool.name)) return d
    return { ...d, served: false, excluded: true, excludedReasons: [...(d.excludedReasons ?? []), reason(d.tool.name)] }
  })
}

/**
 * Prints a ready-to-paste `{"mcpServers": {...}}` entry (--print-config) —
 * the exact shape Claude Desktop/Claude Code/Cursor/etc. read from their own
 * config files, and also what the voiden-mcp-client plugin's paste-importer
 * recognizes, so this can go straight into a Voiden .void file too. Always
 * on stderr, never stdout — stdout is the live MCP JSON-RPC channel in stdio
 * mode, and printing plain text into it would corrupt the protocol stream.
 */
function printMcpServerConfig(name: string, entry: Record<string, unknown>): void {
  console.error('')
  console.error('  Paste this into an MCP client config (or a Voiden .void file):')
  console.error('')
  const json = JSON.stringify({ mcpServers: { [name]: entry } }, null, 2)
  for (const line of json.split('\n')) console.error(`  ${line}`)
  console.error('')
}

/** stdio's config just reproduces this exact invocation — a stdio config is
 *  inherently tied to running on the same machine as the client reading it,
 *  so the resolved absolute project path is the portable-enough choice here
 *  (unlike a .void file's own cross-file references, which move between
 *  machines and need project-root-relative paths — see resolvePath()). Only
 *  the flags that change what's actually served/how are reproduced —
 *  --dynamic-tools/--env change served-surface identity; --scheduler/
 *  --no-restart/etc. are ops concerns, not part of "what would connecting
 *  via this config actually get you". */
function buildStdioConfigEntry(projectRoot: string, opts: { dynamicTools: boolean; env?: string }): Record<string, unknown> {
  const args = ['-y', '@voiden/mcp', projectRoot]
  if (opts.dynamicTools) args.push('--dynamic-tools')
  if (opts.env) args.push('--env', resolve(opts.env))
  return { command: 'npx', args }
}

function printCheckReport(decisions: ServeDecision[], projectRoot: string): void {
  console.log(`\n${decisions.length} /tool block(s) found in ${projectRoot}\n`)
  for (const d of decisions) {
    if (d.excluded) {
      console.log(`  [EXCLUDED] ${d.tool.name}`)
      for (const reason of d.excludedReasons ?? []) console.log(`      ${reason}`)
      continue
    }
    const label = d.served ? (d.descriptionNote ? `SERVED (${d.status!.state})` : 'SERVED') : 'WITHDRAWN'
    console.log(`  [${label}] ${d.tool.name} — ${d.status!.state}${d.status!.note ? `: ${d.status!.note}` : ''}`)
  }
  console.log()
}

const TOOL_CAPABILITY_PLUGIN = 'voiden-mcp-tool'

/**
 * planServedTools()/discoverTools() (see @voiden/runner's mcpToolCapability.ts)
 * silently return [] whenever no /tool-block capability provider is
 * registered — by design, so a disabled plugin doesn't throw. But that makes
 * "the plugin that understands /tool blocks never loaded" and "this project
 * genuinely has zero /tool blocks" produce the exact same output — 0 tools,
 * no error, nothing to tell them apart. Flagging the former loudly here
 * instead of leaving it indistinguishable from the latter (see the Render
 * "0 tool(s) served, no error" case this was written for).
 */
function warnIfToolCapabilityMissing(activePlugins: string[], verbose: boolean): void {
  if (activePlugins.includes(TOOL_CAPABILITY_PLUGIN)) return
  console.error(`  ✗  ${TOOL_CAPABILITY_PLUGIN} is not active — this is the plugin that understands /tool blocks, so 0 tools will be served no matter what the project actually contains.`)
  console.error(
    verbose
      ? '     See the [plugins] line above for why.'
      : '     Re-run with --verbose to see why (disabled, a missing bundled runner, or a load-time error).'
  )
}

/**
 * Unlike --check's printCheckReport(), a live server's startup log only ever
 * said "N tool(s) served" — a tool that WAS discovered but got excluded
 * (most commonly: a cross-file requestFilePath pointing at an absolute path
 * that only exists on the machine the .void file was authored on, so it
 * resolves to nothing once deployed anywhere else — see resolvePath() in
 * the voiden-mcp-tool plugin) was silently dropped with no trace, making it
 * indistinguishable from a project with no /tool blocks at all. Surfacing
 * the same exclusion info --check already had, on every start — this is
 * actionable, not noise, so it isn't gated behind --verbose.
 */
function logExcludedTools(decisions: ServeDecision[]): void {
  const excluded = decisions.filter((d) => d.excluded)
  if (excluded.length === 0) return
  console.error(`  ⚠  ${excluded.length} /tool block(s) discovered but excluded — not served:`)
  for (const d of excluded) {
    console.error(`     [${d.tool.name}] ${(d.excludedReasons ?? []).join(' ') || '(no reason recorded)'}`)
  }
}

/** Spawns a cloudflared quick tunnel around host:port. Peer binary, not
 *  bundled — see mcp-tool-block-spec.md Pending #7. Resolves with the
 *  process once the public URL has been printed, or rejects if cloudflared
 *  isn't on PATH or never produces a URL. */
function spawnTunnel(host: string, port: number, onUrl: (url: string) => void): Promise<ChildProcess> {
  return new Promise((resolvePromise, reject) => {
    const target = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`
    const child = spawn('cloudflared', ['tunnel', '--url', target], { stdio: ['ignore', 'pipe', 'pipe'] })

    let settled = false
    const urlPattern = /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/

    const onData = (chunk: Buffer) => {
      const match = urlPattern.exec(chunk.toString())
      if (match && !settled) {
        settled = true
        onUrl(match[0])
        resolvePromise(child)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      if (err.code === 'ENOENT') {
        reject(new Error('cloudflared not found on PATH — install it first (e.g. `brew install cloudflared`, or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then re-run with --tunnel.'))
      } else {
        reject(err)
      }
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        reject(new Error(`cloudflared exited (code ${code}) before printing a public URL`))
      }
    })

    setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        reject(new Error('cloudflared did not produce a public URL within 15s'))
      }
    }, 15_000).unref()
  })
}

// ─── Crash recovery ─────────────────────────────────────────────────────────
//
// runPublish() deliberately does NOT try to recover in-process from a real
// crash (see its own uncaughtException handling below — it logs and exits,
// on purpose, rather than attempting to limp on in a possibly-corrupted
// state). Something still has to bring the server back, though — that's
// what this does: a small supervisor that spawns runPublish in a CHILD
// process and restarts it if it exits unexpectedly.

const VOIDEN_MCP_SUPERVISED_ENV = 'VOIDEN_MCP_SUPERVISED'
const MAX_RESTARTS_PER_WINDOW = 10
const RESTART_WINDOW_MS = 60_000
const RESTART_DELAY_MS = 1000

/** false for: `--check` (a one-shot diagnostic, not a server — nothing to
 *  restart), an already-supervised child (never supervise a supervisor),
 *  or `--no-restart`/`VOIDEN_PUBLISH_RESTART=false`. True otherwise —
 *  restart-on-crash is the default for a live server, matching --scheduler's
 *  own on-by-default convention. */
export function shouldSupervise(rawOpts: PublishOpts): boolean {
  if (rawOpts.check) return false
  if (process.env[VOIDEN_MCP_SUPERVISED_ENV] === '1') return false
  return rawOpts.restart === false ? false : resolveBool(undefined, 'VOIDEN_PUBLISH_RESTART', true)
}

/**
 * Spawns `node <scriptPath> <scriptArgs>` as a child with the exact same
 * argv this process was invoked with, `stdio: 'inherit'` (load-bearing for
 * stdio-mode MCP JSON-RPC — it has to reach whatever spawned THIS process
 * transparently, through the supervisor, unmodified), and
 * VOIDEN_MCP_SUPERVISED=1 so the child knows not to supervise itself.
 *
 * Restart policy, keyed off the child's own exit code/signal:
 *   - Killed by a signal WE sent (graceful SIGTERM/SIGINT forwarded from
 *     this process) → exit matching that, no restart.
 *   - Exit 0 → clean exit on its own; respected as-is, no restart (a live
 *     server shouldn't normally do this, but if it does, restarting an
 *     intentional clean exit would be wrong).
 *   - Exit 2 → a config/usage problem (bad --env path, --mode dynamic,
 *     --tunnel+stdio, --strict abort, etc.) — retrying won't fix a flag
 *     that's wrong on every attempt. Not restarted.
 *   - Killed by a signal we did NOT send, or exit 1 (runPublish's own
 *     uncaughtException path) → a genuine crash. Restarted, with a short
 *     delay and a rolling-window cap (MAX_RESTARTS_PER_WINDOW within
 *     RESTART_WINDOW_MS) so a persistently-broken server (bad dependency,
 *     crash-on-every-request bug) doesn't spin forever — it gets that many
 *     honest attempts, then gives up loudly instead of hammering silently.
 */
export function runSupervisor(scriptPath: string, scriptArgs: string[]): void {
  let restartTimestamps: number[] = []
  let shuttingDown = false
  let child: ReturnType<typeof spawn> | undefined

  const spawnChild = () => {
    child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      stdio: 'inherit',
      env: { ...process.env, [VOIDEN_MCP_SUPERVISED_ENV]: '1' },
    })

    child.on('exit', (code, signal) => {
      if (shuttingDown) {
        process.exit(code ?? 0)
        return
      }
      if (signal) {
        console.error(`  ⚠  Server killed by signal ${signal} — restarting...`)
      } else if (code === 0) {
        process.exit(0)
        return
      } else if (code === 2) {
        console.error('  ✗  Server exited with a configuration error (code 2) — not restarting; fix the underlying issue and re-run.')
        process.exit(2)
        return
      } else if (code === 3) {
        // A deliberate, healthy restart (stdio's scheduler detected a
        // verification change and needs a fresh process to serve the
        // updated tool list — see runPublish's scheduler block) — not a
        // crash, so a distinct message and no crash-loop-budget cost.
        console.error('  ↻  Restarting for a verification change — reconnect to pick up the updated tool list.')
        spawnChild()
        return
      }

      const now = Date.now()
      restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
      restartTimestamps.push(now)
      if (restartTimestamps.length > MAX_RESTARTS_PER_WINDOW) {
        console.error(`  ✗  Crashed ${MAX_RESTARTS_PER_WINDOW} times within ${RESTART_WINDOW_MS / 1000}s — giving up, not restarting again. Check the crash logs above.`)
        process.exit(1)
      }
      console.error(`  ⚠  Server exited unexpectedly (code ${code ?? 'null'}) — restarting in ${RESTART_DELAY_MS}ms... (${restartTimestamps.length}/${MAX_RESTARTS_PER_WINDOW} restarts in this window)`)
      setTimeout(spawnChild, RESTART_DELAY_MS)
    })
  }

  const forwardSignal = (sig: NodeJS.Signals) => {
    shuttingDown = true
    if (child && !child.killed) child.kill(sig)
  }
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))
  process.on('SIGINT', () => forwardSignal('SIGINT'))

  spawnChild()
}

/**
 * Discovers, verifies, and serves — the whole lifecycle. Owns the process:
 * sets up its own SIGTERM/SIGINT/uncaughtException handling and calls
 * process.exit() directly (--check and error paths), same as any CLI
 * command's main entrypoint would. Only this package's own bin (src/index.ts)
 * calls this — nothing else duplicates or wraps it. Called either directly
 * (supervision disabled/inapplicable) or as the child runSupervisor() spawns.
 */
export async function runPublish(projectRoot: string, rawOpts: PublishOpts): Promise<void> {
  // No subcommand, no verb — `voiden-mcp <path>` takes the project path
  // directly as its only positional argument (see this file's own header
  // comment). A word typed where a verb might be expected (e.g. `voiden-mcp
  // publish .` — there's no `publish` subcommand, that "publish" silently
  // becomes `path` instead, and the trailing "." is just dropped) used to
  // resolve to a nonexistent directory and report "0 /tool block(s) found"
  // with no error at all — indistinguishable from a real, legitimately
  // empty project. Failing loudly here instead.
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    console.error(`  ✗  Not a directory: ${projectRoot}`)
    console.error('     voiden-mcp has no subcommands — the only argument it takes is the project path, e.g. `voiden-mcp .` or `voiden-mcp ./api --http`.')
    process.exit(2)
  }

  const isHttp = Boolean(rawOpts.http)
  const port = Number(resolveString(rawOpts.port, 'VOIDEN_PUBLISH_PORT', '3000'))
  const host = resolveString(rawOpts.host, 'VOIDEN_PUBLISH_HOST', '127.0.0.1')
  const mode: 'static' | 'dynamic' = resolveBool(rawOpts.dynamicTools, 'VOIDEN_PUBLISH_DYNAMIC_TOOLS', false) ? 'dynamic' : 'static'
  const tunnel = resolveBool(rawOpts.tunnel, 'VOIDEN_PUBLISH_TUNNEL', false)
  const publicUrl = resolveString(rawOpts.publicUrl, 'VOIDEN_PUBLISH_PUBLIC_URL', '') || undefined

  const ssoAuthorizeUrl = resolveString(rawOpts.ssoAuthorizeUrl, 'VOIDEN_PUBLISH_SSO_AUTHORIZE_URL', '') || undefined
  const ssoTokenUrl = resolveString(rawOpts.ssoTokenUrl, 'VOIDEN_PUBLISH_SSO_TOKEN_URL', '') || undefined
  const ssoRegistrationUrl = resolveString(rawOpts.ssoRegistrationUrl, 'VOIDEN_PUBLISH_SSO_REGISTRATION_URL', '') || undefined
  const ssoRevocationUrl = resolveString(rawOpts.ssoRevocationUrl, 'VOIDEN_PUBLISH_SSO_REVOCATION_URL', '') || undefined
  if (Boolean(ssoAuthorizeUrl) !== Boolean(ssoTokenUrl)) {
    console.error('  ✗  --sso-authorize-url and --sso-token-url must be given together.')
    process.exit(2)
  }
  if ((rawOpts.ssoClientId || rawOpts.ssoClientSecret) && !ssoRegistrationUrl) {
    console.error('  ✗  --sso-client-id/--sso-client-secret (a single fixed pre-registered app, no upstream Dynamic Client Registration) isn\'t supported yet — that needs a different bridging design. Pass --sso-registration-url instead if your IdP supports RFC 7591 DCR, see docs/mcp-tool-publish-guide.md.')
    process.exit(2)
  }
  const ssoEnabled = Boolean(ssoAuthorizeUrl && ssoTokenUrl)
  if (ssoEnabled && !ssoRegistrationUrl) {
    console.error('  ✗  --sso-authorize-url/--sso-token-url also need --sso-registration-url — without it there\'s no way for an MCP client to register itself, since that upstream Dynamic Client Registration support isn\'t optional in this build. See docs/mcp-tool-publish-guide.md.')
    process.exit(2)
  }

  // --sso-* alone (no --oauth) is enough to turn OAuth mode on — passing
  // both is harmless/redundant, never an error.
  const oauth = resolveBool(rawOpts.oauth, 'VOIDEN_PUBLISH_OAUTH', false) || ssoEnabled

  // API key mode is only ever turned ON by the --api-key flag itself
  // (bare or with a value) — never by VOIDEN_PUBLISH_API_KEY alone. That
  // env var only supplies the VALUE once the flag has already enabled the
  // mode; letting it also enable the mode by itself meant a plain `--http`
  // run (no flags at all) would silently require auth if the env var
  // happened to still be exported from an earlier `--api-key` session —
  // exactly the "server asked for sign-in" surprise this now prevents.
  const apiKeyRaw = rawOpts.apiKey
  const apiKeyEnabled = apiKeyRaw !== undefined
  const apiKeyExplicitValue = typeof apiKeyRaw === 'string' ? apiKeyRaw : process.env.VOIDEN_PUBLISH_API_KEY
  const apiKey = apiKeyEnabled
    ? (apiKeyExplicitValue ?? getOrCreateProjectApiKey(resolve(projectRoot)))
    : undefined
  if (typeof apiKeyRaw === 'string') {
    console.error('  ⚠  --api-key was given a literal value on the command line — visible to anything that can read this process\'s argv (e.g. `ps`). VOIDEN_PUBLISH_API_KEY avoids that.')
  }
  // --no-scheduler bakes opts.scheduler to false when passed; commander has
  // no way to tell "default true" apart from "explicitly passed --scheduler"
  // here, so the env var can only turn scheduling off, never force it back
  // on over an explicit --no-scheduler. Documented limitation, not a bug.
  const scheduler = rawOpts.scheduler === false ? false : resolveBool(undefined, 'VOIDEN_PUBLISH_SCHEDULER', true)
  // How often the scheduler CHECKS what's due — not how often any given
  // verify item is actually re-run (that's its own declared cadence,
  // respected per-entry via the entryCache below). A fine default (1
  // minute) is cheap: most ticks find nothing due and do no network I/O at
  // all, they just compare timestamps.
  const schedulerCheckIntervalMinutes = Number(rawOpts.schedulerIntervalMinutes ?? process.env.VOIDEN_PUBLISH_SCHEDULER_INTERVAL_MINUTES ?? '1')
  const printConfig = resolveBool(rawOpts.printConfig, 'VOIDEN_PUBLISH_PRINT_CONFIG', false)
  const verbose = resolveBool(rawOpts.verbose, 'VOIDEN_PUBLISH_VERBOSE', false)
  const serverConfigName = basename(projectRoot)

  const baseEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
  )
  if (rawOpts.env) {
    const envPath = resolve(rawOpts.env)
    if (!existsSync(envPath)) {
      console.error(`  ✗  Env file not found: ${envPath}`)
      process.exit(2)
    }
    Object.assign(baseEnv, loadEnvFile(envPath))
  }

  const activePlugins = await loadEnabledPlugins(verbose)
  warnIfToolCapabilityMissing(activePlugins, verbose)
  // Persists for the life of the process — reused (not recreated) on every
  // scheduler tick below, so a verify entry's cadence is measured from when
  // IT last actually ran, not from server startup. Populated by this very
  // first call too, so the initial verification and the scheduler's first
  // due-check agree on when everything was last checked.
  const entryCache: VerifyEntryCache = new Map()
  let decisions = await planServedTools(projectRoot, baseEnv, activePlugins, { entryCache, now: Date.now() })
  let lastVerifiedAt = new Date()

  if (rawOpts.check) {
    printCheckReport(decisions, projectRoot)
    const anyFailing = decisions.some((d) => d.excluded || d.status?.state === 'failing')
    process.exit(anyFailing ? 1 : 0)
  }

  if (isRunningInCi() && isHttp && !tunnel && (host === '127.0.0.1' || host === 'localhost')) {
    console.error("  ⚠  Running inside a CI job with no --tunnel — this port won't be reachable from outside this job. Pass --tunnel for a public URL for this job's lifetime, or deploy to a persistent host for an always-on server.")
  }

  const runtimeVars: Record<string, any> = {}
  const commitSha = getCommitSha(projectRoot)

  let httpServer: HttpServer | undefined
  let tunnelProcess: ChildProcess | undefined
  let stdioServer: McpServer | undefined
  let schedulerHandle: NodeJS.Timeout | undefined
  let shuttingDown = false

  const shutdown = async (code: number) => {
    if (shuttingDown) return
    shuttingDown = true
    console.error('  Shutting down…')
    if (schedulerHandle) clearInterval(schedulerHandle)
    if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill()
    if (stdioServer) await stdioServer.close().catch(() => {})
    if (httpServer) {
      await new Promise<void>((res) => {
        httpServer!.close(() => res())
        setTimeout(res, 5000).unref()
      })
    }
    process.exit(code)
  }
  process.on('SIGTERM', () => void shutdown(0))
  process.on('SIGINT', () => void shutdown(0))
  process.on('uncaughtException', (err) => {
    console.error('  ✗  Uncaught exception:', err)
    void shutdown(1)
  })

  // Shared by both the plain (--oauth off) and OAuth-gated HTTP paths below —
  // identical to the pre-OAuth handler, just factored out so it isn't
  // duplicated. Typed against the base node:http request/response so it's
  // equally valid as a raw http.createServer callback or an Express handler
  // (Express's Request/Response are subclasses of these).
  const handleMcpRequest = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Fresh McpServer + transport per request — reusing one transport
      // across requests returns 500s (matches the SDK's own stateless
      // example). Cheap: registration reads the current `decisions`
      // closure value, so a scheduler tick updating it takes effect on
      // the very next request with no hot-swap machinery needed.
      const requestServer = new McpServer({ name: 'voiden-mcp', version: '0.1.0' })
      registerToolsFromDecisions(requestServer, decisions, baseEnv, runtimeVars, activePlugins, commitSha, projectRoot, mode)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await requestServer.connect(transport)
      res.on('close', () => {
        transport.close()
        requestServer.close()
      })
      await transport.handleRequest(req, res)
    } catch (err: any) {
      console.error(`  ✗  Error handling MCP request: ${err?.message ?? String(err)}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({
          jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null,
        }))
      }
    }
  }

  const healthPayload = () => {
    const served = decisions.filter((d) => d.served).length
    const withdrawn = decisions.length - served
    return { status: 'ok', served, withdrawn, uptimeSeconds: Math.round(process.uptime()), lastVerifiedAt: lastVerifiedAt.toISOString() }
  }

  // Set once --tunnel resolves its public URL (after listen(), see below) —
  // only assigned when --oauth is on, so the OAuth issuer/resource metadata
  // can be re-pointed at the real public HTTPS URL instead of the loopback
  // address it briefly advertises right after startup.
  let onTunnelResolved: ((url: string) => void) | undefined

  const useAuth = oauth || apiKeyEnabled

  if (isHttp) {
    if (oauth && !publicUrl && !tunnel && host !== '127.0.0.1' && host !== 'localhost') {
      // The OAuth spec (RFC 8414) requires an HTTPS issuer unless it's
      // loopback — the SDK enforces this itself and would otherwise throw
      // an unhelpful error the moment a client hit any OAuth endpoint.
      console.error('  ✗  --oauth needs an HTTPS or loopback issuer URL — re-run with --tunnel for a public HTTPS URL, pass --public-url if something else (a manual port forward, a reverse proxy) already gives you one, or drop --host so binding stays on 127.0.0.1.')
      process.exit(2)
    }

    if (useAuth) {
      // A fixed-length digest sidesteps timingSafeEqual's requirement that
      // both buffers be the same length (which would otherwise throw, or
      // leak the expected key's length via an early bailout, for any
      // mismatched-length guess).
      const safeCompare = (a: string, b: string): boolean =>
        timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

      let provider: OAuthServerProvider | undefined
      // --public-url wins when given — it's the whole point of the flag
      // (an externally-reachable URL this process has no other way to
      // know about, e.g. a manual port forward). Falls back to the
      // loopback-derived guess otherwise, same as before --public-url
      // existed; --tunnel overrides this again once it resolves, below.
      let issuerUrl = publicUrl ? new URL(publicUrl) : new URL(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)
      const mcpResourceUrl = (issuer: URL) => new URL('/mcp', issuer)
      let authRouter: ReturnType<typeof mcpAuthRouter> | undefined

      if (oauth) {
        provider = ssoEnabled
          ? new VoidenSsoOAuthProvider({
              authorizationUrl: ssoAuthorizeUrl!,
              tokenUrl: ssoTokenUrl!,
              registrationUrl: ssoRegistrationUrl!,
              revocationUrl: ssoRevocationUrl,
            } satisfies SsoEndpoints)
          : new VoidenOAuthProvider()
        const buildAuthRouter = (issuer: URL) =>
          mcpAuthRouter({ provider: provider!, issuerUrl: issuer, resourceServerUrl: mcpResourceUrl(issuer), scopesSupported: ['mcp'] })
        try {
          authRouter = buildAuthRouter(issuerUrl)
        } catch (err: any) {
          console.error(`  ✗  --public-url "${publicUrl}" isn't usable as an OAuth issuer: ${err?.message ?? String(err)}`)
          console.error('     It needs to be the real, externally-reachable HTTPS URL clients use to reach this server (or exactly http://127.0.0.1:<port>/http://localhost:<port>).')
          process.exit(2)
        }

        onTunnelResolved = (url: string) => {
          issuerUrl = new URL(url)
          authRouter = buildAuthRouter(issuerUrl)
          bearerAuth = requireBearerAuth({ verifier: combinedVerifier, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpResourceUrl(issuerUrl)) })
        }
      }

      // Accepts EITHER a valid static API key OR (when --oauth is also on)
      // a valid OAuth-issued token — whichever auth mode(s) are enabled.
      const combinedVerifier: OAuthTokenVerifier = {
        verifyAccessToken: async (token: string): Promise<AuthInfo> => {
          if (apiKey && safeCompare(token, apiKey)) {
            // requireBearerAuth requires a numeric expiresAt (throws "Token
            // has no expiration time" otherwise) — a static key doesn't
            // conceptually expire, so this is just a far-future placeholder,
            // not a real TTL.
            return { token, clientId: 'api-key', scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10 }
          }
          if (provider) return provider.verifyAccessToken(token)
          throw new InvalidTokenError('Access token not recognized')
        },
      }

      let bearerAuth = requireBearerAuth({
        verifier: combinedVerifier,
        resourceMetadataUrl: oauth ? getOAuthProtectedResourceMetadataUrl(mcpResourceUrl(issuerUrl)) : undefined,
      })

      const app = express()
      // Delegates to whatever `authRouter` currently points at — mounted
      // ahead of the health check and the bearer-gated MCP handler so OAuth
      // paths (.well-known/*, /register, /authorize, /token, /revoke)
      // always take priority, with no re-ordering needed when --tunnel
      // swaps `authRouter` to the real public issuer above. Skipped
      // entirely when --oauth is off (--api-key alone needs none of this
      // machinery — just the bearer check below).
      if (authRouter) {
        const router = authRouter
        app.use((req, res, next) => { router(req, res, next) })
      } else {
        // --api-key alone, no --oauth: no OAuth endpoints exist at all, so
        // an OAuth-aware client checking "does this server publish OAuth
        // metadata?" should get a clean 404 here — not a 401 from the
        // bearer gate below, which would misleadingly suggest OAuth is
        // the way in when the actual mechanism is a plain static key.
        app.use('/.well-known', (_req, res) => { res.status(404).json({ error: 'not_found' }) })
      }
      app.get('/health', (_req, res) => { res.status(200).json(healthPayload()) })
      app.use((req, res, next) => { bearerAuth(req, res, next) }, handleMcpRequest)

      httpServer = app.listen(port, host)
      await new Promise<void>((res, reject) => {
        httpServer!.once('listening', () => res())
        httpServer!.once('error', reject)
      })
    } else {
      httpServer = createHttpServer(async (req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(healthPayload()))
          return
        }
        // Without --oauth/--api-key, this server publishes no OAuth
        // metadata at all — but with no routing here beyond /health,
        // every other path (including these) fell straight into the raw
        // MCP JSON-RPC handler below, which rejects anything lacking the
        // right Accept header with a confusing 406, not a clean 404. An
        // OAuth-aware client checking "does this server require auth?"
        // before even looking at how it's configured sees that ambiguous
        // non-404 and can reasonably conclude "might need auth after
        // all" — a real false positive, not just an unhelpful response.
        // A plain 404 here is the unambiguous "no such thing, don't
        // expect OAuth from me" signal that check is actually looking for.
        if (req.url?.startsWith('/.well-known/')) {
          res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not_found' }))
          return
        }
        await handleMcpRequest(req, res)
      })
      await new Promise<void>((res) => httpServer!.listen(port, host, res))
    }

    const served = decisions.filter((d) => d.served).length
    console.error(`  ✓  voiden-mcp — listening on http://${host}:${port}/mcp`)
    // "served" counts /tool blocks, not the actual MCP tool count exposed —
    // those match 1:1 in static mode, but in dynamic mode the surface is
    // always exactly search_tools+call_tool regardless of this number, so
    // say so explicitly rather than leaving "N tool(s) served" looking like
    // it disagrees with what a client actually sees on the tool list.
    console.error(
      mode === 'dynamic'
        ? `     ${served} tool(s) served via search_tools/call_tool (--dynamic-tools)`
        : `     ${served} tool(s) served`
    )
    logExcludedTools(decisions)
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.error(`  ⚠  Bound to ${host} — reachable beyond this machine. Make sure that's intended.`)
    }
    if (oauth) {
      console.error(
        ssoEnabled
          ? `  🔒 OAuth enabled, delegated to ${ssoAuthorizeUrl} — clients complete a real login there before the MCP endpoint responds. /health stays open.`
          : '  🔒 OAuth enabled — clients must complete Dynamic Client Registration + authorization before the MCP endpoint responds. /health stays open.'
      )
    }
    if (apiKeyEnabled) {
      console.error(`  🔑 API key required — pass "Authorization: Bearer ${apiKey}" (also works alongside OAuth above, if both are on)`)
    }
    if (!useAuth && tunnel) {
      console.error('  ⚠  --tunnel with no --oauth/--api-key — this MCP server is public with zero authentication. Anyone with the URL has full tool access.')
    }

    if (printConfig && !tunnel) {
      if (publicUrl) {
        printMcpServerConfig(serverConfigName, { url: new URL('/mcp', publicUrl).toString() })
      } else {
        // 0.0.0.0 means "every interface on this machine," not an address a
        // remote client could actually connect to — there's no way to know
        // this process's real public host/IP from in here, so say so plainly
        // instead of printing something that looks valid but silently isn't.
        const connectHost = host === '0.0.0.0' ? '<this-machine-s-public-host-or-ip>' : host
        if (host === '0.0.0.0') {
          console.error("  ⚠  Bound to 0.0.0.0 — replace the placeholder below with this machine's actual reachable address.")
        }
        printMcpServerConfig(serverConfigName, { url: `http://${connectHost}:${port}/mcp` })
      }
    }

    if (tunnel) {
      try {
        tunnelProcess = await spawnTunnel(host, port, (url) => {
          console.error(`  ✓  Public URL: ${url}`)
          onTunnelResolved?.(url)
          if (printConfig) printMcpServerConfig(serverConfigName, { url: `${url}/mcp` })
        })
      } catch (err: any) {
        console.error(`  ✗  --tunnel failed: ${err.message}`)
        await shutdown(1)
        return
      }
    }
  } else {
    if (tunnel) {
      console.error('  ✗  --tunnel only applies to --http — stdio has no port to tunnel.')
      process.exit(2)
    }
    stdioServer = new McpServer({ name: 'voiden-mcp', version: '0.1.0' })
    registerToolsFromDecisions(stdioServer, decisions, baseEnv, runtimeVars, activePlugins, commitSha, projectRoot, mode)
    await stdioServer.connect(new StdioServerTransport())
    logExcludedTools(decisions)
    if (printConfig) {
      printMcpServerConfig(serverConfigName, buildStdioConfigEntry(projectRoot, { dynamicTools: mode === 'dynamic', env: rawOpts.env }))
    }
  }

  if (scheduler) {
    const isSupervisedChild = process.env.VOIDEN_MCP_SUPERVISED === '1'

    if (!isHttp && !isSupervisedChild) {
      // --no-restart (or some other reason shouldSupervise() said no) means
      // nothing is watching this process to bring it back — exiting on a
      // verification change here would just kill the server with nothing
      // replacing it, worse than today's "stale but alive" behavior. Stay
      // with the old, honest limitation in that case.
      console.error('  ⚠  --scheduler currently only re-registers tools for --http (a fresh server is built per request there). Over stdio, verification still only runs once at startup — restart to pick up changes. (Automatic restart-on-change needs the supervisor, which --no-restart just disabled.)')
    } else {
      console.error(`  ↻  Scheduler: checking every ${schedulerCheckIntervalMinutes} minute(s) which verify items are due — each is only actually re-run on its own declared cadence`)

      // Keyed by tool name, not just a served count — two tools swapping
      // states (one recovers as another breaks) would leave the COUNT
      // unchanged while still being a real, individually-meaningful change;
      // a plain count comparison would silently miss exactly that.
      let lastServedState = new Map(decisions.filter((d) => !d.excluded).map((d) => [d.tool.name, d.served]))

      // Each verify entry is re-run independently, according to its own
      // cadence (via entryCache — see planServedTools()'s doc comment) —
      // NOT one shared interval for the whole server. This tick just asks
      // "what's due right now"; most ticks find nothing due and cost one
      // Map lookup per entry, no network I/O — only logged/acted on when a
      // tool's served state actually changes, so a healthy server doesn't
      // spam a log line every tick for entries that were never due.
      schedulerHandle = setInterval(async () => {
        try {
          decisions = await planServedTools(projectRoot, baseEnv, activePlugins, { entryCache, now: Date.now() })
          lastVerifiedAt = new Date()

          const newServedState = new Map(decisions.filter((d) => !d.excluded).map((d) => [d.tool.name, d.served]))
          const changes: string[] = []
          for (const [name, served] of newServedState) {
            const was = lastServedState.get(name)
            if (was !== undefined && was !== served) changes.push(`${name}: ${was ? 'served' : 'withdrawn'} → ${served ? 'served' : 'withdrawn'}`)
          }

          if (changes.length > 0) {
            console.error(`  ↻  Re-verified — ${changes.join(', ')}`)
            lastServedState = newServedState
            if (!isHttp) {
              // stdio can't hot-swap an already-connected McpServer's
              // registered tools — restarting (via the supervisor already
              // watching this process, guaranteed by the isSupervisedChild
              // check above) is the only way an updated tool list ever
              // reaches a reconnecting client. Real trade-off: this
              // disconnects whoever's currently connected, same as any
              // process restart would.
              console.error('  ↻  Restarting to refresh the stdio connection with the updated tool list...')
              await shutdown(3)
            }
          }
        } catch (err: any) {
          console.error(`  ⚠  Scheduled re-verification failed: ${err?.message ?? String(err)}`)
        }
      }, schedulerCheckIntervalMinutes * 60_000)
      schedulerHandle.unref()
    }
  }
}
