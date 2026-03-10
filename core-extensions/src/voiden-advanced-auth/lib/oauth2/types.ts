/**
 * OAuth 2.0 Type Definitions
 */

export type OAuth2GrantType =
  | "authorization_code"
  | "implicit"
  | "password"
  | "client_credentials";

export type OAuth2AddTokenTo = "header" | "query";

export type OAuth2ClientAuthMethod = "client_secret_post" | "client_secret_basic";

export interface OAuth2Config {
  grantType: OAuth2GrantType;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  callbackUrl: string;
  variablePrefix: string;
  username: string;
  password: string;
  addTokenTo: OAuth2AddTokenTo;
  headerPrefix: string;
  autoRefresh: boolean;
  clientAuthMethod: OAuth2ClientAuthMethod;
  customParams: string;
  advancedOpen: boolean;
}

export interface OAuth2TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
  raw: Record<string, unknown>;
}

export interface OAuth2AuthCodeFlowParams {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scope: string;
  callbackUrl?: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
}

export interface OAuth2ImplicitFlowParams {
  authUrl: string;
  clientId: string;
  scope: string;
  callbackUrl?: string;
  state: string;
}

export interface OAuth2PasswordGrantParams {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
  scope: string;
}

export interface OAuth2ClientCredentialsParams {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export interface OAuth2RefreshTokenParams {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
}

export const DEFAULT_OAUTH2_CONFIG: OAuth2Config = {
  grantType: "authorization_code",
  authUrl: "",
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  callbackUrl: "",
  variablePrefix: "oauth2",
  username: "",
  password: "",
  addTokenTo: "header",
  headerPrefix: "Bearer",
  autoRefresh: true,
  clientAuthMethod: "client_secret_post",
  customParams: "",
  advancedOpen: false,
};

export const GRANT_TYPE_LABELS: Record<OAuth2GrantType, string> = {
  authorization_code: "Authorization Code (PKCE)",
  implicit: "Implicit",
  password: "Password Credentials",
  client_credentials: "Client Credentials",
};
