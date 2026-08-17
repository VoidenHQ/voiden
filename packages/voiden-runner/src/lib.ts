/**
 * Library entry point for @voiden/runner.
 *
 * index.ts is the CLI (commander) entry point, wired via package.json's "bin".
 * This file is the programmatic surface for other packages in the monorepo
 * (e.g. @voiden/mcp) to import directly, wired via "main"/"exports".
 */

export { runVoidFile, getRequestPreview, findRequestBlock } from './runner.js'
export type { RunOptions, SectionResult, RunFileResult, RawRequestInfo } from './runner.js'

export { collectVoidFiles, resolveFiles } from './discovery.js'

export { buildResponseBlockText, upsertResponseBlock } from './resultBlock.js'

export { loadEnabledPlugins } from './plugins/loader.js'

export { loadEnvFile } from './envFile.js'

export type { RunResult, CliReportEntry } from './types.js'

export { discoverTools, verifyTools, validateTools, upsertToolStatus, registerDynamicTools, registerToolsFromDecisions, planServedTools, getCommitSha, registerMcpToolCapabilityProvider } from './mcpToolCapability.js'
export type { ToolState, ToolVerifyResult, ToolStatus, ToolValidationIssue, DiscoverToolsOptions, VerifyToolsOptions, ToolStatusRecord, ServeDecision, McpToolCapabilityProvider, VerifyEntryCacheRecord, VerifyEntryCache, PlanServedToolsOptions } from './mcpToolCapability.js'
export type { ToolDef, ToolExtraction, ToolParamDef, ToolVerifyEntry, ToolVerifyRole, ToolVerifyMode, ToolOnFailure, ToolAnnotations, ToolExtractFn } from './toolRegistry.js'

export { buildMcpServer, registerFixedTools } from './mcpServing.js'
export type { BuildMcpServerOptions } from './mcpServing.js'

// Shared CLI pretty-printing for a RunResult — same --show-req/--show-res
// detail and per-request formatting `voiden-runner run` itself uses,
// exported so other CLIs (the bundled `voiden run` in apps/electron) can
// render identical output instead of reimplementing it.
export { printRequestResult, printRunSummary } from './cliPrint.js'

// .void parsing, AI-agent integration (MCP registration + the standalone
// "voiden-mcp" skill installed alongside the app's own richer "voiden"
// skill) — all live in @voiden/executors, shared with the Voiden app, and
// re-exported here so existing imports of these from @voiden/runner
// (e.g. @voiden/mcp) keep working unchanged.
export {
  parseVoidFile,
  parseVoidFileSections,
  registerClaudeMcpServer,
  unregisterClaudeMcpServer,
  upsertCodexMcpSection,
  removeCodexMcpSection,
  installClaudeSkill,
  uninstallClaudeSkill,
  installCodexSkill,
  uninstallCodexSkill,
  installMcpIntegration,
  uninstallMcpIntegration,
  getMcpStatus,
  MCP_SKILL_MARKDOWN,
} from '@voiden/executors'
export type { Block, VoidSection, McpTargets, McpStatus } from '@voiden/executors'
