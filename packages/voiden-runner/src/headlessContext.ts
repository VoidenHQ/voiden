/**
 * createHeadlessPluginContext
 *
 * Returns a plugin context that can be passed to a core-extension's plugin.ts
 * `onload()` in a headless Node.js environment (voiden-runner CLI).
 *
 * • All UI-related methods (registerVoidenExtension, registerSidebarTab, …)
 *   are no-ops — plugin.ts guards UI setup behind `if (context.ui?.components)`.
 * • pipeline.registerHook wires directly into the shared hookRegistry from
 *   @voiden/executors so that hooks fire when executeRequestPipeline runs.
 * • onBuildRequest / onProcessResponse wire into the shared requestOrchestrator
 *   from @voiden/executors — the same orchestration path used by the Electron app.
 *   If a plugin is disabled its handlers are never registered, so requests
 *   that require that plugin fail gracefully (same behaviour as the app).
 */

import { hookRegistry, PipelineStage, requestOrchestrator, executeWebSocket, executeGrpc } from '@voiden/executors'
import type { RequestBuildHandler, ResponseProcessHandler } from '@voiden/executors'
import { registerBlockSchema, type BlockSchemaDef } from './blockSchemaRegistry.js'
import type { RunnerContext, RunnerRequestHandler, RunnerResponseHandler } from '@voiden/sdk/runner'

export function createHeadlessPluginContext(
  extensionId: string,
  verbose: boolean = false,
): RunnerContext {
  return {
    // ── Pipeline hook registration (for hook plugins: scripting, auth, etc.) ─
    pipeline: {
      registerHook: (stage: string, handler: any, priority?: number) => {
        hookRegistry.registerHook(extensionId, stage as PipelineStage, handler, priority ?? 100)
      },
    },

    // ── Request builder registration (for parser plugins: graphql, sockets, rest) ─
    // Parser plugins call this in their runner.ts onload() to register their
    // block→request conversion function with the shared orchestrator.
    // The SDK expects (request, blocks), but orchestrator uses (request, editor).
    onBuildRequest: (handler: RunnerRequestHandler) => {
      requestOrchestrator.onBuildRequest(async (request, editor) => {
        const blocks = editor.getJSON()?.content ?? []
        return (await handler(request as any, blocks)) ?? request
      })
    },

    // Backward-compat alias: old compiled dist/*/runner.js files call
    // context.registerRequestBuilder(fn) where fn takes (blocks[]) directly.
    registerRequestBuilder: (fn: (blocks: any[]) => any | null | Promise<any | null>) => {
      requestOrchestrator.onBuildRequest(async (request: any, editor: { getJSON(): any }) => {
        const blocks: any[] = editor.getJSON()?.content ?? []
        const built = await fn(blocks)
        return built ?? request
      })
    },

    // ── Response handler registration ──────────────────────────────────────
    onProcessResponse: (handler: RunnerResponseHandler) => {
      requestOrchestrator.onProcessResponse(async (response, editor, request) => {
        const blocks = editor.getJSON()?.content ?? []
        await handler(response as any, blocks, request as any)
      })
    },

    // ── Block schema registration (headless equivalent of registerVoidenExtension) ─
    registerBlockSchema: (def: BlockSchemaDef) => {
      registerBlockSchema(def)
    },

    // ── Protocol executors (for socket plugins) ───────────────────────────
    protocols: {
      executeWebSocket: (req: any) => executeWebSocket(req),
      executeGrpc:      (req: any) => executeGrpc(req),
    },

    // ── Verbosity ────────────────────────────────────────────────────────
    verbose,

    // ── Reporting ────────────────────────────────────────────────────────
    report: {
      add: (_entry: any) => {
        // Runner implementation handles report aggregation via metadata.reportEntries
        // for now. This can be expanded to a dedicated report collector.
      },
      getEntries: () => [],
    },

    // ── UI stubs (all no-ops to satisfy type system if needed) ───────────
    ...({
      registerVoidenExtension:     () => {},
      registerCodemirrorExtension: () => {},
      registerLinkableNodeTypes:   () => {},
      registerNodeDisplayNames:    () => {},
      registerSidebarTab:          () => {},
      addVoidenSlashGroup:         () => {},
      exposeHelpers:               () => {},
      paste: { registerBlockOwner: () => {} },
      project: { openFile: () => {} },
    } as any),
  }
}

