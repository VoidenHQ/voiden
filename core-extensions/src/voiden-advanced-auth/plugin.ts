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
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './lib/oauth2/pkce';

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

              const varPrefix = auth.config.variablePrefix || 'oauth2';
              const EXT_IPC = 'ext:voiden-advanced-auth:';
              const ipc = (ch: string, ...args: any[]) => (window as any).electron?.ipc?.invoke(`${EXT_IPC}${ch}`, ...args);

              /** Resolve {{process.xxx}} patterns using runtime variables */
              const resolveProcessVars = async (text: string): Promise<string> => {
                if (!text || !text.includes('{{process.')) return text;
                try {
                  const variables = await (window as any).electron?.variables?.read() || {};
                  return text.replace(/{{\s*process\.([^}]+)\s*}}/g, (_match: string, varPath: string) => {
                    const value = variables[varPath.trim()];
                    if (value !== undefined && value !== null) {
                      return typeof value === 'object' ? JSON.stringify(value) : String(value);
                    }
                    return _match;
                  });
                } catch {
                  return text;
                }
              };

              /** Save a token result to runtime variables and patch requestState */
              const saveAndPatch = async (result: any) => {
                // Save to runtime variables
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
                // Save all extra fields from the raw response
                const knownKeys = new Set(['access_token', 'token_type', 'expires_in', 'refresh_token', 'scope']);
                if (result.raw) {
                  for (const [key, value] of Object.entries(result.raw)) {
                    if (!knownKeys.has(key) && value != null && value !== '') {
                      updated[`${varPrefix}_${key}`] = typeof value === 'object' ? JSON.stringify(value) : value;
                    }
                  }
                }
                // Save refresh config for future auto-refreshes
                if (auth.config?.autoRefresh && auth.config.tokenUrl && auth.config.clientId) {
                  updated[`${varPrefix}_refresh_config`] = JSON.stringify({
                    tokenUrl: auth.config.tokenUrl,
                    clientId: auth.config.clientId,
                    clientSecret: auth.config.clientSecret || '',
                    scope: auth.config.scope || '',
                    variablePrefix: varPrefix,
                    clientAuthMethod: auth.config.clientAuthMethod || 'client_secret_post',
                    customParams: auth.config.customParams || '',
                  });
                }
                await (window as any).electron?.variables?.writeVariables(JSON.stringify(updated, null, 2));

                // Patch requestState so the current request uses the new token
                const tokenType = result.tokenType || 'Bearer';
                const headerPrefix = auth.config?.headerPrefix || tokenType;
                const addTokenTo = auth.config?.addTokenTo || 'header';
                if (addTokenTo === 'query') {
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
              };

              // ── Auto-Acquire: get a token if none exists ─────────────
              const existingToken = await (window as any).electron?.variables?.get(`${varPrefix}_access_token`);
              if (!existingToken) {
                const grantType = auth.config.grantType || 'authorization_code';

                // Resolve process variables in config fields
                const tokenUrl = await resolveProcessVars(auth.config.tokenUrl || '');
                const clientId = await resolveProcessVars(auth.config.clientId || '');
                const clientSecret = await resolveProcessVars(auth.config.clientSecret || '');
                const scope = await resolveProcessVars(auth.config.scope || '');
                const clientAuthMethod = auth.config.clientAuthMethod || 'client_secret_post';
                const customParams = auth.config.customParams || '';

                let result: any;
                switch (grantType) {
                  case 'authorization_code': {
                    const authUrl = await resolveProcessVars(auth.config.authUrl || '');
                    const callbackUrl = await resolveProcessVars(auth.config.callbackUrl || '');
                    if (!authUrl || !tokenUrl || !clientId) break;
                    const codeVerifier = generateCodeVerifier();
                    const codeChallenge = await generateCodeChallenge(codeVerifier);
                    const state = (await resolveProcessVars(auth.config.state || '')) || generateState();
                    result = await ipc('oauth2:startAuthCodeFlow', {
                      authUrl, tokenUrl, clientId, clientSecret: clientSecret || undefined,
                      scope, callbackUrl: callbackUrl || undefined,
                      codeVerifier, codeChallenge, codeChallengeMethod: 'S256',
                      state, clientAuthMethod, customParams,
                    });
                    break;
                  }
                  case 'implicit': {
                    const authUrl = await resolveProcessVars(auth.config.authUrl || '');
                    const callbackUrl = await resolveProcessVars(auth.config.callbackUrl || '');
                    if (!authUrl || !clientId) break;
                    const state = (await resolveProcessVars(auth.config.state || '')) || generateState();
                    result = await ipc('oauth2:startImplicitFlow', {
                      authUrl, clientId, scope,
                      callbackUrl: callbackUrl || undefined,
                      state, clientAuthMethod, customParams,
                    });
                    break;
                  }
                  case 'password': {
                    const username = await resolveProcessVars(auth.config.username || '');
                    const password = await resolveProcessVars(auth.config.password || '');
                    if (!tokenUrl || !clientId) break;
                    result = await ipc('oauth2:passwordGrant', {
                      tokenUrl, clientId, clientSecret: clientSecret || undefined,
                      username, password, scope, clientAuthMethod, customParams,
                    });
                    break;
                  }
                  case 'client_credentials': {
                    if (!tokenUrl || !clientId) break;
                    result = await ipc('oauth2:clientCredentialsGrant', {
                      tokenUrl, clientId, clientSecret,
                      scope, clientAuthMethod, customParams,
                    });
                    break;
                  }
                }

                if (result?.accessToken) {
                  await saveAndPatch(result);
                  console.log(`[OAuth2 Auto-Acquire] Token acquired for prefix "${varPrefix}" (${grantType})`);
                }
                return; // acquired fresh token, no need to check refresh
              }

              // ── Auto-Refresh: refresh expired tokens ─────────────────
              if (!auth.config?.autoRefresh) return;

              // Check if token is expired
              const expiresAt = await (window as any).electron?.variables?.get(`${varPrefix}_expires_at`);
              if (!expiresAt || Date.now() < Number(expiresAt)) return; // not expired

              // Check if we have a refresh token
              const storedRefreshToken = await (window as any).electron?.variables?.get(`${varPrefix}_refresh_token`);
              if (!storedRefreshToken) return;

              // Get refresh config from runtime variables (saved by Get Token or auto-acquire)
              const rawRefreshConfig = await (window as any).electron?.variables?.get(`${varPrefix}_refresh_config`);
              let refreshConfig: any;
              try {
                refreshConfig = typeof rawRefreshConfig === 'string'
                  ? JSON.parse(rawRefreshConfig)
                  : rawRefreshConfig;
              } catch { return; }
              if (!refreshConfig) return;

              // Refresh the token via Electron IPC
              const refreshResult = await ipc('oauth2:refreshToken', {
                tokenUrl: refreshConfig.tokenUrl || '',
                clientId: refreshConfig.clientId || '',
                clientSecret: refreshConfig.clientSecret || '',
                refreshToken: storedRefreshToken,
                scope: refreshConfig.scope || '',
                clientAuthMethod: refreshConfig.clientAuthMethod || 'client_secret_post',
                customParams: refreshConfig.customParams || '',
              });

              if (refreshResult?.accessToken) {
                await saveAndPatch(refreshResult);
                console.log(`[OAuth2 Auto-Refresh] Token refreshed for prefix "${varPrefix}"`);
              }
            } catch (err) {
              console.warn('[OAuth2 Auto-Refresh] Failed:', err);
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
