import { diffWordsWithSpace } from "diff";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Word-level highlights inside a modified .void block. The text of both
 * versions is flattened in document order, diffed by word, and the changed
 * words are mapped back to editor positions so they can be decorated.
 */

export interface InlineRange {
  from: number;
  to: number;
}

interface Segment {
  /** Offset of this text node in the flattened text. */
  start: number;
  /** Document position of the text node's first character. */
  pos: number;
  length: number;
}

/** Text of a document in reading order, with a newline between text blocks. */
export function flattenText(doc: PMNode): { text: string; segments: Segment[] } {
  let text = "";
  const segments: Segment[] = [];
  let lastBlock: PMNode | null = null;
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (lastBlock && parent !== lastBlock) text += "\n";
    lastBlock = parent;
    segments.push({ start: text.length, pos, length: node.text.length });
    text += node.text;
  });
  return { text, segments };
}

/** Maps a range of the flattened text to document ranges (one per text node it touches). */
const toDocRanges = (from: number, to: number, segments: Segment[]): InlineRange[] => {
  const ranges: InlineRange[] = [];
  for (const seg of segments) {
    const start = Math.max(from, seg.start);
    const end = Math.min(to, seg.start + seg.length);
    if (start < end) ranges.push({ from: seg.pos + start - seg.start, to: seg.pos + end - seg.start });
  }
  return ranges;
};

/**
 * Ranges in `doc` that differ from `other`. For the old version pass
 * side "removed", for the new version side "added".
 */
export function changedRanges(doc: PMNode, other: PMNode, side: "removed" | "added"): InlineRange[] {
  const own = flattenText(doc);
  const theirs = flattenText(other).text;
  const parts = side === "removed" ? diffWordsWithSpace(own.text, theirs) : diffWordsWithSpace(theirs, own.text);
  const ranges: InlineRange[] = [];
  let offset = 0;
  for (const part of parts) {
    // Parts from the other version don't exist in this document.
    const isOther = side === "removed" ? part.added : part.removed;
    if (isOther) continue;
    const isChange = side === "removed" ? part.removed : part.added;
    const next = offset + part.value.length;
    // Whitespace-only changes are noise once rendered.
    if (isChange && part.value.trim()) ranges.push(...toDocRanges(offset, next, own.segments));
    offset = next;
  }
  return ranges;
}
