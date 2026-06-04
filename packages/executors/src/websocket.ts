import WebSocket from 'ws'
import type { WebSocketRequest, RunResult } from './types.js'
import { replaceEnvVars } from './env.js'

const CONNECT_TIMEOUT_MS = 10_000

export function executeWebSocket(req: WebSocketRequest, env: Record<string, string> = {}): Promise<RunResult> {
  const start = Date.now()
  const url = replaceEnvVars(req.url, env)

  return new Promise(resolve => {
    const headers: Record<string, string> = {}
    for (const h of req.headers.filter(h => h.enabled && h.key)) {
      headers[replaceEnvVars(h.key, env)] = replaceEnvVars(h.value, env)
    }

    let settled = false
    const done = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.terminate() } catch {}
      resolve(result)
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(url, { headers })
    } catch (err: any) {
      resolve({
        protocol: req.protocol,
        url,
        success: false,
        durationMs: Date.now() - start,
        connected: false,
        error: err?.message || String(err),
      })
      return
    }

    const timer = setTimeout(() => {
      done({
        protocol: req.protocol,
        url,
        success: false,
        durationMs: Date.now() - start,
        connected: false,
        error: `Connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
      })
    }, CONNECT_TIMEOUT_MS)

    ws.on('open', () => {
      done({
        protocol: req.protocol,
        url,
        success: true,
        durationMs: Date.now() - start,
        connected: true,
      })
    })

    ws.on('error', (err) => {
      done({
        protocol: req.protocol,
        url,
        success: false,
        durationMs: Date.now() - start,
        connected: false,
        error: err.message,
      })
    })
  })
}
