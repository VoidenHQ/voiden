import { Agent, ProxyAgent } from "undici";
import type { ClientCertificateConnectOptions } from "@voiden/executors";

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
 */
export function getDispatcher(
  settings: any,
  requestUrl: string,
  clientCertificate?: ClientCertificateConnectOptions,
): { dispatcher?: Agent | ProxyAgent; proxyInfo?: { name: string; host: string; port: number } } {
  const disableTls = settings?.requests?.disable_tls_verification === true;
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

  const directAgent = () =>
    new Agent({
      ...(hasTargetTls ? { connect: targetTls } : {}),
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

  // If no proxy is enabled, return TLS agent if needed
  if (!proxyEnabled || !activeProxyId) {
    return { dispatcher: directAgent() };
  }

  // Find the active proxy configuration
  const activeProxy = settings.proxy.proxies?.find((p: any) => p.id === activeProxyId);
  if (!activeProxy) {
    return { dispatcher: directAgent() };
  }

  // Check if domain is excluded from proxy
  if (activeProxy.excludedDomains && activeProxy.excludedDomains.length > 0) {
    try {
      const hostname = new URL(requestUrl).hostname;
      if (activeProxy.excludedDomains.some((pattern: string) => isExcludedFromProxy(hostname, pattern))) {
        return { dispatcher: directAgent() };
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
      ...(clientCertificate ? { requestTls: targetTls } : {}),
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
