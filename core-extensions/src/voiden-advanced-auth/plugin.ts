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
              const editor = ctx?.editor;
              if (!editor) return;

              const json = editor.getJSON?.();
              if (!json?.content) return;

              // Find auth node
              const authNode = json.content.find((n: any) => n.type === 'auth');
              if (!authNode?.attrs || authNode.attrs.authType !== 'oauth2') return;

              // Parse oauth2Config
              let oauth2Config: any;
              try {
                const raw = authNode.attrs.oauth2Config;
                if (typeof raw === 'string') oauth2Config = JSON.parse(raw);
                else if (typeof raw === 'object') oauth2Config = raw;
              } catch { return; }

              if (!oauth2Config?.autoRefresh) return;

              const varPrefix = oauth2Config.variablePrefix || 'oauth2';

              // Check if token is expired
              const expiresAt = await (window as any).electron?.variables?.get(`${varPrefix}_expires_at`);
              if (!expiresAt || Date.now() < Number(expiresAt)) return; // not expired

              // Check if we have a refresh token
              const refreshToken = await (window as any).electron?.variables?.get(`${varPrefix}_refresh_token`);
              if (!refreshToken) return; // no refresh token available

              // Refresh the token via Electron IPC (handles {{VARIABLE}} resolution internally)
              const result = await (window as any).electron?.oauth2?.refreshToken({
                tokenUrl: oauth2Config.tokenUrl || '',
                clientId: oauth2Config.clientId || '',
                clientSecret: oauth2Config.clientSecret || '',
                refreshToken,
                scope: oauth2Config.scope || '',
              });

              if (result?.accessToken) {
                // Write new token values to .voiden/.process.env.json
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
