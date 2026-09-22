/**
 * Implements the MCP SDK's OAuthClientProvider — the interface its own
 * auth() function (and StreamableHTTPClientTransport, when given one) drives
 * to complete a real OAuth 2.1 handshake against someone else's MCP server.
 * The SDK does the actual protocol work (discovery, DCR, PKCE, token
 * exchange); this class is just the storage + "how do we show the user a
 * login page" glue it needs.
 *
 * Two distinct modes, both using this same class:
 *   - Read-only (no `onRedirect` given): used by mcp.ts's regular
 *     list_tools/call_tool calls to transparently attach an already-saved
 *     token. redirectToAuthorization() throws in this mode — those calls
 *     must never silently pop a browser mid tool-call; a missing/expired
 *     token there should surface as the existing authRequired flow instead.
 *   - Interactive (`onRedirect` given): used only by mcpAuthorize.ts's
 *     explicit, user-initiated "Authorize" action.
 */

import type {
  OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  getStoredClientInfo,
  saveClientInfo,
  getStoredTokens,
  saveTokensFor,
} from './mcpClientAuthStore.js'

export class McpOAuthProvider implements OAuthClientProvider {
  private codeVerifierValue: string | undefined

  constructor(
    private readonly serverUrl: string,
    private readonly redirectUrlValue: string,
    private readonly onRedirect?: (authorizationUrl: string) => void,
  ) {}

  get redirectUrl(): string {
    return this.redirectUrlValue
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Voiden',
      redirect_uris: [this.redirectUrlValue],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return getStoredClientInfo(this.serverUrl) as OAuthClientInformationFull | undefined
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    saveClientInfo(this.serverUrl, clientInformation)
  }

  tokens(): OAuthTokens | undefined {
    const stored = getStoredTokens(this.serverUrl)
    if (!stored) return undefined
    // Reconstruct expires_in (relative) from the absolute expiresAt this
    // store actually persists — expires_in sitting in a file would silently
    // go stale the moment time passes, so it's never what's stored.
    const expires_in = stored.expiresAt !== undefined
      ? Math.max(0, stored.expiresAt - Math.floor(Date.now() / 1000))
      : undefined
    return {
      access_token: stored.access_token,
      token_type: stored.token_type as 'Bearer',
      refresh_token: stored.refresh_token,
      scope: stored.scope,
      expires_in,
    }
  }

  saveTokens(tokens: OAuthTokens): void {
    saveTokensFor(this.serverUrl, {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expiresAt: tokens.expires_in !== undefined
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : undefined,
    })
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.onRedirect) {
      throw new Error('This MCP connection needs authorization, but nothing is listening for it right now — use the Authorize button, not a regular tool call.')
    }
    this.onRedirect(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error('No PKCE code verifier saved for this authorization attempt.')
    return this.codeVerifierValue
  }
}
