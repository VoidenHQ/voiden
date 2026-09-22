/**
 * Delegated-login OAuth provider — used instead of oauthProvider.ts's
 * auto-approve VoidenOAuthProvider when --sso-authorize-url/--sso-token-url
 * are given. Wraps the MCP SDK's own ProxyOAuthServerProvider, which is
 * genuinely provider-agnostic: it just forwards register/authorize/token
 * calls to whatever URLs it's given (confirmed by reading its source,
 * node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/providers/proxyProvider.js)
 * — no Google/GitHub/Okta-specific code needed here.
 *
 * Requires the upstream IdP to support RFC 7591 Dynamic Client Registration
 * at --sso-registration-url. An upstream that only supports a single fixed,
 * manually-created app (no DCR — this is how "Sign in with Google/GitHub"
 * work) is a different, larger design (a broker holding one shared app,
 * bridging every locally-registered MCP client through it) — deliberately
 * not implemented here, see docs/mcp-tool-publish-guide.md.
 *
 * Two things ProxyOAuthServerProvider deliberately leaves to its caller,
 * overridden below:
 *   - Registered clients aren't cached anywhere by the base class — we
 *     persist what DCR returns via oauthStore.ts so a later connection from
 *     the same MCP client doesn't need to re-register.
 *   - Token verification is a caller-supplied function, not something the
 *     base class implements — rather than requiring the host to also
 *     configure a JWKS/introspection URL, we record {clientId, scopes,
 *     expiresAt} locally at the moment a real upstream token is issued
 *     (reusing oauthStore.ts's token store, keyed by the real token string
 *     itself), and verify against that local record.
 */

import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { getStoredClient, putStoredClient, getToken, deleteToken, putToken } from './oauthStore.js'

// Only used when the upstream's token response omits expires_in — some
// IdPs don't send it for opaque tokens. Conservative default so a token
// that's actually still valid upstream doesn't linger "verified" forever
// on our side if it silently never expires here.
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60

export interface SsoEndpoints {
  authorizationUrl: string
  tokenUrl: string
  revocationUrl?: string
  registrationUrl?: string
}

async function verifySsoToken(token: string): Promise<AuthInfo> {
  const stored = getToken(token)
  if (!stored) throw new InvalidTokenError('Access token not recognized')
  if (stored.expiresAt < Math.floor(Date.now() / 1000)) {
    deleteToken(token)
    throw new InvalidTokenError('Access token expired')
  }
  return {
    token,
    clientId: stored.clientId,
    scopes: stored.scopes,
    expiresAt: stored.expiresAt,
    resource: stored.resource ? new URL(stored.resource) : undefined,
  }
}

export class VoidenSsoOAuthProvider extends ProxyOAuthServerProvider {
  constructor(endpoints: SsoEndpoints) {
    super({
      endpoints,
      verifyAccessToken: verifySsoToken,
      getClient: async (clientId: string) => getStoredClient(clientId),
    })
  }

  // Overrides the base class's clientsStore getter purely to persist what
  // DCR returns — registration itself is still fully proxied upstream by
  // the base class (this only adds a local cache write after success).
  get clientsStore(): OAuthRegisteredClientsStore {
    const base = super.clientsStore
    return {
      getClient: base.getClient,
      ...(base.registerClient && {
        registerClient: async (client) => {
          const registered = await base.registerClient!(client)
          putStoredClient(registered)
          return registered
        },
      }),
    }
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const tokens = await super.exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri, resource)
    this.recordIssuedToken(client.client_id, tokens, resource)
    return tokens
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const tokens = await super.exchangeRefreshToken(client, refreshToken, scopes, resource)
    this.recordIssuedToken(client.client_id, tokens, resource)
    return tokens
  }

  private recordIssuedToken(clientId: string, tokens: OAuthTokens, resource: URL | undefined): void {
    const scopes = tokens.scope ? tokens.scope.split(' ') : []
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS)
    putToken(tokens.access_token, { clientId, scopes, expiresAt, resource: resource?.toString() })
  }
}
