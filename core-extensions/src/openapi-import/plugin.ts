// src/openapi-import/plugin.ts
import React from "react";
import type { PluginContext } from "@voiden/sdk/ui";
import { OpenAPIImportButton } from "./components/OpenAPIImportButton";
import { createOpenApiOverlay } from "./OverlayHost";
import { NodeViewWrapper } from "@tiptap/react";
import { extractOpenAPIValidationFromDoc, OpenAPIValidationContext } from "./lib/pipelineHook";
import { enhanceResponseWithOpenAPIValidation } from "./lib/responseEnhancer";

type EditorTab = { title?: string; content?: string; tabId?: string };



export interface ExtendedPluginContextExplicit extends Omit<PluginContext, 'project'> {
  tab?: {
    getActiveTab(): Promise<any>;
  };

  project: PluginContext['project'] & {
    /**
     * Open a file in the editor
     * @param filePath - The path to the file (relative or absolute)
     * @param skipJoin - If true, treats filePath as absolute path without joining with project root
     * @returns Promise that resolves when the file is opened
     */
    openFile(filePath: string, skipJoin?: boolean): Promise<void>;
  };
  files?: {
    read: (path: string) => Promise<string>;
  }
}

const openapiImportPlugin = (context: ExtendedPluginContextExplicit) => {
  let currentTab: EditorTab | null = null;
  let overlay: ReturnType<typeof createOpenApiOverlay> | null = null;
  let lastTabReopen = "";
  const extendedContext = {
    ...context,
    pipeline: {
      registerHook: async (stage: string, handler: any, priority?: number) => {
        try {
          // @ts-ignore - Vite dynamic import
          const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
          hookRegistry.registerHook('simple-assertions', stage as any, handler, priority);
        } catch (error) {
          console.error("Failed to register hook:", error);
        }
      },
    },

  };
  return {
    onload: async () => {
      // Create overlay only after the app is mounted
      overlay = createOpenApiOverlay(context);
      const { createOpenApiSpecLink } = await import('./nodes/OpenApiSpecLink');
      const { createOpenApiValidationResultsNode } = await import('./nodes/OpenApiResult');
      const { NodeViewWrapper } = context.ui.components;
      const { useParentResponseDoc } = context.ui.hooks;
      const OpenAPISpec = createOpenApiSpecLink(context);
      const OpenAPIResult = createOpenApiValidationResultsNode(NodeViewWrapper, useParentResponseDoc);
      // Provide the helper your panel optionally calls in its event handler
      (window as any).__voidenOpenOpenAPIPreview__ = () => overlay?.open();
      context.registerVoidenExtension(OpenAPISpec);
      context.registerVoidenExtension(OpenAPIResult);
      context.registerLinkableNodeTypes(["openapi-validation-results"]);
      context.registerNodeDisplayNames({
        'openapi-validation-results': 'OpenAPI Result',
      });
      context.registerEditorAction({
        id: "openapi-import-button",
        component: () =>
          React.createElement(OpenAPIImportButton, {
            context,
            onClickCallback: async () => {
              try {
                // Read text directly from the active editor as a reliable source
                const readActiveEditorText = () => {
                  try {
                    const code = context.project.getActiveEditor?.("code");
                    const voiden = context.project.getActiveEditor?.("voiden");
                    const value =
                      (code && typeof code.getText === "function" && code.getText()) ||
                      (voiden && typeof voiden.getText === "function" && voiden.getText()) ||
                      "";
                    return value || "";
                  } catch {
                    return "";
                  }
                };

                const currentActiveProject = await context.project.getActiveProject();

                const rawFromEditor = readActiveEditorText();

                // Fallbacks if you still want to try the tab snapshot
                const rawFromTab = (currentTab?.content ?? "").trim();
                const raw = rawFromEditor.trim() || rawFromTab;

                // Stash payload so the panel can consume it synchronously on first render
                (window as any).__voidenOpenAPILastPayload__ = {
                  raw,
                  currentActiveProject,
                  selectAll: false,
                  autoGenerate: false,
                };

                // 1) Open overlay
                overlay?.open();

                // Remove old tab
                lastTabReopen = "";

                // 2) Dispatch event after the overlay/panel mounts
                //    (panel also has a mount-time fallback to the "last payload" above)
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("voiden.openapi.process", {
                      detail: {
                        raw,
                        currentActiveProject,
                        selectAll: false,
                        autoGenerate: false,
                      },
                    }),
                  );
                }, 0);
              } catch (e) {
                console.error("[openapi-import] failed to open overlay", e);
              }
            },
          }),
        predicate: (tab) => {
          // Close if tab changes
          if (currentTab?.tabId && !lastTabReopen && currentTab?.tabId != tab.tabId) {
            setTimeout(() => overlay?.toggleVisible(false), 0);
            lastTabReopen = currentTab?.tabId;
          }

          if (lastTabReopen && lastTabReopen == tab.tabId) {
            setTimeout(() => overlay?.toggleVisible(true), 0);
            lastTabReopen = "";
          }

          // Check should it be shown on tab
          currentTab = tab;
          const name = tab.title?.toLowerCase() || "";
          const hasOpenApi = tab.content?.includes("openapi") || tab.content?.includes('"openapi"');
          return (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml")) && !!hasOpenApi;
        },
      });

      if (extendedContext.pipeline?.registerHook) {
        await extendedContext.pipeline.registerHook(
          "post-processing",
          async (context: any) => {
            const { requestState, responseState, metadata } = context;
            try {
              const requestDoc = requestState?.metadata?.editorDocument ||
                metadata?.requestDocument ||
                metadata?.editorDocument;

              if (!requestDoc) {
                return;
              }

              const validation = extractOpenAPIValidationFromDoc(requestDoc);
              if (!validation) {
                return;
              }

              // Build validation context
              const validationContext: OpenAPIValidationContext = {
                response: {
                  status: responseState.status,
                  statusText: responseState.statusText,
                  headers: responseState.headers || [],
                  body: responseState.body,
                  contentType: responseState.contentType,
                },
                request: {
                  method: requestState.method || 'GET',
                  path: requestState.pathParams || [],
                  url: requestState.url || '',
                  headers: requestState.headers || {},
                  body:JSON.parse(requestState.body||'{}')||{},
                  query: requestState.queryParams||[],
                  contentType:requestState.contentType
                },
              };

              const { validateOpenAPI } = await import('./lib/openapiValidationEngine')
              // Execute validation
              const result = await validateOpenAPI(validation, validationContext, extendedContext);

              // Store results in responseState.metadata
              if (!responseState.metadata) {
                responseState.metadata = {};
              }

              responseState.metadata.openAPIValidation = result;
            } catch (error) {
              console.error('[OpenAPI Validation] Error in post-process hook:', error);
            }
          },
          15 // Priority: run after response is processed but before display
        );
      }
      context.exposeHelpers({
        enhanceResponseWithOpenAPIValidation
      })


    },

    onunload: () => {
      if ((window as any).__voidenOpenOpenAPIPreview__) {
        delete (window as any).__voidenOpenOpenAPIPreview__;
      }
      overlay?.destroy();
      overlay = null;
    },
  };
};

export default openapiImportPlugin;
