/**
 * Headless resolution of linkedBlock / linkedFile imports.
 *
 * Ports the recursive JSON logic from the Voiden app's
 * apps/ui/src/core/editors/voiden/utils/expandLinkedBlocks.ts onto the plain
 * Block[] shape voidParser.ts already uses ({ type, attrs?, content? } —
 * structurally identical to the app's TipTap JSONContent), so
 * @voiden/runner can resolve the same imports the app does when executing a
 * .void file headlessly.
 *
 * Differences from the app version:
 * - No React Query / block-content-store cache — headless always reads
 *   fresh from disk, the same guarantee the app's `forceRefresh: true`
 *   execution-time path gives.
 * - Takes an injected `readFile` instead of `window.electron.voiden.getBlockContent`
 *   — keeps this package I/O-free, matching voidParser.ts's own convention
 *   of taking file content as a string rather than touching `fs` itself.
 * - Uses parseVoidFile (this package) instead of parseMarkdown + a TipTap
 *   schema — no schema needed headlessly, same as the rest of this package.
 */

import { parseVoidFile, type Block } from './voidParser.js'

export interface LinkedBlockResolver {
  /** Read a project-root-relative .void file's raw markdown. Return null if it doesn't exist / can't be read. */
  readFile: (relPath: string) => Promise<string | null>
}

const MAX_DEPTH = 10

/** Recursively finds a block with the given uid anywhere in a block tree (mirrors the app's BlockLink.tsx findBlockByUid). */
function findBlockByUid(blocks: Block[], uid: string): Block | null {
  for (const block of blocks) {
    if (block.attrs?.uid === uid) return block
    if (Array.isArray(block.content)) {
      const found = findBlockByUid(block.content, uid)
      if (found) return found
    }
  }
  return null
}

/** Marks a block and every descendant with importedFrom, mirroring expandLinkedBlocks.ts's markImported. */
function markImported(block: Block, originalFile: string): Block {
  return {
    ...block,
    attrs: { ...block.attrs, importedFrom: originalFile },
    content: Array.isArray(block.content) ? block.content.map((c) => markImported(c, originalFile)) : block.content,
  }
}

/** Returns the blocks belonging to the section introduced by the separator with the given uid (mirrors expandLinkedBlocks.ts's getBlocksForSection). */
export function getBlocksForSection(content: Block[], sectionUid: string): Block[] {
  let inSection = false
  const blocks: Block[] = []
  for (const node of content) {
    if (node.type === 'request-separator') {
      if (inSection) break
      if (node.attrs?.uid === sectionUid) inSection = true
    } else if (inSection) {
      blocks.push(node)
    }
  }
  return blocks
}

async function resolveOneLinkedBlock(node: Block, resolver: LinkedBlockResolver, depth: number): Promise<Block> {
  if (depth > MAX_DEPTH) return node

  const blockUid = node.attrs?.blockUid
  const originalFile = node.attrs?.originalFile
  if (!blockUid || !originalFile) return node

  try {
    const markdown = await resolver.readFile(originalFile)
    if (typeof markdown !== 'string') return node

    const targetBlocks = parseVoidFile(markdown)
    const target = findBlockByUid(targetBlocks, blockUid)
    if (!target) return node

    // Recursively resolve any linkedBlock nested inside the target first.
    const expanded = await resolveLinkedBlocksInTree([target], resolver, depth + 1)
    return markImported(expanded[0], originalFile)
  } catch {
    return node
  }
}

async function resolveLinkedBlocksInTree(blocks: Block[], resolver: LinkedBlockResolver, depth: number): Promise<Block[]> {
  if (depth > MAX_DEPTH) return blocks

  const result: Block[] = []
  for (const node of blocks) {
    if (node.type === 'linkedBlock') {
      result.push(await resolveOneLinkedBlock(node, resolver, depth))
      continue
    }
    if (Array.isArray(node.content)) {
      result.push({ ...node, content: await resolveLinkedBlocksInTree(node.content, resolver, depth + 1) })
    } else {
      result.push(node)
    }
  }
  return result
}

/**
 * Recursively resolves every linkedBlock node in a flat block array to its
 * actual target content, reading each referenced file fresh via `resolver.readFile`.
 */
export async function resolveLinkedBlocks(blocks: Block[], resolver: LinkedBlockResolver): Promise<Block[]> {
  return resolveLinkedBlocksInTree(blocks, resolver, 0)
}

async function fetchLinkedFileBlocks(node: Block, resolver: LinkedBlockResolver, depth: number): Promise<Block[]> {
  if (depth > MAX_DEPTH) return []

  const originalFile = node.attrs?.originalFile
  const sectionUid: string | null = node.attrs?.sectionUid ?? null
  if (!originalFile) return []

  try {
    const markdown = await resolver.readFile(originalFile)
    if (typeof markdown !== 'string') return []

    const parsedBlocks = parseVoidFile(markdown)

    const blocks = sectionUid !== null
      // Section-specific import: return only the blocks for that section.
      // The parent document already provides the separator before this linkedFile.
      ? getBlocksForSection(parsedBlocks, sectionUid)
      // Whole-file import: drop a leading request-separator (parent provides it).
      : (parsedBlocks[0]?.type === 'request-separator' ? parsedBlocks.slice(1) : parsedBlocks)

    // Recursively resolve any linkedFile nested inside this file's blocks, so a
    // linkedFile-of-a-linkedFile chain resolves fully instead of leaving an
    // unexpanded reference. Nested blocks are marked with their own immediate
    // source by their own recursive call, not overwritten by this level.
    const expandedBlocks: Block[] = []
    for (const block of blocks) {
      if (block.type === 'linkedFile') {
        expandedBlocks.push(...(await fetchLinkedFileBlocks(block, resolver, depth + 1)))
      } else {
        expandedBlocks.push(markImported(block, originalFile))
      }
    }
    return expandedBlocks
  } catch {
    return []
  }
}

/**
 * Expands linkedFile nodes in a flat block array by inlining the referenced
 * file's top-level blocks in place. Must run BEFORE grouping into sections
 * (groupBlocksIntoSections) — a linkedFile's own request-separator blocks
 * need to be visible to the section grouper, same ordering the app's
 * expandLinkedFilesInDoc depends on.
 */
export async function resolveLinkedFiles(blocks: Block[], resolver: LinkedBlockResolver): Promise<Block[]> {
  if (!blocks.some((n) => n.type === 'linkedFile')) return blocks

  const expanded: Block[] = []
  for (const node of blocks) {
    if (node.type === 'linkedFile') {
      expanded.push(...(await fetchLinkedFileBlocks(node, resolver, 0)))
    } else {
      expanded.push(node)
    }
  }
  return expanded
}
