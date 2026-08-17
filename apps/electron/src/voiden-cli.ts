#!/usr/bin/env node
/**
 * The `voiden` CLI's bundled command surface — `agent` and `run`, plus a
 * hidden `mcp-stdio` used internally by what `agent` registers. Built by
 * Forge's own VitePlugin (see forge.config.ts's `plugins` array +
 * vite.cli.config.ts) alongside main.ts/preload.ts, landing at
 * .vite/build/voiden-cli.js — inside app.asar, next to main.js, not as a
 * separate extraResource outside it (which couldn't safely resolve real npm
 * dependencies from its own node_modules at runtime). Only the two
 * workspace-symlinked packages this file imports (@voiden/runner,
 * indirectly @voiden/executors) get bundled into the output; everything
 * else (commander, @modelcontextprotocol/sdk, and @voiden/runner's own
 * dependencies) stays external, resolved from the packaged app's own
 * node_modules the same way main.js's dependencies already are — see
 * vite.base.config.ts's `workspacePackages`/`external`.
 *
 * Launched by apps/electron/bin/voiden (and bin/voiden.cmd) via
 * `ELECTRON_RUN_AS_NODE=1 <packaged Electron binary> <this file> <args>` —
 * the packaged app's own binary bundles Node, so no separate Node install is
 * required on the end user's machine. This requires the `runAsNode` fuse to
 * be enabled (forge.config.ts's FusesPlugin) — deliberately flipped on from
 * the hardened-secure default specifically for this, a real trade-off (see
 * that fuse's own comment). Every other invocation of `voiden` (no
 * recognized subcommand) keeps opening the GUI exactly as before; only
 * `agent`/`run`/`mcp-stdio` are intercepted before that happens.
 *
 * Three responsibilities, deliberately NOT four:
 *   - `agent [path]`    — registers this project with an agent editor
 *                          (Claude Code / Codex): writes .mcp.json /
 *                          config.toml. Pure registration, nothing else —
 *                          replaces the old standalone @voiden/mcp-host
 *                          package (retired).
 *   - `run <paths...>`  — runs .void files headlessly, using
 *                          @voiden/runner's own execution engine. The
 *                          lightweight, everyday version — full power-user
 *                          flags (CSV export, mail reports, session state,
 *                          etc.) stay exclusive to the standalone
 *                          @voiden/runner CLI, which remains a separately
 *                          installable package for CI use.
 *   - `mcp-stdio [path]` — HIDDEN, not a documented command. What `agent`
 *                          actually points .mcp.json's `command`/`args` at:
 *                          a stdio MCP server exposing just the 4 fixed
 *                          tools (list_void_files/list_requests/run_request/
 *                          write_result), via @voiden/runner's own
 *                          registerFixedTools(). Deliberately does NOT
 *                          discover/verify/serve /tool blocks — that's
 *                          @voiden/mcp's job alone, a separate, standalone,
 *                          independently-hostable package. `agent` never
 *                          points at @voiden/mcp; the two are unrelated
 *                          servers for two different purposes.
 */

import { resolve } from 'node:path'
import { program } from 'commander'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  installMcpIntegration,
  uninstallMcpIntegration,
  getMcpStatus,
  MCP_SKILL_MARKDOWN,
  type ServerCommand,
} from '@voiden/executors'
import {
  registerFixedTools,
  runVoidFile,
  resolveFiles,
  loadEnabledPlugins,
  loadEnvFile,
  printRequestResult,
  printRunSummary,
  type RunResult,
} from '@voiden/runner'

function resolveMcpTargets(opts: { claude?: boolean; codex?: boolean }): { claude: boolean; codex: boolean } {
  if (!opts.claude && !opts.codex) return { claude: true, codex: true }
  return { claude: Boolean(opts.claude), codex: Boolean(opts.codex) }
}

// ─── agent ───────────────────────────────────────────────────────────────

program
  .command('agent [path]')
  .description(
    'Register this project with an agent editor (Claude Code / Codex) — writes .mcp.json ' +
    '(and the Codex config.toml equivalent) pointing at this same `voiden` command, so the ' +
    "host sees the 4 fixed tools (list_void_files, list_requests, run_request, write_result). " +
    "Nothing to do with @voiden/mcp — that's a separate, standalone server for publishing " +
    "/tool blocks, not what an everyday agent-editor session talks to.\n\n" +
    '  Examples:\n' +
    '    voiden agent                        # register this directory, both hosts\n' +
    '    voiden agent ./api --claude          # Claude Code only\n' +
    '    voiden agent --remove                # undo registration\n'
  )
  .option('--claude', 'Claude Code only')
  .option('--codex', 'Codex only')
  .option('--remove', 'Remove the registration instead of adding it')
  .action((path: string | undefined, opts) => {
    const projectPath = resolve(path ?? '.')
    const targets = resolveMcpTargets(opts)

    if (opts.remove) {
      const removed = uninstallMcpIntegration(projectPath, targets)
      if (removed.length === 0) {
        console.log('  Nothing to remove.')
        return
      }
      for (const target of removed) {
        console.log(`  ✓  Removed ${target === 'claude' ? 'Claude Code' : 'Codex'} integration`)
      }
      return
    }

    // Points at THIS binary (voiden), not @voiden/mcp — mcp-stdio is the
    // hidden command below that actually serves the 4 fixed tools.
    const serverCommand: ServerCommand = { command: 'voiden', args: ['mcp-stdio', projectPath] }
    const installed = installMcpIntegration(projectPath, targets, MCP_SKILL_MARKDOWN, serverCommand)
    if (installed.length === 0) {
      console.log('  Nothing to install.')
      return
    }
    console.log()
    for (const target of installed) {
      console.log(`  ✓  ${target === 'claude' ? 'Claude Code' : 'Codex'}  —  registered for ${projectPath}`)
    }
    console.log()
    console.log('  Restart Claude Code / Codex (or run /mcp) to pick up the new server.')

    const status = getMcpStatus(projectPath)
    void status
  })

// ─── run ─────────────────────────────────────────────────────────────────

program
  .command('run <paths...>')
  .description(
    'Run .void files headlessly — accepts files, directories (recursive), or a mix.\n\n' +
    '  Examples:\n' +
    '    voiden run auth.void\n' +
    '    voiden run ./requests/\n' +
    '    voiden run ./ --env .env.staging --bail\n' +
    '    voiden run ./ --env .voiden/env-public.yaml --environment staging\n' +
    '    voiden run ./ --show-req --show-res\n\n' +
    '  For CSV export, mail reports, session state, and other power-user flags, use the ' +
    'standalone @voiden/runner package instead (voiden-runner run — same engine, more options).'
  )
  .option('-e, --env <path>', 'Path to a .env or .yaml file for variable substitution')
  .option('--environment <name>', 'Scope --env to one named environment in a multi-environment YAML file (e.g. "dev") instead of merging every environment in it together')
  .option('--show-req', 'Print sent request headers and body for each request')
  .option('--show-res', 'Print response headers and body for each request')
  .option('--bail', 'Stop immediately on the first failure and exit 1')
  .option('--json', 'Output results as JSON (suppresses normal output)')
  .action(async (paths: string[], opts: { env?: string; environment?: string; showReq?: boolean; showRes?: boolean; bail?: boolean; json?: boolean }) => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
    )
    if (opts.env) {
      const envPath = resolve(opts.env)
      try {
        Object.assign(env, loadEnvFile(envPath, opts.environment))
      } catch (err: any) {
        console.error(`  ✗  ${err.message}`)
        process.exit(2)
      }
    }

    const files = await resolveFiles(paths)
    if (files.length === 0) {
      console.error(`  ✗  No .void files found at: ${paths.join(', ')}`)
      process.exit(2)
    }

    const activePlugins = await loadEnabledPlugins()
    const runtimeVars: Record<string, any> = {}
    const summary: { file: string; label?: string; success: boolean; error?: string }[] = []
    // Collected up front (not printed inline) so printRequestResult's
    // "[i/n]" counter reflects the real total — matches how `voiden-runner
    // run` itself prints, same shared function, same output either CLI.
    const allResults: { file: string; result: RunResult }[] = []
    const runStart = Date.now()

    outer: for (const file of files) {
      const { results } = await runVoidFile(file, { env, runtimeVars, activePlugins })
      for (const { label, result } of results) {
        summary.push({ file, label, success: result.success, error: result.error })
        allResults.push({ file, result })
        if (!result.success && opts.bail) break outer
      }
    }

    const failed = summary.filter((s) => !s.success).length
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      allResults.forEach(({ file, result }, i) => {
        printRequestResult(result, file, i + 1, allResults.length, opts.showReq ?? false, opts.showRes ?? false, false)
      })
      printRunSummary(allResults, Date.now() - runStart)
    }
    process.exit(failed > 0 ? 1 : 0)
  })

// ─── mcp-stdio (hidden — not a public command, see header) ────────────────

program
  .command('mcp-stdio [path]', { hidden: true })
  .action(async (path: string | undefined) => {
    const projectRoot = resolve(path ?? process.env.VOIDEN_PROJECT_ROOT ?? '.')
    const activePlugins = await loadEnabledPlugins()
    const runtimeVars: Record<string, any> = {}
    const server = new McpServer({ name: 'voiden', version: '0.1.0' })
    registerFixedTools(server, projectRoot, runtimeVars, activePlugins)
    await server.connect(new StdioServerTransport())
  })

program.parseAsync(process.argv)
