/**
 * OAuth 2.0 Main-Process Extension
 *
 * Handles OAuth2 flows in the Electron main process:
 * - Authorization Code (with PKCE) via loopback server
 * - Implicit flow via loopback server with fragment extraction
 * - Password grant (direct token exchange)
 * - Client Credentials grant (direct token exchange)
 * - Token refresh
 * - OIDC Discovery
 */

import type { ElectronExtensionContext, ElectronPlugin } from "@voiden/sdk/electron";
import * as http from "node:http";

/** Escape HTML special characters to prevent XSS in callback pages. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Track active loopback servers so we can cancel them
let activeServer: http.Server | null = null;
let activeReject: ((reason: Error) => void) | null = null;

/**
 * Replace {{VARIABLE}} patterns in all string fields of a params object.
 */
async function replaceVarsInParams<T extends Record<string, unknown>>(
  params: T,
  ctx: ElectronExtensionContext,
  event: any,
): Promise<T> {
  const result = { ...params } as Record<string, unknown>;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "string" && value.includes("{{")) {
      result[key] = await ctx.env.replaceVariables(value, event);
    }
  }
  return result as T;
}

/**
 * Parse custom params string (key=value&key2=value2) into a record.
 */
async function parseCustomParams(
  raw: string,
  ctx: ElectronExtensionContext,
  event: any,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!raw || !raw.trim()) return result;
  for (const pair of raw.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx).trim());
    let value = pair.slice(eqIdx + 1).trim();
    if (value.includes("{{")) {
      value = await ctx.env.replaceVariables(value, event);
    }
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Build Basic auth header from client credentials.
 */
function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * POST to a token endpoint with form-urlencoded body.
 */
async function postTokenRequest(
  tokenUrl: string,
  body: Record<string, string>,
  authHeader?: string,
): Promise<Record<string, unknown>> {
  const { request } = await import("undici");

  const formParts: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null && v !== "") {
      formParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const formBody = formParts.join("&");
  console.log("[OAuth2] Token request →", tokenUrl);
  console.log("[OAuth2] Token body →", formBody);

  const res = await request(tokenUrl, {
    method: "POST",
    headers,
    body: formBody,
  });

  const text = await res.body.text();
  console.log("[OAuth2] Token response ←", text.slice(0, 1000));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 500)}`);
  }
}

/**
 * Normalize a token endpoint response to our standard shape.
 */
function normalizeTokenResponse(raw: Record<string, unknown>) {
  if (raw.error) {
    throw new Error(
      `OAuth2 error: ${raw.error}${raw.error_description ? ` - ${raw.error_description}` : ""}`,
    );
  }
  return {
    accessToken: String(raw.access_token || ""),
    tokenType: String(raw.token_type || "Bearer"),
    expiresIn: raw.expires_in != null ? Number(raw.expires_in) : undefined,
    refreshToken: raw.refresh_token ? String(raw.refresh_token) : undefined,
    scope: raw.scope ? String(raw.scope) : undefined,
    raw,
  };
}

/**
 * Shutdown helper – close server + reject promise.
 */
function shutdownServer(reason?: string) {
  if (activeServer) {
    try {
      activeServer.close();
    } catch { /* ignore */ }
    activeServer = null;
  }
  if (activeReject) {
    activeReject(new Error(reason || "OAuth2 flow cancelled"));
    activeReject = null;
  }
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorization Successful</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:8px;background:#16213e;box-shadow:0 4px 12px rgba(0,0,0,.3)}
h1{color:#0f9d58;margin-bottom:.5rem}
</style></head>
<body><div class="card"><h1>Authorization Successful</h1><p>You can close this window and return to Voiden.</p></div></body></html>`;

const IMPLICIT_EXTRACTOR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Processing...</title></head>
<body><script>
var hash = window.location.hash.substring(1);
if (hash) {
  window.location.replace('/callback/receive?' + hash);
} else {
  document.body.innerText = 'No token received. You can close this window.';
}
</script></body></html>`;

// ─── Plugin Factory ──────────────────────────────────────────────

export default function createOAuth2MainPlugin(ctx: ElectronExtensionContext): ElectronPlugin {
  return {
    onload() {
      // ── OIDC Discovery ──────────────────────────────────────────
      ctx.ipc.handle("oauth2:discover", async (event, params) => {
        const projectPath = await ctx.project.getActive(event);
        if (!projectPath) throw new Error("No active project");

        let issuerUrl: string = params.issuerUrl || "";
        if (issuerUrl.includes("{{")) {
          issuerUrl = await ctx.env.replaceVariables(issuerUrl, event);
        }

        issuerUrl = issuerUrl.replace(/\/+$/, "");
        issuerUrl = issuerUrl.replace(/\/(authorize|auth|oauth2?\/authorize|oauth2?\/auth)(\/.*)?$/i, "");

        const discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
        const { request } = await import("undici");

        const res = await request(discoveryUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          headersTimeout: 10_000,
          bodyTimeout: 10_000,
        });

        const text = await res.body.text();
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Discovery endpoint returned non-JSON: ${text.slice(0, 200)}`);
        }

        if (!json.authorization_endpoint && !json.token_endpoint) {
          throw new Error("Discovery response missing authorization_endpoint and token_endpoint");
        }

        return json;
      });

      // ── Authorization Code (PKCE) ──────────────────────────────
      ctx.ipc.handle("oauth2:startAuthCodeFlow", async (event, params) => {
        const projectPath = await ctx.project.getActive(event);
        if (!projectPath) throw new Error("No active project");

        const p = await replaceVarsInParams(params, ctx, event);
        const {
          authUrl, tokenUrl, clientId, clientSecret,
          scope, callbackUrl, codeVerifier, codeChallenge,
          codeChallengeMethod, state,
        } = p;

        let listenPort = 0;
        if (callbackUrl) {
          try {
            const parsed = new URL(callbackUrl);
            listenPort = parseInt(parsed.port, 10) || 0;
          } catch { /* use random port */ }
        }

        shutdownServer();

        return new Promise((resolve, reject) => {
          activeReject = reject;

          const server = http.createServer();
          activeServer = server;

          server.listen(listenPort, "127.0.0.1", () => {
            const addr = server.address() as { port: number };
            const port = addr.port;
            const redirectUri = callbackUrl || `http://127.0.0.1:${port}/callback`;

            const authUrlObj = new URL(authUrl);
            authUrlObj.searchParams.set("response_type", "code");
            authUrlObj.searchParams.set("client_id", clientId);
            authUrlObj.searchParams.set("redirect_uri", redirectUri);
            if (scope) authUrlObj.searchParams.set("scope", scope);
            if (state) authUrlObj.searchParams.set("state", state);
            if (codeChallenge) {
              authUrlObj.searchParams.set("code_challenge", codeChallenge);
              authUrlObj.searchParams.set("code_challenge_method", codeChallengeMethod || "S256");
            }

            ctx.shell.openExternal(authUrlObj.toString());

            const timeout = setTimeout(() => {
              shutdownServer("OAuth2 flow timed out (120s)");
            }, 120_000);

            let handled = false;
            let exchangedCode: string | null = null;

            server.on("request", async (req, res) => {
              const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

              if (url.pathname === "/callback") {
                // Browsers may send duplicate requests (favicon, retries) — only handle once
                if (handled) {
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end(SUCCESS_HTML);
                  return;
                }

                const code = url.searchParams.get("code");
                const returnedState = url.searchParams.get("state");
                const error = url.searchParams.get("error");

                if (error) {
                  handled = true;
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end(
                    `<html><body><h2>Error: ${escapeHtml(error)}</h2><p>${escapeHtml(url.searchParams.get("error_description") || "")}</p></body></html>`,
                  );
                  clearTimeout(timeout);
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(new Error(`OAuth2 error: ${error} - ${url.searchParams.get("error_description") || ""}`));
                  return;
                }

                if (state && returnedState !== state) {
                  handled = true;
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end("<html><body><h2>State mismatch</h2><p>Possible CSRF attack. Please try again.</p></body></html>");
                  clearTimeout(timeout);
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(new Error("OAuth2 state mismatch"));
                  return;
                }

                if (!code) {
                  handled = true;
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end("<html><body><h2>No authorization code received</h2></body></html>");
                  clearTimeout(timeout);
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(new Error("No authorization code received"));
                  return;
                }

                // Defensive guard: never exchange the same code twice in one flow.
                if (exchangedCode === code) {
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end(SUCCESS_HTML);
                  return;
                }

                handled = true;
                exchangedCode = code;
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(SUCCESS_HTML);
                clearTimeout(timeout);

                try {
                  const tokenBody: Record<string, string> = {
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: redirectUri,
                    client_id: clientId,
                  };
                  if (clientSecret) tokenBody.client_secret = clientSecret;
                  if (codeVerifier) tokenBody.code_verifier = codeVerifier;

                  let authHeader: string | undefined;
                  if (p.clientAuthMethod === "client_secret_basic" && clientId) {
                    authHeader = buildBasicAuthHeader(clientId, clientSecret || "");
                    delete tokenBody.client_id;
                    delete tokenBody.client_secret;
                  }

                  const custom = await parseCustomParams(p.customParams || "", ctx, event);
                  Object.assign(tokenBody, custom);

                  const raw = await postTokenRequest(tokenUrl, tokenBody, authHeader);
                  const result = normalizeTokenResponse(raw);

                  server.close();
                  activeServer = null;
                  activeReject = null;
                  resolve(result);
                } catch (err: any) {
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(err);
                }
              }
            });
          });
        });
      });

      // ── Implicit Flow ──────────────────────────────────────────
      ctx.ipc.handle("oauth2:startImplicitFlow", async (event, params) => {
        const projectPath = await ctx.project.getActive(event);
        if (!projectPath) throw new Error("No active project");

        const p = await replaceVarsInParams(params, ctx, event);
        const { authUrl, clientId, scope, callbackUrl, state } = p;

        let listenPort = 0;
        if (callbackUrl) {
          try {
            const parsed = new URL(callbackUrl);
            listenPort = parseInt(parsed.port, 10) || 0;
          } catch { /* use random port */ }
        }

        shutdownServer();

        return new Promise((resolve, reject) => {
          activeReject = reject;

          const server = http.createServer();
          activeServer = server;

          server.listen(listenPort, "127.0.0.1", () => {
            const addr = server.address() as { port: number };
            const port = addr.port;
            const redirectUri = callbackUrl || `http://127.0.0.1:${port}/callback`;

            const authUrlObj = new URL(authUrl);
            authUrlObj.searchParams.set("response_type", "token");
            authUrlObj.searchParams.set("client_id", clientId);
            authUrlObj.searchParams.set("redirect_uri", redirectUri);
            if (scope) authUrlObj.searchParams.set("scope", scope);
            if (state) authUrlObj.searchParams.set("state", state);

            ctx.shell.openExternal(authUrlObj.toString());

            const timeout = setTimeout(() => {
              shutdownServer("OAuth2 implicit flow timed out (120s)");
            }, 120_000);

            server.on("request", (req, res) => {
              const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

              if (url.pathname === "/callback") {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(IMPLICIT_EXTRACTOR_HTML);
              } else if (url.pathname === "/callback/receive") {
                const accessToken = url.searchParams.get("access_token");
                const tokenType = url.searchParams.get("token_type") || "Bearer";
                const expiresIn = url.searchParams.get("expires_in");
                const error = url.searchParams.get("error");
                const returnedState = url.searchParams.get("state");

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(SUCCESS_HTML);
                clearTimeout(timeout);

                if (error) {
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(new Error(`OAuth2 error: ${error} - ${url.searchParams.get("error_description") || ""}`));
                  return;
                }

                if (state && returnedState !== state) {
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(new Error("OAuth2 state mismatch"));
                  return;
                }

                if (!accessToken) {
                  server.close();
                  activeServer = null;
                  activeReject = null;
                  reject(new Error("No access token received"));
                  return;
                }

                const raw: Record<string, unknown> = {};
                url.searchParams.forEach((v, k) => { raw[k] = v; });

                server.close();
                activeServer = null;
                activeReject = null;
                resolve({
                  accessToken,
                  tokenType,
                  expiresIn: expiresIn ? Number(expiresIn) : undefined,
                  raw,
                });
              }
            });
          });
        });
      });

      // ── Password Grant ─────────────────────────────────────────
      ctx.ipc.handle("oauth2:passwordGrant", async (event, params) => {
        const projectPath = await ctx.project.getActive(event);
        if (!projectPath) throw new Error("No active project");

        const p = await replaceVarsInParams(params, ctx, event);

        const body: Record<string, string> = {
          grant_type: "password",
          client_id: p.clientId,
          username: p.username,
          password: p.password,
        };
        if (p.clientSecret) body.client_secret = p.clientSecret;
        if (p.scope) body.scope = p.scope;

        let authHeader: string | undefined;
        if (p.clientAuthMethod === "client_secret_basic" && p.clientId) {
          authHeader = buildBasicAuthHeader(p.clientId, p.clientSecret || "");
          delete body.client_id;
          delete body.client_secret;
        }

        const custom = await parseCustomParams(p.customParams || "", ctx, event);
        Object.assign(body, custom);

        const raw = await postTokenRequest(p.tokenUrl, body, authHeader);
        return normalizeTokenResponse(raw);
      });

      // ── Client Credentials Grant ───────────────────────────────
      ctx.ipc.handle("oauth2:clientCredentialsGrant", async (event, params) => {
        const projectPath = await ctx.project.getActive(event);
        if (!projectPath) throw new Error("No active project");

        const p = await replaceVarsInParams(params, ctx, event);

        const body: Record<string, string> = {
          grant_type: "client_credentials",
          client_id: p.clientId,
          client_secret: p.clientSecret,
        };
        if (p.scope) body.scope = p.scope;

        let authHeader: string | undefined;
        if (p.clientAuthMethod === "client_secret_basic" && p.clientId) {
          authHeader = buildBasicAuthHeader(p.clientId, p.clientSecret || "");
          delete body.client_id;
          delete body.client_secret;
        }

        const custom = await parseCustomParams(p.customParams || "", ctx, event);
        Object.assign(body, custom);

        const raw = await postTokenRequest(p.tokenUrl, body, authHeader);
        return normalizeTokenResponse(raw);
      });

      // ── Refresh Token ──────────────────────────────────────────
      ctx.ipc.handle("oauth2:refreshToken", async (event, params) => {
        const projectPath = await ctx.project.getActive(event);
        if (!projectPath) throw new Error("No active project");

        const p = await replaceVarsInParams(params, ctx, event);

        const body: Record<string, string> = {
          grant_type: "refresh_token",
          client_id: p.clientId,
          refresh_token: p.refreshToken,
        };
        if (p.clientSecret) body.client_secret = p.clientSecret;
        if (p.scope) body.scope = p.scope;

        let authHeader: string | undefined;
        if (p.clientAuthMethod === "client_secret_basic" && p.clientId) {
          authHeader = buildBasicAuthHeader(p.clientId, p.clientSecret || "");
          delete body.client_id;
          delete body.client_secret;
        }

        const custom = await parseCustomParams(p.customParams || "", ctx, event);
        Object.assign(body, custom);

        const raw = await postTokenRequest(p.tokenUrl, body, authHeader);
        return normalizeTokenResponse(raw);
      });

      // ── Cancel Flow ────────────────────────────────────────────
      ctx.ipc.handle("oauth2:cancelFlow", async () => {
        shutdownServer("Flow cancelled by user");
        return { cancelled: true };
      });
    },

    onunload() {
      shutdownServer("Extension unloading");
    },
  };
}
