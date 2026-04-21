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
        createGqlUrlNode,
        createGqlBodyNode,
      } = await import('./nodes');

      // Create nodes with context components
      const GraphQLQueryNode = createGraphQLQueryNode(NodeViewWrapper, CodeEditor, RequestBlockHeader, useSendRestRequest);
      const GraphQLVariablesNode = createGraphQLVariablesNode(NodeViewWrapper, CodeEditor, RequestBlockHeader);
      const GraphQLSubscriptionEventsNode = createGraphQLSubscriptionEventsNode(NodeViewWrapper, context, CodeEditor);
      const GqlUrlNode = createGqlUrlNode(NodeViewWrapper, useSendRestRequest);
      const GqlBodyNode = createGqlBodyNode(NodeViewWrapper, CodeEditor);

      // Register nodes
      context.registerVoidenExtension(GraphQLQueryNode);
      context.registerVoidenExtension(GraphQLVariablesNode);
      context.registerVoidenExtension(GraphQLSubscriptionEventsNode);
      context.registerVoidenExtension(GqlUrlNode);
      context.registerVoidenExtension(GqlBodyNode);

      // Register linkable node types
      context.registerLinkableNodeTypes([
        'gqlquery',
        'gqlbody',
        'gqlurl',
        'gqlvariables',
        'gqlsubscriptionevents',
      ]);

      // Register request building handler
      context.onBuildRequest(async (request, editor) => {
        try {
          // Get the JSON from the editor (linked blocks are already expanded by the orchestrator)
          const editorJson = editor.getJSON();


          // Dynamic import of getRequest function from app
          // @ts-ignore - Path resolved at runtime in app context
          const { getRequest } = await import(/* @vite-ignore */ '@/core/request-engine/getRequestFromJson');

          // Build request WITHOUT environment variables
          // Environment variables will be replaced securely in Electron (Stage 3)
          // Faker variables will be replaced at Stage 5 (Pre-Send) by the faker extension
          request = await getRequest(editorJson, undefined, undefined);
          // Only handle documents with a gqlquery node
          const gqlNode = editorJson.content?.find(
            (n: any) => n.type === 'gqlquery'
          );
          if (!gqlNode) return request; // Not a GraphQL doc, pass through

          // Support new format (gqlurl/gqlbody children) and old format (direct attrs)
          const gqlBodyChild = gqlNode.content?.find((n: any) => n.type === 'gqlbody');
          const gqlUrlChild = gqlNode.content?.find((n: any) => n.type === 'gqlurl');

          // Extract query and operation info
          const query = gqlBodyChild?.attrs?.body || gqlNode.attrs?.body || '';
          let operationType = gqlBodyChild?.attrs?.operationType || gqlNode.attrs?.operationType || 'query';
          let operationName: string | undefined;

          const match = query.match(/^\s*(query|mutation|subscription)\s+([\w]+)?/);
          if (match) {
            operationType = match[1];
            operationName = match[2];
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

          // URL: from gqlurl child text, or legacy attrs.endpoint, or schemaUrl
          const gqlUrlText = gqlUrlChild?.content?.[0]?.text || gqlUrlChild?.content || '';
          const url = (typeof gqlUrlText === 'string' ? gqlUrlText : '') ||
            gqlNode.attrs?.endpoint || gqlNode.attrs?.schemaUrl || '';

          // Read headers from the TipTap table structure (headers-table > table > tableRow > tableCell)
          const readTableHeaders = (type: string) => {
            const result: Array<{key: string, value: string, enabled: boolean}> = [];
            editorJson.content?.forEach((rootNode: any) => {
              if (rootNode.type !== type) return;
              rootNode.content?.forEach((node: any) => {
                if (node.type !== 'table') return;
                node.content?.forEach((rowNode: any) => {
                  if (rowNode.type !== 'tableRow' || rowNode.attrs?.disabled) return;
                  let key = '', value = '';
                  rowNode.content?.forEach((cellNode: any, cellIndex: number) => {
                    if (cellNode.type === 'tableCell') {
                      const text = (cellNode.content?.[0]?.content?.[0]?.text || '').trim();
                      if (cellIndex === 0) key = text;
                      else if (cellIndex === 1) value = text;
                    }
                  });
                  if (key) result.push({ key, value, enabled: true });
                });
              });
            });
            return result;
          };

          // Read auth node and map to orchestrator format
          const readAuth = () => {
            const authNode = editorJson.content?.find((n: any) => n.type === 'auth');
            if (!authNode?.attrs) return undefined;
            const authType = authNode.attrs.authType;
            if (!authType || authType === 'inherit' || authType === 'none') return undefined;
            const typeMapping: Record<string, string> = {
              bearer: 'bearer-token', basic: 'basic-auth', apiKey: 'api-key',
              oauth2: 'oauth2', oauth1: 'oauth1', digest: 'digest-auth',
              ntlm: 'ntlm', awsSignature: 'aws-signature', hawk: 'hawk',
            };
            const mappedType = typeMapping[authType];
            if (!mappedType) return undefined;
            const config: Record<string, string> = {};
            authNode.content?.forEach((node: any) => {
              if (node.type === 'table') {
                node.content?.forEach((rowNode: any) => {
                  if (rowNode.type === 'tableRow') {
                    let k = '', v = '';
                    rowNode.content?.forEach((cellNode: any, idx: number) => {
                      if (cellNode.type === 'tableCell') {
                        const text = (cellNode.content?.[0]?.content?.[0]?.text || '').trim();
                        if (idx === 0) k = text; else if (idx === 1) v = text;
                      }
                    });
                    if (k) config[k] = v;
                  }
                });
              }
            });
            let finalConfig: any = config;
            if (authType === 'bearer') finalConfig = { token: config.token || '' };
            else if (authType === 'basic') finalConfig = { username: config.username || '', password: config.password || '' };
            else if (authType === 'apiKey') finalConfig = { key: config.key || '', value: config.value || '', in: config.add_to || 'header' };
            else if (authType === 'oauth2') {
              let oauth2Attrs: any = {};
              try {
                const raw = authNode.attrs?.oauth2Config;
                if (raw) oauth2Attrs = typeof raw === 'string' ? JSON.parse(raw) : raw;
              } catch {}
              const varPrefix = oauth2Attrs.variablePrefix || 'oauth2';
              finalConfig = {
                accessToken: `{{process.${varPrefix}_access_token}}`,
                tokenType: `{{process.${varPrefix}_token_type}}`,
                headerPrefix: oauth2Attrs.headerPrefix || 'Bearer',
                addTokenTo: oauth2Attrs.addTokenTo || 'header',
                autoRefresh: oauth2Attrs.autoRefresh === true,
                variablePrefix: varPrefix,
                grantType: oauth2Attrs.grantType || 'authorization_code',
                tokenUrl: config.token_url || oauth2Attrs.tokenUrl || '',
                clientId: config.client_id || oauth2Attrs.clientId || '',
                clientSecret: config.client_secret || oauth2Attrs.clientSecret || '',
                scope: config.scope || '',
                refreshToken: `{{process.${varPrefix}_refresh_token}}`,
              };
            }
            return { enabled: true, type: mappedType, config: finalConfig };
          };

          // Merge user headers with required Content-Type default
          const userHeaders = readTableHeaders('headers-table');
          const cookies = readTableHeaders('cookies-table');
          const mergedHeaders = [{ key: 'Content-Type', value: 'application/json', enabled: true }];
          for (const uh of userHeaders) {
            const idx = mergedHeaders.findIndex(h => h.key.toLowerCase() === uh.key.toLowerCase());
            if (idx !== -1) mergedHeaders[idx] = uh;
            else mergedHeaders.push(uh);
          }
          if (cookies.length > 0) {
            const cookieString = cookies.map((c: any) => `${c.key}=${c.value}`).join('; ');
            const cookieIdx = mergedHeaders.findIndex(h => h.key.toLowerCase() === 'cookie');
            if (cookieIdx !== -1) mergedHeaders[cookieIdx].value += '; ' + cookieString;
            else mergedHeaders.push({ key: 'Cookie', value: cookieString, enabled: true });
          }

          const auth = readAuth();

          // Get pre/post request scripts
          const preRequestBlock = editorJson.content?.find((n: any) => n.type === 'pre_request_block');
          const postRequestBlocks = editorJson.content?.filter((n: any) => n.type === 'post_request_block');

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
            auth,
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
                    content: [
                      { type: 'gqlurl', content: [] },
                      { type: 'gqlbody', attrs: { body: '', operationType: 'query' } },
                    ],
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
