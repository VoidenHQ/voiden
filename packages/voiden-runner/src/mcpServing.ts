/**
 * MCP serving — the shared, transport-agnostic core behind both
 * `@voiden/mcp` (stdio, published to npm, auto-registered with
 * Claude Code/Codex) and `voiden-runner mcp serve` (stdio or HTTP, CLI-only
 * users with no Voiden app installed). Neither duplicates the other's
 * tool-building logic — both call buildMcpServer() here and just pick a
 * transport to connect.
 *
 * Two things get registered on every server:
 *   1. registerFixedTools (below) — the 4 generic tools (list/run/write)
 *      every project gets, regardless of what it declares. Genuinely
 *      generic — references no /tool-block shape at all.
 *   2. Whatever the /tool-block-owning plugin (voiden-mcp-tool) registered
 *      via context.registerMcpToolCapabilityProvider() — discovery,
 *      structural validation (voiden-mcp-blocks-spec.md §1.6), verification
 *      (§1.4), and serving decisions all live in that plugin now, not here.
 *      See mcpToolCapability.ts for the registry + dispatchers.
 */

import { readFileSync } from 'fs'
import { relative, resolve, isAbsolute } from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runVoidFile, getRequestPreview, findRequestBlock, createLinkedBlockResolver } from './runner.js'
import { collectVoidFiles } from './discovery.js'
import { upsertResponseBlock } from './resultBlock.js'
import { loadEnabledPlugins } from './plugins/loader.js'
import { planServedTools, registerToolsFromDecisions, getCommitSha, type ServeDecision } from './mcpToolCapability.js'
import { parseVoidFile, groupBlocksIntoSections, resolveLinkedFiles, resolveLinkedBlocks } from '@voiden/executors'
import type { RunResult } from './types.js'
import { z } from 'zod'

// ─── Fixed tools (list_void_files, list_requests, run_request, write_result) ──

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function findRequestUid(blocks: any[]): string | undefined {
  return findRequestBlock(blocks)?.attrs?.uid
}

/** Resolve a tool-supplied path against the project root, refusing to escape it. */
function resolveInProject(projectRoot: string, filePath: string): string {
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

// Works around a pre-existing TS2589 ("Type instantiation is excessively
// deep and possibly infinite") in @modelcontextprotocol/sdk's own
// registerTool<OutputArgs, InputArgs> overload — its ZodRawShapeCompat type
// is built to structurally support both zod v3 and v4 input shapes
// simultaneously (this repo resolves our own zod imports to 3.25.x, but the
// SDK carries its own separate zod v4 copy internally for its own
// purposes), and that dual-compat type is what blows past TS's
// instantiation budget once enough registerTool calls stack up in one
// file — not anything about our own schemas or handlers. Purely a
// compile-time complexity ceiling: schemas still validate for real at
// runtime (confirmed via live stdio/HTTP tool calls). `any` here only
// narrows the problematic generic inference at the SDK boundary, not any
// actual type safety on our side — `name`/`config`/`handler` are exactly
// what a real `server.registerTool(...)` call already expects.
function registerTool(server: McpServer, name: string, config: any, handler: any): void {
  server.registerTool(name, config, handler)
}

/** Registers the 4 fixed tools every project gets, regardless of what it declares. */
export function registerFixedTools(
  server: McpServer,
  projectRoot: string,
  runtimeVars: Record<string, any>,
  activePlugins: string[],
): void {
  registerTool(
    server,
    'list_void_files',
    {
      title: 'List .void files',
      description: 'List every .void file in the current Voiden project, as paths relative to the project root.',
      inputSchema: {},
    },
    async () => {
      const files = await collectVoidFiles(projectRoot)
      return textResult(files.map((f) => relative(projectRoot, f)))
    },
  )

  registerTool(
    server,
    'list_requests',
    {
      title: 'List requests in a .void file',
      description: 'Parse a .void file and list its requests (one per section) — label, request uid, method, and URL — without executing anything.',
      inputSchema: {
        filePath: z.string().describe('Path to the .void file, relative to the project root (or absolute).'),
      },
    },
    async ({ filePath }: { filePath: string }) => {
      const resolved = resolveInProject(projectRoot, filePath)
      const content = readFileSync(resolved, 'utf-8')
      const resolver = createLinkedBlockResolver(projectRoot)
      let rawBlocks = parseVoidFile(content)
      rawBlocks = await resolveLinkedFiles(rawBlocks, resolver)
      rawBlocks = await resolveLinkedBlocks(rawBlocks, resolver)
      const sections = groupBlocksIntoSections(rawBlocks)
      return textResult(
        sections.map((s) => ({
          sectionLabel: s.label,
          requestUid: findRequestUid(s.blocks),
          ...getRequestPreview(s.blocks),
        })),
      )
    },
  )

  registerTool(
    server,
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
    async ({ filePath, sectionLabel, envFile, envVars }: { filePath: string; sectionLabel?: string; envFile?: string; envVars?: Record<string, string> }) => {
      const resolved = resolveInProject(projectRoot, filePath)
      const env = {
        ...(envFile ? loadEnvFile(resolveInProject(projectRoot, envFile)) : {}),
        ...(envVars ?? {}),
      }

      const result = await runVoidFile(resolved, { env, runtimeVars, sectionLabel, activePlugins, projectRoot })
      return textResult(result)
    },
  )

  registerTool(
    server,
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
    async ({ filePath, requestUid, result }: { filePath: string; requestUid: string; result: Record<string, any> }) => {
      const resolved = resolveInProject(projectRoot, filePath)
      upsertResponseBlock(resolved, requestUid, result as RunResult)
      return textResult({ written: true, filePath, requestUid })
    },
  )
}

// ─── Combined entry point ───────────────────────────────────────────────────

export interface BuildMcpServerOptions {
  projectRoot: string
  env: Record<string, string>
  /** Lets each caller brand its own server identity. */
  serverName?: string
  serverVersion?: string
}

/**
 * Builds a fully-registered McpServer — the 4 fixed tools plus whatever
 * /tool declarations pass verification — ready to `.connect(transport)`.
 * Transport-agnostic on purpose: the caller decides stdio vs HTTP.
 */
export async function buildMcpServer(opts: BuildMcpServerOptions): Promise<{ server: McpServer; decisions: ServeDecision[] }> {
  const activePlugins = await loadEnabledPlugins()
  const runtimeVars: Record<string, any> = {}
  const server = new McpServer({ name: opts.serverName ?? 'voiden-mcp', version: opts.serverVersion ?? '0.1.0' })

  registerFixedTools(server, opts.projectRoot, runtimeVars, activePlugins)
  const decisions = await planServedTools(opts.projectRoot, opts.env, activePlugins)
  registerToolsFromDecisions(server, decisions, opts.env, runtimeVars, activePlugins, getCommitSha(opts.projectRoot), opts.projectRoot)

  return { server, decisions }
}
