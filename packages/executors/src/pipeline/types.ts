/**
 * Request Execution Pipeline Types — shared between app and CLI.
 *
 * No TipTap / browser / Electron dependencies — safe to import in Node.js
 * (voiden-runner) and in the Electron renderer (app).
 *
 * The app's pipeline/types.ts re-exports everything from here and overlays
 * TipTap-typed variants of the hook contexts.
 */

// ─── Pipeline Stages ──────────────────────────────────────────────────────────

export enum PipelineStage {
  /**
   * Validate / transform before compilation.
   * Extensions can: validate editor state, cancel the request, transform data.
   */
  PreProcessing      = 'pre-processing',

  /**
   * Collect data from editor nodes.
   * Extensions can: add headers / query params to the request state.
   */
  RequestCompilation = 'request-compilation',

  /** Platform only — extensions don't hook here (security). */
  EnvReplacement     = 'env-replacement',

  /** Platform only — extensions don't hook here (security). */
  AuthInjection      = 'auth-injection',

  /**
   * Last chance for modifications before sending.
   * Extensions can: run pre-request scripts, add logging, modify request state.
   */
  PreSend            = 'pre-send',

  /** Platform only — actual HTTP / WS / gRPC execution. */
  Sending            = 'sending',

  /** Platform only — parse body, extract headers. */
  ResponseExtraction = 'response-extraction',

  /**
   * After response received.
   * Extensions can: run post-response scripts, validate, log, cache.
   */
  PostProcessing     = 'post-processing',
}

// ─── Request / response state ─────────────────────────────────────────────────

export interface RestApiRequestState {
  method: string
  url: string
  headers:     Array<{ key: string; value: string; enabled?: boolean }>
  queryParams: Array<{ key: string; value: string; enabled?: boolean }>
  pathParams:  Array<{ key: string; value: string; enabled?: boolean }>
  body?: string
  contentType?: string
  bodyParams?: Array<{ key: string; value: string | File; type?: string; enabled?: boolean }>
  binary?: File | string | string[]
  authProfile?: string
  preRequestResult?: any
  metadata?: Record<string, any>
  /** Protocol hint set by parser plugins: 'rest' | 'graphql' | 'grpc' | 'ws' */
  protocolType?: string
  /** GraphQL operation type: 'query' | 'mutation' | 'subscription' */
  operationType?: string
  /** gRPC-specific config set by the GraphQL/sockets parser */
  grpc?: Record<string, any>
}

export interface RestApiResponseState {
  status: number
  protocol?: string
  operationType?: string
  statusText: string
  headers: Array<{ key: string; value: string }>
  contentType: string | null
  body: any
  timing: { start: number; end: number; duration: number }
  bytesContent: number
  url: string
  error: string | null
  testRunnerResult?: any
  requestMeta?: {
    method: string
    url: string
    headers: { key: string; value: string }[]
    httpVersion?: string
    proxy?: { name: string; host: string; port: number }
  }
  metadata?: Record<string, any>
}

// ─── Hook context shapes ──────────────────────────────────────────────────────
//
// `editor` is typed as `any` so this package has no TipTap dependency.
// The app passes a real TipTap Editor; the CLI passes a headless shim:
//   { getJSON(): any }

export interface PreProcessingContext {
  editor?: any
  requestState: RestApiRequestState
  cancel: () => void
}

export interface RequestCompilationContext {
  editor?: any
  requestState: RestApiRequestState
  auth?: any
  addHeader:      (key: string, value: string) => void
  addQueryParam:  (key: string, value: string) => void
}

export interface PreSendContext {
  requestState: RestApiRequestState
  metadata: Record<string, any>
}

export interface PostProcessingContext {
  requestState: RestApiRequestState
  responseState: RestApiResponseState
  metadata: Record<string, any>
}

// ─── Hook system ──────────────────────────────────────────────────────────────

export type HookHandler<T = any> = (context: T) => Promise<void> | void

export interface Hook {
  extensionId: string
  stage: PipelineStage
  handler: HookHandler
  priority?: number
}

// ─── Pipeline result ──────────────────────────────────────────────────────────

export interface PipelineResult {
  success: boolean
  requestState: RestApiRequestState
  responseState?: RestApiResponseState
  error?: Error
  cancelled?: boolean
}

// ─── Node population interface ────────────────────────────────────────────────

export interface RequestPopulator {
  populateRequest(node: any, requestState: RestApiRequestState): void | Promise<void>
  consumeResponse?(node: any, responseState: RestApiResponseState): void | Promise<void>
}

// ─── Pipeline response (returned by executeRequestPipeline) ──────────────────

export interface PipelineResponse {
  statusCode: number
  statusMessage: string
  headers: Array<{ key: string; value: string }>
  contentType: string | null
  body: any
  url: string
  elapsedTime: number
  error?: string
  bytesContent: number
  protocol?: string
  operationType?: string
  prerequestResult?: any
  requestMeta?: any
  testRunnerResult?: any
  metadata?: Record<string, any>
  /** Sent request headers (populated by the executor after env/auth injection) */
  requestHeaders?: Array<{ key: string; value: string }>
  /** Serialised request body that was sent */
  requestBody?: string
}
