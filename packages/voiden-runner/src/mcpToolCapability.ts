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
 *      directly — so @voiden/mcp-server (and anything else importing
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
}

export interface ToolStatusRecord {
  state: ToolState
  lastCheckedAt: string
  note?: string
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
  verifyTools(tools: ToolDef[], opts: VerifyToolsOptions & { activePlugins: string[] }): Promise<ToolStatus[]>
  planServedTools(projectRoot: string, env: Record<string, string>, activePlugins: string[]): Promise<ServeDecision[]>
  registerServedTools(
    server: McpServer,
    decisions: ServeDecision[],
    baseEnv: Record<string, string>,
    runtimeVars: Record<string, any>,
    activePlugins: string[],
    commitSha: string | undefined,
    projectRoot: string,
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
// exported directly, so every existing caller (index.ts, @voiden/mcp-server)
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

export async function verifyTools(tools: ToolDef[], opts: VerifyToolsOptions = {}): Promise<ToolStatus[]> {
  if (!provider) return []
  return provider.verifyTools(tools, { ...opts, activePlugins: opts.activePlugins ?? [] })
}

export async function planServedTools(projectRoot: string, env: Record<string, string>, activePlugins: string[]): Promise<ServeDecision[]> {
  if (!provider) return []
  return provider.planServedTools(projectRoot, env, activePlugins)
}

export function registerToolsFromDecisions(
  server: McpServer,
  decisions: ServeDecision[],
  baseEnv: Record<string, string>,
  runtimeVars: Record<string, any>,
  activePlugins: string[],
  commitSha: string | undefined,
  projectRoot: string,
): void {
  provider?.registerServedTools(server, decisions, baseEnv, runtimeVars, activePlugins, commitSha, projectRoot)
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
