export { replaceEnvVars } from './env.js'
export type { WebSocketRequest, GrpcRequest, RunResult } from './types.js'
export { executeWebSocket } from './websocket.js'
export { executeGrpc } from './grpc.js'
export type { McpOperation, McpRequest, McpOperationResult } from './mcp.js'
export { executeMcpOperation } from './mcp.js'
export type { AuthorizeMcpServerResult } from './mcpAuthorize.js'
export { authorizeMcpServer } from './mcpAuthorize.js'
export { deleteAuthFor as deleteMcpClientAuth } from './mcpClientAuthStore.js'

export type { SecureRequestAdapter, SecureHandoffResult, SecureHttpResult, SecureRequestResult } from './secureRequest.js'
export { executeSecureRequest, hasHttpHeader, deleteHttpHeader, addDefaultHttpHeaders, getFileMimeType } from './secureRequest.js'

export {
  UnresolvedVariablesError,
  assertNoUnresolvedTemplates,
  formatUnresolvedVariablesError,
  validateResolvedStrings,
} from './unresolvedVariables.js'

export * from './pipeline/index.js'

export type { HeadlessEditor, RequestBuildHandler, ResponseProcessHandler } from './orchestrator.js'
export { RequestOrchestrator, requestOrchestrator } from './orchestrator.js'

export type { DeclaredBlockVersion, BlockVersionStatus, InstalledPluginInfo } from './blockVersioning.js'
export { classifyBlockVersion } from './blockVersioning.js'

// .void file parsing — shared by @voiden/runner (execution) and the Voiden
// app (validating externally-written files), so it lives here rather than
// in either of those.
export type { Block, VoidSection } from './voidParser.js'
export { parseVoidFile, parseVoidFileSections, groupBlocksIntoSections } from './voidParser.js'

// linkedBlock / linkedFile resolution — headless counterpart to the app's
// expandLinkedBlocks.ts, used by @voiden/runner so imported blocks/sections
// resolve the same way when executing a .void file outside the app.
export type { LinkedBlockResolver } from './linkedBlocks.js'
export { resolveLinkedBlocks, resolveLinkedFiles, getBlocksForSection } from './linkedBlocks.js'

// AI-agent integration (MCP server registration + skill install) — shared by
// @voiden/runner's `mcp` CLI command and the Voiden app's Settings toggle.
export type { ServerCommand, McpTargets, McpStatus } from './mcpInstall.js'
export {
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
} from './mcpInstall.js'

export { MCP_SKILL_MARKDOWN } from './skillContent.js'
