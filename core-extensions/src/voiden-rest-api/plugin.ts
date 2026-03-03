/**
 * Plugin Adapter for Voiden REST API Extension
 *
 * This adapter wraps the new UIExtension to work with the legacy Plugin system.
 * This is a transitional approach until the plugin system fully supports UIExtension.
 */

import { PluginContext } from '@voiden/sdk/ui';
import { VoidenRestApiExtension } from './extension';
import { createResponseStatusNode } from './nodes/ResponseStatusNode';
import { createResponseHeadersNode } from './nodes/ResponseHeadersNode';
import { createRequestHeadersNode } from './nodes/RequestHeadersNode';
import { createResponseBodyNode } from './nodes/ResponseBodyNode';
import manifest from './manifest.json';
import React from 'react';
import { createResponseDocNode } from './nodes/ResponseDocNode';
import { CopyCurlButton } from './components/CopyCurlButton';

type EditorTab = { title?: string; content?: string; tabId?: string };

// Lazily cached store reference so the synchronous predicate can read unsaved content.
let _editorStore: any = null;
function getEditorStore() {
  if (!_editorStore) {
    // @ts-ignore - resolved at runtime in app context
    (import(/* @vite-ignore */ '@/core/editors/voiden/VoidenEditor') as Promise<any>)
      .then((m: any) => { _editorStore = m.useEditorStore; })
      .catch(() => {});
  }
  return _editorStore;
}

const voidenRestApiPlugin = (context: PluginContext) => {
  // Create extension instance
  const extension = new VoidenRestApiExtension();
  let currentTab: EditorTab | null = null;
  // Create a minimal UIExtensionContext that maps to PluginContext
  const createExtensionContext = () => {
    return {
      blocks: {
        register: (block: any) => {
          // TODO: Implement block registration via context.registerVoidenExtension
        },
        unregister: (name: string) => { },
        get: (name: string) => undefined,
        getAll: () => [],
      },
      slashCommands: {
        register: (command: any) => {
          context.addVoidenSlashCommand(command);
        },
        registerGroup: (group: any) => {
          context.addVoidenSlashGroup(group);
        },
        unregister: (name: string) => { },
        get: (name: string) => undefined,
        getAll: () => [],
        getGroups: () => [],
      },
      ui: {
        registerSidebar: (side: 'left' | 'right', tab: any) => {
          context.registerSidebarTab(side, tab);
        },
        registerPanel: (panel: any) => {
          context.registerPanel(panel.id, panel);
        },
        showModal: (modal: any) => {
        },
        closeModal: (id: string) => {
        },
        showToast: (message: string, type?: string) => {
        },
      },
      editor: {
        getActive: (type: 'voiden' | 'code') => {
          return context.project.getActiveEditor(type);
        },
        getAll: () => {
          return {
            voiden: context.project.getActiveEditor('voiden'),
            code: context.project.getActiveEditor('code'),
          };
        },
        focus: (type: 'voiden' | 'code') => {
          const editor = context.project.getActiveEditor(type);
          if (editor) {
            editor.commands.focus();
          }
        },
      },
      storage: {
        get: async (key: string) => {
          // TODO: Implement storage via electron
          return undefined;
        },
        set: async (key: string, value: any) => {
          // TODO: Implement storage via electron
        },
        delete: async (key: string) => {
          // TODO: Implement storage via electron
        },
        clear: async () => {
          // TODO: Implement storage via electron
        },
      },
      metadata: {
        name: extension.name,
        version: extension.version,
        description: extension.description,
        author: extension.author,
        icon: extension.icon,
      },
      request: {
        send: async (request: any, options?: any) => {
          // TODO: Implement request sending
          throw new Error('Request API not yet implemented in adapter');
        },
      },
      // Pipeline API - stub implementation
      // The actual request handling is done via context.onBuildRequest/onProcessResponse
      // This stub allows extensions to register hooks without errors
      pipeline: {
        registerHook: (stage: any, handler: any, priority?: number) => {
          // TODO: Map this to the appropriate context.onBuildRequest/onProcessResponse
          // For now, this is a no-op as the plugin adapter handles request building directly
        },
        unregisterHook: (stage: any, handler: any) => {
          // No-op
        },
        getHooks: (stage: any) => {
          return [];
        },
      },
    };
  };

  return {
    onload: async () => {

      // Load request nodes from plugin package
      const { createMethodNode } = await import('./nodes/MethodNode');
      const { createJsonNode } = await import('./nodes/JsonNode');
      const { createXMLNode } = await import('./nodes/XMLNode');
      const { createYmlNode } = await import('./nodes/YmlNode');
      const { UrlNode } = await import('./nodes/UrlNode');
      const {
        RequestNode,
        createHeadersTableNodeView,
        createQueryTableNodeView,
        createPathParamsTableNodeView,
        createURLTableNodeView,
        createMultipartTableNodeView
      } = await import('./nodes/index');
      const { createRestFileNode } = await import('./nodes/RestFile');

      // Create nodes with context components and hooks
      const { NodeViewWrapper, CodeEditor, RequestBlockHeader } = context.ui.components;
      const { useSendRestRequest, useParentResponseDoc } = context.ui.hooks;

      const JsonNode = createJsonNode(NodeViewWrapper, CodeEditor, RequestBlockHeader, context.project.openFile);
      const XMLNode = createXMLNode(NodeViewWrapper, CodeEditor, RequestBlockHeader, context.project.openFile);
      const YmlNode = createYmlNode(NodeViewWrapper, CodeEditor, RequestBlockHeader, context.project.openFile);
      const MethodNode = createMethodNode(useSendRestRequest);
      const RestFile = createRestFileNode(NodeViewWrapper, RequestBlockHeader, context.project.openFile);

      // Create table nodes with RequestBlockHeader and openFile callback
      const HeadersTableNodeView = createHeadersTableNodeView(RequestBlockHeader, context.project.openFile);
      const QueryTableNodeView = createQueryTableNodeView(RequestBlockHeader, context.project.openFile);
      const PathParamsTableNodeView = createPathParamsTableNodeView(RequestBlockHeader, context.project.openFile);
      const URLTableNodeView = createURLTableNodeView(RequestBlockHeader, context.project.openFile);
      const MultipartTableNodeView = createMultipartTableNodeView(RequestBlockHeader, context.project.openFile);

      // Register Tiptap nodes for HTTP requests
      context.registerVoidenExtension(RequestNode);
      context.registerVoidenExtension(MethodNode);
      context.registerVoidenExtension(UrlNode);
      context.registerVoidenExtension(HeadersTableNodeView);
      context.registerVoidenExtension(QueryTableNodeView);
      context.registerVoidenExtension(PathParamsTableNodeView);
      context.registerVoidenExtension(URLTableNodeView);
      context.registerVoidenExtension(MultipartTableNodeView);
      context.registerVoidenExtension(JsonNode);
      context.registerVoidenExtension(XMLNode);
      context.registerVoidenExtension(YmlNode);
      context.registerVoidenExtension(RestFile);

      // Create and register response nodes using local implementations with context components

      const ResponseStatusNode = createResponseStatusNode(NodeViewWrapper);
      const ResponseHeadersNode = createResponseHeadersNode(NodeViewWrapper, CodeEditor, useParentResponseDoc);
      const RequestHeadersNode = createRequestHeadersNode(NodeViewWrapper, CodeEditor, useParentResponseDoc);
      const ResponseBodyNode = createResponseBodyNode(NodeViewWrapper, CodeEditor, useParentResponseDoc);
      const ResponseDocNode = createResponseDocNode(NodeViewWrapper);
      context.registerVoidenExtension(ResponseStatusNode);
      context.registerVoidenExtension(ResponseHeadersNode);
      context.registerVoidenExtension(ResponseBodyNode);
      context.registerVoidenExtension(RequestHeadersNode);
      context.registerVoidenExtension(ResponseDocNode);

      // Register linkable node types (for external file linking)

      context.registerLinkableNodeTypes([
        // Request nodes (linkable)
        'request',
        'rest-request',
        'method',
        'url',
        'response-doc',
        'headers-table',
        'query-table',
        'path-table',
        'url-table',
        'multipart-table',
        'json_body',
        'xml_body',
        'yml_body',
        'restFile',
        'response-body',
        'response-headers',
        'request-headers',
        'response-status',
      ]);

      // Register display names for node types (for UI block picker)
      context.registerNodeDisplayNames({
        'request': 'Request',
        'rest-request': 'Request',
        'headers-table': 'Headers',
        'rest-headers': 'Headers',
        'json_body': 'Body',
        'rest-body': 'Body',
        'query-table': 'Query Params',
        'rest-query': 'Query Params',
        'path-table': 'Path Params',
        'rest-params': 'Path Params',
        'rest-file': 'File Upload',
        'response-doc': 'Response',
        'response-body': 'Response Body',
        'response-headers': 'Response Headers',
        'request-headers': 'Request Headers',
        'xml_body': 'XML Body',
        'yml_body': 'YAML Body',
      });


      // Register Copy cURL action
      context.registerEditorAction({
        id: "copy-curl-button",
        component: (props: any) =>
          React.createElement(CopyCurlButton, {
            tab: props?.tab,
            context: context
          }),
        predicate: (tab) => {
          const name = tab?.title?.toLowerCase() || "";
          if (!name.endsWith(".void")) return false;

          let content = tab?.content || "";
          // If unsaved content exists, use it exclusively as the source of truth
          const store = getEditorStore();
          if (tab?.tabId && store) {
            const unsaved = store.getState().unsaved[tab.tabId];
            if (unsaved) {
              try {
                const doc = JSON.parse(unsaved);
                return doc?.content?.some((node: any) =>
                  node.type === 'api' || node.type === 'request'
                ) ?? false;
              } catch {
                return false;
              }
            }
          }

          // No unsaved content — fall back to saved file content
          if (typeof content !== 'string' || content.trim().length === 0) return false;

          try {
            const fenceRegex = /```\s*void([\s\S]*?)```/gi;
            let match;
            while ((match = fenceRegex.exec(content)) !== null) {
              if (/type:\s*request/i.test(match[1] || '')) return true;
            }
            return false;
          } catch {
            return false;
          }
        },
      });



      // Register request building handler
      context.onBuildRequest(async (request, editor) => {

        try {
          // Dynamic import of getRequest function and environment hooks from app
          // @ts-ignore - Path resolved at runtime in app context
          const { getRequest } = await import(/* @vite-ignore */ '@/core/request-engine/getRequestFromJson');

          // @ts-ignore - Path resolved at runtime in app context
          const { useEnvironments } = await import(/* @vite-ignore */ '@/core/environment/hooks');

          // Get active environment from app's environment system
          // Access the query client to get current environment data
          // @ts-ignore - Path resolved at runtime in app context
          const { getQueryClient } = await import(/* @vite-ignore */ '@/main');
          const queryClient = getQueryClient();
          const envData = queryClient.getQueryData(['environments']) as any;
          const activeEnv = envData?.activeEnv ? envData.data[envData.activeEnv] : undefined;

          // Get the JSON from the editor
          let editorJson = editor.getJSON();

          // Expand any linked blocks so plugins can access their content
          // @ts-ignore - Path resolved at runtime in app context
          const { expandLinkedBlocksInDoc } = await import(/* @vite-ignore */ '@/core/editors/voiden/utils/expandLinkedBlocks');
          editorJson = await expandLinkedBlocksInDoc(editorJson);

          // Build request WITHOUT environment variables
          // Environment variables will be replaced securely in Electron (Stage 3)
          // Faker variables will be replaced at Stage 5 (Pre-Send) by the faker extension
          const builtRequest = await getRequest(editorJson, undefined, undefined);

          return builtRequest;
        } catch (error) {
          throw error;
        }
      });

      // Register response processing handler
      context.onProcessResponse(async (response) => {
        const perfStart = performance.now();

        // Only handle REST protocol or GraphQL query/mutation responses
        // Let other protocols (GraphQL subscriptions, gRPC, WebSocket) be handled by their respective plugins
        const isRest = response.protocol && (response.protocol === 'rest' || response.protocol === 'http' || response.protocol === 'https');
        const isGraphQLQueryOrMutation = response.protocol === 'graphql' &&
          response.operationType &&
          (response.operationType === 'query' || response.operationType === 'mutation');

        if (!isRest && !isGraphQLQueryOrMutation) {
          return;
        }

        try {
          // Dynamic import of response converter
          const importStart = performance.now();
          const { convertResponseToVoidenDoc } = await import('./lib/responseConverter');

          // Convert response to Voiden document
          const convertStart = performance.now();
          const responseDoc = convertResponseToVoidenDoc({
            statusCode: response.statusCode || response.status || 0,
            statusMessage: response.statusMessage || response.statusText || '',
            headers: response.headers || [],
            body: response.body || response.data,
            contentType: response.contentType,
            elapsedTime: response.elapsedTime || response.time || 0,
            url: response.url,
            requestMeta: response.requestMeta,
            metadata: response.metadata,
            wsId: response.wsId || '',
          });

          // Open a new Voiden tab with the response
          const openStart = performance.now();
          await context.openVoidenTab(
            `Response ${response.statusCode}`,
            responseDoc,
            { readOnly: true }
          );
        } catch (error) {
        }
      });

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PASTE HANDLING
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Import paste utilities
      const { convertCurlToRequest } = await import('./index');
      const {
        convertToMethodNode,
        convertToURLNode,
        convertToHeadersTableNode,
        convertToQueryTableNode,
        convertToJsonNode,
        convertToXMLNode,
        convertToYmlNode,
        convertToMultipartTableNode,
        findAndReplaceOrAddNode,
        insertParagraphAfterRequestBlocks,
        updateEditorContent,
      } = await import('./lib/converter');

      // Register block owners (read from manifest)
      const blockTypes = manifest.capabilities.blocks.owns;
      const allowExtensions = manifest.capabilities.blocks.allowExtensions;

      blockTypes.forEach(blockType => {
        context.paste.registerBlockOwner({
          blockType,
          allowExtensions, // Read from manifest

          // Handle paste inside this block (e.g., pasting into method/url nodes)
          handlePasteInside: (text, html, node, view) => {
            if (blockType === 'method' || blockType === 'url') {
              // Strip formatting and insert as plain text
              let cleanedText = text.trim();

              // Extract plain text from HTML if present
              if (html && html.includes('<div>')) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                cleanedText = (tempDiv.textContent || tempDiv.innerText || text).trim();
              }

              // Strip fenced code block markers
              const tripleBacktickMatch = cleanedText.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
              if (tripleBacktickMatch) {
                cleanedText = tripleBacktickMatch[1].trim();
              }

              // Insert as plain text
              const tr = view.state.tr.replaceSelectionWith(view.state.schema.text(cleanedText));
              view.dispatch(tr);
              return true;
            }
            return false; // Other blocks use default paste
          },

          // Process block when pasted from clipboard
          processBlock: (block) => {
            // Could add validation/cleaning here
            return block;
          },
        });
      });

      // Register pattern handlers (read from manifest)
      const patterns = manifest.capabilities.paste.patterns;

      patterns.forEach(patternConfig => {

        // Parse regex pattern from manifest string (e.g., "/^curl\\s+/i" -> /^curl\s+/i)
        const patternMatch = patternConfig.pattern.match(/^\/(.+)\/([gimuy]*)$/);
        const regex = patternMatch
          ? new RegExp(patternMatch[1], patternMatch[2])
          : new RegExp(patternConfig.pattern);

        context.paste.registerPatternHandler({
          canHandle: (text) => {
            return regex.test(text.trim());
          },

          handle: (text, _html, _view) => {
            try {
              // Parse cURL command
              const requests = convertCurlToRequest(text) as any[];
              if (!requests || requests.length === 0) {
                return false;
              }

              const request = requests[0];
              const editor = context.project.getActiveEditor('voiden');

              if (!editor) {
                return false;
              }

              // Confirm replacement if editor is not empty
              if (!editor.isEmpty) {
                const proceed = window.confirm('Pasting this cURL request will replace the current content. Do you want to proceed?');
                if (!proceed) {
                  return true; // Handled but cancelled
                }
              }

              // Populate editor with cURL request
              updateEditorContent(editor, (editorJsonContent) => {
                const requestBlocks = ["headers-table", "query-table", "url-table", "multipart-table", "json_body", "xml_body", "yml_body"];

                // Step 1: Clean up existing request nodes
                editorJsonContent = editorJsonContent.filter((node: any) => {
                  if (node.type === "method" || node.type === "url") return false;
                  if (node.type && requestBlocks.includes(node.type)) return false;
                  return true;
                });

                // Step 2: Create method and URL nodes
                const newEndpointContent = [
                  convertToMethodNode(request.method),
                  convertToURLNode(request.url)
                ];

                // Find existing request node
                const requestIndex = editorJsonContent.findIndex((node: any) =>
                  node.type === "request" && !node.attrs?.importedFrom
                );

                if (requestIndex > -1) {
                  // Update existing
                  editorJsonContent[requestIndex] = {
                    ...editorJsonContent[requestIndex],
                    content: newEndpointContent,
                  };
                } else {
                  // Create new
                  editorJsonContent.push({
                    type: "request",
                    content: newEndpointContent,
                  });
                }

                // Step 3: Add headers
                if (request.headers?.length) {
                  editorJsonContent = findAndReplaceOrAddNode(
                    editorJsonContent,
                    "headers-table",
                    convertToHeadersTableNode(request.headers.map((h: any) => [h.name, h.value]))
                  );
                }

                // Step 4: Add query parameters
                if (request.parameters?.length) {
                  editorJsonContent = findAndReplaceOrAddNode(
                    editorJsonContent,
                    "query-table",
                    convertToQueryTableNode(request.parameters.map((p: any) => [p.name, p.value || ""]))
                  );
                }

                // Step 5: Add request body
                if (request.body) {
                  if (request.body.mimeType === "multipart/form-data" && request.body.params) {
                    const tableData = request.body.params.map((param: any) => {
                      const name = param.name;
                      const value = param.fileName ? `@${param.fileName.replace(/^"|"$/g, "")}` : param.value || "";
                      return [name, value.replace(/^"|"$/g, "")];
                    });
                    editorJsonContent = findAndReplaceOrAddNode(
                      editorJsonContent,
                      "multipart-table",
                      convertToMultipartTableNode(tableData)
                    );
                  } else if (["application/xml", "text/xml"].includes(request.body.mimeType || "") && request.body.text) {
                    editorJsonContent = findAndReplaceOrAddNode(
                      editorJsonContent,
                      "xml_body",
                      convertToXMLNode(request.body.text, request.body.mimeType || "application/xml")
                    );
                  } else if (["application/x-yaml", "text/yaml", "text/x-yaml", "application/yaml"].includes(request.body.mimeType || "") && request.body.text) {
                    editorJsonContent = findAndReplaceOrAddNode(
                      editorJsonContent,
                      "yml_body",
                      convertToYmlNode(request.body.text, request.body.mimeType || "application/x-yaml")
                    );
                  } else if (["application/json", "application/hal+json", "text/plain"].includes(request.body.mimeType || "") && request.body.text) {
                    const contentType = request.body.mimeType && ["application/json", "application/hal+json"].includes(request.body.mimeType) ? "json" : "text";
                    editorJsonContent = findAndReplaceOrAddNode(
                      editorJsonContent,
                      "json_body",
                      convertToJsonNode(request.body.text, contentType)
                    );
                  }
                }

                // Step 6: Add paragraph after request blocks
                return insertParagraphAfterRequestBlocks(editorJsonContent);
              });

              return true;
            } catch (error) {
              // console.error('[VOIDEN REST API] Error processing cURL:', error);
              return false;
            }
          },
        });
      });



      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // EXPOSE HELPERS FOR OTHER PLUGINS
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      const { helpers } = await import('./lib/helpers');

      // Set up markdown converter function
      // This allows other plugins to convert JSONContent to markdown with proper frontmatter
      (window as any).__voidenMarkdownConverter__ = async (jsonContent: any) => {
        try {
          // Import the markdown converter from the app
          // @ts-ignore - Path resolved at runtime in app context
          const { prosemirrorToMarkdown } = await import(/* @vite-ignore */ '@/core/file-system/hooks/useFileSystem');
          // @ts-ignore - Path resolved at runtime in app context
          const { getSchema } = await import(/* @vite-ignore */ '@tiptap/core');
          // @ts-ignore - Path resolved at runtime in app context
          const { voidenExtensions } = await import(/* @vite-ignore */ '@/core/editors/voiden/extensions');

          // Get the schema from the voiden extensions
          const schema = getSchema(voidenExtensions);

          // Convert to JSON string first (prosemirrorToMarkdown expects a string)
          const contentString = JSON.stringify(jsonContent);

          // Use the app's prosemirrorToMarkdown function which handles:
          // 1. Converting ProseMirror JSON to markdown
          // 2. Adding YAML frontmatter with version info
          // 3. Sanitizing inline code blocks
          const markdown = prosemirrorToMarkdown(contentString, schema);

          return markdown;
        } catch (error) {
          throw new Error('Failed to convert content to markdown. Make sure the editor is properly initialized.');
        }
      };

      // Expose helpers on window for other plugins
      if (!(window as any).__voidenHelpers__) {
        (window as any).__voidenHelpers__ = {};
      }

      (window as any).__voidenHelpers__['voiden-wrapper-api-extension'] = helpers;
      // Also expose under the correct extension name
      (window as any).__voidenHelpers__['voiden-rest-api'] = helpers;

      // Inject context into extension BEFORE calling onLoad
      const extensionContext = createExtensionContext();

      // Validate extension context before setting
      if (!extensionContext) {
        throw new Error('Failed to create extension context');
      }

      if (typeof (extension as any)._setContext !== 'function') {
        throw new Error('Extension does not have _setContext method');
      }

      (extension as any)._setContext(extensionContext);

      // Validate extension has required methods
      if (typeof extension.onLoad !== 'function') {
        throw new Error('Extension missing required onLoad method');
      }

      // Call extension's onLoad (this registers slash commands)
      await extension.onLoad();
    },
    onunload: async () => {
      await extension.onUnload?.();
    },
  };
};

export default voidenRestApiPlugin;
