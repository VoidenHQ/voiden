/**
 * Voiden Advanced Authentication Extension
 *
 * Provides advanced authentication support including:
 * - Bearer Token
 * - Basic Auth
 * - API Key (Header/Query)
 * - OAuth 1.0
 * - OAuth 2.0 (full flow with PKCE, 4 grant types, auto-refresh)
 * - Digest Auth
 * - AWS Signature
 * - And more...
 */

import type { PluginContext } from '@voiden/sdk/ui';
import { insertAuthNode } from './lib/utils';

// Access (window as any).electron via (window as any).electron to avoid
// conflicting declare global blocks with other extensions.

export default function createAdvancedAuthPlugin(context: PluginContext) {
  return {
    onload: async () => {

      // Load AuthNode from plugin package
      const { createAuthNode } = await import('./nodes/AuthNode');

      // Create node with context components
      const { NodeViewWrapper, RequestBlockHeader } = context.ui.components;
      const AuthNode = createAuthNode(NodeViewWrapper, RequestBlockHeader, context.project.openFile);

      // Register AuthNode
      context.registerVoidenExtension(AuthNode);

      // ── OAuth2 Auto-Refresh Hook ──────────────────────────────────
      // Runs during RequestCompilation (before preSendProcessHook).
      // If autoRefresh is enabled and the token is expired, refreshes
      // the token via Electron IPC and writes the new token to
      // .voiden/.process.env.json so preSendProcessHook picks it up.
      try {
        // @ts-ignore - Vite resolves @/ alias at serve time
        const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
        hookRegistry.registerHook(
          'voiden-advanced-auth',
          'request-compilation' as any,
          async (ctx: any) => {
            try {
              // Check if this request uses oauth2 auth (passed from sendRequestHybrid)
              const auth = ctx?.auth;
              if (!auth?.enabled || auth.type !== 'oauth2') return;
              if (!auth.config?.autoRefresh) return;

              const varPrefix = auth.config.variablePrefix || 'oauth2';

              // Check if token is expired
              const expiresAt = await (window as any).electron?.variables?.get(`${varPrefix}_expires_at`);
              if (!expiresAt || Date.now() < Number(expiresAt)) return; // not expired

              // Check if we have a refresh token
              const storedRefreshToken = await (window as any).electron?.variables?.get(`${varPrefix}_refresh_token`);
              if (!storedRefreshToken) return;

              // Get refresh config from runtime variables (saved by Get Token)
              const rawRefreshConfig = await (window as any).electron?.variables?.get(`${varPrefix}_refresh_config`);
              let refreshConfig: any;
              try {
                refreshConfig = typeof rawRefreshConfig === 'string'
                  ? JSON.parse(rawRefreshConfig)
                  : rawRefreshConfig;
              } catch { return; }
              if (!refreshConfig) return;

              // Refresh the token via Electron IPC
              const result = await (window as any).electron?.ipc?.invoke('ext:voiden-advanced-auth:oauth2:refreshToken', {
                tokenUrl: refreshConfig.tokenUrl || '',
                clientId: refreshConfig.clientId || '',
                clientSecret: refreshConfig.clientSecret || '',
                refreshToken: storedRefreshToken,
                scope: refreshConfig.scope || '',
                clientAuthMethod: refreshConfig.clientAuthMethod || 'client_secret_post',
                customParams: refreshConfig.customParams || '',
              });

              if (result?.accessToken) {
                const existing = await (window as any).electron?.variables?.read() || {};
                const updated: Record<string, any> = {
                  ...existing,
                  [`${varPrefix}_access_token`]: result.accessToken,
                  [`${varPrefix}_token_type`]: result.tokenType || 'Bearer',
                };
                if (result.refreshToken) {
                  updated[`${varPrefix}_refresh_token`] = result.refreshToken;
                }
                if (result.expiresIn) {
                  updated[`${varPrefix}_expires_at`] = Date.now() + result.expiresIn * 1000;
                }
                await (window as any).electron?.variables?.writeVariables(JSON.stringify(updated, null, 2));

                // Patch the current requestState directly.
                // convertToRestApiRequestState() already resolved the old expired token
                // before this hook ran, so we must overwrite it here for the current
                // request to use the new token.
                const tokenType = result.tokenType || 'Bearer';
                const headerPrefix = auth.config?.headerPrefix || tokenType;
                const addTokenTo = auth.config?.addTokenTo || 'header';
                if (addTokenTo === 'query') {
                  // Patch query param with new token
                  if (ctx.requestState?.queryParams) {
                    const params = ctx.requestState.queryParams as Array<{ key: string; value: string; enabled?: boolean }>;
                    const tokenIdx = params.findIndex(
                      (p: any) => p.key === 'access_token',
                    );
                    if (tokenIdx >= 0) {
                      params[tokenIdx].value = encodeURIComponent(result.accessToken);
                    } else {
                      params.push({ key: 'access_token', value: encodeURIComponent(result.accessToken), enabled: true });
                    }
                  }
                } else if (ctx.requestState?.headers) {
                  // Patch Authorization header with new token
                  const headers = ctx.requestState.headers as Array<{ key: string; value: string; enabled?: boolean }>;
                  const authIdx = headers.findIndex(
                    (h: any) => h.key?.toLowerCase() === 'authorization',
                  );
                  const newValue = `${headerPrefix} ${result.accessToken}`;
                  if (authIdx >= 0) {
                    headers[authIdx].value = newValue;
                  } else {
                    headers.push({ key: 'Authorization', value: newValue, enabled: true });
                  }
                }

                console.log(`[OAuth2 Auto-Refresh] Token refreshed for prefix "${varPrefix}"`);
              }
            } catch (err) {
              console.warn('[OAuth2 Auto-Refresh] Failed to refresh token:', err);
            }
          },
          5, // high priority – runs before scripting hooks
        );
      } catch (err) {
        console.warn('[voiden-advanced-auth] Failed to register auto-refresh hook:', err);
      }

      // Register linkable node type
      context.registerLinkableNodeTypes(['auth']);

      // Register display names for node types
      context.registerNodeDisplayNames({
        'auth': 'Authorization',
      });

      // Register slash commands for different auth types
      context.addVoidenSlashGroup({
        name: 'advanced-auth',
        title: 'Advanced Authentication',
        commands: [
          {
            name: "auth",
            singleton: true,
            label: "Authorization",
            compareKeys: ["auth","auth-api-key", "auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ['auth'],
            slash: "/auth",
            description: "Insert authorization block",
            action: (editor: any) => {
              insertAuthNode(editor, "inherit");
            },
          },
          {
            name: "auth-bearer",
            label: "Bearer Token",
            singleton: true,
            compareKeys: ["auth","auth-api-key", "auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ['auth-bearer'],
            slash: "/auth-bearer",
            description: "Insert Bearer Token auth",
            action: (editor: any) => {
              insertAuthNode(editor, "bearer");
            },
          },
          {
            name: "auth-basic",
            label: "Basic Auth",
            singleton: true,
            compareKeys: ["auth","auth-api-key", "auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ["auth-basic"],
            slash: "/auth-basic",
            description: "Insert Basic authentication",
            action: (editor: any) => {
              insertAuthNode(editor, "basic");
            },
          },
          {
            name: "auth-api-key",
            label: "API Key",
            singleton: true,
            compareKeys: ["auth", "auth-api-key","auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ["auth-api-key"],
            slash: "/auth-api-key",
            description: "Insert API Key auth",
            action: (editor: any) => {
              insertAuthNode(editor, "apiKey");
            },
          },
          {
            name: "auth-oauth2",
            label: "OAuth 2.0",
            singleton: true,
            compareKeys: ["auth", "auth-api-key", "auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ["auth-oauth2"],
            slash: "/auth-oauth2",
            description: "Insert OAuth 2.0 auth",
            action: (editor: any) => {
              insertAuthNode(editor, "oauth2");
            },
          },
          {
            name: "auth-oauth1",
            label: "OAuth 1.0",
            singleton: true,
            compareKeys: ["auth", "auth-api-key","auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ["auth-oauth1"],
            slash: "/auth-oauth1",
            description: "Insert OAuth 1.0 auth",
            action: (editor: any) => {
              insertAuthNode(editor, "oauth1");
            },
          },
          {
            name: "auth-digest",
            label: "Digest Auth",
            singleton: true,
            compareKeys: ["auth", "auth-api-key","auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ["auth-digest"],
            slash: "/auth-digest",
            description: "Insert Digest authentication",
            action: (editor: any) => {
              insertAuthNode(editor, "digest");
            },
          },
          {
            name: "auth-aws",
            label: "AWS Signature",
            singleton: true,
            compareKeys: ["auth", "auth-api-key","auth-basic", "auth-bearer", "auth-api-key", "auth-oauth1", "auth-oauth2", "auth-digest", "auth-aws"],
            aliases: ["auth-aws"],
            slash: "/auth-aws",
            description: "Insert AWS Signature auth",
            action: (editor: any) => {
              insertAuthNode(editor, "awsSignature");
            },
          },
        ],
      });
    },

    onunload: async () => {
    },
  };
}
