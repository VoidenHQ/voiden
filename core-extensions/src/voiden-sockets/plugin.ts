/**
 * Voiden Socket Extension
 */

import type { PluginContext } from '@voiden/sdk/ui';
import { insertSocketNode } from './lib/utils';
import { createMessagesNode } from './nodes/MessagesNode';
import { createGrpcMessagesNode } from './nodes/gRPCMessageNode';
import manifest from "./manifest.json";
import React from 'react';
import { CopyWebsocatButton } from './components/CopyWebsocatButton';
import { CopyGrpcurlButton } from './components/CopyGrpcurlButton';
import { socketHistoryAdapter } from './historyAdapter';

// Lazily cached store reference so the synchronous predicates can read unsaved content.
// Lazily cached store reference so the synchronous predicate can read unsaved content.
let _editorStore: any = null;

// Captured proto services from the most recent gRPC build request — injected into the response doc.
let _pendingProtoServices: any[] | null = null;
function getEditorStore() {
  if (!_editorStore) {
    // @ts-ignore - resolved at runtime in app context
    (import(/* @vite-ignore */ '@/core/editors/voiden/VoidenEditor') as Promise<any>)
      .then((m: any) => { _editorStore = m.useEditorStore; })
      .catch(() => {});
  }
  return _editorStore;
}

export default function createSocketPlugin(context: PluginContext) {
  const extendedContext = {
    ...context,
    pipeline: {
      registerHook: async (stage: string, handler: any, priority?: number) => {
        try {
          // @ts-ignore - Vite dynamic import
          const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
          hookRegistry.registerHook('web-socket', stage as any, handler, priority);
        } catch (error) {
          console.error("Failed to register hook:", error);
        }
      },
    },
  };
  return {
    onload: async () => {
      const { SocketRequestNode } = await import('./nodes/RequestNode');
      const { createProtoFileNode } = await import('./nodes/ProtoSelectorNode');
      const { createSocketMethodNode } = await import('./nodes/MethodNode');
      const { SocketUrlNode } = await import('./nodes/UrlNode');
      const { NodeViewWrapper } = context.ui.components;
      const { useSendRestRequest } = context.ui.hooks;

      const ProtoFileNode = createProtoFileNode(NodeViewWrapper);
      const SocketMethodNode = createSocketMethodNode(useSendRestRequest);


      const MessagesNode = createMessagesNode(NodeViewWrapper, context);
      const gRPCMessageNode = createGrpcMessagesNode(NodeViewWrapper, context);
      context.registerVoidenExtension(ProtoFileNode);
      context.registerVoidenExtension(SocketRequestNode);
      context.registerVoidenExtension(SocketMethodNode);
      context.registerVoidenExtension(SocketUrlNode);
      context.registerVoidenExtension(MessagesNode);
      context.registerVoidenExtension(gRPCMessageNode);
      context.registerLinkableNodeTypes(['socket-request', 'smethod', 'surl', 'proto', 'messages-node', "grpc-messages-node",

      ]);
      context.addVoidenSlashGroup({
        name: 'sockets',
        title: 'Sockets',
        commands: [
          {
            name: "web-socket",
            label: "Web Socket",
            aliases: ['websocket', 'ws', "wss"],
            singleton: true,
            compareKeys: ["socket-request", "endpoint", "request"],
            slash: "/wss",
            description: "Insert Web Socket block",
            action: (editor: any) => {
              insertSocketNode(editor, "wss");
            },
          },
          {
            name: "grpcs-socket",
            label: "gRPCS Socket",
            singleton: true,
            compareKeys: ["socket-request", "request", "endpoint"],
            aliases: ['grpcsocket', 'grpc', 'grpcs'],
            slash: "/grpcs",
            description: "Insert gRPCS Socket block",
            action: (editor: any) => {
              insertSocketNode(editor, "grpcs");
            },
          },
        ],
      });

      // Register Copy websocat action
      context.registerEditorAction({
        id: "copy-websocat-button",
        component: (props: any) =>
          React.createElement(CopyWebsocatButton, {
            tab: props?.tab,
            context: context
          }),
        predicate: (tab) => {
          // Show copy websocat button for .void files that contain a socket-request inside a ```void fenced block
          const name = tab?.title?.toLowerCase() || "";
          if (!name.endsWith(".void")) return false;

          const store = getEditorStore();
          // Check unsaved content first
          if (tab?.tabId && store) {
            const unsaved = store.getState().unsaved[tab.tabId];
            if (unsaved) {
              try {
                const doc = JSON.parse(unsaved);
                const hasWs = doc?.content?.some((node: any) => {
                  if (node.type !== 'socket-request') return false;
                  const method = node.content?.find((c: any) => c.type === 'smethod')?.content?.[0]?.text || '';
                  return /^wss?$/i.test(method.trim());
                });
                if (hasWs) return true;
              } catch {}
            }
          }

          const content = tab?.content;
          if (typeof content !== 'string' || content.trim().length === 0) return false;

          try {
            const text = content;
            const fenceRegex = /```\s*void([\s\S]*?)```/gi;
            let match;
            while ((match = fenceRegex.exec(text)) !== null) {
              const inner = match[1] || '';
              if (/type:\s*socket-request/i.test(inner)) {
                // Check for smethod content (e.g. WSS/GRPCS) or surl scheme
                const methodMatch = inner.match(/-\s*type:\s*smethod[\s\S]*?content:\s*([^\n\r]+)/i);
                if (methodMatch && /wss?|ws/i.test(methodMatch[1].trim())) return true;
              }
            }

            return false;
          } catch {
            return false;
          }
        },
      });

      // Register Copy grpcurl action
      context.registerEditorAction({
        id: "copy-grpcurl-button",
        component: (props: any) =>
          React.createElement(CopyGrpcurlButton, {
            tab: props?.tab,
            context: context
          }),
        predicate: (tab) => {
          // Show copy grpcurl button for .void files that contain a socket-request inside a ```void fenced block
          const name = tab?.title?.toLowerCase() || "";
          if (!name.endsWith(".void")) return false;

          const store = getEditorStore();
          // Check unsaved content first
          if (tab?.tabId && store) {
            const unsaved = store.getState().unsaved[tab.tabId];
            if (unsaved) {
              try {
                const doc = JSON.parse(unsaved);
                const hasGrpc = doc?.content?.some((node: any) => {
                  if (node.type !== 'socket-request') return false;
                  const method = node.content?.find((c: any) => c.type === 'smethod')?.content?.[0]?.text || '';
                  return /^grpcs?$/i.test(method.trim());
                });
                if (hasGrpc) return true;
              } catch {}
            }
          }

          const content = tab?.content;
          if (typeof content !== 'string' || content.trim().length === 0) return false;

          try {
            const text = content;
            const fenceRegex = /```\s*void([\s\S]*?)```/gi;
            let match;
            while ((match = fenceRegex.exec(text)) !== null) {
              const inner = match[1] || '';
              if (/type:\s*socket-request/i.test(inner) || /socket-request/i.test(inner)) {
                // Check for smethod content indicating GRPCS/GRPC or surl scheme
                const methodMatch = inner.match(/-\s*type:\s*smethod[\s\S]*?content:\s*([^\n\r]+)/i);
                if (methodMatch && /grpcs?|grpc/i.test(methodMatch[1].trim())) return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        },
      });

      context.onProcessResponse(async (response) => {
        if (response.protocol !== 'wss' && response.protocol !== 'ws' && response.protocol !== 'grpc' && response.protocol !== 'grpcs') {
          return
        }
        try {
          // Capture the source .void file path BEFORE switching to the connected tab
          let sourceFilePath: string | null = null;
          try {
            // @ts-ignore
            const { useResponseStore } = await import(/* @vite-ignore */ '@/core/request-engine/stores/responseStore');
            const tabId = useResponseStore.getState().currentRequestTabId;
            if (tabId) {
              const panelData = await (window as any).electron?.state?.getPanelTabs('main');
              const tab = (panelData?.tabs as any[])?.find((t: any) => t.id === tabId && t.type === 'document');
              sourceFilePath = tab?.source ?? null;
            }
          } catch { /* best-effort */ }

          const { convertResponseToVoidenDocWithMessageNode, convertResponseToVoidenDocWithGRPCMessageNode } = await import('./lib/responseConverter');
          let responseDoc;
          if (response.protocol === 'wss' || response.protocol === 'ws') {
            responseDoc = convertResponseToVoidenDocWithMessageNode({
              requestMeta: response.requestMeta
                ? { ...response.requestMeta, sourceFilePath }
                : { url: '', headers: [], sourceFilePath },
              wsId: response.wsId || '',
            });
          } else {
            const capturedServices = _pendingProtoServices;
            _pendingProtoServices = null;
            responseDoc = convertResponseToVoidenDocWithGRPCMessageNode({
              requestMeta: response.requestMeta
                ? { ...response.requestMeta, sourceFilePath, protoServices: capturedServices }
                : { url: '', headers: [], package: '', service: '', callType: '', method: '', sourceFilePath, protoServices: capturedServices },
              grpcId: response.grpcId || '',
            });
          }
          await context.openVoidenTab(
            `connected`,
            responseDoc,
            { readOnly: true }
          );
        } catch (error) {
        }
      });

      // Register request building handler for socket requests
      context.onBuildRequest(async (request, editor) => {
        try {
          // Dynamic import of getRequest function from app
          // @ts-ignore - Path resolved at runtime in app context
          const { getRequest } = await import(/* @vite-ignore */ '@/core/request-engine/getRequestFromJson');

          // Get the JSON from the editor
          let editorJson = editor.getJSON();

          // Expand any linked blocks so plugins can access their content
          // @ts-ignore - Path resolved at runtime in app context
          const { expandLinkedBlocksInDoc } = await import(/* @vite-ignore */ '@/core/editors/voiden/utils/expandLinkedBlocks');
          editorJson = await expandLinkedBlocksInDoc(editorJson);

          // Capture proto services for injection into the response doc
          try {
            const socketNode = (editorJson.content as any[])?.find((n: any) => n.type === 'socket-request');
            const protoNode = socketNode?.content?.find((n: any) => n.type === 'proto');
            _pendingProtoServices = Array.isArray(protoNode?.attrs?.services) && protoNode.attrs.services.length > 0
              ? protoNode.attrs.services
              : null;
          } catch { _pendingProtoServices = null; }

          // Build socket request from editor JSON
          // getRequest will detect socket-request nodes and build appropriate request
          const builtRequest = await getRequest(editorJson, undefined, undefined);

          // Resolve relative proto file path to absolute so the electron process can find the file
          if (builtRequest?.grpc?.protoFilePath && !builtRequest.grpc.protoFilePath.startsWith('/')) {
            try {
              const projectDir = await (window as any).electron?.directories?.getActive();
              if (projectDir) {
                const sep = projectDir.endsWith('/') ? '' : '/';
                builtRequest.grpc.protoFilePath = `${projectDir}${sep}${builtRequest.grpc.protoFilePath}`;
              }
            } catch { /* keep as-is */ }
          }
          const { convertResponseToVoidenDocWithGRPCMessageNode } = await import('./lib/responseConverter');
          let responseDoc;
          if (!builtRequest.grpc && (builtRequest.protocolType === 'grpc' || builtRequest.protocolType === 'grpcs')) {
            responseDoc = convertResponseToVoidenDocWithGRPCMessageNode({});
            await context.openVoidenTab(
              `connected`,
              responseDoc,
              { readOnly: true }
            );
            throw "gRPC configuration incomplete: proto file, service, or method is not selected.";
          } else {
            return builtRequest;
          }
        } catch (error) {
          console.error("Error building socket request:", error);
          throw error;

        }
      });

      // Register pattern handlers (read from manifest)
      const patterns = manifest.capabilities.paste.patterns;
      const {
        convertWebsocatToSocketRequest,
        convertGrpcurlToSocketRequest,
        updateEditorContent,
        insertParagraphAfterRequestBlocks
      } = await import('./lib/converter');

      patterns.forEach(patternConfig => {
        // Parse regex pattern from manifest string (e.g., "/^websocat\\s+/i" -> /^websocat\s+/i)
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
              const trimmedText = text.trim();
              let socketRequest;

              // Determine command type and convert
              if (/^websocat\s+/i.test(trimmedText)) {
                socketRequest = convertWebsocatToSocketRequest(trimmedText);
              } else if (/^grpcurl\s+/i.test(trimmedText)) {
                socketRequest = convertGrpcurlToSocketRequest(trimmedText);
              } else {
                return false;
              }

              if (!socketRequest) {
                return false;
              }

              const editor = context.project.getActiveEditor('voiden');

              if (!editor) {
                return false;
              }

              // Confirm replacement if editor is not empty
              if (!editor.isEmpty) {
                const commandType = /^websocat\s+/i.test(trimmedText) ? 'websocat' : 'grpcurl';
                const proceed = window.confirm(`Pasting this ${commandType} request will replace the current content. Do you want to proceed?`);
                if (!proceed) {
                  return true; // Handled but cancelled
                }
              }

              // Populate editor with socket request
              updateEditorContent(editor, (editorJsonContent) => {
                const requestBlocks = ["socket-request", "headers-table", "path-table", "query-table", "proto"];

                // Clean up existing socket request nodes
                editorJsonContent = editorJsonContent.filter((node: any) => {
                  if (node.type === "endpoint") return false;
                  if (node.type && requestBlocks.includes(node.type)) return false;
                  return true;
                });
                // Add the converted socket request
                editorJsonContent.push(...(socketRequest || []));

                // Add paragraph after request blocks
                return insertParagraphAfterRequestBlocks(editorJsonContent);
              });

              return true;
            } catch (error) {
              // console.error('[VOIDEN] Error processing socket command:', error);
              return false;
            }
          },
        });
      });

      // CURL IMPORTER: handle websocat/grpcurl paste/replay in the editor
      if ((context as any).paste?.registerCurlImporter) {
        (context as any).paste.registerCurlImporter(async (curlString: string, editor: any) => {
          const trimmed = curlString.trim();
          const {
            convertWebsocatToSocketRequest,
            convertGrpcurlToSocketRequest,
            updateEditorContent,
            insertParagraphAfterRequestBlocks,
          } = await import('./lib/converter');

          let socketRequest: any;
          if (/^websocat\s+/i.test(trimmed)) {
            socketRequest = convertWebsocatToSocketRequest(trimmed);
          } else if (/^grpcurl\s+/i.test(trimmed)) {
            socketRequest = convertGrpcurlToSocketRequest(trimmed);
          } else {
            return false;
          }

          if (!socketRequest || !editor) return false;

          updateEditorContent(editor, (editorJsonContent: any[]) => {
            const requestBlocks = ['socket-request', 'headers-table', 'path-table', 'query-table', 'proto'];
            editorJsonContent = editorJsonContent.filter((node: any) => {
              if (node.type === 'endpoint') return false;
              if (node.type && requestBlocks.includes(node.type)) return false;
              return true;
            });
            editorJsonContent.push(...(socketRequest || []));
            return insertParagraphAfterRequestBlocks(editorJsonContent);
          });
          return true;
        });
      }

      // Register socket history adapter with the adapter registry
      {
        // @ts-ignore - Path resolved at runtime in app context
        const { historyAdapterRegistry } = await import(/* @vite-ignore */ '@/core/history/adapterRegistry');
        historyAdapterRegistry.register(socketHistoryAdapter);
      }

      // Register history curl builder for socket protocols (WS/WSS → websocat, GRPC/GRPCS → grpcurl)
      if ((context as any).history?.registerCurlBuilder) {
        (context as any).history.registerCurlBuilder((entry: any, projectPath?: string) => {
          const method = (entry.request?.method ?? '').toUpperCase();
          const url = entry.request?.url ?? '';
          const headers: Array<{ key: string; value: string }> = entry.request?.headers ?? [];
          const body: string | undefined = entry.request?.body;
          const grpcMeta = entry.request?.grpcMeta ?? {};

          const headerArgs = headers
            .filter((h) => h.key && h.value)
            .map((h) => `-H "${h.key}: ${h.value}"`)
            .join(' ');

          if (/^WSS?$/.test(method)) {
            const parts = ['websocat'];
            if (headerArgs) parts.push(headerArgs);
            parts.push(url);
            if (body) return `echo '${body}' | ${parts.join(' ')}`;
            return parts.join(' ');
          }

          if (/^GRPCS?$/.test(method)) {
            const parts = ['grpcurl'];
            const fullService = grpcMeta.package
              ? `${grpcMeta.package}.${grpcMeta.service ?? ''}`.replace(/\.$/, '')
              : (grpcMeta.service ?? '');
            const fullMethod = fullService && grpcMeta.method
              ? `${fullService}/${grpcMeta.method}`
              : '';

            // grpcurl expects plain host:port, not a URL with scheme
            const host = url.replace(/^grpcs?:\/\//, '');

            if (method === 'GRPC') parts.push('-plaintext');
            if (headerArgs) parts.push(headerArgs);

            // Use -import-path <dir> -proto <filename> so grpcurl can locate the file
            if (grpcMeta.protoFilePath) {
              // Resolve relative proto path to absolute for command-line usability
              let protoPath: string = grpcMeta.protoFilePath;
              if (projectPath && protoPath && !protoPath.startsWith('/')) {
                const sep = projectPath.endsWith('/') ? '' : '/';
                protoPath = `${projectPath}${sep}${protoPath}`;
              }
              const lastSlash = protoPath.lastIndexOf('/');
              if (lastSlash !== -1) {
                const dir = protoPath.slice(0, lastSlash);
                const file = protoPath.slice(lastSlash + 1);
                parts.push(`-import-path "${dir}" -proto "${file}"`);
              } else {
                parts.push(`-proto "${protoPath}"`);
              }
            }

            if (body) parts.push(`-d '${body}'`);
            parts.push(host);
            if (fullMethod) parts.push(fullMethod);
            return parts.join(' ');
          }

          return `# ${method} ${url}`;
        });
      }

    },
    onunload: async () => { },
  };
}
