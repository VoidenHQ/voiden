import { Agent, ProxyAgent, Pool, buildConnector } from "undici";
import type { ClientCertificateConnectOptions } from "@voiden/executors";

/** Real TLS details of a connection, shown in the response panel's Security section. */
export type TlsConnectionDetails = {
  isSecure: true;
  protocol?: string;
  cipher?: string;
  /** False only when TLS verification is turned off and the server's certificate didn't verify. */
  authorized: boolean;
  authorizationError?: string;
  certificate?: { subject?: string; issuer?: string; validFrom?: string; expiry?: string };
  /** The client certificate presented (mTLS); `name` is filled in by the executor. */
  clientCertificate?: { name?: string; subject?: string; issuer?: string; expiry?: string };
};

function certName(o: any): string | undefined {
  if (!o || typeof o !== "object") return undefined;
  if (o.CN) return Array.isArray(o.CN) ? o.CN.join(", ") : String(o.CN);
  if (o.O) return Array.isArray(o.O) ? o.O.join(", ") : String(o.O);
  const parts = Object.entries(o).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(", ") : undefined;
}

function certDate(s: unknown): string | undefined {
  if (typeof s !== "string" || !s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString();
}

/** Reads protocol, cipher and both certificates from a connected TLS socket. */
export function describeTlsSocket(socket: any): TlsConnectionDetails | undefined {
  if (!socket || !socket.encrypted || typeof socket.getPeerCertificate !== "function") return undefined;
  const peer = socket.getPeerCertificate();
  const own = typeof socket.getCertificate === "function" ? socket.getCertificate() : null;
  const cipher = typeof socket.getCipher === "function" ? socket.getCipher() : null;
  const hasPeer = peer && Object.keys(peer).length > 0;
  const hasOwn = own && Object.keys(own).length > 0;
  return {
    isSecure: true,
    protocol: (typeof socket.getProtocol === "function" ? socket.getProtocol() : null) ?? undefined,
    cipher: cipher?.standardName || cipher?.name || undefined,
    authorized: socket.authorized === true,
    authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
    certificate: hasPeer
      ? { subject: certName(peer.subject), issuer: certName(peer.issuer), validFrom: certDate(peer.valid_from), expiry: certDate(peer.valid_to) }
      : undefined,
    clientCertificate: hasOwn
      ? { subject: certName(own.subject), issuer: certName(own.issuer), expiry: certDate(own.valid_to) }
      : undefined,
  };
}

/**
 * A pool factory for Agent / ProxyAgent that reports every socket it connects.
 * The wrapped connector runs after the TLS handshake (directly or through a
 * proxy tunnel), so the socket's real protocol, cipher and certificates can be read.
 */
function tlsCapturingFactory(onSocket: (socket: any) => void) {
  return (origin: any, options: any) => {
    const base = typeof options?.connect === "function" ? options.connect : buildConnector({ ...(options?.connect ?? {}) });
    const connect = (opts: any, callback: any) =>
      base(opts, (err: any, socket: any) => {
        if (!err && socket) {
          try {
            onSocket(socket);
          } catch {
            /* metadata only: never fail the request over it */
          }
        }
        callback(err, socket);
      });
    return new Pool(origin, { ...options, connect });
  };
}

/** Matches a hostname against a proxy exclusion pattern (`host` or `*.suffix`). */
function isExcludedFromProxy(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    // Wildcard match: *.internal matches api.internal, service.internal
    const suffix = pattern.substring(1); // Remove * to get .internal
    return hostname.endsWith(suffix) || hostname === suffix.substring(1); // Match .internal or internal
  }
  // Exact match
  return hostname === pattern;
}

/**
 * Get dispatcher (Agent or ProxyAgent) based on settings
 * Returns the dispatcher and proxy info for metadata
 *
 * @param clientCertificate mTLS material (cert/key/pfx/ca/passphrase) presented to the
 *   target server. With a proxy it is applied to the tunnelled connection to the target,
 *   not to the connection to the proxy itself.
 * @param options.disableTlsVerification Per-request override of the app-wide
 *   `requests.disable_tls_verification` setting (the request's
 *   `disable_tls_verification` option). `undefined` falls back to the setting.
 */
export function getDispatcher(
  settings: any,
  requestUrl: string,
  clientCertificate?: ClientCertificateConnectOptions,
  options?: { disableTlsVerification?: boolean },
): {
  dispatcher?: Agent | ProxyAgent;
  proxyInfo?: { name: string; host: string; port: number };
  /** TLS details of the last connection this dispatcher made (HTTPS only). */
  getTlsInfo: () => TlsConnectionDetails | undefined;
} {
  const disableTls = typeof options?.disableTlsVerification === "boolean"
    ? options.disableTlsVerification
    : settings?.requests?.disable_tls_verification === true;
  const timeoutSec = settings?.requests?.timeout ?? 300;
  const timeoutMs = timeoutSec > 0 ? timeoutSec * 1000 : 0;
  const proxyEnabled = settings?.proxy?.enabled === true;
  const activeProxyId = settings?.proxy?.activeProxyId;

  // TLS options for the connection to the target server
  const targetTls = {
    ...(disableTls ? { rejectUnauthorized: false } : {}),
    ...(clientCertificate ?? {}),
  };
  const hasTargetTls = Object.keys(targetTls).length > 0;

  // Each request gets its own dispatcher, so what this captures belongs to it.
  let tlsInfo: TlsConnectionDetails | undefined;
  const factory = tlsCapturingFactory((socket) => {
    const details = describeTlsSocket(socket);
    if (details) tlsInfo = details;
  });
  const getTlsInfo = () => tlsInfo;

  const directAgent = () =>
    new Agent({
      ...(hasTargetTls ? { connect: targetTls } : {}),
      factory,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

  // If no proxy is enabled, return TLS agent if needed
  if (!proxyEnabled || !activeProxyId) {
    return { dispatcher: directAgent(), getTlsInfo };
  }

  // Find the active proxy configuration
  const activeProxy = settings.proxy.proxies?.find((p: any) => p.id === activeProxyId);
  if (!activeProxy) {
    return { dispatcher: directAgent(), getTlsInfo };
  }

  // Check if domain is excluded from proxy
  if (activeProxy.excludedDomains && activeProxy.excludedDomains.length > 0) {
    try {
      const hostname = new URL(requestUrl).hostname;
      if (activeProxy.excludedDomains.some((pattern: string) => isExcludedFromProxy(hostname, pattern))) {
        return { dispatcher: directAgent(), getTlsInfo };
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

  // ProxyAgent ignores `connect` for the target server: TLS options for the
  // tunnelled connection (verification, client certificate) go in `requestTls`.
  return {
    dispatcher: new ProxyAgent({
      uri: proxyUrl,
      ...(hasTargetTls ? { requestTls: targetTls } : {}),
      factory,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    }),
    proxyInfo: {
      name: activeProxy.name,
      host: activeProxy.host,
      port: activeProxy.port,
    },
    getTlsInfo,
  };
}
