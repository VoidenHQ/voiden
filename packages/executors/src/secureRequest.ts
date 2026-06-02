/**
 * executeSecureRequest — shared secure HTTP executor.
 *
 * Handles variable replacement, body building, and HTTP(S) execution.
 * For WS, gRPC, and GraphQL subscription protocols, returns a SecureHandoffResult
 * so the caller can handle these using their protocol-specific registries.
 *
 * Used by:
 *   • Electron IPC handler (send-secure-request) — adapter uses replaceVariablesSecure + undici Agent
 *   • voiden-runner CLI (cliElectron) — adapter uses replaceEnvVars + global fetch
 */

import { Buffer } from 'node:buffer'
import { extname } from 'node:path'
import type { RestApiRequestState } from './pipeline/types.js'
import { executeWebSocket } from './websocket.js'
import { executeGrpc } from './grpc.js'

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface SecureRequestAdapter {
  /** Replace {{variable}} references in a string. */
  replaceVar(text: string): Promise<string>
  /** Read a file from the filesystem (required for binary uploads and multipart file params). */
  readFile?(filePath: string): Promise<Buffer>
  /**
   * Return an undici-compatible dispatcher and optional proxy metadata for a URL.
   * Electron passes an Agent or ProxyAgent; CLI omits this for plain fetch.
   */
  getDispatcher?(url: string): { dispatcher?: any; proxyInfo?: any }
  /** Whether to follow HTTP redirects. Defaults to true. */
  followRedirects?: boolean
  /**
   * true  = Electron renderer — WS/gRPC hands off to the UI plugin via wsId/grpcId.
   * false = CLI (voiden-runner) — WS/gRPC connection is handled inline and a
   *         connection report is returned as a regular response body.
   * Defaults to true (Electron behaviour) when omitted.
   */
  isElectron?: boolean
}

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * Caller must handle this protocol — it requires Electron-side registries (WS/gRPC/GQL)
 * or CLI stubs. Contains all resolved (variable-replaced) values so the caller can proceed.
 */
export interface SecureHandoffResult {
  kind: 'handoff'
  protocol: 'ws' | 'wss' | 'grpc' | 'grpcs' | 'graphql-subscription'
  resolvedUrl: string
  resolvedHeaders: Record<string, string>
  resolvedBody?: string
  /** Original request state (for gRPC metadata, operationType, etc.) */
  requestState: RestApiRequestState
}

/** Completed HTTP(S) response */
export interface SecureHttpResult {
  kind: 'http'
  ok: boolean
  status: number
  statusText: string
  headers: [string, string][]
  body: Buffer | null
  protocol: string
  operationType?: string
  requestMeta: {
    method: string
    url: string
    headers: { key: string; value: string }[]
    httpVersion: string
    proxy?: any
    tlsInfo?: any
    body?: string | null
    bodyContentType?: string | null
  }
}

export type SecureRequestResult = SecureHandoffResult | SecureHttpResult

// ─── Internal utilities ───────────────────────────────────────────────────────

export function hasHttpHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some(k => k.toLowerCase() === lower)
}

export function deleteHttpHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) delete headers[k]
  }
}

export function addDefaultHttpHeaders(headers: Record<string, string>, url: string): void {
  const host = new URL(url).host
  if (!hasHttpHeader(headers, 'User-Agent'))       headers['User-Agent'] = 'Voiden/1.0 (Electron)'
  if (!hasHttpHeader(headers, 'Accept'))           headers['Accept'] = '*/*'
  if (!hasHttpHeader(headers, 'Accept-Encoding')) headers['Accept-Encoding'] = 'gzip, deflate, br'
  if (!hasHttpHeader(headers, 'Host'))             headers['Host'] = host
  if (!hasHttpHeader(headers, 'Connection'))       headers['Connection'] = 'close'
  if (!hasHttpHeader(headers, 'Accept-Language')) headers['Accept-Language'] = 'en-US,en;q=0.9'
  if (!hasHttpHeader(headers, 'Sec-Fetch-Mode'))  headers['Sec-Fetch-Mode'] = 'cors'
  if (!hasHttpHeader(headers, 'Sec-Fetch-Site'))  headers['Sec-Fetch-Site'] = 'cross-site'
  if (!hasHttpHeader(headers, 'Sec-Fetch-Dest'))  headers['Sec-Fetch-Dest'] = 'empty'
}

export function getFileMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mime: Record<string, string> = {
    '.txt': 'text/plain',   '.html': 'text/html',       '.css': 'text/css',
    '.js':  'application/javascript', '.json': 'application/json',
    '.xml': 'application/xml',        '.pdf':  'application/pdf',
    '.zip': 'application/zip',        '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',            '.png':  'image/png',
    '.gif': 'image/gif',              '.svg':  'image/svg+xml',
    '.mp4': 'video/mp4',              '.mp3':  'audio/mpeg',
    '.wav': 'audio/wav',
  }
  return mime[ext] ?? 'application/octet-stream'
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function executeSecureRequest(
  requestState: RestApiRequestState,
  adapter: SecureRequestAdapter,
): Promise<SecureRequestResult> {
  const rv = (text: string) => adapter.replaceVar(text)

  // ── 1. Replace variables in URL ───────────────────────────────────────────
  let url = await rv(requestState.url)

  // ── 2. Replace variables in headers ──────────────────────────────────────
  const headers: Record<string, string> = {}
  for (const h of requestState.headers ?? []) {
    if (h.enabled !== false && h.key) {
      headers[await rv(h.key)] = await rv(h.value)
    }
  }

  // ── 3. Replace variables in query params → append to URL ─────────────────
  const queryParts: string[] = []
  for (const p of requestState.queryParams ?? []) {
    if (p.enabled !== false) {
      const k = await rv(p.key)
      const v = await rv(p.value)
      if (k) queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
  }
  if (queryParts.length > 0) {
    url += url.includes('?') ? `&${queryParts.join('&')}` : `?${queryParts.join('&')}`
  }

  // ── 4. Replace variables in path params ──────────────────────────────────
  for (const p of requestState.pathParams ?? []) {
    if (p.enabled !== false) {
      url = url.replace(`{${p.key}}`, encodeURIComponent(await rv(p.value)))
    }
  }

  // ── 5. Replace variables in body text ────────────────────────────────────
  const body = requestState.body ? await rv(requestState.body) : undefined

  // ── 6. Ensure URL has a protocol prefix ──────────────────────────────────
  if (!url.match(/^(https?|wss?|grpcs?):\/\//i)) url = `http://${url}`

  // ── 7. Protocol detection — hand off WS / gRPC / GQL-sub to caller ───────
  const proto = new URL(url).protocol

  if (proto === 'ws:' || proto === 'wss:') {
    const wsProtocol = proto === 'wss:' ? 'wss' : 'ws'
    if (adapter.isElectron !== false) {
      return { kind: 'handoff', protocol: wsProtocol, resolvedUrl: url, resolvedHeaders: headers, resolvedBody: body, requestState }
    }
    // CLI: connect and return a connection report as a regular response body
    const headersList = Object.entries(headers).map(([key, value]) => ({ key, value, enabled: true }))
    const result = await executeWebSocket({ protocol: wsProtocol, url, headers: headersList })
    const report = {
      connected: result.connected ?? false,
      protocol: result.protocol,
      url,
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
    }
    const reportBuf = Buffer.from(JSON.stringify(report, null, 2))
    const metaHeaders = headersList.map(h => ({ key: h.key, value: h.value }))
    return {
      kind: 'http',
      ok: result.connected ?? false,
      status: result.connected ? 101 : 0,
      statusText: result.connected ? 'Switching Protocols' : (result.error ?? 'Connection Failed'),
      headers: [['content-type', 'application/json']] as [string, string][],
      body: reportBuf,
      protocol: wsProtocol,
      requestMeta: { method: wsProtocol.toUpperCase(), url, headers: metaHeaders, httpVersion: 'WS' },
    }
  }

  if (proto === 'grpc:' || proto === 'grpcs:') {
    const grpcProtocol = proto === 'grpcs:' ? 'grpcs' : 'grpc'
    if (adapter.isElectron !== false) {
      return { kind: 'handoff', protocol: grpcProtocol, resolvedUrl: url, resolvedHeaders: headers, resolvedBody: body, requestState }
    }
    // CLI: connect and return a connection report as a regular response body
    const grpc = requestState.grpc ?? {}
    const result = await executeGrpc({
      protocol: grpcProtocol,
      url,
      metadata: headers,
      body,
      protoFilePath: grpc['protoFilePath'],
      service: grpc['service'],
      method: grpc['method'],
      package: grpc['package'],
      callType: grpc['callType'],
    })
    const report = {
      connected: result.connected ?? false,
      protocol: result.protocol,
      url,
      durationMs: result.durationMs,
      ...(grpc['service'] ? { service: grpc['service'] } : {}),
      ...(grpc['method'] ? { method: grpc['method'] } : {}),
      ...(result.error ? { error: result.error } : {}),
    }
    const reportBuf = Buffer.from(JSON.stringify(report, null, 2))
    const metaHeaders = Object.entries(headers).map(([key, value]) => ({ key, value }))
    return {
      kind: 'http',
      ok: result.connected ?? false,
      status: result.connected ? 200 : 0,
      statusText: result.connected ? 'Connected' : (result.error ?? 'Connection Failed'),
      headers: [['content-type', 'application/json']] as [string, string][],
      body: reportBuf,
      protocol: grpcProtocol,
      requestMeta: { method: 'GRPC', url, headers: metaHeaders, httpVersion: 'gRPC' },
    }
  }

  if (requestState.protocolType === 'graphql' && requestState.operationType === 'subscription') {
    return {
      kind: 'handoff',
      protocol: 'graphql-subscription',
      resolvedUrl: url, resolvedHeaders: headers, resolvedBody: body, requestState,
    }
  }

  // ── 8. Build fetch options ────────────────────────────────────────────────
  const followRedirects = adapter.followRedirects ?? true
  const fetchOptions: any = {
    method: requestState.method || 'GET',
    headers,
    redirect: followRedirects ? 'follow' : 'manual',
  }

  // ── 9. Build request body ─────────────────────────────────────────────────
  if (requestState.binary) {
    if (Array.isArray(requestState.binary)) {
      // Multiple binary files → send as multipart/form-data, one entry per file
      if (!adapter.readFile) throw new Error('Multi-file binary upload requires adapter.readFile')
      const formData = new FormData()
      for (const filePath of requestState.binary as string[]) {
        const fileBuffer = await adapter.readFile(filePath)
        const fileName = filePath.split('/').pop() ?? 'file'
        const blob = new Blob([fileBuffer], { type: getFileMimeType(filePath) })
        formData.append(fileName, blob, fileName)
      }
      fetchOptions.body = formData
      deleteHttpHeader(headers, 'Content-Type')
    } else if (typeof requestState.binary === 'string') {
      if (!adapter.readFile) throw new Error(`Binary file upload requires adapter.readFile (path: ${requestState.binary})`)
      const fileBuffer = await adapter.readFile(requestState.binary)
      fetchOptions.body = fileBuffer
      if (!hasHttpHeader(headers, 'Content-Type')) headers['Content-Type'] = getFileMimeType(requestState.binary)
    } else {
      const bin = requestState.binary as any
      if (typeof bin.arrayBuffer === 'function') fetchOptions.body = Buffer.from(await bin.arrayBuffer())
      else if (bin && 'buffer' in bin) fetchOptions.body = Buffer.from(bin.buffer)
      else fetchOptions.body = bin
    }
  } else if (requestState.bodyParams?.length) {
    const bodyParams = requestState.bodyParams as any[]

    if (requestState.contentType === 'multipart/form-data') {
      const formData = new FormData()
      for (const p of bodyParams) {
        if (p.enabled === false) continue
        if (p.type === 'file' && p.value) {
          if (!adapter.readFile) throw new Error('Multipart file upload requires adapter.readFile')
          const filePath = p.value as string
          const fileBuffer = await adapter.readFile(filePath)
          const fileName = filePath.split('/').pop() ?? 'file'
          const blob = new Blob([fileBuffer], { type: getFileMimeType(filePath) })
          formData.append(p.key, blob, fileName)
        } else if (p.type === 'text') {
          formData.append(p.key, await rv(p.value as string))
        }
      }
      fetchOptions.body = formData
      deleteHttpHeader(headers, 'Content-Type') // Let FormData set Content-Type with boundary
    } else if (requestState.contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams()
      for (const p of bodyParams) {
        if (p.enabled !== false && p.type === 'text') {
          params.append(p.key, await rv(p.value as string))
        }
      }
      fetchOptions.body = params.toString()
      if (!hasHttpHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
  } else if (requestState.method !== 'GET' && body) {
    fetchOptions.body = body
    if (requestState.contentType && !hasHttpHeader(headers, 'Content-Type')) {
      headers['Content-Type'] = requestState.contentType
    }
  }

  // ── 10. Apply dispatcher (proxy / TLS agent) ──────────────────────────────
  let proxyInfo: any
  if (adapter.getDispatcher) {
    const { dispatcher, proxyInfo: pi } = adapter.getDispatcher(url)
    if (dispatcher) fetchOptions.dispatcher = dispatcher
    proxyInfo = pi
  }

  // ── 11. Add default HTTP headers ──────────────────────────────────────────
  addDefaultHttpHeaders(headers, url)
  fetchOptions.headers = headers

  // ── 12. Execute HTTP request ──────────────────────────────────────────────
  const response = await fetch(url, fetchOptions as RequestInit)
  const buffer = response.body ? await response.arrayBuffer() : null

  // ── 13. Build request metadata for display ────────────────────────────────
  const requestMetaHeaders = Object.entries(headers).map(([k, v]) => ({ key: k, value: v as string }))
  const isHttps = new URL(url).protocol === 'https:'
  const tlsInfo = isHttps
    ? { protocol: 'TLS 1.3', cipher: 'TLS_AES_128_GCM_SHA256', isSecure: true }
    : undefined
  const responseProtocol = requestState.protocolType === 'graphql' ? 'graphql' : 'rest'

  let requestBodySent: string | null = null
  let requestBodyContentType: string | null = null

  if (body && typeof body === 'string') {
    requestBodySent = body
    requestBodyContentType = requestState.contentType ?? headers['Content-Type'] ?? null
  } else if (requestState.bodyParams?.length) {
    const bodyParams = requestState.bodyParams as any[]
    if (requestState.contentType === 'multipart/form-data') {
      requestBodySent = bodyParams
        .filter(p => p.enabled !== false)
        .map(p => p.type === 'file'
          ? `${p.key}: [file] ${String(p.value).split('/').pop()}`
          : `${p.key}: ${p.value}`)
        .join('\n')
      requestBodyContentType = 'multipart/form-data'
    } else if (requestState.contentType === 'application/x-www-form-urlencoded') {
      requestBodySent = bodyParams
        .filter(p => p.enabled !== false && p.type === 'text')
        .map(p => `${p.key}=${p.value}`)
        .join('&')
      requestBodyContentType = 'application/x-www-form-urlencoded'
    }
  }

  return {
    kind: 'http',
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()] as [string, string][],
    body: buffer ? Buffer.from(buffer) : null,
    protocol: responseProtocol,
    operationType: requestState.operationType,
    requestMeta: {
      method: fetchOptions.method,
      url,
      headers: requestMetaHeaders,
      httpVersion: (response as any).httpVersion ?? 'HTTP/1.1',
      proxy: proxyInfo,
      tlsInfo,
      body: requestBodySent,
      bodyContentType: requestBodyContentType,
    },
  }
}
