export { replaceEnvVars } from './env.js'
export type { WebSocketRequest, GrpcRequest, RunResult } from './types.js'
export { executeWebSocket } from './websocket.js'
export { executeGrpc } from './grpc.js'

export type { SecureRequestAdapter, SecureHandoffResult, SecureHttpResult, SecureRequestResult } from './secureRequest.js'
export { executeSecureRequest, hasHttpHeader, deleteHttpHeader, addDefaultHttpHeaders, getFileMimeType } from './secureRequest.js'

export type { SecureAuthProvider, SecureAuthApplyContext, SecureAuthApplyResult } from './secureAuthProviders/index.js'
export { SecureAuthProviderRegistry, secureAuthProviders } from './secureAuthProviders/index.js'

export {
  UnresolvedVariablesError,
  assertNoUnresolvedTemplates,
  formatUnresolvedVariablesError,
  validateResolvedStrings,
} from './unresolvedVariables.js'

export * from './pipeline/index.js'

export type { HeadlessEditor, RequestBuildHandler, ResponseProcessHandler } from './orchestrator.js'
export { RequestOrchestrator, requestOrchestrator } from './orchestrator.js'
export { mergeRequestHandlerResult } from './requestComposition.js'
