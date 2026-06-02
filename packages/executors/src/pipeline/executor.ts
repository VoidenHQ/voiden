/**
 * executeRequestPipeline — shared core pipeline executor.
 *
 * Runs all 8 pipeline stages for a single request and returns a PipelineResponse.
 *
 * The caller supplies:
 *   • requestState  – already-built RestApiRequestState
 *   • ipcAdapter    – window.electron (app) or createCliElectron(env) (CLI)
 *   • editor        – TipTap Editor (app) or { getJSON(): any } shim (CLI)
 *   • signal        – optional AbortSignal
 *   • options       – preRequestResult, protocolType, operationType
 *
 * Stages 3, 4, 6, 7 (env replacement, auth injection, sending, response
 * extraction) are handled entirely inside the ipcAdapter — the executor just
 * awaits the adapter's sendSecure() call and processes its response.
 */

import { Buffer } from 'buffer'
import { hookRegistry } from './HookRegistry.js'
import { PipelineStage, RestApiRequestState, RestApiResponseState, PipelineResponse } from './types.js'

export interface ExecutorOptions {
  preRequestResult?: any
  protocolType?: string
  operationType?: string
}

export async function executeRequestPipeline(
  requestState: RestApiRequestState,
  ipcAdapter: any,
  editor: { getJSON(): any } | undefined,
  signal?: AbortSignal,
  options: ExecutorOptions = {},
): Promise<PipelineResponse> {
  const startTime = performance.now()
  const metadata: Record<string, any> = requestState.metadata ?? {}
  requestState.metadata = metadata // Ensure shared reference

  try {
    const url = requestState.url.toLowerCase()
    const isWebSocket = url.startsWith('ws://') || url.startsWith('wss://')
    const isGrpc = url.startsWith('grpc://') || url.startsWith('grpcs://')
    const isGraphQLSubscription =
      options.protocolType === 'graphql' && options.operationType === 'subscription'
    const isSpecialProtocol = isWebSocket || isGrpc || isGraphQLSubscription

    // ── Stage 1: Pre-processing ───────────────────────────────────────────────
    let preProcessingCancelled = false
    await hookRegistry.executeHooks(PipelineStage.PreProcessing, {
      editor,
      requestState,
      cancel: () => { preProcessingCancelled = true },
    })

    if (preProcessingCancelled) {
      throw new Error('Request cancelled during pre-processing')
    }

    // ── Stage 2: Request compilation ──────────────────────────────────────────
    await hookRegistry.executeHooks(PipelineStage.RequestCompilation, {
      editor,
      requestState,
      auth: undefined,
      addHeader: (key: string, value: string) => {
        requestState.headers.push({ key, value, enabled: true })
      },
      addQueryParam: (key: string, value: string) => {
        requestState.queryParams.push({ key, value, enabled: true })
      },
    })

    // Runtime variable replacement ({{process.xxx}}).
    // In the app this is provided by electron.runtime.preSendProcess.
    // In the CLI, cliElectron returns the state unchanged (no process env file in headless mode).
    requestState = await (ipcAdapter?.runtime?.preSendProcess?.(requestState) ?? requestState)

    // ── Stage 5: Pre-send ─────────────────────────────────────────────────────
    await hookRegistry.executeHooks(PipelineStage.PreSend, {
      requestState,
      metadata,
    })

    if (requestState?.metadata?.scriptCancelled) {
      const reason = requestState?.metadata?.preScriptError
      throw new Error(
        reason
          ? `Request cancelled by pre-request script: ${reason}`
          : 'Request cancelled by pre-request script',
      )
    }

    // ── Stages 3, 4, 6, 7 — delegated to the IPC adapter ────────────────────
    const adapterResponse = await ipcAdapter.request.sendSecure(
      requestState,
      signal ? { aborted: signal.aborted } : undefined,
    )

    // Network / connection error
    if (!adapterResponse.status && adapterResponse.statusText) {
      return {
        statusCode: 0,
        protocol: adapterResponse.protocol,
        operationType: adapterResponse.operationType,
        statusMessage: adapterResponse.statusText,
        headers: [],
        contentType: null,
        body: null,
        url: '',
        elapsedTime: performance.now() - startTime,
        error: adapterResponse.error || adapterResponse.statusText,
        bytesContent: 0,
        prerequestResult: options.preRequestResult,
        requestMeta: adapterResponse.requestMeta,
      }
    }

    // Parse response headers
    const headers: Array<{ key: string; value: string }> = []
    if (adapterResponse.headers) {
      adapterResponse.headers.forEach(([key, value]: [string, string]) => {
        headers.push({ key, value })
      })
    }

    // Parse response body
    let body: any = null
    if (adapterResponse.body) {
      const buffer = Buffer.from(adapterResponse.body)
      const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')?.value || ''
      if (contentType.includes('json')) {
        try { body = JSON.parse(buffer.toString()) } catch { body = buffer.toString() }
      } else if (contentType.includes('text/')) {
        body = buffer.toString()
      } else {
        body = buffer
      }
    }

    const bodyString = typeof body === 'string' ? body : JSON.stringify(body)
    const bytesContent = new TextEncoder().encode(bodyString).length
    const endTime = performance.now()

    // ── WebSocket / gRPC / GraphQL subscription ───────────────────────────────
    if (isSpecialProtocol) {
      const baseResponse: PipelineResponse = adapterResponse
      const responseState: RestApiResponseState = {
        status: baseResponse.statusCode,
        statusText: baseResponse.statusMessage,
        headers: baseResponse.headers,
        contentType: baseResponse.contentType,
        body: baseResponse.body,
        timing: { start: startTime, end: endTime, duration: baseResponse.elapsedTime },
        bytesContent: baseResponse.bytesContent,
        url: baseResponse.url,
        error: baseResponse.error ?? null,
        requestMeta: baseResponse.requestMeta,
        metadata: baseResponse.metadata ?? {},
      }

      await hookRegistry.executeHooks(PipelineStage.PostProcessing, {
        requestState, responseState, metadata,
      })

      await _saveRuntimeVars(ipcAdapter, editor, requestState, responseState)
      return {
        ...baseResponse,
        requestHeaders: requestState.headers.filter(h => h.enabled !== false),
        requestBody: requestState.body,
        metadata: responseState.metadata,
      }
    }

    // ── REST response state ───────────────────────────────────────────────────
    const responseState: RestApiResponseState = {
      status: adapterResponse.status,
      statusText: adapterResponse.statusText,
      headers,
      protocol: adapterResponse.protocol,
      operationType: adapterResponse.operationType,
      contentType: headers.find(h => h.key.toLowerCase() === 'content-type')?.value || null,
      body,
      timing: { start: startTime, end: endTime, duration: endTime - startTime },
      bytesContent,
      url: adapterResponse.requestMeta?.url || requestState.url,
      error: adapterResponse.error || null,
      requestMeta: adapterResponse.requestMeta,
      metadata: adapterResponse.metadata ?? {},
    }

    // ── Stage 8: Post-processing ──────────────────────────────────────────────
    await hookRegistry.executeHooks(PipelineStage.PostProcessing, {
      requestState, responseState, metadata,
    })

    await _saveRuntimeVars(ipcAdapter, editor, requestState, responseState)

    return {
      statusCode: responseState.status,
      statusMessage: responseState.statusText,
      headers: responseState.headers.map(h => ({ key: h.key, value: h.value })),
      protocol: responseState.protocol,
      operationType: responseState.operationType,
      contentType: responseState.contentType,
      body: responseState.body,
      url: responseState.url,
      elapsedTime: responseState.timing.duration,
      error: responseState.error ?? undefined,
      bytesContent: responseState.bytesContent,
      testRunnerResult: responseState.testRunnerResult,
      prerequestResult: options.preRequestResult,
      requestMeta: responseState.requestMeta,
      metadata: responseState.metadata,
      requestHeaders: requestState.headers.filter(h => h.enabled !== false),
      requestBody: requestState.body,
    }

  } catch (error: any) {
    return {
      statusCode: 0,
      statusMessage: '',
      headers: [],
      contentType: null,
      body: null,
      url: '',
      elapsedTime: performance.now() - startTime,
      error: error.message,
      bytesContent: 0,
      protocol: options.protocolType,
      operationType: options.operationType,
      prerequestResult: options.preRequestResult,
    }
  }
}

// ─── Runtime variable persistence (best-effort) ───────────────────────────────
//
// In the app, ipcAdapter.runtime.* are real Electron helpers.
// In the CLI, cliElectron stubs them all to no-ops / empty arrays.

async function _saveRuntimeVars(
  ipcAdapter: any,
  editor: { getJSON(): any } | undefined,
  requestState: RestApiRequestState,
  responseState: RestApiResponseState,
): Promise<void> {
  try {
    const state = await ipcAdapter?.state?.get()
    const path = state?.activeDirectory || ''

    let editorJson = editor?.getJSON?.()
    editorJson = editorJson
      ? await (ipcAdapter?.runtime?.expandLinkedBlocks?.(editorJson) ?? editorJson)
      : editorJson

    const captureArray = await (ipcAdapter?.runtime?.getRuntimeVariables?.(editorJson) ?? [])
    if (captureArray?.length > 0) {
      const saveFn = ipcAdapter?.runtime?.saveRuntimeVariables ?? (() => Promise.resolve())
      await saveFn(requestState, responseState, captureArray, path)
    }
  } catch {
    // best-effort — never let this break the request flow
  }
}
