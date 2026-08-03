import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

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
  const transport = new StreamableHTTPClientTransport(new URL(req.url), {
    requestInit: { headers: req.headers },
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
    return { success: false, error: err?.message || String(err), durationMs: Date.now() - start }
  } finally {
    try { await client.close() } catch { /* best-effort cleanup */ }
  }
}
