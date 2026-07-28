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
 */

import { readFileSync } from 'fs'
import { resolve, relative, isAbsolute } from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  runVoidFile,
  parseVoidFileSections,
  collectVoidFiles,
  getRequestPreview,
  upsertResponseBlock,
  type RunResult,
} from '@voiden/runner'

const projectRoot = resolve(process.argv[2] ?? process.env.VOIDEN_PROJECT_ROOT ?? process.cwd())

// ─── Per-session state (lives for the process lifetime — one MCP session) ────
// Shared across tool calls so {{process.xxx}} runtime variables chain the same
// way they do across files in a single CLI invocation.
const runtimeVars: Record<string, any> = {}
let cachedActivePlugins: string[] | undefined

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a tool-supplied path against the project root, refusing to escape it. */
function resolveInProject(filePath: string): string {
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(projectRoot, filePath)
  const rel = relative(projectRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`"${filePath}" resolves outside the project root (${projectRoot})`)
  }
  return resolved
}

/** Same flat KEY=VALUE .env format the CLI's --env flag accepts. */
function loadEnvFile(envPath: string): Record<string, string> {
  const content = readFileSync(envPath, 'utf-8')
  const env: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key) env[key] = val
  }
  return env
}

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function findRequestUid(blocks: any[]): string | undefined {
  return blocks.find(b => b?.type === 'request')?.attrs?.uid
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'voiden-mcp-server', version: '0.1.0' })

server.registerTool(
  'list_void_files',
  {
    title: 'List .void files',
    description: 'List every .void file in the current Voiden project, as paths relative to the project root.',
    inputSchema: {},
  },
  async () => {
    const files = await collectVoidFiles(projectRoot)
    return textResult(files.map(f => relative(projectRoot, f)))
  },
)

server.registerTool(
  'list_requests',
  {
    title: 'List requests in a .void file',
    description:
      'Parse a .void file and list its requests (one per section) — label, request uid, method, and URL — without executing anything.',
    inputSchema: {
      filePath: z.string().describe('Path to the .void file, relative to the project root (or absolute).'),
    },
  },
  async ({ filePath }) => {
    const resolved = resolveInProject(filePath)
    const content = readFileSync(resolved, 'utf-8')
    const sections = parseVoidFileSections(content)
    return textResult(
      sections.map(s => ({
        sectionLabel: s.label,
        requestUid: findRequestUid(s.blocks),
        ...getRequestPreview(s.blocks),
      })),
    )
  },
)

server.registerTool(
  'run_request',
  {
    title: 'Run a request',
    description:
      'Execute a request from a .void file — makes a real HTTP/GraphQL/etc. call using the project\'s plugins and env, exactly as the Voiden app\'s Run button or the voiden-runner CLI would. ' +
      'Omit sectionLabel to run every section in the file. Returns structured results (pass/fail, status, timing, headers, body).',
    inputSchema: {
      filePath: z.string().describe('Path to the .void file, relative to the project root (or absolute).'),
      sectionLabel: z.string().optional().describe('Run only the section with this request-separator label. Omit to run the whole file.'),
      envFile: z.string().optional().describe('Path to a KEY=VALUE .env file to merge on top of system env, relative to the project root.'),
      envVars: z.record(z.string()).optional().describe('Individual env var overrides, applied on top of envFile.'),
    },
  },
  async ({ filePath, sectionLabel, envFile, envVars }) => {
    const resolved = resolveInProject(filePath)
    const env = {
      ...(envFile ? loadEnvFile(resolveInProject(envFile)) : {}),
      ...(envVars ?? {}),
    }

    const result = await runVoidFile(resolved, {
      env,
      runtimeVars,
      sectionLabel,
      activePlugins: cachedActivePlugins,
    })
    cachedActivePlugins = result.activePlugins

    return textResult(result)
  },
)

server.registerTool(
  'write_result',
  {
    title: 'Write a result back into the .void file',
    description:
      'Record a request\'s execution result (as returned by run_request) into the .void file it came from, as a `response` block placed right after the matching request block. ' +
      'Replaces any previous response block for the same request. No file locking: if this file is open with unsaved edits in Voiden, the next manual save there can overwrite this, or this can overwrite those edits — avoid calling this on a file someone else may be actively editing.',
    inputSchema: {
      filePath: z.string().describe('Path to the .void file, relative to the project root (or absolute).'),
      requestUid: z.string().describe('The uid of the request block this result belongs to (from list_requests or run_request).'),
      result: z.record(z.any()).describe('The `result` object for this request from run_request\'s response (i.e. one entry of its `results[].result` array, not the whole run_request response).'),
    },
  },
  async ({ filePath, requestUid, result }) => {
    const resolved = resolveInProject(filePath)
    upsertResponseBlock(resolved, requestUid, result as RunResult)
    return textResult({ written: true, filePath, requestUid })
  },
)

await server.connect(new StdioServerTransport())
