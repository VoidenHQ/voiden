/**
 * Result write-back — records a request's execution result directly into the
 * .void file it came from, as a new `response` block placed right after the
 * `request` block it belongs to.
 *
 * This is new: voiden-runner has never modified .void files before (see
 * README: "The .void files themselves are never modified"). It exists so an
 * MCP-driven agent can close the loop — write a request, run it, and have the
 * real result recorded in the file instead of only ever seeing console/JSON
 * output.
 *
 * No file locking is used (matches the rest of the codebase — the Electron
 * app's own files:write is a bare fs.writeFile too). If the target file is
 * open with unsaved edits in Voiden at the same time, the next manual save
 * there can silently overwrite this write, or this write can clobber those
 * edits. Callers (the MCP server, the skill) should treat this as a known
 * limitation, not something this function guards against.
 */

import { readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import YAML from 'yaml'
import type { RunResult } from './types.js'

const MAX_BODY_CHARS = 20_000

// Plain markdown heading placed right before the fenced `response` block —
// makes the record visible/readable even without the voiden-rest-api plugin's
// dedicated renderer (e.g. in a raw markdown viewer, or before that plugin
// picks up this change).
const RESPONSE_HEADING = '## Response recorded'

// Same fence shape as parser.ts's regex, but tracking raw text offsets too
// (parser.ts only returns parsed Block[], with no position info) since we
// need to splice the source text rather than just read it.
const FENCE_RE = /^```void\n([\s\S]*?)^```/gm

interface FenceMatch {
  /** Index of the opening ` ```void ` */
  start: number
  /** Index right after the closing ` ``` ` */
  end: number
  type?: string
  uid?: string
  requestUid?: string
}

function scanFences(content: string): FenceMatch[] {
  const matches: FenceMatch[] = []
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const start = m.index
    const end = start + m[0].length
    const body = m[1]
    const lines = body.trim().split('\n')
    let type: string | undefined
    let uid: string | undefined
    let requestUid: string | undefined
    if (lines[0]?.trim() === '---') {
      const headerEnd = lines.indexOf('---', 1)
      if (headerEnd !== -1) {
        try {
          const parsed = YAML.parse(lines.slice(1, headerEnd).join('\n'))
          type = parsed?.type
          uid = parsed?.attrs?.uid
          requestUid = parsed?.attrs?.requestUid
        } catch {
          // Malformed fence — treat as opaque (type/uid stay undefined), matching
          // parser.ts's own tolerance for blocks it can't parse.
        }
      }
    }
    matches.push({ start, end, type, uid, requestUid })
  }
  return matches
}

/** Build a fenced `response` block's raw text for the given result. */
export function buildResponseBlockText(result: RunResult, requestUid: string): string {
  let body = result.body
  let truncated = false
  if (typeof body === 'string' && body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS)
    truncated = true
  }

  const attrs: Record<string, any> = {
    uid: randomUUID(),
    requestUid,
    capturedAt: new Date().toISOString(),
    success: result.success,
  }
  if (result.status !== undefined) attrs.status = result.status
  if (result.statusText !== undefined) attrs.statusText = result.statusText
  attrs.durationMs = result.durationMs
  if (result.size !== undefined) attrs.size = result.size
  if (result.requestHeaders) attrs.requestHeaders = result.requestHeaders
  if (result.requestBody) attrs.requestBody = result.requestBody
  if (result.responseHeaders) attrs.responseHeaders = result.responseHeaders
  if (body !== undefined) attrs.body = body
  if (truncated) attrs.truncated = true
  if (result.error) attrs.error = result.error

  const yamlText = YAML.stringify({ type: 'response', attrs })
  return '```void\n---\n' + yamlText + '---\n```'
}

/**
 * Insert or replace the `response` block for `requestUid` in `filePath`.
 * - If a `response` block already exists for this request in the same
 *   section (i.e. before the next request-separator, or EOF), it's replaced.
 * - Otherwise the new block is inserted immediately after the request block.
 *
 * Matches purely by `uid`, not block `type` — deliberately protocol-agnostic:
 * REST's request-container block is typed `request`, GraphQL's is `gqlquery`,
 * WebSocket/gRPC's is `socket-request`, and other plugins may use their own
 * type name entirely. uids are unique per block regardless of type, so there's
 * no need to hardcode (and keep updating) a list of "known request types".
 *
 * Throws if no block with a matching `uid` exists in the file.
 */
export function upsertResponseBlock(filePath: string, requestUid: string, result: RunResult): void {
  const content = readFileSync(filePath, 'utf-8')
  const fences  = scanFences(content)

  const requestFence = fences.find(f => f.uid === requestUid)
  if (!requestFence) {
    throw new Error(`No block with uid "${requestUid}" found in ${filePath}`)
  }

  const nextSeparator = fences.find(
    f => f.type === 'request-separator' && f.start > requestFence.end,
  )
  const sectionEnd = nextSeparator ? nextSeparator.start : content.length

  const existingResponse = fences.find(
    f => f.type === 'response'
      && f.requestUid === requestUid
      && f.start > requestFence.end
      && f.start < sectionEnd,
  )

  const blockText = buildResponseBlockText(result, requestUid)
  const blockWithHeading = RESPONSE_HEADING + '\n\n' + blockText

  let newContent: string
  if (existingResponse) {
    // Replace the heading together with the block if we recognise one directly
    // preceding it (written by a prior run) — otherwise leave whatever precedes
    // it untouched and just add a heading now.
    const before = content.slice(0, existingResponse.start)
    const headingMatch = before.match(/## Response recorded\s*$/)
    const replaceStart = headingMatch ? existingResponse.start - headingMatch[0].length : existingResponse.start
    newContent = content.slice(0, replaceStart) + blockWithHeading + content.slice(existingResponse.end)
  } else {
    newContent = content.slice(0, requestFence.end) + '\n\n' + blockWithHeading + content.slice(requestFence.end)
  }

  writeFileSync(filePath, newContent, 'utf-8')
}
