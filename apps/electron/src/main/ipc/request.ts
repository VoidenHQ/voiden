import { ipcMain, BrowserWindow, protocol } from "electron";
import { Blob } from "node:buffer";
import { Agent, ProxyAgent, request as undiciRequest, WebSocket, fetch, FormData } from "undici";
import { getSettings } from "../settings";
import { replaceVariablesSecure } from "../env";
import { getActiveProject } from "../state";
import fs from "fs/promises";
import path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { createClient, Client } from "graphql-ws";


const lastByWcAndKey = new Map<string, number>();

const wsRegistry = new Map<string, WebSocket>();
// Track explicitly closed WebSocket connections (to prevent auto-reconnect)
const wsClosedConnections = new Map<string, { reason: string; timestamp: number }>();
// Track paused WebSocket connections (connection stays open but paused)
const wsPausedConnections = new Map<string, { reason: string; timestamp: number; isPaused: boolean }>();
// Enhanced gRPC registry to support different call types
interface GrpcConfig {
  fileName: string;
  filePath: string;
  service: string;
  method: string;
  callType: 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional_streaming';
  requestType: string;
  responseType: string;
  metadata: Record<string, string>;
  payload: string;
}
interface GrpcRegistryEntry {
  client: grpc.Client; // Generic gRPC client
  call?: any; // Active call stream
  method: string;
  target: string;
  protoFilePath: string;
  package: string,
  service: string;
  callType: GrpcConfig['callType'];
  metadata: grpc.Metadata;
}

// Global registry for gRPC connections
const grpcRegistry = new Map<string, GrpcRegistryEntry>();


// Or if you want to keep the explicit structure:
const wsMessageStore = new Map<string, Array<{
  kind: "system-open" | "system-close" | "system-pause" | "system-error" | "recv" | "sent";
  ts: number;
  wsId: string;
  // For system-open
  url?: string | null;
  // For system-close
  code?: number|string;
  reason?: string;
  wasClean?: boolean;
  // For system-error
  message?: string;
  cause?: any;
  name?: string;
  // For recv and sent
  data?: any;
}>>();

const grpcMessageStore = new Map<string, Array<{
  data: any;
  timestamp: number;
  type?: string;
  kind?: string
}>>();

// GraphQL Subscription registries
const gqlSubscriptionRegistry = new Map<string, { client: Client; dispose: () => void }>();
const gqlSubscriptionConnectedState = new Map<string, boolean>(); // Track if connection was successfully established
const gqlSubscriptionStore = new Map<string, Array<{
  kind: 'data' | 'error' | 'complete' | 'system-open' | 'system-close' | 'system-error';
  ts: number;
  subscriptionId: string;
  data?: any;
  error?: any;
  message?: string;
  url?: string;
  code?: string | number;
  reason?: string;
}>>();
const gqlSubscriptionClosedConnections = new Map<string, { reason: string; timestamp: number }>();
const gqlSubscriptionConfigs = new Map<string, { url: string; query: string; variables?: any; headers?: Array<{key: string; value: string; enabled?: boolean}>; protocol?: string; createdAt: number }>();

// Periodic cleanup for inactive WebSocket connections
const WS_INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds
const CLEANUP_INTERVAL = 60 * 1000; // Check every minute

function startWebSocketCleanup() {
  setInterval(() => {
    const now = Date.now();

    for (const [wsId, ws] of wsRegistry.entries()) {
      // Get the last message timestamp for this WebSocket
      const messages = wsMessageStore.get(wsId) || [];

      // Find the most recent message timestamp
      const lastMessageTime = messages.length > 0
        ? Math.max(...messages.map(msg => msg.ts))
        : wsConfigs.get(wsId)?.createdAt || 0;

      const inactiveTime = now - lastMessageTime;

      // Close if inactive for more than 5 minutes
      if (inactiveTime > WS_INACTIVITY_TIMEOUT) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(4002, "Closed due to inactivity");
        }

        // Cleanup
        wsRegistry.delete(wsId);
        wsConfigs.delete(wsId);

        // Clean up message store after a delay
        setTimeout(() => {
          wsMessageStore.delete(wsId);
          wsClosedConnections.delete(wsId);
          wsPausedConnections.delete(wsId);
        }, 1000 * 60 * 5);
      }
    }

    // Also cleanup gRPC connections
    for (const [grpcId, g] of grpcRegistry.entries()) {
      const messages = grpcMessageStore.get(grpcId) || [];
      const lastMessageTime = messages.length > 0
        ? Math.max(...messages.map(msg => msg.timestamp))
        : 0;

      const inactiveTime = now - lastMessageTime;
      if (inactiveTime > WS_INACTIVITY_TIMEOUT) {
        if (g.call && typeof g.call.end === 'function') {
          g.call.end(() => {
            sendToWindow("grpc-stream-end", {
              grpcId,
              reason: 'Closed due to inactivity',
            });
          });
        }

        try {
          g.client.close();
        } catch { }
        grpcRegistry.delete(grpcId);

        setTimeout(() => {
          grpcMessageStore.delete(grpcId);
          wsClosedConnections.delete(grpcId);
        }, 1000 * 60 * 5);
      }
    }

    // Also cleanup GraphQL subscriptions
    for (const [subscriptionId, { client, dispose }] of gqlSubscriptionRegistry.entries()) {
      const messages = gqlSubscriptionStore.get(subscriptionId) || [];
      const lastMessageTime = messages.length > 0
        ? Math.max(...messages.map(msg => msg.ts))
        : gqlSubscriptionConfigs.get(subscriptionId)?.createdAt || 0;

      const inactiveTime = now - lastMessageTime;

      // Close if inactive for more than 5 minutes
      if (inactiveTime > WS_INACTIVITY_TIMEOUT) {
        dispose(); // Clean up subscription
        client.dispose(); // Close client connection

        // Cleanup
        gqlSubscriptionRegistry.delete(subscriptionId);
        gqlSubscriptionConnectedState.delete(subscriptionId);
        gqlSubscriptionConfigs.delete(subscriptionId);

        // Clean up message store after a delay
        setTimeout(() => {
          gqlSubscriptionStore.delete(subscriptionId);
          gqlSubscriptionClosedConnections.delete(subscriptionId);
        }, 1000 * 60 * 5);
      }
    }
  }, CLEANUP_INTERVAL);
}
/**
 * Check if a header exists (case-insensitive)
 * HTTP headers are case-insensitive per RFC 2616
 */
function hasHeader(headers: Record<string, string>, headerName: string): boolean {
  const lowerHeaderName = headerName.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerHeaderName);
}

/**
 * Delete a header (case-insensitive)
 * HTTP headers are case-insensitive per RFC 2616
 */
function deleteHeader(headers: Record<string, string>, headerName: string): void {
  const lowerHeaderName = headerName.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerHeaderName) {
      delete headers[key];
    }
  }
}

/**
 * Add default HTTP headers that browsers/HTTP clients normally add automatically
 * This allows us to capture and display all headers that will be sent
 *
 * Note: Some headers like Connection may be overridden by undici/fetch
 */
function addDefaultHeaders(headers: Record<string, string>, url: string, method: string, hasBody: boolean): void {
  const parsedUrl = new URL(url);

  // User-Agent - if not already set
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = "Voiden/1.0 (Electron)";
  }

  // Accept - if not already set
  if (!headers["Accept"] && !headers["accept"]) {
    headers["Accept"] = "*/*";
  }

  // Accept-Encoding - if not already set
  if (!headers["Accept-Encoding"] && !headers["accept-encoding"]) {
    headers["Accept-Encoding"] = "gzip, deflate, br";
  }

  // Host - always set from URL
  if (!headers["Host"] && !headers["host"]) {
    headers["Host"] = parsedUrl.host;
  }

  // Connection - undici typically uses 'close' for HTTP/1.1
  // We'll set what undici actually uses
  if (!headers["Connection"] && !headers["connection"]) {
    headers["Connection"] = "close";
  }

  // Accept-Language - if not already set
  if (!headers["Accept-Language"] && !headers["accept-language"]) {
    headers["Accept-Language"] = "en-US,en;q=0.9";
  }

  // Sec-Fetch-Mode - added by undici for CORS requests
  if (!headers["Sec-Fetch-Mode"] && !headers["sec-fetch-mode"]) {
    headers["Sec-Fetch-Mode"] = "cors";
  }

  // Sec-Fetch-Site - added by undici
  if (!headers["Sec-Fetch-Site"] && !headers["sec-fetch-site"]) {
    headers["Sec-Fetch-Site"] = "cross-site";
  }

  // Sec-Fetch-Dest - added by undici for non-navigation requests
  if (!headers["Sec-Fetch-Dest"] && !headers["sec-fetch-dest"]) {
    headers["Sec-Fetch-Dest"] = "empty";
  }

  // Content-Length - will be set automatically by fetch for body requests
  // We don't set it manually as fetch handles it better
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".txt": "text/plain",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function createMultipartBlob(bytes: ArrayBuffer | ArrayLike<number>, type?: string): Blob {
  return new Blob([Buffer.from(bytes as ArrayLike<number>)], {
    type: type || "application/octet-stream",
  });
}

/**
 * Get dispatcher (Agent or ProxyAgent) based on settings
 * Returns the dispatcher and proxy info for metadata
 */
function getDispatcher(
  settings: any,
  requestUrl: string,
): { dispatcher?: Agent | ProxyAgent; proxyInfo?: { name: string; host: string; port: number } } {
  const disableTls = settings?.requests?.disable_tls_verification === true;
  const timeoutSec = settings?.requests?.timeout ?? 300;
  const timeoutMs = timeoutSec > 0 ? timeoutSec * 1000 : 0;
  const proxyEnabled = settings?.proxy?.enabled === true;
  const activeProxyId = settings?.proxy?.activeProxyId;

  // If no proxy is enabled, return TLS agent if needed
  if (!proxyEnabled || !activeProxyId) {
    if (disableTls) {
      return { dispatcher: new Agent({ connect: { rejectUnauthorized: false }, bodyTimeout: timeoutMs, headersTimeout: timeoutMs }) };
    }
    return { dispatcher: new Agent({ bodyTimeout: timeoutMs, headersTimeout: timeoutMs }) };
  }

  // Find the active proxy configuration
  const activeProxy = settings.proxy.proxies?.find((p: any) => p.id === activeProxyId);
  if (!activeProxy) {
    if (disableTls) {
      return { dispatcher: new Agent({ connect: { rejectUnauthorized: false }, bodyTimeout: timeoutMs, headersTimeout: timeoutMs }) };
    }
    return { dispatcher: new Agent({ bodyTimeout: timeoutMs, headersTimeout: timeoutMs }) };
  }

  // Check if domain is excluded from proxy
  if (activeProxy.excludedDomains && activeProxy.excludedDomains.length > 0) {
    try {
      const hostname = new URL(requestUrl).hostname;
      const isExcluded = activeProxy.excludedDomains.some((pattern: string) => {
        if (pattern.startsWith("*.")) {
          // Wildcard match: *.internal matches api.internal, service.internal
          const suffix = pattern.substring(1); // Remove * to get .internal
          return hostname.endsWith(suffix) || hostname === suffix.substring(1); // Match .internal or internal
        }
        // Exact match
        return hostname === pattern;
      });

      if (isExcluded) {
        if (disableTls) {
          return { dispatcher: new Agent({ connect: { rejectUnauthorized: false }, bodyTimeout: timeoutMs, headersTimeout: timeoutMs }) };
        }
        return { dispatcher: new Agent({ bodyTimeout: timeoutMs, headersTimeout: timeoutMs }) };
      }
    } catch (error) {
      // Continue with proxy on parse error
    }
  }

  // Build proxy URL
  const protocol = "http"; // Proxies typically use HTTP protocol
  let proxyUrl = `${protocol}://${activeProxy.host}:${activeProxy.port}`;

  // Add auth if enabled
  if (activeProxy.auth && activeProxy.username) {
    const username = encodeURIComponent(activeProxy.username);
    const password = activeProxy.password ? encodeURIComponent(activeProxy.password) : "";
    proxyUrl = `${protocol}://${username}:${password}@${activeProxy.host}:${activeProxy.port}`;
  }

  // Create ProxyAgent with TLS settings
  return {
    dispatcher: new ProxyAgent({
      uri: proxyUrl,
      connect: disableTls ? { rejectUnauthorized: false } : undefined,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    }),
    proxyInfo: {
      name: activeProxy.name,
      host: activeProxy.host,
      port: activeProxy.port,
    },
  };
}

function applyProxyEnvForGrpc(settings: any, requestUrl: string) {
  try {
    const proxyEnabled = settings?.proxy?.enabled === true;
    const activeProxyId = settings?.proxy?.activeProxyId;
    if (!proxyEnabled || !activeProxyId) return;

    const u = new URL(requestUrl);
    const active = settings.proxy.proxies?.find((p: any) => p.id === activeProxyId);
    if (!active) return;

    // honor excludedDomains
    const hostname = u.hostname;
    const excluded = (active.excludedDomains || []).some((pattern: string) => {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.substring(1);
        return hostname.endsWith(suffix) || hostname === suffix.substring(1);
      }
      return hostname === pattern;
    });
    if (excluded) return;

    const auth = active.auth && active.username ? `${encodeURIComponent(active.username)}:${encodeURIComponent(active.password || "")}@` : "";
    const proxyUrl = `http://${auth}${active.host}:${active.port}`;

    // Set envs for grpc-js proxy tunneling (CONNECT)
    if (u.protocol === "grpcs:") process.env.HTTPS_PROXY = proxyUrl;
    else process.env.HTTP_PROXY = proxyUrl;

    if (active.excludedDomains?.length) {
      // Add to NO_PROXY so grpc-js bypasses those hosts
      const list = active.excludedDomains.join(",");
      process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${list}` : list;
    }
  } catch { }
}

// Store WebSocket configurations for later creation
const wsConfigs = new Map<string, {
  url: string;
  headers?: Record<string, string>;
  protocols?: string | string[];
  dispatcher?: Agent | ProxyAgent;
  proxyInfo?: any;
  createdAt: number;
}>();

function handleWsConnection(
  url: string,
  {
    headers,
    dispatcher,
    protocols,
    proxyInfo,
    dedupeKey,
    originalRequestMeta,
  }: {
    headers?: Record<string, string>;
    dispatcher?: any;
    protocols?: string | string[];
    proxyInfo?: any;
    dedupeKey?: string;
    originalRequestMeta?: { method?: string; url?: string };
  },
) {
  if (dedupeKey) {
    const key = String(dedupeKey);
    const now = Date.now();
    const last = lastByWcAndKey.get(key) || 0;
    if (now - last < 100) {
      return {
        status: 0,
        statusText: "duplicate-suppressed",
        requestMeta: {
          method: originalRequestMeta?.method || "GET",
          url: originalRequestMeta?.url || "",
        },
      };
    }
    lastByWcAndKey.set(key, now);
  }

  const wsId = makeId();

  // Store configuration for later WebSocket creation
  wsConfigs.set(wsId, {
    url,
    headers,
    protocols,
    dispatcher,
    proxyInfo,
    createdAt: Date.now()
  });

  const metaHeaders = Object.entries(headers || {}).map(([k, v]) => ({ key: k, value: v as string }));

  const result: any = {
    ok: true,
    wsId,
    protocol: 'wss',
    requestMeta: {
      url,
      headers: metaHeaders,
      proxy: proxyInfo,
    },
  };

  if (protocols !== undefined) {
    result.requestMeta.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
  }

  return result;
}


function encodeEchoRequestString(input: Buffer): Buffer {
  // We treat the incoming Buffer as UTF-8 text for the 'message' field
  const payload = input; // already a Buffer

  const len = payload.length;

  // Encode length as protobuf varint
  const lenBytes: number[] = [];
  let n = len;
  while (n > 127) {
    lenBytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  lenBytes.push(n);

  // field #1, wire type 2 (length-delimited) => tag = 0x0A
  const tag = 0x0a;

  return Buffer.concat([Buffer.from([tag, ...lenBytes]), payload]);
}

const makeId = () => {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}


// Shared gRPC opener used by both send-request and send-secure-request
async function handleGrpcConnection(url: string, protocol: string, headers: Record<string, string> | undefined, settings: any) {
  const u = new URL(url);
  const insecure = protocol === "grpc:";
  const defaultPort = insecure ? 80 : 443;
  const address = `${u.hostname}:${u.port || defaultPort}`;

  // Derive method from URL path, e.g. /pkg.Service/Method
  let methodPath = u.pathname && u.pathname !== "/" ? decodeURIComponent(u.pathname) : undefined;
  if (methodPath && !methodPath.startsWith("/")) methodPath = `/${methodPath}`;
  if (!methodPath) {
    return { status: 0, statusText: "grpc-method-required" };
  }

  applyProxyEnvForGrpc(settings, url);

  const creds = insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  const channelOptions: grpc.ChannelOptions = {
    "grpc.ssl_target_name_override": u.hostname,
    "grpc.default_authority": u.hostname,
  };
  const client = new grpc.Client(address, creds, channelOptions);

  const grpcId = makeId();
  grpcRegistry.set(grpcId, { client, method: methodPath, target: address });

  // Wait for the channel to be ready before starting the stream
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000; // 5s timeout
      client.waitForReady(deadline, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  } catch (err: any) {
    sendToWindow("ws-error", {
      grpcId,
      message: err?.message || "gRPC connection error",
    });
    try {
      client.close();
    } catch { }
    grpcRegistry.delete(grpcId);
    // Return early to prevent further execution
    return {
      ok: false,
      grpcId,
      requestMeta: {
        target: address,
        method: methodPath,
        insecure,
        headers: Object.entries(headers || {}).map(([k, v]) => ({ key: k, value: v as string })),
      },
      error: err?.message || "gRPC connection error",
    };
  }

  // Raw bidi stream with Buffer payloads
  const definition: grpc.MethodDefinition<Buffer, Buffer> = {
    path: methodPath!,
    requestStream: true,
    responseStream: true,
    requestSerialize: (v: Buffer) => encodeEchoRequestString(v),
    requestDeserialize: (v: Buffer) => v,
    responseSerialize: (v: Buffer) => v,
    responseDeserialize: (v: Buffer) => v,
    originalName: undefined as any,
  };

  // Map headers to gRPC metadata
  const md = new grpc.Metadata();
  for (const [k, v] of Object.entries(headers || {})) {
    if (v != null) md.set(k, String(v));
  }

  const call = client.makeBidiStreamRequest(definition.path, definition.requestSerialize, definition.responseDeserialize, md);

  grpcRegistry.set(grpcId, { client, call, method: methodPath, target: address });

  setTimeout(() => {
    // NOW we know the channel is ready, treat it as "open"
    sendToWindow("ws-open", { grpcId, url: `${address}${methodPath}`, protocols: ["grpc"] });
  }, 2000);

  call.on("data", (chunk: Buffer) => {
    sendToWindow("ws-message", { grpcId, data: chunk });
  });

  call.on("error", (err: any) => {
    sendToWindow("ws-error", {
      grpcId,
      message: err?.message || "gRPC error",
      code: err?.code,
      details: err?.details,
    });
  });

  call.on("end", () => {
    sendToWindow("ws-close", { grpcId, code: 0, reason: "end", wasClean: true });
    try {
      client.close();
    } catch { }
    grpcRegistry.delete(grpcId);
  });

  return {
    ok: true,
    grpcId,
    protocol: 'grpc',
    requestMeta: {
      target: address,
      url: url,
      method: methodPath,
      insecure,
      headers: Object.entries(headers || {}).map(([k, v]) => ({ key: k, value: v as string })),
    },
  };
}

export function registerRequestIpcHandler() {
  startWebSocketCleanup();
  ipcMain.handle("send-request", async (_event, { urlForRequest, fetchOptions, signalState }) => {
    const settings = getSettings();
    const controller = new AbortController();
    const signal = controller.signal;
    fetchOptions.signal = signal;

    if (signalState?.aborted) {
      controller.abort();
    }

    try {
      // --- New: branch by protocol (WS vs HTTP) ---
      const protocol = new URL(urlForRequest).protocol;
      if (protocol === "ws:" || protocol === "wss:") {
        // Configure dispatcher (proxy or TLS agent) for WS too
        const { dispatcher, proxyInfo } = getDispatcher(settings, urlForRequest);

        const headers = fetchOptions?.headers ?? undefined;
        const protocols =
          fetchOptions?.protocols && Array.isArray(fetchOptions.protocols)
            ? fetchOptions.protocols
            : typeof fetchOptions?.protocols === "string"
              ? fetchOptions.protocols
              : undefined;

        return handleWsConnection(urlForRequest, {
          headers,
          dispatcher,
          protocols,
          proxyInfo,
        });
      }
      // --- End WS path ---

      if (protocol === "grpc:" || protocol === "grpcs:") {
        return await handleGrpcConnection(urlForRequest, protocol, (fetchOptions?.headers || {}) as Record<string, string>, settings);
      }

      const { body, bodyHint } = fetchOptions;

      if (bodyHint === "FormData") {
        const formData = new FormData();
        for (const item of body) {
          if (typeof item[1] !== "object") {
            formData.append(item[0], item[1]);
            continue;
          }

          formData.append(
            item[0],
            createMultipartBlob(item[1].buffer, item[1].type),
            item[1].name,
          );
        }
        fetchOptions.body = formData;
      } else if (bodyHint === "File") {
        fetchOptions.body = Buffer.from(body.buffer);
      }

      // Configure dispatcher (proxy or TLS agent)
      const { dispatcher, proxyInfo } = getDispatcher(settings, urlForRequest);
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const response = await fetch(urlForRequest, fetchOptions);
      const buffer = response.body ? await response.arrayBuffer() : null;

      return {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body: buffer ? Buffer.from(buffer) : null,
        requestMeta: {
          method: fetchOptions.method,
          url: urlForRequest,
          headers: Object.entries(fetchOptions.headers || {}).map(([k, v]) => ({ key: k, value: v as string })),
          httpVersion: (response as any).httpVersion || "HTTP/1.1",
          proxy: proxyInfo,
        },
      };
    } catch (error: any) {
      return {
        statusText: error?.cause?.code || error?.message,
      };
    }
  });



  /**
   * Secure request handler that replaces environment variables in Electron.
   * UI sends raw request with {{variables}}, Electron replaces and executes.
   *
   * @security Environment values never exposed to UI
   */
  ipcMain.handle("send-secure-request", async (_event, { requestState, signalState }) => {
    const settings = getSettings();
    const activeProject = await getActiveProject();
    const controller = new AbortController();
    const signal = controller.signal;

    // Declare variables outside try block so they're accessible in catch
    let url = requestState.url;
    let headers: Record<string, string> = {};
    let protocol;
    if (signalState?.aborted) {
      controller.abort();
    }
    try {
      // 1. Replace variables in URL
      if (activeProject) {
        url = await replaceVariablesSecure(url, activeProject);
      }

      // 2. Replace variables in headers
      for (const header of requestState.headers || []) {
        if (header.enabled !== false) {
          let key = header.key;
          let value = header.value;

          if (activeProject) {
            key = await replaceVariablesSecure(key, activeProject);
            value = await replaceVariablesSecure(value, activeProject);
          }

          headers[key] = value;
        }
      }

      // 3. Replace variables in query params (add to URL)
      if (requestState.queryParams && requestState.queryParams.length > 0) {
        const queryParts: string[] = [];
        for (const param of requestState.queryParams) {
          if (param.enabled !== false) {
            let key = param.key;
            let value = param.value;

            if (activeProject) {
              key = await replaceVariablesSecure(key, activeProject);
              value = await replaceVariablesSecure(value, activeProject);
            }

            queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
          }
        }

        if (queryParts.length > 0) {
          const queryString = queryParts.join("&");
          url += url.includes("?") ? `&${queryString}` : `?${queryString}`;
        }
      }

      // 4. Replace variables in path params
      if (requestState.pathParams && requestState.pathParams.length > 0) {
        for (const param of requestState.pathParams) {
          if (param.enabled !== false) {
            let value = param.value;

            if (activeProject) {
              value = await replaceVariablesSecure(value, activeProject);
            }

            url = url.replace(`{${param.key}}`, encodeURIComponent(value));
          }
        }
      }

      // 5. Replace variables in body
      let body = requestState.body;
      if (body && activeProject) {
        body = await replaceVariablesSecure(body, activeProject);
      }

      // 6. Build fetch options
      // Determine redirect mode: per-request metadata overrides global setting
      const followRedirects = requestState.metadata?.follow_redirects !== undefined
        ? requestState.metadata.follow_redirects
        : settings?.requests?.follow_redirects ?? true;

      const fetchOptions: RequestInit = {
        method: requestState.method || "GET",
        headers,
        signal,
        redirect: followRedirects ? "follow" : "manual",
      };

      // 6. Handle binary file upload (for restFile nodes)
      if (requestState.binary) {
        if (typeof requestState.binary === "string") {
          // Binary is a file path string
          let filePath = requestState.binary;

          // If the path is relative, resolve it relative to activeProject
          if (filePath.startsWith("/") && activeProject && !filePath.startsWith(activeProject)) {
            filePath = path.join(activeProject, filePath);
          }

          try {
            // Read file from filesystem
            const fileBuffer = await fs.readFile(filePath);
            fetchOptions.body = fileBuffer as any;

            // Set Content-Type if not already set
            if (!hasHeader(headers, "Content-Type")) {
              headers["Content-Type"] = getMimeType(filePath);
            }
          } catch (error) {
            throw new Error(`Failed to read binary file: ${filePath}`);
          }
        } else {
          const binaryValue = requestState.binary as any;

          if (binaryValue && typeof binaryValue.arrayBuffer === "function") {
            fetchOptions.body = Buffer.from(await binaryValue.arrayBuffer()) as any;
          } else if (binaryValue && typeof binaryValue === "object" && "buffer" in binaryValue) {
            fetchOptions.body = Buffer.from(binaryValue.buffer) as any;
          } else {
            fetchOptions.body = binaryValue;
          }
        }
      }
      // Add body for non-GET requests
      else if (requestState.method !== "GET" && body) {
        fetchOptions.body = body;

        // Fallback: Set Content-Type header from contentType field if not already present
        // Note: Extensions should set Content-Type via pipeline hooks (RequestCompilation stage)
        // This is a fallback to ensure the header is set even if extensions aren't loaded
        if (requestState.contentType && !hasHeader(headers, "Content-Type")) {
          headers["Content-Type"] = requestState.contentType;
        }
      }

      // 7. Configure dispatcher (proxy or TLS agent)
      const { dispatcher, proxyInfo } = getDispatcher(settings, url);
      if (dispatcher) {
        (fetchOptions as RequestInit & { dispatcher?: Agent | ProxyAgent }).dispatcher = dispatcher;
      }

      // 8. Ensure URL has protocol
      if (
        !url.startsWith("http://") &&
        !url.startsWith("https://") &&
        !url.startsWith("ws://") &&
        !url.startsWith("wss://") &&
        !url.startsWith("grpc://") &&
        !url.startsWith("grpcs://")
      ) {
        url = `http://${url}`;
      }

      // 7. Handle body params (multipart/url-encoded)

      if (requestState.bodyParams && requestState.bodyParams.length > 0) {
        if (requestState.contentType === "multipart/form-data") {
          // Build FormData
          const formData = new FormData();
          for (const param of requestState.bodyParams) {
            if (param.enabled !== false) {
              if (param.type === "file" && param.value) {
                // Handle file - param.value is now a file path string
                let filePath = param.value as string;

                // If the path is relative (starts with /), resolve it relative to activeProject
                if (filePath.startsWith("/") && activeProject && !filePath.startsWith(activeProject)) {
                  filePath = path.join(activeProject, filePath);
                }

                try {
                  // Read file from filesystem
                  console.log(`Reading file for multipart upload: ${filePath}`);
                  const fileBuffer = await fs.readFile(filePath);
                  const fileName = path.basename(filePath);
                  formData.append(
                    param.key,
                    createMultipartBlob(fileBuffer, getMimeType(filePath)),
                    fileName,
                  );
                } catch (error) {
                  throw new Error(`Failed to read file: ${error}`);
                }
              } else if (param.type === "text") {
                // Handle text value
                let value = param.value as string;
                if (activeProject) {
                  value = await replaceVariablesSecure(value, activeProject);
                }
                formData.append(param.key, value);
              }
            }
          }
          fetchOptions.body = formData as any;

          // Remove Content-Type header - browser will set it with boundary
          deleteHeader(headers, "Content-Type");
        } else if (requestState.contentType === "application/x-www-form-urlencoded") {
          // Build URLSearchParams
          const params = new URLSearchParams();
          for (const param of requestState.bodyParams) {
            if (param.enabled !== false && param.type === "text") {
              let value = param.value as string;
              if (activeProject) {
                value = await replaceVariablesSecure(value, activeProject);
              }
              params.append(param.key, value);
            }
          }
          fetchOptions.body = params.toString();
          // Only set Content-Type if not already present
          if (!hasHeader(headers, "Content-Type")) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
          }
        }
      }

      // --- New: if the final compiled URL is WS(S), open a WebSocket and return immediately ---
      protocol = new URL(url).protocol;
      if (protocol === "ws:" || protocol === "wss:") {
        const headersForWs = fetchOptions?.headers ?? undefined;
        const key = String(requestState?.url || "");
        return handleWsConnection(url, {
          headers: headersForWs as any,
          dispatcher: (fetchOptions as any).dispatcher,
          proxyInfo,
          dedupeKey: key,
          originalRequestMeta: {
            method: requestState?.method,
            url: requestState?.url,
          },
        });
      }
      // --- End WS path ---

      if (requestState.protocolType === 'grpc' && requestState.grpc) {
        return await handleGrpcRequest(requestState, settings, activeProject || '');
      }

      // Handle GraphQL subscriptions - don't execute, just store config
      if (requestState.protocolType === 'graphql' && requestState.operationType === 'subscription') {
        // Extract GraphQL query and variables from body
        let query = '';
        let variables = {};
        
        if (requestState.body) {
          try {
            const parsed = JSON.parse(requestState.body);
            query = parsed.query || '';
            variables = parsed.variables || {};
          } catch (e) {
            // Failed to parse GraphQL body
          }
        }

        // Generate subscription ID from URL + query
        const subscriptionId = `gql_${Buffer.from(requestState.url + query).toString('base64').slice(0, 32)}`;
        
        // Check if subscription already exists and close it first
        const existingConnection = gqlSubscriptionRegistry.get(subscriptionId);
        if (existingConnection) {
          try {
            // Dispose of the subscription and client
            existingConnection.dispose();
            existingConnection.client.dispose();
            
            // Remove from registries
            gqlSubscriptionRegistry.delete(subscriptionId);
            gqlSubscriptionConnectedState.delete(subscriptionId);
            gqlSubscriptionClosedConnections.delete(subscriptionId);
            
            // Send close event to UI
            sendToWindow('graphql-subscription-close', {
              subscriptionId,
              reason: 'Replaced by new subscription',
              code: 1000,
            });
            
            // Wait a bit to ensure cleanup is complete
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (e) {
            // Error closing existing subscription
          }
        }
        
        // Store configuration for later connection with protocol fallback support
        gqlSubscriptionConfigs.set(subscriptionId, {
          url: requestState.url,
          query,
          variables,
          headers: requestState.headers || [],
          protocol: 'graphql-ws', // Default protocol, will fallback to others if needed
          createdAt: Date.now(),
        });

        // Return immediately with subscription ID (similar to wsId and grpcId)
        return {
          ok: true,
          status: 200,
          protocol: 'graphql',
          operationType: 'subscription',
          subscriptionId,
          statusText: 'Subscription Ready',
          headers: [],
          requestMeta: {
            url: requestState.url,
            method: requestState.method,
            headers: requestState.headers || [],
          },
        };
      }

      // 9. Add default HTTP headers explicitly (after all other processing)
      // This allows us to capture and display ALL headers that will be sent
      const hasBody = fetchOptions.body !== undefined;
      addDefaultHeaders(headers, url, requestState.method || "GET", hasBody);

      // 10. Execute request

      const response = await fetch(url, fetchOptions);
      const buffer = response.body ? await response.arrayBuffer() : null;

      // Capture headers from fetchOptions to ensure we get all modifications
      const finalHeaders = (fetchOptions.headers as Record<string, string>) || {};
      const requestMetaHeaders = Object.entries(finalHeaders).map(([k, v]) => ({ key: k, value: v as string }));

      // Determine TLS info based on URL and response
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";
      const tlsInfo = isHttps
        ? {
          protocol: "TLS 1.3", // Modern default
          cipher: "TLS_AES_128_GCM_SHA256", // Common cipher suite
          isSecure: true,
          // Note: fetch API doesn't expose certificate details
          // In a production app, you'd use undici's request() to get actual TLS info
        }
        : undefined;

      // Determine protocol type - check for GraphQL first, then default to rest
      const responseProtocol = requestState.protocolType === 'graphql' ? 'graphql' : 'rest';

      // Build a displayable version of the request body (no binary data)
      let requestBodySent: string | null = null;
      let requestBodyContentType: string | null = null;
      if (body && typeof body === 'string') {
        requestBodySent = body;
        requestBodyContentType = requestState.contentType || headers['Content-Type'] || null;
      } else if (requestState.bodyParams && requestState.bodyParams.length > 0) {
        if (requestState.contentType === 'multipart/form-data') {
          // Summarize multipart params (exclude binary content)
          const parts = requestState.bodyParams
            .filter((p: any) => p.enabled !== false)
            .map((p: any) => p.type === 'file'
              ? `${p.key}: [file] ${typeof p.value === 'string' ? p.value.split('/').pop() : 'binary'}`
              : `${p.key}: ${p.value}`);
          requestBodySent = parts.join('\n');
          requestBodyContentType = 'multipart/form-data';
        } else if (requestState.contentType === 'application/x-www-form-urlencoded') {
          const parts = requestState.bodyParams
            .filter((p: any) => p.enabled !== false && p.type === 'text')
            .map((p: any) => `${p.key}=${p.value}`);
          requestBodySent = parts.join('&');
          requestBodyContentType = 'application/x-www-form-urlencoded';
        }
      }

      return {
        status: response.status,
        protocol: responseProtocol,
        operationType: requestState.operationType, // Include operation type for GraphQL (query/mutation/subscription)
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body: buffer ? Buffer.from(buffer) : null,
        requestMeta: {
          method: fetchOptions.method,
          url,
          headers: requestMetaHeaders,
          httpVersion: (response as Response & { httpVersion?: string }).httpVersion || "HTTP/1.1",
          proxy: proxyInfo,
          tlsInfo,
          body: requestBodySent,
          bodyContentType: requestBodyContentType,
        },
      };
    } catch (error: any) {
      // Build requestMeta from the request state even on error
      let requestMetaHeaders: { key: string; value: string }[] = [];
      try {
        // Try to include headers if they were set before the error
        if (typeof headers !== "undefined") {
          requestMetaHeaders = Object.entries(headers).map(([k, v]) => ({ key: k, value: v as string }));
        } else if (requestState.headers) {
          // Fallback to original request headers
          requestMetaHeaders = requestState.headers.filter((h) => h.enabled !== false).map((h) => ({ key: h.key, value: h.value }));
        }
      } catch { }

      const errorMessage = error?.message || "Request failed";
      const protocolType: string = requestState.protocolType || protocol?.replace(':', '') || '';

      // Return error response based on protocol type
      if (protocolType.toLowerCase() === 'graphql') {
        return {
          ok: false,
          status: 0,
          statusText: "graphql-error",
          error: errorMessage,
          protocol: 'graphql',
          operationType: requestState.operationType,
          requestMeta: {
            url: requestState.url || url,
            method: requestState.method,
            headers: requestMetaHeaders,
          },
        };
      }

      if (protocolType.toLowerCase() === 'grpc' || protocolType.toLowerCase() === 'grpcs') {
        return {
          ok: false,
          status: 0,
          statusText: "grpc-error",
          error: errorMessage,
          protocol: 'grpc',
          requestMeta: {
            url: requestState.url || 'grpc://unknown',
            method: requestState.grpc?.method || 'unknown',
            service: requestState.grpc?.service || 'unknown',
            target: requestState.grpc?.target || 'unknown',
            headers: requestMetaHeaders,
          },
        };
      }

      if (protocolType.toLowerCase() === 'ws' || protocolType.toLowerCase() === 'wss') {
        return {
          ok: false,
          status: 0,
          wsId: null,
          error: errorMessage,
          protocol: 'ws',
          requestMeta: {
            url: requestState.url || 'ws://unknown',
            headers: requestMetaHeaders,
          },
        };
      }
      // Default REST/HTTP error response
      return {
        ok: false,
        status: 0,
        statusText: errorMessage,
        error: errorMessage,
        protocol: protocolType || protocol || 'rest',
        protocolType: protocolType || 'rest',
        operationType: requestState.operationType, // Include for GraphQL
        requestMeta: {
          method: requestState.method || "GET",
          url: url || requestState.url,
          headers: requestMetaHeaders,
          httpVersion: "HTTP/1.1",
        },
      };
    }
  });

  ipcMain.handle("ws-connect", (_, wsId: string) => {
    // Check if this WebSocket is paused - don't reconnect, just show stored messages
    const pausedInfo = wsPausedConnections.get(wsId);
    if (pausedInfo) {
      // Connection is paused, replay stored messages without reconnecting
      const storedMessages = wsMessageStore.get(wsId) || [];

      if (storedMessages.length > 0) {
        // Replay all stored messages to the frontend
        setTimeout(() => {
          for (const msg of storedMessages) {
            if (msg.kind === 'system-open') {
              sendToWindow('ws-open', { wsId: msg.wsId, url: msg.url });
            } else if (msg.kind === 'recv') {
              sendToWindow('ws-message', { wsId: msg.wsId, data: msg.data });
            } else if (msg.kind === 'sent') {
              sendToWindow('ws-message-sent', { wsId: msg.wsId, data: msg.data });
            } else if (msg.kind === 'system-error') {
              sendToWindow('ws-error', {
                wsId: msg.wsId,
                message: msg.message,
                code: msg.code,
                cause: msg.cause,
                name: msg.name
              });
            } else if (msg.kind === 'system-close') {
              sendToWindow('ws-close', {
                wsId: msg.wsId,
                code: msg.code,
                reason: msg.reason,
                wasClean: msg.wasClean
              });
            } else if (msg.kind === 'system-pause') {
              sendToWindow('ws-pause', {
                wsId: msg.wsId,
                code: msg.code || 4001,
                reason: msg.reason,
                wasClean: msg.wasClean
              });
            }
          }
        }, 100);
      }

      return {
        ok: false,
        wsId,
        message: `Connection is paused: ${pausedInfo.reason}. Use Resume to continue.`,
        wasPaused: true,
        storedMessageCount: storedMessages.length
      };
    }

    // Check if this WebSocket was explicitly closed
    const closedInfo = wsClosedConnections.get(wsId);
    if (closedInfo) {
      // Connection was previously closed, replay stored messages without reconnecting
      const storedMessages = wsMessageStore.get(wsId) || [];

      if (storedMessages.length > 0) {
        // Replay all stored messages to the frontend
        setTimeout(() => {
          for (const msg of storedMessages) {
            if (msg.kind === 'system-open') {
              sendToWindow('ws-open', { wsId: msg.wsId, url: msg.url });
            } else if (msg.kind === 'recv') {
              sendToWindow('ws-message', { wsId: msg.wsId, data: msg.data });
            } else if (msg.kind === 'sent') {
              sendToWindow('ws-message-sent', { wsId: msg.wsId, data: msg.data });
            } else if (msg.kind === 'system-error') {
              sendToWindow('ws-error', {
                wsId: msg.wsId,
                message: msg.message,
                code: msg.code,
                cause: msg.cause,
                name: msg.name
              });
            } else if (msg.kind === 'system-close') {
              sendToWindow('ws-close', {
                wsId: msg.wsId,
                code: msg.code,
                reason: msg.reason,
                wasClean: msg.wasClean
              });
            } else if (msg.kind === 'system-pause') {
              sendToWindow('ws-pause', {
                wsId: msg.wsId,
                code: msg.code || 4001,
                reason: msg.reason,
                wasClean: msg.wasClean
              });
            }
          }
        }, 100);
      } else {
        // No historical messages - send error notification
        setTimeout(() => {
          sendToWindow('ws-error', {
            wsId,
            message: `Connection was closed: ${closedInfo.reason}. Message history has been cleared. Click "Reconnect" to establish a new connection.`,
            code: 'CONNECTION_CLOSED_NO_HISTORY'
          });
        }, 100);
      }

      return {
        ok: false,
        wsId,
        message: storedMessages.length > 0
          ? `Connection was closed: ${closedInfo.reason}. Showing historical messages.`
          : `Connection was closed: ${closedInfo.reason}. No historical messages available.`,
        wasClosed: true,
        storedMessageCount: storedMessages.length
      };
    }

    // Check if WebSocket is already active
    const existingWs = wsRegistry.get(wsId);
    if (existingWs) {
      if (existingWs.readyState === WebSocket.CLOSING || existingWs.readyState === WebSocket.CLOSED) {
        existingWs
      }

      // Get stored messages for this WebSocket
      const storedMessages = wsMessageStore.get(wsId) || [];

      // Sort messages by timestamp to ensure chronological order
      const sortedMessages = [...storedMessages].sort((a, b) => a.ts - b.ts);

      for (const msg of sortedMessages) {
        switch (msg.kind) {
          case "system-open":
            // Send open event first if it exists
            sendToWindow("ws-open", {
              wsId: msg.wsId,
              url: msg.url,
              protocols: msg.protocols,
              proxy: msg.proxyInfo,
              isReplayed: true
            });
            break;

          case "system-close":
            // Only send close if WebSocket is actually closed
            if (existingWs.readyState === WebSocket.CLOSED) {
              sendToWindow("ws-close", {
                wsId: msg.wsId,
                code: msg.code,
                reason: msg.reason,
                wasClean: msg.wasClean,
                isReplayed: true
              });
            }
            break;

          case "system-pause":
            sendToWindow("ws-pause", {
              wsId: msg.wsId,
              code: msg.code || 4001,
              reason: msg.reason,
              wasClean: msg.wasClean,
              isReplayed: true
            });
            break;

          case "system-error":
            sendToWindow("ws-error", {
              wsId: msg.wsId,
              message: msg.message,
              code: msg.code,
              cause: msg.cause,
              name: msg.name,
              isReplayed: true
            });
            break;

          case "recv":
            sendToWindow("ws-message", {
              wsId: msg.wsId,
              data: msg.data,
              isReplayed: true,
              originalTimestamp: msg.ts
            });
            break;

          case "sent":
            sendToWindow("ws-message-sent", {
              wsId: msg.wsId,
              data: msg.data,
              isReplayed: true,
              originalTimestamp: msg.ts
            });
            break;
        }
      }

      // Send current status if WebSocket is still open
      const currentStatus = getWsStatus(existingWs);
      if (currentStatus === "open") {
        // Send a synthetic "already-open" event to inform frontend
        sendToWindow("ws-already-open", {
          wsId,
          currentStatus,
          storedMessagesCount: sortedMessages.length
        });
      }

      // Return current status
      return
    }

    const config = wsConfigs.get(wsId);
    if (!config) {
      return {
        ok: false,
        error: `No WebSocket configuration found for wsId: ${wsId}`,
        wsId
      };
    }

    // Create the WebSocket
    const ws = new WebSocket(config.url, {
      protocols: config.protocols,
      headers: config.headers,
      dispatcher: config.dispatcher,
    });
    wsRegistry.set(wsId, ws);

    // Initialize message store for this WebSocket
    if (!wsMessageStore.has(wsId)) {
      wsMessageStore.set(wsId, []);
    }
    ws.addEventListener("open", () => {

      // Store system-open event
      const storedMessages = wsMessageStore.get(wsId) || [];
      storedMessages.push({
        kind: "system-open" as const,
        ts: Date.now(),
        wsId,
        url: config.url
      });
      wsMessageStore.set(wsId, storedMessages);

      sendToWindow("ws-open", {
        wsId,
        url: config.url,
        protocols: config.protocols,
        proxy: config.proxyInfo
      });
    });

    ws.addEventListener("message", (msg: any) => {
      // Check if connection is paused - if so, don't process messages
      const pausedInfo = wsPausedConnections.get(wsId);
      if (pausedInfo?.isPaused) {
        return; // Ignore messages while paused
      }

      let data = msg.data;
      if (data instanceof ArrayBuffer) data = Buffer.from(new Uint8Array(data));

      // Convert data for storage (try to keep as original format)
      let dataForStorage = data;
      if (data instanceof ArrayBuffer) {
        dataForStorage = Buffer.from(new Uint8Array(data)).toString();
      } else if (Buffer.isBuffer(data)) {
        dataForStorage = data.toString();
      } else if (data instanceof Uint8Array) {
        dataForStorage = Buffer.from(data).toString();
      }

      // Store recv event
      const storedMessages = wsMessageStore.get(wsId) || [];
      storedMessages.push({
        kind: "recv" as const,
        ts: Date.now(),
        wsId,
        data: dataForStorage
      });

      // Keep only last 50 messages to prevent memory leak
      if (storedMessages.length > 50) {
        storedMessages.shift();
      }

      wsMessageStore.set(wsId, storedMessages);

      // Send to frontend
      sendToWindow("ws-message", { wsId, data });
    });

    ws.addEventListener("error", (err: any) => {

      // Store system-error event
      const storedMessages = wsMessageStore.get(wsId) || [];
      storedMessages.push({
        kind: "system-error" as const,
        ts: Date.now(),
        wsId,
        message: err?.error?.message || err?.message || "WebSocket error",
        code: err?.code,
        cause: err?.cause,
        name: err?.name
      });
      wsMessageStore.set(wsId, storedMessages);

      sendToWindow("ws-error", {
        wsId,
        code: err?.code,
        cause: err?.cause,
        name: err?.name,
        message: err?.error?.message || err?.message || "WebSocket error"
      });
    });

    ws.addEventListener("close", (ev: any) => {

      // Store system-close event
      const storedMessages = wsMessageStore.get(wsId) || [];

      // Determine if this is a pause (code 4001) or permanent close
      const isPause = ev.code === 4001;

      storedMessages.push({
        kind: "system-close" as const,
        ts: Date.now(),
        wsId,
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
        isPause // Add flag to indicate if it's a pause
      } as any);

      wsMessageStore.set(wsId, storedMessages);

      // Only cleanup if it's NOT a pause
      if (!isPause) {
        sendToWindow("ws-close", {
          wsId,
          code: ev.code,
          reason: ev.reason,
          wasClean: ev.wasClean,
          isPause
        });
        
        // Send warning about message cleanup
        setTimeout(() => {
          sendToWindow("ws-error", {
            wsId,
            message: "⚠️ Message history will be cleared in 5 minutes. Reconnect now to preserve your session.",
            code: 'CLEANUP_WARNING'
          });
          storedMessages.push({
            kind: "system-error" as const,
            ts: Date.now(),
            wsId,
            message: "⚠️ Message history will be cleared in 5 minutes. Reconnect now to preserve your session.",
            code: 'CLEANUP_WARNING'
          });
          wsMessageStore.set(wsId, storedMessages);
        }, 100);
        
        wsRegistry.delete(wsId);

        // Optionally clear message store after some delay for permanent close
        setTimeout(() => {
          wsMessageStore.delete(wsId);
        }, 5 * 60 *1000); // 5 minute delay to allow for any final UI updates
      } else {
        sendToWindow("ws-pause", {
          wsId,
          code: ev.code,
          reason: ev.reason,
          wasClean: ev.wasClean,
          isPause
        });
        wsRegistry.delete(wsId);
      }
    });

    return {
      ok: true,
      wsId,
      message: "WebSocket connection initiated"
    };
  });

  ipcMain.on("ws-send", (_event, { wsId, data }: { wsId: string; data: string | ArrayBuffer | Uint8Array | Buffer }) => {
    const ws = wsRegistry.get(wsId);
    const pausedInfo = wsPausedConnections.get(wsId);

    // Don't send if connection is paused
    if (pausedInfo?.isPaused) {
      return;
    }

    if (ws && ws.readyState === ws.OPEN) {
      // Convert data to string for storage if needed
      let dataToSend = data;
      let dataForStorage: any = data;

      if (data instanceof ArrayBuffer) {
        dataForStorage = Buffer.from(new Uint8Array(data)).toString();
      } else if (Buffer.isBuffer(data)) {
        dataForStorage = data.toString();
      } else if (data instanceof Uint8Array) {
        dataForStorage = Buffer.from(data).toString();
      }

      // Store the sent message as ChatItem
      const storedMessages = wsMessageStore.get(wsId) || [];
      storedMessages.push({
        kind: "sent" as const,
        ts: Date.now(),
        wsId,
        data: dataForStorage
      });

      // Keep only last 50 messages
      if (storedMessages.length > 50) {
        storedMessages.shift();
      }

      wsMessageStore.set(wsId, storedMessages);

      // Send the actual data
      ws.send(data as any);
      return;
    }

    const g = grpcRegistry.get(wsId);
    if (g?.call) {
      const payload =
        typeof data === "string" ? Buffer.from(data) : data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : Buffer.from(data as any);

      // Store gRPC sent message if needed
      if (grpcMessageStore.has(wsId)) {
        const grpcMessages = grpcMessageStore.get(wsId) || [];
        grpcMessages.push({
          kind: "sent" as const,
          ts: Date.now(),
          wsId,
          data: payload.toString()
        });

        if (grpcMessages.length > 50) {
          grpcMessages.shift();
        }

        grpcMessageStore.set(wsId, grpcMessages);
      }

      g.call.write(payload);
    }
  });

  ipcMain.on("ws-pause", (_event, { wsId, reason }: { wsId: string; reason?: string }) => {
    const ws = wsRegistry.get(wsId);

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      const pauseReason = reason || "Paused by user";

      // Mark this connection as paused (but keep it alive)
      wsPausedConnections.set(wsId, {
        reason: pauseReason,
        timestamp: Date.now(),
        isPaused: true
      });

      // Store pause event in message history with consistent structure
      const storedMessages = wsMessageStore.get(wsId) || [];
      storedMessages.push({
        kind: "system-pause",
        ts: Date.now(),
        wsId,
        code: 4001, // Pause code
        reason: pauseReason,
        wasClean: true
      });
      wsMessageStore.set(wsId, storedMessages);

      // Notify frontend that connection is paused
      sendToWindow('ws-pause', {
        wsId,
        code: 4001,
        reason: pauseReason
      });
    }
  });

  // Resume paused WebSocket connection
  ipcMain.on("ws-resume", (_event, { wsId }: { wsId: string }) => {
    const pausedInfo = wsPausedConnections.get(wsId);
    const ws = wsRegistry.get(wsId);

    if (pausedInfo && ws) {
      // Remove paused state
      wsPausedConnections.delete(wsId);

      // Store resume event in message history
      const storedMessages = wsMessageStore.get(wsId) || [];
      storedMessages.push({
        kind: "system-open",
        ts: Date.now(),
        wsId,
        url: wsConfigs.get(wsId)?.url || null
      });
      wsMessageStore.set(wsId, storedMessages);

      // Notify frontend that connection is resumed
      sendToWindow('ws-open', {
        wsId,
        url: wsConfigs.get(wsId)?.url || null
      });
    }
  });

  // Update ws-close handler to use a different code:
  ipcMain.on("ws-close", (_event, { wsId, reason }: { wsId: string; reason?: string }) => {
    const ws = wsRegistry.get(wsId);

    if (ws) {
      // Close with permanent close code (4000 or 1000 for normal closure)
      const closeCode = 4000; // Custom code for permanent close
      const closeReason = reason || "Closed by user";

      // Mark this connection as explicitly closed
      wsClosedConnections.set(wsId, {
        reason: closeReason,
        timestamp: Date.now()
      });

      ws.close(closeCode, closeReason);

      // Note: The actual cleanup will be handled by the addEventListener("close") above
      // which will detect that code !== 4001 and clean up everything
    } else {
    }
  });

  // Clear closed WebSocket state to allow reconnection
  ipcMain.handle("ws-clear-closed", (_event, wsId: string) => {
    const closedInfo = wsClosedConnections.get(wsId);
    const pausedInfo = wsPausedConnections.get(wsId);

    if (closedInfo || pausedInfo) {
      wsClosedConnections.delete(wsId);
      wsPausedConnections.delete(wsId);
      // Optionally clear message store too for fresh start
      wsMessageStore.delete(wsId);
      wsConfigs.delete(wsId);
      return { ok: true, message: "Connection state cleared, ready for reconnection" };
    }
    return { ok: false, message: "No closed or paused state found for this connection" };
  });



  ipcMain.handle('grpc:connect', async (event, grpcId: string) => {
    const entry = grpcRegistry.get(grpcId);
    const messageStore = grpcMessageStore.get(grpcId) || [];
    if (!entry) {
      const errorMessage = 'gRPC session not found or has been cleaned up';
      // Only replay messages if they exist, don't send additional error
      if (messageStore.length > 0) {
        replayGrpcMessages(grpcId);
      } else {
        // Only send error if no messages to replay
        sendToWindow('grpc-stream-error', {
          grpcId,
          error: errorMessage,
          code: 'SESSION_NOT_FOUND',
          details: 'Session expired or cleaned up'
        });
      }
      return { ok: false, error: 'gRPC session not found' };
    }

    if (entry && messageStore?.length > 0) {
      replayGrpcMessages(grpcId);
      return { ok: true, grpcId };
    }


    const { target, service, method, protoFilePath, package: packageName, callType, metadata } = entry;

    if (callType === 'unary') {
      replayGrpcMessages(grpcId);
      return;
    }
    try {
      // --- CONNECT PHASE ---
      const [host, portStr] = target.split(':');
      const port = parseInt(portStr || '443', 10);

      const insecure = port !== 443 && !target.includes('ssl');
      const creds = insecure
        ? grpc.credentials.createInsecure()
        : grpc.credentials.createSsl();

      const channelOptions: grpc.ChannelOptions = {
        "grpc.ssl_target_name_override": host,
        "grpc.default_authority": host,
      };

      const client = new grpc.Client(target, creds, channelOptions);

      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 10000;
        client.waitForReady(deadline, (err) => err ? reject(err) : resolve());
      });

      // store the connected client
      entry.client = client;
      grpcRegistry.set(grpcId, entry);

      // notify UI that stream began / unary finished

      switch (callType) {
        case 'server_streaming':
          await handleServerStreamingCall(grpcId, client, protoFilePath, packageName, service, method, "", metadata, entry);
          break;

        case 'client_streaming':
          // For client streaming, first call creates the stream
          await handleClientStreamingCall(grpcId, client, protoFilePath, packageName, service, method, metadata, entry);
          break;

        case 'bidirectional_streaming':
          // For bidi streaming, first call creates the stream
          await handleBidirectionalStreamingCall(grpcId, client, protoFilePath, packageName, service, method, metadata, entry);
          break;
      }
      addGrpcMessage(grpcId, "stream-open", {
        target,
        service,
        method,
        callType,
      });
      sendToWindow("grpc-stream-open", {
        grpcId,
        target,
        service,
        method,
        callType,
      });

      return {
        ok: true,
        grpcId,
        callType,
      };

    } catch (err: any) {
      addGrpcMessage(grpcId, "stream-error", {
        error: err?.message || "gRPC connection error",
        code: err?.code,
      });
      sendToWindow("grpc-stream-error", {
        grpcId,
        error: err?.message || "gRPC connection error",
        code: err?.code,
      });
      grpcRegistry.delete(grpcId);
      return {
        ok: false,
        grpcId,
        error: err?.message || "gRPC connection error",
      };
    }
  });


  ipcMain.handle('grpc:send', async (event, grpcId: string, payload: string) => {
    const entry = grpcRegistry.get(grpcId);

    if (!entry || (!entry.client && entry.callType !== 'unary')) {
      const errorMsg = 'gRPC connection not found or not connected';
      // Add to message store but only send to window once
      addGrpcMessage(grpcId, "stream-error", {
        error: errorMsg
      });
      sendToWindow("grpc-stream-error", {
        grpcId,
        error: errorMsg
      });
      return {
        ok: false,
        error: errorMsg
      };
    }


    const { client, target, protoFilePath, package: packageName, service, method, callType, metadata } = entry;
    try {
      // Parse payload
      let parsedPayload: any = {};
      if (payload) {
        try {
          parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch (error) {
          parsedPayload = {};
        }
      }

      addGrpcMessage(grpcId, "stream-data", parsedPayload, 'request');
      // Handle different call types
      switch (callType) {
        case 'unary':
          // Validate target URL format
          if (!target || typeof target !== 'string' || target.trim() === '') {
            const errorMsg = 'URL is incorrect. Please provide a valid target URL in format host:port (e.g., localhost:50051)';
            addGrpcMessage(grpcId, "stream-error", { error: errorMsg });
            sendToWindow("grpc-stream-error", { grpcId, error: errorMsg });
            return { ok: false, error: errorMsg };
          }

          // Check if target contains colon for host:port format
          if (!target.includes(':')) {
            const errorMsg = 'URL is incorrect. Target must include port (e.g., localhost:50051)';
            addGrpcMessage(grpcId, "stream-error", { error: errorMsg });
            sendToWindow("grpc-stream-error", { grpcId, error: errorMsg });
            return { ok: false, error: errorMsg };
          }

          const [host, portStr] = target.split(':');
          
          // Validate host is not empty
          if (!host || host.trim() === '') {
            const errorMsg = 'URL is incorrect. Host cannot be empty (e.g., localhost:50051)';
            addGrpcMessage(grpcId, "stream-error", { error: errorMsg });
            sendToWindow("grpc-stream-error", { grpcId, error: errorMsg });
            return { ok: false, error: errorMsg };
          }

          // Validate port is a valid number
          const port = parseInt(portStr || '443', 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            const errorMsg = 'URL is incorrect. Port must be a valid number between 1 and 65535';
            addGrpcMessage(grpcId, "stream-error", { error: errorMsg });
            sendToWindow("grpc-stream-error", { grpcId, error: errorMsg });
            return { ok: false, error: errorMsg };
          }

          const insecure = port !== 443 && !target.includes('ssl');
          const creds = insecure
            ? grpc.credentials.createInsecure()
            : grpc.credentials.createSsl();

          const channelOptions: grpc.ChannelOptions = {
            "grpc.ssl_target_name_override": host,
            "grpc.default_authority": host,
          };

          const uclient = new grpc.Client(target, creds, channelOptions);

          await new Promise<void>((resolve, reject) => {
            const deadline = Date.now() + 10000;
            uclient.waitForReady(deadline, (err) => err ? reject(err) : resolve());
          });
          return await handleUnaryCall(grpcId, uclient, protoFilePath, packageName, service, method, parsedPayload, metadata);

        case 'server_streaming':
          return await handleServerStreamingCall(grpcId, client, protoFilePath, packageName, service, method, parsedPayload, metadata, entry);

        case 'client_streaming':
          // For client streaming, first call creates the stream
          if (!entry.call) {
            return await handleClientStreamingCall(grpcId, client, protoFilePath, packageName, service, method, metadata, entry);
          } else {
            entry.call.write(parsedPayload);

            return { ok: true, message: 'Message sent to stream' };
          }

        case 'bidirectional_streaming':
          // For bidi streaming, first call creates the stream
          if (!entry.call) {
            return await handleBidirectionalStreamingCall(grpcId, client, protoFilePath, packageName, service, method, metadata, entry);
          } else {
            entry.call.write(parsedPayload);
            return { ok: true, message: 'Message sent to stream' };
          }
        default:
          throw new Error(`Unknown call type: ${callType}`);
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Failed to send message';
      // Only add to store and send once
      addGrpcMessage(grpcId, "stream-error", {
        error: errorMsg
      });
      sendToWindow("grpc-stream-error", {
        grpcId,
        error: errorMsg,
      });

      return {
        ok: false,
        error: errorMsg
      };
    }
  });

  ipcMain.handle('grpc:end', async (event, grpcId: string) => {
    const entry = grpcRegistry.get(grpcId);
    if (!entry || !entry.call) {
      return {
        ok: false,
        error: 'gRPC connection not found'
      };
    }

    const { call, callType } = entry;

    console.log('Ending gRPC call', grpcId, callType);
    if (callType === 'client_streaming' || callType === 'bidirectional_streaming' || callType === 'server_streaming') {
      try {
        call.end();
        return { ok: true, message: 'Stream ended' };
      } catch (err: any) {
        return {
          ok: false,
          error: err?.message || 'Failed to end stream'
        };
      }
    }

    return {
      ok: false,
      error: 'Only client/bidirectional streaming calls can be ended'
    };
  });

  ipcMain.handle('grpc:close', async (event, grpcId: string) => {
    const entry = grpcRegistry.get(grpcId);
    if (!entry) {
      return {
        ok: false,
        error: 'gRPC connection not found'
      };
    }

    try {
      if (entry.call) {
        entry.call.cancel();
      }

      if (entry.client) {
        entry.client.close();
      }

      return { ok: true };

    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Failed to close connection'
      };
    }
  });

  ipcMain.handle('grpc:cancel', async (event, grpcId: string) => {
    const entry = grpcRegistry.get(grpcId);
    if (!entry || !entry.call) {
      return {
        ok: false,
        error: 'gRPC connection not found'
      };
    }

    try {
      entry.call.cancel();

      addGrpcMessage(grpcId, "stream-cancelled", {
        reason: 'Call cancelled by client'
      });
      sendToWindow('grpc-stream-cancelled', {
        grpcId,
      });

      return { ok: true };

    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Failed to cancel call'
      };
    }
  });

  // GraphQL Subscription Handlers
ipcMain.handle("connect-graphql-subscription", async (_, subscriptionId: string) => {
  // First, clear all old messages for this subscription and send a clear event
  gqlSubscriptionStore.delete(subscriptionId);
  
  // Send a clear event to the UI to reset the events display
  sendToWindow('graphql-subscription-clear', {
    subscriptionId,
    ts: Date.now(),
  });
  
  // Check if subscription already exists (regardless of state) and clean it up
  const existingConnection = gqlSubscriptionRegistry.get(subscriptionId);
  if (existingConnection) {
    try {
      // Dispose of the subscription and client
      existingConnection.dispose();
      existingConnection.client.dispose();
    } catch (e) {
      // Error disposing existing subscription
    }
    // Remove from registry
    gqlSubscriptionRegistry.delete(subscriptionId);
    gqlSubscriptionConnectedState.delete(subscriptionId);
  }
  
  // Check if subscription was previously closed
  const closedInfo = gqlSubscriptionClosedConnections.get(subscriptionId);
  if (closedInfo) {
    // Clear the closed state to allow fresh reconnection
    gqlSubscriptionClosedConnections.delete(subscriptionId);
    
    // Don't replay messages or return early - continue with normal connection flow
  }

  // Get configuration (should have been stored when subscription was created)
  const config = gqlSubscriptionConfigs.get(subscriptionId);
  if (!config) {
    storeGraphQLSubscriptionMessage(subscriptionId, {
      kind: 'system-error',
      ts: Date.now(),
      subscriptionId,
      message: 'No configuration found for this subscription',
    });
    
    sendToWindow('graphql-subscription-error', {
      subscriptionId,
      message: 'No configuration found for this subscription',
    });
    return { error: 'No configuration found' };
  }

  try {
    // Convert HTTP/HTTPS to WS/WSS for WebSocket connection
    let wsUrl = config.url;
    if (wsUrl.startsWith('https://')) {
      wsUrl = wsUrl.replace(/^https:\/\//, 'wss://');
    } else if (wsUrl.startsWith('http://')) {
      wsUrl = wsUrl.replace(/^http:\/\//, 'ws://');
    }
    
    // Build headers object from array
    const headerObj: Record<string, string> = {};
    if (config.headers && Array.isArray(config.headers)) {
      for (const h of config.headers) {
        if (h.enabled !== false) {
          headerObj[h.key] = h.value;
        }
      }
    }
    
    // Create graphql-ws client
    const client = createClient({
      url: wsUrl,
      webSocketImpl: WebSocket,
      connectionParams: headerObj,
      on: {
        connected: () => {
          // Mark as successfully connected
          gqlSubscriptionConnectedState.set(subscriptionId, true);
          
          storeGraphQLSubscriptionMessage(subscriptionId, {
            kind: 'system-open',
            ts: Date.now(),
            subscriptionId,
            url: wsUrl,
            protocol: 'graphql-ws',
          });

          sendToWindow('graphql-subscription-open', {
            subscriptionId,
            url: wsUrl,
            protocol: 'graphql-ws',
          });
        },
        error: (error) => {
          // Don't mark as connected if error occurs
          gqlSubscriptionConnectedState.delete(subscriptionId);
          
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          storeGraphQLSubscriptionMessage(subscriptionId, {
            kind: 'system-error',
            ts: Date.now(),
            subscriptionId,
            message: errorMessage,
            error,
          });

          sendToWindow('graphql-subscription-error', {
            subscriptionId,
            message: errorMessage,
            error,
          });
        },
        closed: (event) => {
          // Clear connected state on close
          gqlSubscriptionConnectedState.delete(subscriptionId);
          
          const closeEvent = event as CloseEvent | undefined;
          
          storeGraphQLSubscriptionMessage(subscriptionId, {
            kind: 'system-close',
            ts: Date.now(),
            subscriptionId,
            code: closeEvent?.code || 1000,
            reason: closeEvent?.reason || 'Connection closed',
          });

          sendToWindow('graphql-subscription-close', {
            subscriptionId,
            code: closeEvent?.code || 1000,
            reason: closeEvent?.reason || 'Connection closed',
          });

          // Clear registry and config
          gqlSubscriptionRegistry.delete(subscriptionId);
          gqlSubscriptionConfigs.delete(subscriptionId);
          
          // Schedule message cleanup after 5 minutes
          setTimeout(() => {
            gqlSubscriptionStore.delete(subscriptionId);
            gqlSubscriptionClosedConnections.delete(subscriptionId);
          }, 5 * 60 * 1000);
        },
      },
    });
    
    // Subscribe to the GraphQL subscription
    const dispose = client.subscribe(
      {
        query: config.query,
        variables: config.variables || {},
      },
      {
        next: (data) => {
          // Check if data contains GraphQL errors
          if (data.errors && Array.isArray(data.errors)) {
            
            // Format error message from GraphQL errors array
            const errorMessages = data.errors.map((err: any) => {
              let msg = err.message || 'Unknown error';
              if (err.path) msg += ` (path: ${err.path.join('.')})`;
              if (err.locations) msg += ` at line ${err.locations[0]?.line}, column ${err.locations[0]?.column}`;
              return msg;
            }).join('\n');
            
            storeGraphQLSubscriptionMessage(subscriptionId, {
              kind: 'system-error',
              ts: Date.now(),
              subscriptionId,
              error: data.errors,
              message: `GraphQL Error:\n${errorMessages}`,
            });

            sendToWindow('graphql-subscription-error', {
              subscriptionId,
              error: data.errors,
              message: `GraphQL Error:\n${errorMessages}`,
            });
          } else {
            // Normal data received
            storeGraphQLSubscriptionMessage(subscriptionId, {
              kind: 'data',
              ts: Date.now(),
              subscriptionId,
              data: data.data,
            });

            sendToWindow('graphql-subscription-data', {
              subscriptionId,
              data: data.data,
            });
          }
        },
        error: (error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          storeGraphQLSubscriptionMessage(subscriptionId, {
            kind: 'system-error',
            ts: Date.now(),
            subscriptionId,
            error,
            message: errorMessage,
          });

          sendToWindow('graphql-subscription-error', {
            subscriptionId,
            error,
            message: errorMessage,
          });
        },
        complete: () => {
          storeGraphQLSubscriptionMessage(subscriptionId, {
            kind: 'complete',
            ts: Date.now(),
            subscriptionId,
            message: 'Subscription completed',
          });

          sendToWindow('graphql-subscription-complete', {
            subscriptionId,
          });
          
          // Clear registry and config on completion
          gqlSubscriptionRegistry.delete(subscriptionId);
          gqlSubscriptionConfigs.delete(subscriptionId);
          gqlSubscriptionConnectedState.delete(subscriptionId);
          
          // Schedule message cleanup after 5 minutes
          setTimeout(() => {
            gqlSubscriptionStore.delete(subscriptionId);
          }, 5 * 60 * 1000);
        },
      }
    );
    
    // Store client and dispose function in registry
    gqlSubscriptionRegistry.set(subscriptionId, { client, dispose });

    return { connected: true };
  } catch (error: any) {
    storeGraphQLSubscriptionMessage(subscriptionId, {
      kind: 'system-error',
      ts: Date.now(),
      subscriptionId,
      message: error?.message || 'Failed to connect',
    });

    sendToWindow('graphql-subscription-error', {
      subscriptionId,
      message: error?.message || 'Failed to connect',
    });

    return { error: error?.message };
  }
});

ipcMain.handle("close-graphql-subscription", async (_, { subscriptionId, reason }: { subscriptionId: string; reason?: string }) => {
  const entry = gqlSubscriptionRegistry.get(subscriptionId);
  
  if (entry) {
    // Dispose the subscription and client
    entry.dispose();
    entry.client.dispose();
    
    gqlSubscriptionRegistry.delete(subscriptionId);
    gqlSubscriptionConfigs.delete(subscriptionId);
    gqlSubscriptionConnectedState.delete(subscriptionId);
    
    // Mark as closed
    gqlSubscriptionClosedConnections.set(subscriptionId, {
      reason: reason || 'User closed connection',
      timestamp: Date.now(),
    });
    
    storeGraphQLSubscriptionMessage(subscriptionId, {
      kind: 'system-close',
      ts: Date.now(),
      subscriptionId,
      code: 1000,
      reason: reason || 'User closed connection',
    });

    sendToWindow('graphql-subscription-close', {
      subscriptionId,
      code: 1000,
      reason: reason || 'User closed connection',
    });
    
    // Schedule message cleanup after 5 minutes
    setTimeout(() => {
      gqlSubscriptionStore.delete(subscriptionId);
      gqlSubscriptionClosedConnections.delete(subscriptionId);
    }, 5 * 60 * 1000);
    
    return { closed: true };
  }
  
  return { error: 'Subscription not found or not connected' };
});




  // Helper function
  function getWsStatus(ws: WebSocket): string {
    switch (ws.readyState) {
      case WebSocket.CONNECTING: return "connecting";
      case WebSocket.OPEN: return "open";
      case WebSocket.CLOSING: return "closing";
      case WebSocket.CLOSED: return "closed";
      default: return "unknown";
    }
  }
}

function sendToWindow(event, sendData) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(event, sendData);
  }
}


/**
 * Handle gRPC request based on call type from requestState
 */
async function handleGrpcRequest(
  requestState: any,
  settings: any,
  activeProject: string
): Promise<any> {
  const grpcConfig = requestState.grpc;

  if (!grpcConfig) {
    return {
      status: 0,
      statusText: "grpc-config-missing",
      error: "gRPC configuration not found in request",
    };
  }

  const {
    service,
    method,
    callType,
    protoFilePath,
    package: packageName,
    metadata,
    payload
  } = grpcConfig;

  const url = requestState.url;
  if (!service || !method || !callType || !packageName) {
    return {
      status: 0,
      statusText: "grpc-incomplete-config",
      error: "Missing required gRPC configuration (service, method, or callType)",
    };
  }

  try {
    // Parse URL for connection details
    const u = new URL(url);
    const insecure = u.protocol === "grpc:";
    const defaultPort = insecure ? 80 : 443;
    const address = `${u.hostname}:${u.port || defaultPort}`;
    // Apply proxy settings
    applyProxyEnvForGrpc(settings, url);

    // Convert metadata object to grpc.Metadata
    const grpcMetadata = new grpc.Metadata();
    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        if (value != null) {
          grpcMetadata.set(key, String(value));
        }
      }
    }

    // Generate unique ID for this gRPC session
    const grpcId = makeId();

    // Store minimal info in registry (no client yet, no proto needed)
    grpcRegistry.set(grpcId, {
      client: null as any, // Will be created on connect
      method,
      protoFilePath,
      package: packageName,
      target: address,
      service,
      callType,
      metadata: grpcMetadata,
    });

    // Return connection info without actually connecting
    return {
      ok: true,
      grpcId,
      protocol: 'grpc',
      requestMeta: {
        url: url,
        service: service,
        package: packageName,
        method: method,
        target: address,
        callType: callType,
        protoFilePath: protoFilePath || null,
        headers: Object.entries(metadata || {}).map(([k, v]) => ({
          key: k,
          value: v as string
        })),
        proxy: settings.proxy ? {
          name: settings.proxy.name,
          host: settings.proxy.host,
          port: settings.proxy.port,
        } : undefined,
      },
    };

  } catch (error: any) {
    return {
      status: 0,
      statusText: "grpc-error",
      error: error?.message || "gRPC request initialization failed",
      protocol: 'grpc',
    };
  }
}

async function handleUnaryCall(
  grpcId: string,
  client: grpc.Client,
  protoFilePath: string,
  packageName: string,
  service: string,
  method: string,
  payload: any,
  metadata: grpc.Metadata
) {
  const { serialize, deserialize } = getGrpcTypes(
    protoFilePath,
    packageName,
    service,
    method
  );
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const path = `/${packageName}.${service}/${method}`;
    client.makeUnaryRequest(
      path,
      serialize,// serialize
      deserialize, // deserialize
      payload,
      metadata,
      (err: grpc.ServiceError | null, response?: Buffer) => {
        const duration = Date.now() - startTime;

        if (err) {
          const errorData = {
            error: err.message,
            code: err.code,
            details: err.details,
          };
          // Add to store and send to window only once
          addGrpcMessage(grpcId, "stream-error", errorData);
          sendToWindow("grpc-stream-error", {
            grpcId,
            ...errorData,
          });
          // Reject without sending duplicate messages
          return reject({ ok: false, error: err.message });
        } else {
          try {
            addGrpcMessage(grpcId, "unary-response", response);
            sendToWindow("grpc-stream-response", {
              grpcId,
              data: response,
              duration,
            });
            addGrpcMessage(grpcId, "stream-end", {
              reason: 'Unary call completed'
            });
            addGrpcMessage(grpcId, 'stream-closed', {
              reason: "Stream Closed"
            })
            sendToWindow('grpc-stream-end', {
              grpcId,
              reason: 'Unary call Completed'
            })
            sendToWindow("grpc-stream-closed", {
              grpcId,
              reason: "Stream Closed"
            })
            resolve({ ok: true, data: response, duration });
          } catch (error) {
            addGrpcMessage(grpcId, "stream-error", {
              error: "Failed to parse response: " + error
            });
            sendToWindow("grpc-stream-error", {
              grpcId,
              error: "Failed to parse response : " + error,
            });
            reject({ ok: false, error: "Failed to parse response" });
          }
        }
      }
    );
  });
}

async function handleServerStreamingCall(
  grpcId: string,
  client: grpc.Client,
  protoFilePath: string,
  packageName: string,
  service: string,
  method: string,
  payload: any,
  metadata: grpc.Metadata,
  entry: any
) {
  const { serialize, deserialize } = getGrpcTypes(
    protoFilePath,
    packageName,
    service,
    method
  );
  const path = `/${packageName}.${service}/${method}`;

  const call = client.makeServerStreamRequest(
    path,
    serialize,
    deserialize,
    payload,
    metadata
  );

  // Store the call in registry
  entry.call = call;
  const grpc = grpcRegistry.get(grpcId);
  if (grpc) {
    grpcRegistry.set(grpcId, {
      ...grpc,
      call: call,
    });
  }
  call.on('data', (chunk: Buffer) => {
    try {
      const data = chunk;
      addGrpcMessage(grpcId, "stream-data", chunk, 'response');
      sendToWindow("grpc-stream-data", {
        grpcId,
        data,
        type: 'response',
      });
    } catch (error) {
      console.error('Failed to parse stream data:', error);
    }
  });

  call.on('end', () => {
    console.log('gRPC server streaming ended');
    addGrpcMessage(grpcId, "stream-end", {
      reason: 'Stream completed'
    });
    addGrpcMessage(grpcId, "stream-closed", {
      reason: "Stream Closed"
    })
    sendToWindow("grpc-stream-end", {
      grpcId,
      reason: 'Stream completed',
    });
    sendToWindow("grpc-stream-closed", {
      grpcId,
      reason: "Stream Closed"
    });
    
    // Cleanup: close client and remove from registry
    try {
      if (client) {
        client.close();
      }
    } catch (err) {
      console.error('Error closing gRPC client:', err);
    }
    grpcRegistry.delete(grpcId);
  });

  call.on('error', (err: grpc.ServiceError) => {
    addGrpcMessage(grpcId, "stream-error", {
      error: err.message,
      code: err.code,
      details: err.details,
    });
    sendToWindow("grpc-stream-error", {
      grpcId,
      error: err.message,
      code: err.code,
      details: err.details,
    });
  });

  return { ok: true, message: 'Server streaming started' };
}

async function handleClientStreamingCall(
  grpcId: string,
  client: grpc.Client,
  protoFilePath: string,
  packageName: string,
  service: string,
  method: string,
  metadata: grpc.Metadata,
  entry: any
) {
  const { serialize, deserialize } = getGrpcTypes(
    protoFilePath,
    packageName,
    service,
    method
  );
  const path = `/${packageName}.${service}/${method}`;

  const call = client.makeClientStreamRequest(
    path,
    serialize,
    deserialize,
    metadata,
    (err: grpc.ServiceError | null, response?: Buffer) => {
      if (err) {
        addGrpcMessage(grpcId, "stream-error", {
          error: err.message,
          code: err.code,
          details: err.details,
        });
        sendToWindow("grpc-stream-error", {
          grpcId,
          error: err.message,
          code: err.code,
          details: err.details,
        });
      } else {
        try {
          const data = response;
          addGrpcMessage(grpcId, "stream-response", response, 'response');
          sendToWindow("grpc-stream-response", {
            grpcId,
            data,
          });
        } catch (error) {
          addGrpcMessage(grpcId, "stream-error", {
            error: "Failed to parse response"
          });
          sendToWindow("grpc-stream-error", {
            grpcId,
            error: "Failed to parse response",
          });
        }
      }
    }
  );

  // Store the call in registry
  entry.call = call;

  const grpc = grpcRegistry.get(grpcId)
  if (grpc) {
    grpcRegistry.set(grpcId, {
      ...grpc,
      call: call,
    });
  }
  call.on('end', () => {
    addGrpcMessage(grpcId, "stream-end", {
      reason: 'Stream completed'
    });
    addGrpcMessage(grpcId, "stream-closed", {
      reason: "Stream Closed"
    })
    sendToWindow("grpc-stream-end", {
      grpcId,
      reason: 'Stream completed',
    });
    sendToWindow("grpc-stream-closed", {
      grpcId,
      reason: "Stream Closed"
    });
    
    // Cleanup: close client and remove from registry
    try {
      if (client) {
        client.close();
      }
    } catch (err) {
      console.error('Error closing gRPC client:', err);
    }
    grpcRegistry.delete(grpcId);
  });

  call.on('error', (err: grpc.ServiceError) => {
    addGrpcMessage(grpcId, "stream-error", {
      error: err.message,
      code: err.code,
      details: err.details,
    });
    sendToWindow("grpc-stream-error", {
      grpcId,
      error: err.message,
      code: err.code,
      details: err.details,
    });
  });

  return { ok: true, message: 'Client streaming started' };
}

async function handleBidirectionalStreamingCall(
  grpcId: string,
  client: grpc.Client,
  protoFilePath: string,
  packageName: string,
  service: string,
  method: string,
  metadata: grpc.Metadata,
  entry: any
) {
  const { serialize, deserialize } = getGrpcTypes(
    protoFilePath,
    packageName,
    service,
    method
  );
  const path = `/${packageName}.${service}/${method}`;
  const call = client.makeBidiStreamRequest(
    path,
    serialize,
    deserialize,
    metadata
  );

  // Store the call in registry
  entry.call = call;

  const grpc = grpcRegistry.get(grpcId)
  if (grpc) {
    grpcRegistry.set(grpcId, {
      ...grpc,
      call: call,
    });
  }
  call.on('data', (chunk: Buffer) => {
    try {
      const data = chunk;
      addGrpcMessage(grpcId, "stream-data", chunk, "response");
      sendToWindow("grpc-stream-data", {
        grpcId,
        data,
        type: 'response',
      });
    } catch (error) {
      console.error('Failed to parse stream data:', error);
    }
  });

  call.on('end', () => {
    addGrpcMessage(grpcId, "stream-end", {
      reason: 'Stream completed'
    });
    addGrpcMessage(grpcId, "stream-closed", {
      reason: 'Stream closed'
    });
    sendToWindow("grpc-stream-end", {
      grpcId,
      reason: 'Stream completed',
    });
    sendToWindow("grpc-stream-closed", {
      grpcId,
      reason: "Stream Closed"
    });
    
    // Cleanup: close client and remove from registry
    try {
      if (client) {
        client.close();
      }
    } catch (err) {
      console.error('Error closing gRPC client:', err);
    }
    grpcRegistry.delete(grpcId);
  });

  call.on('error', (err: grpc.ServiceError) => {
    addGrpcMessage(grpcId, "stream-error", {
      error: err.message,
      code: err.code,
      details: err.details,
    });
    sendToWindow("grpc-stream-error", {
      grpcId,
      error: err.message,
      code: err.code,
      details: err.details,
    });
  });

  return { ok: true, message: 'Bidirectional streaming started' };
}


function getGrpcTypes(
  protoFilePath: string,
  packageName: string,
  service: string,
  method: string
) {
  const packageDefinition = protoLoader.loadSync(protoFilePath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto: grpc.GrpcObject | any =
    grpc.loadPackageDefinition(packageDefinition);

  const svc = proto[packageName][service];
  const methodInfo = svc.service[method];

  // ✔ Use the serializer/deserializer generated by grpc
  const serialize = methodInfo.requestSerialize;
  const deserialize = methodInfo.responseDeserialize;

  return { serialize, deserialize };
}

function deleteGrpcRegistryAndMessageCache(grpcId: string) {
  const entry = grpcRegistry.get(grpcId);
  if (entry) {
    grpcRegistry.delete(grpcId);
  }
  const messageStore = grpcMessageStore.get(grpcId);
  if (messageStore) {
    grpcMessageStore.delete(grpcId);
  }
}



function addGrpcMessage(grpcId: string, kind: "stream-open" | "stream-closed" | "stream-data" | "stream-response" | "unary-response" | "stream-error" | "stream-end" | "stream-cancelled", data?: any, msgType?: "request" | 'response') {
  const messages = grpcMessageStore.get(grpcId) || [];
  messages.push({
    data,
    type: msgType,
    timestamp: Date.now(),
    kind: kind,
  });

  // Keep only last 50 messages
  if (messages.length > 50) {
    messages.shift();
  }

  grpcMessageStore.set(grpcId, messages);
}

/**
 * Replays stored gRPC messages to the frontend
 * Similar to WebSocket message replay functionality
 */
function replayGrpcMessages(grpcId: string) {

  // Get stored messages for this gRPC connection
  const storedMessages = grpcMessageStore.get(grpcId) || [];

  if (storedMessages.length === 0) {
    return;
  }

  // Sort messages by timestamp to ensure chronological order
  const sortedMessages = [...storedMessages].sort((a, b) => a.timestamp - b.timestamp);

  for (const msg of sortedMessages) {
    switch (msg.kind) {
      case "stream-open":
        sendToWindow("grpc-stream-open", {
          grpcId: grpcId,
          target: msg.data?.target,
          method: msg.data?.method,
          service: msg.data?.service,
          callType: msg.data?.callType,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "stream-data":
        sendToWindow("grpc-stream-data", {
          grpcId: grpcId,
          data: msg.data?.data || msg.data,
          type: msg.type || 'response',
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "stream-response":
        sendToWindow("grpc-stream-response", {
          grpcId: grpcId,
          data: msg.data?.data || msg.data,
          duration: msg.data?.duration,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "unary-response":
        sendToWindow("grpc-stream-response", {
          grpcId: grpcId,
          data: msg.data?.data || msg.data,
          duration: msg.data?.duration,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "stream-error":
        sendToWindow("grpc-stream-error", {
          grpcId: grpcId,
          error: msg.data?.error,
          code: msg.data?.code,
          details: msg.data?.details,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "stream-end":
        sendToWindow("grpc-stream-end", {
          grpcId: grpcId,
          reason: msg.data?.reason,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "stream-cancelled":
        sendToWindow("grpc-stream-cancelled", {
          grpcId: grpcId,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      case "stream-closed":
        sendToWindow("grpc-stream-closed", {
          grpcId: grpcId,
          reason: msg.data?.reason,
          isReplayed: true,
          originalTimestamp: msg.timestamp
        });
        break;

      default:
        console.warn(`Unknown gRPC message type: ${msg.type}`);
    }
  }
}


function storeGraphQLSubscriptionMessage(subscriptionId: string, message: any) {
  const messages = gqlSubscriptionStore.get(subscriptionId) || [];
  messages.push(message);
  
  // Keep only last 100 messages
  if (messages.length > 100) {
    messages.shift();
  }
  
  gqlSubscriptionStore.set(subscriptionId, messages);
}

function replayGraphQLSubscriptionMessages(subscriptionId: string) {
  const storedMessages = gqlSubscriptionStore.get(subscriptionId) || [];
  
  if (storedMessages.length === 0) {
    return;
  }
  
  const sortedMessages = [...storedMessages].sort((a, b) => a.ts - b.ts);
  
  for (const msg of sortedMessages) {
    switch (msg.kind) {
      case 'system-open':
        sendToWindow('graphql-subscription-open', {
          subscriptionId: msg.subscriptionId,
          url: msg.url,
          isReplayed: true,
          originalTimestamp: msg.ts,
        });
        break;
      case 'data':
        sendToWindow('graphql-subscription-data', {
          subscriptionId: msg.subscriptionId,
          data: msg.data,
          isReplayed: true,
          originalTimestamp: msg.ts,
        });
        break;
      case 'system-error':
      case 'error':
        sendToWindow('graphql-subscription-error', {
          subscriptionId: msg.subscriptionId,
          message: msg.message,
          error: msg.error,
          isReplayed: true,
          originalTimestamp: msg.ts,
        });
        break;
      case 'complete':
        sendToWindow('graphql-subscription-complete', {
          subscriptionId: msg.subscriptionId,
          isReplayed: true,
          originalTimestamp: msg.ts,
        });
        break;
      case 'system-close':
        sendToWindow('graphql-subscription-close', {
          subscriptionId: msg.subscriptionId,
          code: msg.code,
          reason: msg.reason,
          isReplayed: true,
          originalTimestamp: msg.ts,
        });
        break;
    }
  }
}
