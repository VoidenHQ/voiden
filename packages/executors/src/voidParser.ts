/**
 * Parser: .void file content (markdown string) → Block[]
 *
 * Adapted from apps/ui/src/core/editors/voiden/markdownConverter.ts
 * - No TipTap/ProseMirror dependency
 * - No schema validation — trusts the YAML type field as-is
 *
 * Lives here (not in @voiden/runner) because both the Voiden app and
 * @voiden/runner need it — the app for validating externally-written .void
 * files, the runner for actually executing them — and @voiden/executors is
 * the one shared package both already depend on without pulling in
 * @voiden/runner's CLI-specific weight (chalk, commander, nodemailer, the
 * plugin loader).
 */

import YAML from 'yaml'

export interface Block {
  type: string
  attrs?: Record<string, any>
  content?: Block[] | string
}

/**
 * Restore %%EMPTY_LINE%% placeholders back to empty strings.
 * These appear in script/code node bodies when saved.
 */
function restoreEmptyLineMarkers(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/%%EMPTY_LINE%%/g, '')
  }
  if (Array.isArray(value)) {
    return value.map(restoreEmptyLineMarkers)
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = restoreEmptyLineMarkers(v)
    }
    return result
  }
  return value
}

/**
 * Inflate a compact-saved table node — `{ type: "table", rows: [{ attrs,
 * row: [key, value] }] }` — back into the full ProseMirror node tree
 * (tableRow → tableCell → paragraph) that every consumer downstream of a
 * parsed block actually expects. Ported from
 * apps/ui/src/core/editors/voiden/markdownConverter.ts's inflateTableNode —
 * this file's own header comment already says it's an adaptation of that
 * one, but this one specific step went missing in the adaptation, which
 * silently broke every table-shaped block (multipart-table, headers-table,
 * a plain table, and any multipart file field inside one) for every
 * standalone consumer of parseVoidFile (voiden-runner, @voiden/mcp,
 * run_request) — they never crashed, they just silently extracted zero
 * rows, since e.g. voiden-rest-api's buildBodyParams only knows how to read
 * the inflated tableRow/tableCell shape, never the compact one.
 */
function inflateTableNode(simplified: any): Block {
  const tableNode: Block = { type: 'table', content: [] }
  if (!simplified.rows || !Array.isArray(simplified.rows)) return tableNode

  const rows: Block[] = []
  for (const rowObj of simplified.rows) {
    const cells: Block[] = []
    for (const cellValue of rowObj.row ?? []) {
      const paragraphContent: any[] = []
      if (cellValue === null || cellValue === undefined) {
        // leave empty — matches the source's explicit no-op branch
      } else if (typeof cellValue === 'string') {
        paragraphContent.push({ type: 'text', text: cellValue })
      } else if (Array.isArray(cellValue)) {
        for (const item of cellValue) {
          if (typeof item === 'string') paragraphContent.push({ type: 'text', text: item })
          else if (item && typeof item === 'object') paragraphContent.push(item) // already a node, e.g. fileLink
        }
      } else if (typeof cellValue === 'object') {
        paragraphContent.push(cellValue)
      }
      cells.push({
        type: 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: [{ type: 'paragraph', content: paragraphContent } as any],
      })
    }
    rows.push({ type: 'tableRow', attrs: rowObj.attrs || {}, content: cells })
  }
  tableNode.content = rows
  return tableNode
}

/**
 * Recursively inflates any compact-saved table found anywhere in a parsed
 * block's content tree — a table can be nested inside a section, an
 * imported block, etc., not just at the top level. See inflateTableNode's
 * own comment for why this exists at all.
 *
 * Deliberately does NOT also wrap a plain-string `content` into a text-node
 * array, unlike the app-side original this was ported from — plenty of leaf
 * block types (method, url, ...) store their value as a bare string by
 * design and are read that way downstream; blindly wrapping every string
 * content field broke them (e.g. a `method` block's content going from the
 * plain string "POST" to `[{type: "text", text: "POST"}]`, which the REST
 * plugin's own buildHandler doesn't recognize as a method at all). Only
 * table cells actually need array-of-nodes content, and inflateTableNode
 * above already produces that shape directly — nothing here needs to layer
 * a second, more aggressive transform on top of it.
 */
function inflateSimplifiedNode(node: any): any {
  if (!node || typeof node !== 'object') return node

  if (node.type === 'table' && node.rows) {
    node = inflateTableNode(node)
  }

  if (Array.isArray(node.content)) {
    node.content = node.content.map((child: any) => inflateSimplifiedNode(child))
  }

  return node
}

/**
 * Parse a single void code block text (the YAML inside the fenced block).
 * Returns null if the block is malformed.
 */
function parseVoidBlockText(text: string): Block | null {
  const lines = text.trim().split('\n')
  if (lines[0]?.trim() !== '---') return null

  const headerEnd = lines.indexOf('---', 1)
  if (headerEnd === -1) return null

  const yamlText = lines.slice(1, headerEnd).join('\n')

  try {
    let node = YAML.parse(yamlText)
    node = restoreEmptyLineMarkers(node)
    node = inflateSimplifiedNode(node)
    return node as Block
  } catch {
    return null
  }
}

/**
 * Parse .void file content into an array of blocks.
 * Extracts all ```void ... ``` fenced code blocks from the markdown.
 */
export function parseVoidFile(content: string): Block[] {
  const blocks: Block[] = []
  // Match ```void\n...\n``` fenced code blocks
  const regex = /^```void\n([\s\S]*?)^```/gm
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const block = parseVoidBlockText(match[1])
    if (block) {
      blocks.push(block)
    }
  }

  return blocks
}

export interface VoidSection {
  /** Label from the request-separator block, if present */
  label?: string
  blocks: Block[]
}

/**
 * Group an already-parsed flat block array into sections split at
 * request-separator blocks. A file with no separators returns a single
 * section.
 *
 * Split out from parseVoidFileSections so callers that need to transform the
 * flat block array first (e.g. @voiden/runner resolving linkedBlock/linkedFile
 * imports — a linkedFile can carry its own request-separators, which must be
 * visible before section-splitting) can do so without re-parsing.
 */
export function groupBlocksIntoSections(allBlocks: Block[]): VoidSection[] {
  const sections: VoidSection[] = [{ blocks: [] }]

  for (const block of allBlocks) {
    if (block.type === 'request-separator') {
      sections.push({
        label: block.attrs?.label as string | undefined,
        blocks: [],
      })
    } else {
      sections[sections.length - 1].blocks.push(block)
    }
  }

  return sections.filter(s => s.blocks.length > 0)
}

/**
 * Parse .void file content into sections split at request-separator blocks.
 * A file with no separators returns a single section.
 */
export function parseVoidFileSections(content: string): VoidSection[] {
  return groupBlocksIntoSections(parseVoidFile(content))
}
