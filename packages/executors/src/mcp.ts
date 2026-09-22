import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getValidStoredTokens } from './mcpClientAuthStore.js'

const OPERATION_TIMEOUT_MS = 15_000

export type McpOperation =
  | 'list_tools' | 'call_tool' | 'list_resources' | 'read_resource' | 'list_prompts' | 'get_prompt'

export interface McpRequest {
  url: string
  headers: Record<string, string>
  operation: McpOperation
  toolName?: string
  toolArgs?: Record<string, any>
  resourceUri?: string
  promptName?: string
  promptArgs?: Record<string, any>
}

export interface McpOperationResult {
  success: boolean
  result?: any
  error?: string
  durationMs: number
  /** Set when the failure was specifically a 401 — lets callers show "this
   *  server needs authorization" instead of a generic connection error. */
  authRequired?: boolean
  /** Best-effort: the URL a human should actually visit to log in, resolved
   *  by walking the same discovery chain a real MCP client does (RFC 9728
   *  protected-resource metadata -> RFC 8414 authorization-server metadata).
   *  Omitted if that walk itself fails — authRequired alone still tells the
   *  caller enough to show a clear message even with no URL to link to. */
  authorizeUrl?: string
}

/**
 * Best-effort discovery of the real /authorize URL for a 401 response,
 * mirroring what an OAuth-strict MCP client does before ever showing a user
 * a login page — see docs/mcp-tool-publish-guide.md's "What actually gets
 * called, endpoint by endpoint" for the same chain from the server side.
 * Every step is optional and wrapped so a discovery failure here never
 * overrides the caller's own authRequired:true — worst case, the user gets
 * "needs authorization" with no direct link instead of one.
 */
async function discoverAuthorizeUrl(mcpUrl: string): Promise<string | undefined> {
  try {
    const resourceMetaRes = await fetch(new URL('/.well-known/oauth-protected-resource', mcpUrl))
    if (!resourceMetaRes.ok) return undefined
    const resourceMeta = await resourceMetaRes.json()
    const authServer = resourceMeta?.authorization_servers?.[0]
    if (!authServer) return undefined

    const authServerMetaRes = await fetch(new URL('/.well-known/oauth-authorization-server', authServer))
    if (!authServerMetaRes.ok) return undefined
    const authServerMeta = await authServerMetaRes.json()
    return authServerMeta?.authorization_endpoint || authServer
  } catch {
    return undefined
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

/**
 * Runs one MCP operation against a Streamable-HTTP server: connect (which performs
 * the initialize handshake internally), make the one call the block asked for, close.
 * Every call is a fresh connection — no session is kept alive across invocations.
 */
export async function executeMcpOperation(req: McpRequest): Promise<McpOperationResult> {
  const start = Date.now()
  const client = new Client({ name: 'voiden', version: '1.0.0' }, { capabilities: {} })

  // Transparently attach a token from a completed "Authorize" flow (see
  // mcpAuthorize.ts) — but never here does it try to CREATE one: no
  // authProvider is passed to the transport below, so a missing/expired
  // token surfaces as the existing 401 -> authRequired path instead of
  // silently trying to pop a browser mid tool-call. A block's own explicit
  // Authorization header (a static key, or a manually-pasted token) always
  // wins over an auto-attached one, since the user set it on purpose.
  const hasExplicitAuthHeader = Object.keys(req.headers).some((k) => k.toLowerCase() === 'authorization')
  const headers = { ...req.headers }
  if (!hasExplicitAuthHeader) {
    const storedTokens = getValidStoredTokens(req.url)
    if (storedTokens) headers['Authorization'] = `${storedTokens.token_type || 'Bearer'} ${storedTokens.access_token}`
  }

  const transport = new StreamableHTTPClientTransport(new URL(req.url), {
    requestInit: { headers },
  })

  try {
    await withTimeout(client.connect(transport), OPERATION_TIMEOUT_MS, 'MCP connect')

    let result: any
    switch (req.operation) {
      case 'list_tools':
        result = await withTimeout(client.listTools(), OPERATION_TIMEOUT_MS, 'list_tools')
        break
      case 'call_tool':
        result = await withTimeout(
          client.callTool({ name: req.toolName || '', arguments: req.toolArgs || {} }),
          OPERATION_TIMEOUT_MS, 'call_tool',
        )
        break
      case 'list_resources':
        result = await withTimeout(client.listResources(), OPERATION_TIMEOUT_MS, 'list_resources')
        break
      case 'read_resource':
        result = await withTimeout(
          client.readResource({ uri: req.resourceUri || '' }),
          OPERATION_TIMEOUT_MS, 'read_resource',
        )
        break
      case 'list_prompts':
        result = await withTimeout(client.listPrompts(), OPERATION_TIMEOUT_MS, 'list_prompts')
        break
      case 'get_prompt':
        result = await withTimeout(
          client.getPrompt({ name: req.promptName || '', arguments: req.promptArgs || {} }),
          OPERATION_TIMEOUT_MS, 'get_prompt',
        )
        break
      default:
        throw new Error(`Unknown MCP operation: ${req.operation}`)
    }

    // A tool-level failure (isError:true in a callTool result) is a normal,
    // successful RPC whose payload happens to describe an error — not a thrown
    // exception. Only transport/protocol-level failures land in the catch below.
    return { success: true, result, durationMs: Date.now() - start }
  } catch (err: any) {
    // StreamableHTTPClientTransport throws this (err.code holding the raw
    // HTTP status) specifically when it gets a 401 with no authProvider
    // configured — which is always true here, since this executor never
    // constructs one. Every other failure (network down, bad URL, server
    // 500) throws a plain Error with no `.code`, so this check doesn't
    // false-positive on unrelated connection problems.
    const authRequired = err?.code === 401
    return {
      success: false,
      error: err?.message || String(err),
      authRequired,
      authorizeUrl: authRequired ? await discoverAuthorizeUrl(req.url) : undefined,
      durationMs: Date.now() - start,
    }
  } finally {
    try { await client.close() } catch { /* best-effort cleanup */ }
  }
}
