/**
 * MCP tool capability registry — the /tool-block equivalent of
 * requestContainerRegistry.ts's "core owns an empty registry + accessor;
 * a plugin populates it via context.registerXxx() in its own runner.ts
 * onload(); core never hardcodes knowledge of a block's shape."
 *
 * Everything that actually INTERPRETS the tool/toolparams/toolverifies
 * block's own semantics — what "unbound param" means, that role:
 * 'auth-check' gates other rows, that mode: 'none' skips a row, what
 * onFailure: 'advertise-degraded' does to a description — lives in
 * voiden-mcp-tool's own runner bundle, not here. This file only holds:
 *
 *   1. The stable *protocol* types (ToolState/ToolStatus/ServeDecision/etc.)
 *      — these describe a generic verified/unverified/failing, served/
 *      excluded shape, not the /tool block's own attrs, so they're
 *      legitimately core's public @voiden/runner contract.
 *   2. A single optional provider slot (there's only ever one plugin that
 *      owns the /tool capability, unlike registerToolProvider's providers[]
 *      array, where multiple protocol plugins each contribute request-
 *      container extraction).
 *   3. Thin dispatchers with the same names/signatures the old
 *      toolVerification.ts/toolStatusBlock.ts/mcpServing.ts exported
 *      directly — so @voiden/mcp (and anything else importing
 *      discoverTools/verifyTools/etc. from @voiden/runner) needs zero
 *      changes. They gracefully no-op when no provider is registered
 *      (e.g. voiden-mcp-tool disabled), matching how toolRegistry.ts's
 *      own extractTools() already returns [] with no providers.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDef } from './toolRegistry.js'

export type ToolState = 'verified' | 'unverified' | 'failing'

export interface ToolVerifyResult {
  entry: any
  passed: boolean
  reason?: 'auth-failure' | 'contract-failure'
  runResult?: any
}

export interface ToolStatus {
  tool: ToolDef
  state: ToolState
  results: ToolVerifyResult[]
  note?: string
}

export interface DiscoverToolsOptions {
  activePlugins?: string[]
}

export interface ToolValidationIssue {
  tool: ToolDef
  check: 'unbound-param' | 'unresolved-placeholder' | 'missing-section' | 'duplicate-name' | 'readonly-mutating'
  message: string
}

export interface VerifyToolsOptions {
  /** Only run verify entries whose `cadence` matches exactly. Omit to run every entry regardless of cadence. */
  cadence?: string
  env?: Record<string, string>
  runtimeVars?: Record<string, any>
  activePlugins?: string[]
  /** When provided, each tool's own source: environment params (with their
   *  own envProfile/envName) are resolved per-tool and merged over `env`
   *  before its verification requests run — so verification sees the same
   *  values a real call would. Omit to skip this and use `env` as-is. */
  projectRoot?: string
}

export interface ToolStatusRecord {
  state: ToolState
  lastCheckedAt: string
  note?: string
}

/** One verify entry's last-known result, cached across scheduler ticks so
 *  each entry can be re-verified on its own declared `cadence` instead of
 *  the whole server sharing one fixed interval. Keyed by
 *  `${tool.toolBlockUid}::${entryIndex}` — stable across re-discovery as
 *  long as verify rows aren't reordered/added/removed; if they are, a
 *  cache miss just means that one entry is treated as never-verified
 *  (immediately due), which is the correct, safe fallback either way. */
export interface VerifyEntryCacheRecord {
  passed: boolean
  reason?: 'auth-failure' | 'contract-failure'
  runResult?: any
  verifiedAt: number
}
export type VerifyEntryCache = Map<string, VerifyEntryCacheRecord>

export interface PlanServedToolsOptions {
  /** Reused across calls (the caller owns and persists it — typically the
   *  scheduler in @voiden/mcp) so each verify entry is only actually
   *  re-run when its own cadence says it's due; entries not yet due reuse
   *  their cached result instead of a fresh network call. Omit for a
   *  fully-fresh run with no caching (e.g. `--check`, or a one-shot
   *  discoverDecisions call with no scheduler behind it). */
  entryCache?: VerifyEntryCache
  /** Epoch ms "now" — defaults to Date.now() if omitted. Threaded through
   *  explicitly (rather than each cache check calling Date.now() itself)
   *  so every entry in the same planServedTools() call is judged against
   *  the exact same instant. */
  now?: number
}

export interface ServeDecision {
  tool: ToolDef
  served: boolean
  /** Set only for tools voiden-mcp-blocks-spec.md §1.6 structurally excludes — never reached verification at all. */
  excluded?: boolean
  excludedReasons?: string[]
  /** Set only for tools that reached verification. */
  status?: ToolStatus
  /** Prefixed onto the description when unverified/degraded, so the agent reads it. */
  descriptionNote?: string
}

/**
 * Everything voiden-runner core needs from the plugin that owns the /tool
 * block. voiden-mcp-tool constructs one of these in its own runner.ts
 * onload() and hands it to context.registerMcpToolCapabilityProvider().
 */
export interface McpToolCapabilityProvider {
  discoverTools(projectRoot: string, opts: { activePlugins: string[] }): Promise<ToolDef[]>
  validateTools(projectRoot: string, tools: ToolDef[]): Promise<{ validTools: ToolDef[]; issues: ToolValidationIssue[] }>
  verifyTools(tools: ToolDef[], opts: VerifyToolsOptions & { activePlugins: string[]; entryCache?: VerifyEntryCache; now?: number }): Promise<ToolStatus[]>
  planServedTools(projectRoot: string, env: Record<string, string>, activePlugins: string[], opts?: PlanServedToolsOptions): Promise<ServeDecision[]>
  registerServedTools(
    server: McpServer,
    decisions: ServeDecision[],
    baseEnv: Record<string, string>,
    runtimeVars: Record<string, any>,
    activePlugins: string[],
    commitSha: string | undefined,
    projectRoot: string,
    mode?: 'static' | 'dynamic',
  ): void
  upsertToolStatus(filePath: string, toolBlockUid: string, status: { state: ToolState; note?: string }): void
  /** Best-effort — never throws. Not every project is a git repo. */
  getCommitSha(projectRoot: string): string | undefined
}

let provider: McpToolCapabilityProvider | undefined

export function registerMcpToolCapabilityProvider(p: McpToolCapabilityProvider): void {
  provider = p
}

export function clearMcpToolCapabilityProvider(): void {
  provider = undefined
}

export function getMcpToolCapabilityProvider(): McpToolCapabilityProvider | undefined {
  return provider
}

// ─── Thin dispatchers — same names/signatures the old core implementation
// exported directly, so every existing caller (index.ts, @voiden/mcp)
// needs zero changes at the call site. ───────────────────────────────────

export async function discoverTools(projectRoot: string, opts: DiscoverToolsOptions = {}): Promise<ToolDef[]> {
  if (!provider) return []
  return provider.discoverTools(projectRoot, { activePlugins: opts.activePlugins ?? [] })
}

export async function validateTools(projectRoot: string, tools: ToolDef[]): Promise<{ validTools: ToolDef[]; issues: ToolValidationIssue[] }> {
  // No capability plugin registered → nothing to validate against; treat
  // every discovered tool as valid rather than silently excluding all of
  // them (discoverTools() already returns [] in that case anyway, but this
  // keeps validateTools() correct if ever called with a tool list from
  // elsewhere).
  if (!provider) return { validTools: tools, issues: [] }
  return provider.validateTools(projectRoot, tools)
}

export async function verifyTools(tools: ToolDef[], opts: VerifyToolsOptions & { entryCache?: VerifyEntryCache; now?: number } = {}): Promise<ToolStatus[]> {
  if (!provider) return []
  return provider.verifyTools(tools, { ...opts, activePlugins: opts.activePlugins ?? [] })
}

export async function planServedTools(projectRoot: string, env: Record<string, string>, activePlugins: string[], opts?: PlanServedToolsOptions): Promise<ServeDecision[]> {
  if (!provider) return []
  return provider.planServedTools(projectRoot, env, activePlugins, opts)
}

export function registerToolsFromDecisions(
  server: McpServer,
  decisions: ServeDecision[],
  baseEnv: Record<string, string>,
  runtimeVars: Record<string, any>,
  activePlugins: string[],
  commitSha: string | undefined,
  projectRoot: string,
  mode?: 'static' | 'dynamic',
): void {
  provider?.registerServedTools(server, decisions, baseEnv, runtimeVars, activePlugins, commitSha, projectRoot, mode)
}

/** Computes decisions once, then registers them. Used by the stdio path,
 *  where one McpServer instance lives for the whole process. */
export async function registerDynamicTools(
  server: McpServer,
  projectRoot: string,
  baseEnv: Record<string, string>,
  runtimeVars: Record<string, any>,
  activePlugins: string[],
): Promise<ServeDecision[]> {
  const decisions = await planServedTools(projectRoot, baseEnv, activePlugins)
  registerToolsFromDecisions(server, decisions, baseEnv, runtimeVars, activePlugins, getCommitSha(projectRoot), projectRoot)
  return decisions
}

export function upsertToolStatus(filePath: string, toolBlockUid: string, status: { state: ToolState; note?: string }): void {
  if (!provider) {
    throw new Error('No /tool-block capability plugin is registered — is voiden-mcp-tool enabled?')
  }
  provider.upsertToolStatus(filePath, toolBlockUid, status)
}

/** Best-effort — returns undefined (never throws) when no provider is registered. */
export function getCommitSha(projectRoot: string): string | undefined {
  return provider?.getCommitSha(projectRoot)
}
