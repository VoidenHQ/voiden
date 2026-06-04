/**
 * Parser: .void file content (markdown string) → Block[]
 *
 * Adapted from apps/ui/src/core/editors/voiden/markdownConverter.ts
 * - No TipTap/ProseMirror dependency
 * - No schema validation — trusts the YAML type field as-is
 */

import YAML from 'yaml'
import type { Block } from './types.js'

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
 * Parse .void file content into sections split at request-separator blocks.
 * A file with no separators returns a single section.
 */
export function parseVoidFileSections(content: string): VoidSection[] {
  const allBlocks = parseVoidFile(content)

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
