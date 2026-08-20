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
import mimeTypes from 'mime-types'
import type { RestApiRequestState } from './pipeline/types.js'
import { executeWebSocket } from './websocket.js'
import { executeGrpc } from './grpc.js'
import { executeMcpOperation } from './mcp.js'
import { assertNoUnresolvedTemplates } from './unresolvedVariables.js'

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface SecureRequestAdapter {
  /** Replace {{variable}} references in a string. */
  replaceVar(text: string): Promise<string>
  /** Read a file from the filesystem (required for binary uploads and multipart file params). */
  readFile?(filePath: string): Promise<Buffer>
  /**
   * Return an undici-compatible dispatcher and optional proxy metadata for a URL.
   * Electron passes an Agent or ProxyAgent; CLI omits this for plain fetch.
   *
   * `options.disableTlsVerification`, when present, is this request's per-request
   * TLS override (from requestState.metadata.disable_tls_verification) and takes
   * priority over the app-wide disable_tls_verification setting; omit it to fall
   * back to the global setting.
   */
  getDispatcher?(url: string, options?: { disableTlsVerification?: boolean }): { dispatcher?: any; proxyInfo?: any }
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
  // mime-types covers the full mime-db registry (hundreds of extensions),
  // so new file types are handled automatically without another release.
  return mimeTypes.lookup(filePath) || 'application/octet-stream'
}

function validateResolvedOutgoing(
  url: string,
  headers: Record<string, string>,
  body?: string,
  extra: string[] = [],
): void {
  const parts: string[] = [url]
  if (body) parts.push(body)
  parts.push(...Object.keys(headers), ...Object.values(headers), ...extra)
  assertNoUnresolvedTemplates(parts)
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

  validateResolvedOutgoing(url, headers, body)

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

  // MCP (Streamable HTTP) — not reducible to a single fetch() like GraphQL is,
  // since a spec-compliant server requires an initialize handshake before any
  // operation. Unlike WS/gRPC above, there's no persistent connection to keep
  // alive across IPC calls (connect → one call → close), so this returns a
  // plain kind:'http' result directly instead of a kind:'handoff' — no
  // Electron-side registry needed, identical behaviour for app and CLI.
  if (requestState.protocolType === 'mcp') {
    const mcp = (requestState as any).mcp ?? {}
    // toolName/resourceUri/promptName are plain strings; toolArgs/promptArgs
    // are JSON objects the user authored in the operation block's code
    // editor — either can contain {{...}} placeholders (env, runtime,
    // faker, tool-param binds) same as any other request field. rv() only
    // operates on strings, so object args need a recursive walk rather than
    // the single call url/headers get above.
    const resolveDeep = async (value: any): Promise<any> => {
      if (typeof value === 'string') return rv(value)
      if (Array.isArray(value)) return Promise.all(value.map(resolveDeep))
      if (value && typeof value === 'object') {
        const entries = await Promise.all(
          Object.entries(value).map(async ([k, v]) => [k, await resolveDeep(v)] as const),
        )
        return Object.fromEntries(entries)
      }
      return value
    }

    const result = await executeMcpOperation({
      url,
      headers,
      operation: mcp.operation,
      toolName: await resolveDeep(mcp.toolName),
      toolArgs: await resolveDeep(mcp.toolArgs),
      resourceUri: await resolveDeep(mcp.resourceUri),
      promptName: await resolveDeep(mcp.promptName),
      promptArgs: await resolveDeep(mcp.promptArgs),
    })

    const responseBody = result.success
      ? { operation: mcp.operation, ...result.result }
      : { operation: mcp.operation, error: result.error }
    const metaHeaders = Object.entries(headers).map(([key, value]) => ({ key, value }))

    return {
      kind: 'http',
      ok: result.success,
      status: result.success ? 200 : 0,
      // Short, generic text only — this feeds the response panel's top-bar
      // status chrome, which expects an HTTP-style label ("OK", "Not Found"),
      // not the full (often multi-line, JSON-bearing) MCP error message. The
      // full error is already carried in the JSON body (responseBody.error
      // above), which the mcp-response block renders in full.
      statusText: result.success ? 'OK' : 'MCP request failed',
      headers: [['content-type', 'application/json']],
      body: Buffer.from(JSON.stringify(responseBody, null, 2)),
      protocol: 'mcp',
      requestMeta: { method: 'MCP', url, headers: metaHeaders, httpVersion: 'MCP/Streamable-HTTP' },
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
      const resolvedBinaryPath = await rv(requestState.binary)
      validateResolvedOutgoing(url, headers, body, [resolvedBinaryPath])
      if (!adapter.readFile) throw new Error(`Binary file upload requires adapter.readFile (path: ${resolvedBinaryPath})`)
      const fileBuffer = await adapter.readFile(resolvedBinaryPath)
      fetchOptions.body = fileBuffer
      if (!hasHttpHeader(headers, 'Content-Type')) headers['Content-Type'] = getFileMimeType(resolvedBinaryPath)
    } else {
      const bin = requestState.binary as any
      if (typeof bin.arrayBuffer === 'function') fetchOptions.body = Buffer.from(await bin.arrayBuffer())
      else if (bin && 'buffer' in bin) fetchOptions.body = Buffer.from(bin.buffer)
      else fetchOptions.body = bin
    }
  } else if (requestState.bodyParams?.length) {
    const bodyParams = requestState.bodyParams as any[]
    const resolvedBodyParamTexts: string[] = []

    if (requestState.contentType === 'multipart/form-data') {
      const formData = new FormData()
      for (const p of bodyParams) {
        if (p.enabled === false) continue
        if (p.type === 'file' && p.value) {
          if (!adapter.readFile) throw new Error('Multipart file upload requires adapter.readFile')
          const filePath = await rv(p.value as string)
          resolvedBodyParamTexts.push(filePath)
          const fileBuffer = await adapter.readFile(filePath)
          const fileName = filePath.split('/').pop() ?? 'file'
          const blob = new Blob([fileBuffer], { type: getFileMimeType(filePath) })
          formData.append(p.key, blob, fileName)
        } else if (p.type === 'text') {
          const resolvedValue = await rv(p.value as string)
          resolvedBodyParamTexts.push(resolvedValue)
          formData.append(p.key, resolvedValue)
        }
      }
      fetchOptions.body = formData
      deleteHttpHeader(headers, 'Content-Type') // Let FormData set Content-Type with boundary
    } else if (requestState.contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams()
      for (const p of bodyParams) {
        if (p.enabled !== false && p.type === 'text') {
          const resolvedValue = await rv(p.value as string)
          resolvedBodyParamTexts.push(resolvedValue)
          params.append(p.key, resolvedValue)
        }
      }
      fetchOptions.body = params.toString()
      if (!hasHttpHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    validateResolvedOutgoing(url, headers, body, resolvedBodyParamTexts)
  } else if (requestState.method !== 'GET' && body) {
    fetchOptions.body = body
    if (requestState.contentType && !hasHttpHeader(headers, 'Content-Type')) {
      headers['Content-Type'] = requestState.contentType
    }
  }

  // ── 10. Apply dispatcher (proxy / TLS agent) ──────────────────────────────
  let proxyInfo: any
  if (adapter.getDispatcher) {
    const disableTlsVerification = requestState.metadata?.disable_tls_verification
    const { dispatcher, proxyInfo: pi } = adapter.getDispatcher(
      url,
      typeof disableTlsVerification === 'boolean' ? { disableTlsVerification } : undefined,
    )
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
