/**
 * OAuth 2.0 IPC Handlers
 *
 * Handles OAuth2 flows in the Electron main process:
 * - Authorization Code (with PKCE) via loopback server
 * - Implicit flow via loopback server with fragment extraction
 * - Password grant (direct token exchange)
 * - Client Credentials grant (direct token exchange)
 * - Token refresh
 */

import { ipcMain, shell } from "electron";
import * as http from "node:http";
import { replaceVariablesSecure } from "../env";
import { getActiveProject } from "../state";

// Track active loopback servers so we can cancel them
let activeServer: http.Server | null = null;
let activeReject: ((reason: Error) => void) | null = null;

/**
 * Replace {{VARIABLE}} patterns in all string fields of a params object.
 * Runs in main process using the secure env replacement.
 */
async function replaceVarsInParams<T extends Record<string, unknown>>(
  params: T,
  projectPath: string,
): Promise<T> {
  const result = { ...params } as Record<string, unknown>;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "string" && value.includes("{{")) {
      result[key] = await replaceVariablesSecure(value, projectPath);
    }
  }
  return result as T;
}

/**
 * POST to a token endpoint with form-urlencoded body.
 * Uses dynamic import for undici to avoid bundling issues.
 */
async function postTokenRequest(
  tokenUrl: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const { request } = await import("undici");

  // Build form body, omitting empty values
  const formParts: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null && v !== "") {
      formParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }

  const res = await request(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formParts.join("&"),
  });

  const text = await res.body.text();
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

/**
 * Success HTML served to the browser after callback.
 */
const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorization Successful</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:8px;background:#16213e;box-shadow:0 4px 12px rgba(0,0,0,.3)}
h1{color:#0f9d58;margin-bottom:.5rem}
</style></head>
<body><div class="card"><h1>Authorization Successful</h1><p>You can close this window and return to Voiden.</p></div></body></html>`;

/**
 * HTML page that extracts the fragment from an implicit flow callback.
 * The token is in the URL fragment (#access_token=...&token_type=...) which
 * the server never sees, so we need JS in the browser to forward it.
 */
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

// ─── IPC Registration ──────────────────────────────────────────────

export function registerOAuth2IpcHandlers() {
  // ── Authorization Code (PKCE) ────────────────────────────────────
  ipcMain.handle("oauth2:startAuthCodeFlow", async (event, params) => {
    const projectPath = await getActiveProject(event);
    if (!projectPath) throw new Error("No active project");

    const p = await replaceVarsInParams(params, projectPath);
    const {
      authUrl,
      tokenUrl,
      clientId,
      clientSecret,
      scope,
      callbackUrl,
      codeVerifier,
      codeChallenge,
      codeChallengeMethod,
      state,
    } = p;

    // If callbackUrl is specified, extract the port from it; otherwise use 0 (random)
    let listenPort = 0;
    if (callbackUrl) {
      try {
        const parsed = new URL(callbackUrl);
        listenPort = parseInt(parsed.port, 10) || 0;
      } catch { /* use random port */ }
    }

    // Cancel any running flow
    shutdownServer();

    return new Promise((resolve, reject) => {
      activeReject = reject;

      const server = http.createServer();
      activeServer = server;

      server.listen(listenPort, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        const port = addr.port;
        const redirectUri = callbackUrl || `http://127.0.0.1:${port}/callback`;

        // Build authorization URL
        const authUrlObj = new URL(authUrl);
        authUrlObj.searchParams.set("response_type", "code");
        authUrlObj.searchParams.set("client_id", clientId);
        authUrlObj.searchParams.set("redirect_uri", redirectUri);
        if (scope) authUrlObj.searchParams.set("scope", scope);
        if (state) authUrlObj.searchParams.set("state", state);
        if (codeChallenge) {
          authUrlObj.searchParams.set("code_challenge", codeChallenge);
          authUrlObj.searchParams.set(
            "code_challenge_method",
            codeChallengeMethod || "S256",
          );
        }

        shell.openExternal(authUrlObj.toString());

        // Timeout after 120s
        const timeout = setTimeout(() => {
          shutdownServer("OAuth2 flow timed out (120s)");
        }, 120_000);

        server.on("request", async (req, res) => {
          const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

          if (url.pathname === "/callback") {
            const code = url.searchParams.get("code");
            const returnedState = url.searchParams.get("state");
            const error = url.searchParams.get("error");

            if (error) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(
                `<html><body><h2>Error: ${error}</h2><p>${url.searchParams.get("error_description") || ""}</p></body></html>`,
              );
              clearTimeout(timeout);
              server.close();
              activeServer = null;
              activeReject = null;
              reject(
                new Error(
                  `OAuth2 error: ${error} - ${url.searchParams.get("error_description") || ""}`,
                ),
              );
              return;
            }

            if (state && returnedState !== state) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(
                "<html><body><h2>State mismatch</h2><p>Possible CSRF attack. Please try again.</p></body></html>",
              );
              clearTimeout(timeout);
              server.close();
              activeServer = null;
              activeReject = null;
              reject(new Error("OAuth2 state mismatch"));
              return;
            }

            if (!code) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(
                "<html><body><h2>No authorization code received</h2></body></html>",
              );
              clearTimeout(timeout);
              server.close();
              activeServer = null;
              activeReject = null;
              reject(new Error("No authorization code received"));
              return;
            }

            // Serve success page immediately
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(SUCCESS_HTML);
            clearTimeout(timeout);

            try {
              // Exchange code for token
              const tokenBody: Record<string, string> = {
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
              };
              if (clientSecret) tokenBody.client_secret = clientSecret;
              if (codeVerifier) tokenBody.code_verifier = codeVerifier;

              const raw = await postTokenRequest(tokenUrl, tokenBody);
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

  // ── Implicit Flow ────────────────────────────────────────────────
  ipcMain.handle("oauth2:startImplicitFlow", async (event, params) => {
    const projectPath = await getActiveProject(event);
    if (!projectPath) throw new Error("No active project");

    const p = await replaceVarsInParams(params, projectPath);
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

        shell.openExternal(authUrlObj.toString());

        const timeout = setTimeout(() => {
          shutdownServer("OAuth2 implicit flow timed out (120s)");
        }, 120_000);

        server.on("request", (req, res) => {
          const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

          if (url.pathname === "/callback") {
            // Serve extractor HTML that reads fragment and redirects
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(IMPLICIT_EXTRACTOR_HTML);
          } else if (url.pathname === "/callback/receive") {
            // Fragment params forwarded as query params by the JS
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
              reject(
                new Error(
                  `OAuth2 error: ${error} - ${url.searchParams.get("error_description") || ""}`,
                ),
              );
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
            url.searchParams.forEach((v, k) => {
              raw[k] = v;
            });

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

  // ── Password Grant ───────────────────────────────────────────────
  ipcMain.handle("oauth2:passwordGrant", async (event, params) => {
    const projectPath = await getActiveProject(event);
    if (!projectPath) throw new Error("No active project");

    const p = await replaceVarsInParams(params, projectPath);

    const body: Record<string, string> = {
      grant_type: "password",
      client_id: p.clientId,
      username: p.username,
      password: p.password,
    };
    if (p.clientSecret) body.client_secret = p.clientSecret;
    if (p.scope) body.scope = p.scope;

    const raw = await postTokenRequest(p.tokenUrl, body);
    return normalizeTokenResponse(raw);
  });

  // ── Client Credentials Grant ─────────────────────────────────────
  ipcMain.handle("oauth2:clientCredentialsGrant", async (event, params) => {
    const projectPath = await getActiveProject(event);
    if (!projectPath) throw new Error("No active project");

    const p = await replaceVarsInParams(params, projectPath);

    const body: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: p.clientId,
      client_secret: p.clientSecret,
    };
    if (p.scope) body.scope = p.scope;

    const raw = await postTokenRequest(p.tokenUrl, body);
    return normalizeTokenResponse(raw);
  });

  // ── Refresh Token ────────────────────────────────────────────────
  ipcMain.handle("oauth2:refreshToken", async (event, params) => {
    const projectPath = await getActiveProject(event);
    if (!projectPath) throw new Error("No active project");

    const p = await replaceVarsInParams(params, projectPath);

    const body: Record<string, string> = {
      grant_type: "refresh_token",
      client_id: p.clientId,
      refresh_token: p.refreshToken,
    };
    if (p.clientSecret) body.client_secret = p.clientSecret;
    if (p.scope) body.scope = p.scope;

    const raw = await postTokenRequest(p.tokenUrl, body);
    return normalizeTokenResponse(raw);
  });

  // ── Cancel Flow ──────────────────────────────────────────────────
  ipcMain.handle("oauth2:cancelFlow", async () => {
    shutdownServer("Flow cancelled by user");
    return { cancelled: true };
  });
}
