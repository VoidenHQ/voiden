/**
 * Voiden GraphQL Plugin
 * 
 * Complete GraphQL client with query/mutation/subscription support
 */

import type { PluginContext } from '@voiden/sdk/ui';
import { parseGraphQLOperation } from './lib/utils';
import manifest from './manifest.json';

export default function createGraphQLPlugin(context: PluginContext) {
  const extendedContext = {
    ...context,
    pipeline: {
      registerHook: async (stage: string, handler: any, priority?: number) => {
        try {
          // @ts-ignore - Vite dynamic import
          const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
          hookRegistry.registerHook('graphql', stage as any, handler, priority);
        } catch (error) {
          console.error("Failed to register GraphQL hook:", error);
        }
      },
    },
  };

  return {
    onload: async () => {
      // Get context components and hooks
      const { NodeViewWrapper, CodeEditor, RequestBlockHeader } = context.ui.components;
      const { useSendRestRequest } = context.ui.hooks;

      // Import node factories dynamically
      const {
        createGraphQLQueryNode,
        createGraphQLVariablesNode,
        createGraphQLSubscriptionEventsNode,
      } = await import('./nodes');

      // Create nodes with context components
      const GraphQLQueryNode = createGraphQLQueryNode(NodeViewWrapper, CodeEditor, RequestBlockHeader, useSendRestRequest);
      const GraphQLVariablesNode = createGraphQLVariablesNode(NodeViewWrapper, CodeEditor, RequestBlockHeader);
      const GraphQLSubscriptionEventsNode = createGraphQLSubscriptionEventsNode(NodeViewWrapper, context, CodeEditor);

      // Register nodes
      context.registerVoidenExtension(GraphQLQueryNode);
      context.registerVoidenExtension(GraphQLVariablesNode);
      context.registerVoidenExtension(GraphQLSubscriptionEventsNode);

      // Register linkable node types
      context.registerLinkableNodeTypes([
        'gqlquery',
        'gqlvariables',
        'gqlsubscriptionevents',
      ]);

      // Register request building handler
      context.onBuildRequest(async (request, editor) => {
        try {
          // Get the JSON from the editor (linked blocks are already expanded by the orchestrator)
          const editorJson = editor.getJSON();

          // Only handle documents with a gqlquery node
          const gqlNode = editorJson.content?.find(
            (n: any) => n.type === 'gqlquery'
          );
          if (!gqlNode) return request; // Not a GraphQL doc, pass through

          // Extract query and operation info
          const query = gqlNode.attrs?.body || '';
          let operationType = gqlNode.attrs?.operationType || 'query';
          let operationName: string | undefined = gqlNode.attrs?.operationName;

          if (!operationName) {
            const match = query.match(/^\s*(query|mutation|subscription)\s+([\w]+)?/);
            if (match) {
              operationType = match[1];
              operationName = match[2];
            }
          }

          // Get variables from gqlvariables block
          const gqlVariablesNode = editorJson.content?.find(
            (n: any) => n.type === 'gqlvariables'
          );
          let variables: any = {};
          if (gqlVariablesNode) {
            try {
              variables = JSON.parse(gqlVariablesNode.attrs?.body || '{}');
            } catch (e) {
              // ignore parse errors
            }
          }

          // Determine URL:
          // 1. URL block (if present) overrides everything
          // 2. endpoint attribute on gqlquery (dedicated endpoint URL)
          // 3. schemaUrl as last fallback (introspection endpoint = query endpoint)
          const apiNode = editorJson.content?.find(
            (n: any) => n.type === 'api' || n.type === 'request'
          );
          const urlFromBlock = apiNode?.content?.find(
            (n: any) => n.type === 'url'
          )?.content?.[0]?.text || '';
          const url = urlFromBlock || gqlNode.attrs?.endpoint || gqlNode.attrs?.schemaUrl || '';

          console.log('[GraphQL onBuildRequest]', {
            endpoint: gqlNode.attrs?.endpoint,
            schemaUrl: gqlNode.attrs?.schemaUrl,
            urlFromBlock,
            resolvedUrl: url,
            allAttrs: gqlNode.attrs,
          });

          // Build headers: start with auto-generated defaults
          const defaultHeaders = [
            { key: 'Content-Type', value: 'application/json', enabled: true },
          ];

          // Merge user-defined headers on top (user values override defaults for same key)
          const getTable = (type: string) => {
            const nodes = editorJson.content?.filter((n: any) => n.type === type) || [];
            const rows: any[] = [];
            for (const node of nodes) {
              const tableRows = node.attrs?.rows || node.content || [];
              for (const row of tableRows) {
                if (row.key && row.enabled !== false) {
                  rows.push(row);
                }
              }
            }
            return rows;
          };

          const userHeaders = getTable('headers-table');
          const mergedHeaders = [...defaultHeaders];
          for (const uh of userHeaders) {
            const existingIdx = mergedHeaders.findIndex(
              (h) => h.key.toLowerCase() === uh.key.toLowerCase()
            );
            if (existingIdx !== -1) {
              mergedHeaders[existingIdx] = uh; // user overrides default
            } else {
              mergedHeaders.push(uh);
            }
          }

          // Get cookies and merge into headers
          const cookies = getTable('cookies-table');
          if (cookies.length > 0) {
            const cookieString = cookies.map((c: any) => `${c.key}=${c.value}`).join('; ');
            const existingCookieIdx = mergedHeaders.findIndex(
              (h) => h.key.toLowerCase() === 'cookie'
            );
            if (existingCookieIdx !== -1) {
              mergedHeaders[existingCookieIdx] = {
                ...mergedHeaders[existingCookieIdx],
                value: mergedHeaders[existingCookieIdx].value + '; ' + cookieString,
              };
            } else {
              mergedHeaders.push({ key: 'Cookie', value: cookieString, enabled: true });
            }
          }

          // Get auth if present
          const authNode = editorJson.content?.find(
            (n: any) => n.type === 'auth'
          );

          // Get pre/post request scripts if present
          const preRequestBlock = editorJson.content?.find(
            (n: any) => n.type === 'pre_request_block'
          );
          const postRequestBlocks = editorJson.content?.filter(
            (n: any) => n.type === 'post_request_block'
          );

          return {
            ...request,
            protocolType: 'graphql',
            operationType,
            method: 'POST',
            url,
            headers: mergedHeaders,
            body: JSON.stringify({
              query,
              variables,
              operationName,
            }),
            content_type: 'application/json',
            prescript: preRequestBlock?.attrs?.body,
            postscript: postRequestBlocks?.map((n: any) => n.attrs?.body).join('\n'),
            auth: authNode?.attrs || request?.auth,
          };
        } catch (error) {
          console.error('GraphQL onBuildRequest error:', error);
          throw error;
        }
      });

      // Register slash commands
      context.addVoidenSlashGroup({
        name: 'graphql',
        title: 'GraphQL',
        commands: [
          {
            name: 'graphql-query',
            label: 'GraphQL Query',
            aliases: ['gqlquery'],
            compareKeys: ['gqlquery'],
            singleton: true,
            slash: '/gqlquery',
            description: 'Insert GraphQL query block',
            action: (editor: any) => {
              if (!editor) return;
              editor
                .chain()
                .focus()
                .insertContent([
                  {
                    type: 'gqlquery',
                    attrs: {
                      body: '',
                      operationType: 'query',
                    },
                  },
                  {
                    type: 'paragraph',
                  },
                ])
                .run();
            },
          },
          {
            name: 'graphql-variables',
            label: 'GraphQL Variables',
            aliases: ['gqlvariables'],
            slash: '/gqlvariables',
            compareKeys: ['gqlvariables'],
            singleton: true,
            description: 'Insert GraphQL variables block',
            action: (editor: any) => {
              if (!editor) return;
              editor
                .chain()
                .focus()
                .insertContent([
                  {
                    type: 'gqlvariables',
                    attrs: {
                      body: '{}',
                    },
                  },
                  {
                    type: 'paragraph',
                  },
                ])
                .run();
            },
          },
        ],
      });

      // Register response processor for all GraphQL responses
      context.onProcessResponse(async (response) => {
        // Only handle GraphQL protocol responses
        if (response.protocol !== 'graphql' && response.protocolType !== 'graphql') {
          return;
        }

        const operationType = response.operationType || 'query';

        // Handle subscriptions
        if (operationType === 'subscription') {
          try {
            const subscriptionId = response.subscriptionId || `sub-${Date.now()}`;

            const { convertSubscriptionResponseToVoidenDoc } = await import('./lib/subscriptionResponseConverter');

            const responseDoc = convertSubscriptionResponseToVoidenDoc({
              subscriptionId,
              url: response.requestMeta?.url || '',
              connected: false,
              requestMeta: response.requestMeta,
            });

            await context.openVoidenTab(
              `Subscription`,
              responseDoc,
            );
          } catch (error) {
            console.error('Failed to process GraphQL subscription response:', error);
          }
          return;
        }

        // Handle query/mutation responses
        try {
          const { convertGraphQLResponseToVoidenDoc } = await import('./lib/responseConverter');

          const responseDoc = convertGraphQLResponseToVoidenDoc({
            statusCode: response.statusCode || response.status || 0,
            statusMessage: response.statusMessage || response.statusText || '',
            headers: response.headers || [],
            body: response.body || response.data,
            contentType: response.contentType,
            elapsedTime: response.elapsedTime || response.time || 0,
            url: response.url,
            requestMeta: response.requestMeta,
            metadata: response.metadata,
          });

          // Attach section info for scroll-to-request linking and color matching
          if (response.__sectionIndex !== undefined && responseDoc?.attrs) {
            responseDoc.attrs.sectionIndex = response.__sectionIndex;
          }
          if (response.__sectionColorIndex !== undefined && responseDoc?.attrs) {
            responseDoc.attrs.sectionColorIndex = response.__sectionColorIndex;
          }
          if (response.__sectionLabel && responseDoc?.attrs) {
            responseDoc.attrs.sectionLabel = response.__sectionLabel;
          }

          await context.openVoidenTab(
            `Response ${response.statusCode || response.status || 0}`,
            responseDoc,
            { readOnly: true }
          );
        } catch (error) {
          console.error('Failed to process GraphQL response:', error);
        }
      });
    },

    metadata: manifest,
  };
}
