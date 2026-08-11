#!/usr/bin/env node
/**
 * @voiden/mcp-server — exposes the .void runner as MCP tools for an AI agent.
 *
 * Runs as an ordinary local stdio process, started by the MCP host (Claude
 * Code, Claude Desktop, etc.) for the duration of a session. It has nothing
 * to do with the Voiden desktop app — it calls the same @voiden/runner
 * engine the CLI and the app's "Run" button use, just returned as structured
 * data instead of console text or a JSON file.
 *
 * Project root: first CLI arg, or VOIDEN_PROJECT_ROOT, or the working
 * directory the host launched this process from.
 *
 * Execution safety: run_request makes a real HTTP/GraphQL/etc. call, and
 * write_result modifies a file on disk with no locking. This server does no
 * extra gating beyond describing that in each tool's description — the MCP
 * host's per-call approval prompt is the intended safety boundary.
 *
 * Thin wrapper only — all tool-building (the 4 fixed tools plus /tool
 * discovery/validation/verification/registration) lives in
 * @voiden/runner's mcpServing.ts, shared with `voiden-runner mcp serve`
 * (stdio + HTTP, for CLI-only users with no Voiden app installed) so neither
 * duplicates the other's registration logic.
 */

import { resolve } from 'path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer, planServedTools, loadEnabledPlugins } from '@voiden/runner'

const projectRoot = resolve(process.argv[2] ?? process.env.VOIDEN_PROJECT_ROOT ?? process.cwd())
const isCheckMode = process.argv.includes('--check')

// The MCP-server-process equivalent of "the project's environment" — an MCP
// host (Claude Code/Codex) already lets a user set env vars for this server
// process via .mcp.json's `env` block, which is the standard place secrets
// for a tool param's source:'environment' belong. Same filter the CLI's
// `run` command already uses for its own process-env base.
const baseEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
)

if (isCheckMode) {
  // Dry run: no live server, just report what --check would decide and exit.
  // The only way to meaningfully test this feature without an actual agent
  // session connected — also doubles as a real CI-usable dry-run for users.
  const activePlugins = await loadEnabledPlugins()
  const decisions = await planServedTools(projectRoot, baseEnv, activePlugins)
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
  const anyFailing = decisions.some((d) => d.excluded || d.status?.state === 'failing')
  process.exit(anyFailing ? 1 : 0)
}

const { server } = await buildMcpServer({ projectRoot, env: baseEnv, serverName: 'voiden-mcp-server', serverVersion: '0.1.0' })

await server.connect(new StdioServerTransport())
