/**
 * Runtime variable capture and substitution — voiden-runner.
 *
 * In the Electron app, captured variables are saved to ~/.voiden/.process.env.json.
 * In the runner they are kept PURELY IN-MEMORY for the duration of the run:
 *   • Nothing is written to disk — .void files are never touched
 *   • Variables captured from file/section A are available in file/section B
 *   • The map is reset on each `voiden-runner run` invocation
 *
 * Capture syntax (runtime-variables block in the .void file):
 *   key   = token
 *   value = {{$res.body.access_token}}
 *
 * Substitution syntax (URL, headers, body, query params, etc.):
 *   {{process.token}}
 *
 * Script access:
 *   voiden.variables.get('token')   // read
 *   voiden.variables.set('token', v) // write — reflected immediately in the run
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RuntimeVarRow {
  key:     string
  value:   string   // e.g. "{{$res.body.access_token}}"
  enabled: boolean
}

export interface CaptureRequest {
  url?:           string
  method?:        string
  requestHeaders?: Record<string, string>
  requestBody?:   string
}

export interface CaptureResponse {
  status?:          number
  statusText?:      string
  responseHeaders?: Record<string, string>
  body?:            string
  durationMs?:      number
  size?:            number
}

// ─── Block extraction ─────────────────────────────────────────────────────────

/**
 * Find all runtime-variables capture rows inside a section's block array.
 * Handles both the attrs.rows format (new) and TipTap nested table (old).
 */
export function extractRuntimeVarRows(blocks: any[]): RuntimeVarRow[] {
  const rows: RuntimeVarRow[] = []

  for (const block of blocks) {
    if (block.type !== 'runtime-variables') continue

    // ── New format: attrs.rows ─────────────────────────────────────────────
    if (Array.isArray(block.attrs?.rows)) {
      for (const r of block.attrs.rows) {
        if (!r.key || !r.value) continue
        rows.push({ key: r.key, value: r.value, enabled: r.enabled !== false })
      }
      continue
    }

    // ── App-generated table format: table.rows[].row ──────────────────────
    const table = block.content?.find((n: any) => n.type === 'table')
    if (!table) continue

    if (Array.isArray(table.rows)) {
      for (const r of table.rows) {
        if (r.attrs?.disabled === true) continue
        const key   = String(r.row?.[0] ?? '').trim()
        const value = String(r.row?.[1] ?? '').trim()
        if (!key || !value) continue
        rows.push({ key, value, enabled: true })
      }
      continue
    }

    // ── Old TipTap table format: table.content[tableRow] ──────────────────
    for (const tr of table.content ?? []) {
      if (tr.type !== 'tableRow') continue
      if (tr.attrs?.disabled === true) continue

      const cells: any[] = tr.content ?? []
      const key   = cellText(cells[0])
      const value = cellText(cells[1])
      if (!key || !value) continue

      rows.push({ key, value, enabled: true })
    }
  }

  return rows
}

function cellText(cell: any): string {
  if (!cell || cell.type !== 'tableCell') return ''
  return (cell.content ?? [])
    .flatMap((p: any) => p.content ?? [])
    .filter((n: any) => n.type === 'text')
    .map((n: any) => n.text ?? '')
    .join('')
    .trim()
}

// ─── Value path extraction ────────────────────────────────────────────────────

function tryJson(s: any): any {
  if (typeof s !== 'string') return s
  try { return JSON.parse(s) } catch { return s }
}

function toKvArray(obj?: Record<string, string>): { key: string; value: string }[] {
  if (!obj) return []
  return Object.entries(obj).map(([key, value]) => ({ key, value }))
}

/**
 * Extract a value by dot-notation path from a nested object or {key,value}[] array.
 * Supports: `body.data.id`, `headers.Authorization`, `items[0].name`
 */
function byPath(obj: any, path: string): any {
  if (obj == null || !path) return undefined
  const keys = path.split('.')
  let cur = obj

  for (const raw of keys) {
    if (cur == null) return undefined
    if (typeof cur === 'string') { cur = tryJson(cur); if (cur == null) return undefined }

    // Array index: items[0]
    const arr = raw.match(/^(.+)\[(\d+)\]$/)
    if (arr) {
      const [, k, i] = arr
      cur = Array.isArray(cur) ? kvFind(cur, k) : cur?.[k]
      if (typeof cur === 'string') cur = tryJson(cur)
      cur = Array.isArray(cur) ? cur[parseInt(i, 10)] : undefined
      continue
    }

    // Key-value array (headers, queryParams, etc.)
    if (Array.isArray(cur) && cur[0] != null && 'key' in cur[0]) {
      cur = kvFind(cur, raw)
      continue
    }

    // Plain object — case-insensitive match for headers
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      const k = Object.keys(cur).find(k => k === raw || k.toLowerCase() === raw.toLowerCase())
      cur = k ? cur[k] : undefined
      continue
    }

    cur = cur?.[raw]
  }

  return cur
}

function kvFind(arr: any[], key: string): any {
  return arr.find((i: any) => i.key?.toLowerCase() === key.toLowerCase())?.value
}

function evalExpr(expr: string, req: CaptureRequest, res: CaptureResponse): any {
  const m = expr.trim().match(/^\{\{\s*\$(\w+)\.(.+?)\s*\}\}$/)
  if (!m) return undefined

  const [, source, path] = m

  if (source === 'res') {
    return byPath({
      status:     res.status,
      statusText: res.statusText,
      body:       tryJson(res.body),
      headers:    toKvArray(res.responseHeaders),
      time:       res.durationMs,
      size:       res.size,
    }, path)
  }

  if (source === 'req') {
    return byPath({
      url:        req.url,
      method:     req.method,
      headers:    toKvArray(req.requestHeaders),
      body:       tryJson(req.requestBody),
      queryParams: [],
    }, path)
  }

  return undefined
}

// ─── Capture update ───────────────────────────────────────────────────────────

/**
 * Evaluate all capture rows and write results into `vars` (mutates in place).
 * Call this after each request completes.
 */
export function captureRuntimeVars(
  rows:   RuntimeVarRow[],
  req:    CaptureRequest,
  res:    CaptureResponse,
  vars:   Record<string, any>,
): void {
  for (const row of rows) {
    if (!row.enabled) continue
    const expr = row.value.trim()

    if (/^\{\{\s*\$\w+\.[^}]+\s*\}\}$/.test(expr)) {
      // Single template — preserve original type (object, number, etc.)
      const captured = evalExpr(expr, req, res)
      if (captured !== undefined && captured !== null) vars[row.key] = captured
    } else {
      // Mixed text — string interpolation
      vars[row.key] = expr.replace(/\{\{\s*\$(\w+)\.([^}]+)\s*\}\}/g, (_, src, path) => {
        const v = evalExpr(`{{$${src}.${path}}}`, req, res)
        return v !== undefined && v !== null ? String(v) : ''
      })
    }
  }
}

// ─── Process variable substitution ───────────────────────────────────────────

const PROCESS_RE = /\{\{\s*process\.([^}]+)\s*\}\}/g

function procReplace(text: string, vars: Record<string, any>): string {
  if (!text || typeof text !== 'string') return text
  return text.replace(PROCESS_RE, (_, path) => {
    const v = byPath(vars, path.trim())
    return v !== undefined && v !== null
      ? (typeof v === 'object' ? JSON.stringify(v) : String(v))
      : ''
  })
}

function procReplacePreserve(text: string, vars: Record<string, any>): any {
  if (!text || typeof text !== 'string') return text
  const single = text.trim().match(/^\{\{\s*process\.([^}]+)\s*\}\}$/)
  if (single) {
    const v = byPath(vars, single[1].trim())
    return v !== undefined && v !== null ? v : ''
  }
  return procReplace(text, vars)
}

/**
 * Substitute {{process.xxx}} in all fields of a RestApiRequestState.
 * Returns a shallow-cloned, modified copy — original is not mutated.
 */
export function applyProcessVarsToState(
  state: any,
  vars:  Record<string, any>,
): any {
  if (!Object.keys(vars).length) return state
  const s = { ...state }

  if (s.url) s.url = procReplace(s.url, vars)

  if (Array.isArray(s.headers))
    s.headers = s.headers.map((h: any) => ({ ...h, value: procReplace(h.value ?? '', vars) }))

  if (Array.isArray(s.queryParams))
    s.queryParams = s.queryParams.map((p: any) => ({ ...p, value: procReplace(p.value ?? '', vars) }))

  if (Array.isArray(s.pathParams))
    s.pathParams = s.pathParams.map((p: any) => ({ ...p, value: procReplace(p.value ?? '', vars) }))

  if (s.body) {
    if (typeof s.body === 'string') {
      const r = procReplacePreserve(s.body, vars)
      s.body = typeof r === 'object' ? r : String(r)
    } else if (typeof s.body === 'object') {
      try { s.body = JSON.parse(procReplace(JSON.stringify(s.body), vars)) } catch { /* keep */ }
    }
  }

  if (Array.isArray(s.bodyParams))
    s.bodyParams = s.bodyParams.map((p: any) => ({ ...p, value: procReplace(String(p.value ?? ''), vars) }))

  return s
}
