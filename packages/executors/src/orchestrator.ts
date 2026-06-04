/**
 * RequestOrchestrator — headless, shared request execution orchestrator.
 *
 * Used by both the Electron app (via requestOrchestrator in apps/ui) and
 * voiden-runner (CLI). The headless version has no TipTap/DOM dependencies.
 *
 * Plugins register their block→request builder via onBuildRequest(). If a
 * plugin is disabled its handler is never registered, so requests that require
 * that plugin fail gracefully — identical behaviour to the Electron app.
 */

import { executeRequestPipeline } from './pipeline/executor.js'
import type { PipelineResponse } from './pipeline/types.js'

export type HeadlessEditor = { getJSON(): any }

export type RequestBuildHandler = (
  request: any,
  editor: HeadlessEditor,
) => Promise<any> | any

export type ResponseProcessHandler = (
  response: any,
  editor: HeadlessEditor,
  request: any,
) => Promise<void> | void

export class RequestOrchestrator {
  private static instance: RequestOrchestrator
  private requestHandlers: RequestBuildHandler[] = []
  private responseHandlers: ResponseProcessHandler[] = []

  public static getInstance(): RequestOrchestrator {
    const globalSymbol = Symbol.for('voiden.requestOrchestrator')
    const g = globalThis as any

    if (!g[globalSymbol]) {
      g[globalSymbol] = new RequestOrchestrator()
    }
    return g[globalSymbol]
  }

  onBuildRequest(handler: RequestBuildHandler): void {
    this.requestHandlers.push(handler)
  }

  onProcessResponse(handler: ResponseProcessHandler): void {
    this.responseHandlers.push(handler)
  }

  async executeRequest(
    editor: HeadlessEditor,
    ipcAdapter: any,
    signal?: AbortSignal,
  ): Promise<PipelineResponse> {
    let request: any = {}

    for (const handler of this.requestHandlers) {
      request = await handler(request, editor)
    }

    if (!request?.url) {
      throw new Error(
        request?.errorMessage ||'No plugin could build a request from the document blocks. ' +
        'Ensure the required plugin (e.g. voiden-rest-api, voiden-graphql) is enabled.',
      )
    }

    const response = await executeRequestPipeline(request, ipcAdapter, editor, signal)

    for (const handler of this.responseHandlers) {
      try {
        await handler(response, editor, request)
      } catch {
        // Response handlers must not break execution
      }
    }

    return response
  }


  clear(): void {
    this.requestHandlers = []
    this.responseHandlers = []
  }
}

export const requestOrchestrator = RequestOrchestrator.getInstance()
