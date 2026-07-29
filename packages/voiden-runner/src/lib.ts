/**
 * Library entry point for @voiden/runner.
 *
 * index.ts is the CLI (commander) entry point, wired via package.json's "bin".
 * This file is the programmatic surface for other packages in the monorepo
 * (e.g. @voiden/mcp-server) to import directly, wired via "main"/"exports".
 */

export { runVoidFile, getRequestPreview, findRequestBlock } from './runner.js'
export type { RunOptions, SectionResult, RunFileResult, RawRequestInfo } from './runner.js'

export { collectVoidFiles, resolveFiles } from './discovery.js'

export { buildResponseBlockText, upsertResponseBlock } from './resultBlock.js'

export { loadEnabledPlugins } from './plugins/loader.js'

export type { RunResult, CliReportEntry } from './types.js'

// .void parsing, AI-agent integration (MCP registration + the standalone
// "voiden-mcp" skill installed alongside the app's own richer "voiden"
// skill) — all live in @voiden/executors, shared with the Voiden app, and
// re-exported here so existing imports of these from @voiden/runner
// (e.g. @voiden/mcp-server) keep working unchanged.
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
