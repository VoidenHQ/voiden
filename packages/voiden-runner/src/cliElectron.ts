/**
 * cliElectron
 *
 * Mirrors the shape of window.electron that sendRequestHybrid expects, but
 * runs entirely in Node.js — no IPC, no Electron main process involved.
 *
 * Electron side:   sendRequestHybrid(..., window.electron)
 * CLI side:        sendRequestHybrid(..., createCliElectron(env))
 *
 * request.sendSecure  → delegates to executeSecureRequest from @voiden/executors
 *                        (same variable replacement + body building + HTTP execution)
 * env.replaceVariables → replaceEnvVars() from the --env file
 * state.get           → returns a stub (no active project in CLI)
 * runtime.*           → stubs for UI-only hooks (preSend vars, linked blocks, etc.)
 */

import { replaceEnvVars, executeSecureRequest } from '@voiden/executors'
import type { SecureRequestAdapter } from '@voiden/executors'
import type { RestApiRequestState } from '@voiden/sdk'
import { readFile } from 'node:fs/promises'
import { applyProcessVarsToState } from './runtimeVars.js'

// ─── Core sendSecure — delegates to the shared executor ───────────────────────

async function sendSecure(
  requestState: RestApiRequestState,
  _signalState?: { aborted?: boolean },
): Promise<any> {
  const env: Record<string, string> = (requestState as any).__cliEnv ?? {}

  const adapter: SecureRequestAdapter = {
    replaceVar: (text: string) => Promise.resolve(replaceEnvVars(text, env)),
    readFile: (filePath: string) => readFile(filePath),
    isElectron: false, // CLI: connect inline and return a report in the body
  }

  try {
    const result = await executeSecureRequest(requestState, adapter)

    // WS / gRPC / GraphQL-subscription: executeSecureRequest returns a handoff
    // (same as in the Electron app). The socket plugin's onProcessResponse hook
    // handles the actual connection and updates the response.
    if (result.kind === 'handoff') {
      return {
        // PipelineResponse shape (executor casts adapterResponse as PipelineResponse
        // for isSpecialProtocol requests)
        statusCode:    0,
        statusMessage: 'Handoff',
        headers:       [],
        contentType:   null,
        body:          null,
        url:           result.resolvedUrl,
        elapsedTime:   0,
        bytesContent:  0,
        protocol:      result.protocol,
        requestMeta: {
          method:      requestState.method,
          url:         result.resolvedUrl,
          headers:     Object.entries(result.resolvedHeaders).map(([key, value]) => ({ key, value })),
          httpVersion: result.protocol.toUpperCase(),
        },
        // Plugin reads handoff data from here in its onProcessResponse handler
        metadata: {
          handoff: {
            protocol: result.protocol,
            url:      result.resolvedUrl,
            headers:  result.resolvedHeaders,
            grpc:     result.requestState?.grpc,
            body:     result.resolvedBody,
          },
        },
      }
    }

    return {
      status:        result.status,
      statusText:    result.statusText,
      statusCode:    result.status,
      statusMessage: result.statusText,
      headers:       result.headers,
      body:          result.body,
      protocol:      result.protocol,
      operationType: result.operationType,
      requestMeta:   result.requestMeta,
    }

  } catch (error: any) {
    return {
      statusText: error?.message || 'Request failed',
      error:      error?.message || 'Request failed',
    }
  }
}

// ─── Public factory ───────────────────────────────────────────────────────────

export function createCliElectron(env: Record<string, string>, runtimeVars: Record<string, any> = {}) {
  return {
    isApp: false,

    request: {
      /**
       * Drop-in replacement for window.electron.request.sendSecure.
       * Injects __cliEnv so sendSecure can access the env map without
       * changing the RestApiRequestState interface.
       */
      sendSecure: (requestState: RestApiRequestState, signalState?: any) =>
        sendSecure({ ...requestState, __cliEnv: env } as any, signalState),
    },

    env: {
      /** Drop-in for window.electron.env.replaceVariables (used in auth header building) */
      replaceVariables: (text: string) => Promise.resolve(replaceEnvVars(text, env)),
    },

    state: {
      /** No active project in headless mode — callers guard with optional chaining */
      get: () => Promise.resolve({ activeDirectory: undefined }),
    },

    runtime: {
      /**
       * preSendProcessHook equivalent — in UI this replaces {{process.xxx}} from
       * .voiden/.process.env.json.  In CLI we have no project dir, so just return
       * the state as-is.  Pass --env to cover the same variables.
       */
      preSendProcess: (state: RestApiRequestState) =>
        Promise.resolve(applyProcessVarsToState(state, runtimeVars) as RestApiRequestState),

      /** replaceProcessVariablesInText equivalent — identity in CLI */
      replaceVar: (text: string) => Promise.resolve(text),

      /** expandLinkedBlocksInDoc equivalent — no linked blocks in CLI */
      expandLinkedBlocks: (json: any) => Promise.resolve(json),

      /** getRuntimeVariablesMap equivalent — no capture config in CLI */
      getRuntimeVariables: (_json: any) => Promise.resolve([]),

      /** saveRuntimeVariables equivalent — no project dir to save to in CLI */
      saveRuntimeVariables: () => Promise.resolve(),
    },
  }
}

export type CliElectron = ReturnType<typeof createCliElectron>
