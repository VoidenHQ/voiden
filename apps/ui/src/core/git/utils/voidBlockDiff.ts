import { diffArrays, diffWordsWithSpace } from "diff";
import YAML from "yaml";
import type { JSONContent } from "@tiptap/core";

/**
 * Block-level diff for .void files. Both versions are parsed into top-level
 * editor blocks (requests, tables, paragraphs...) and compared as blocks, so
 * the diff viewer can render them natively instead of as serialized YAML.
 */

/** A run of blocks that renders as one row in the diff. */
export type VoidDiffSection =
  | { kind: "unchanged"; blocks: JSONContent[] }
  /** The same block (matched by uid or by similar content) edited in place. */
  | { kind: "modified"; before: JSONContent; after: JSONContent }
  /** Blocks removed from the old version and/or added in the new one. */
  | { kind: "changed"; removed: JSONContent[]; added: JSONContent[] };

export interface FrontmatterChange {
  key: string;
  before?: string;
  after?: string;
}

/** Below this word overlap, two uid-less blocks are shown as removed + added instead of modified. */
const SIMILARITY_THRESHOLD = 0.5;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Reads the YAML header of a .void file. Unparseable headers count as empty. */
export function readFrontmatter(markdown: string | null | undefined): Record<string, unknown> {
  const match = markdown?.match(FRONTMATTER_RE);
  if (!match) return {};
  try {
    const parsed = YAML.parse(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const formatValue = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
};

/** Lists header keys whose values differ between two versions, in a stable order. */
export function diffFrontmatter(before: string | null | undefined, after: string | null | undefined): FrontmatterChange[] {
  const a = readFrontmatter(before);
  const b = readFrontmatter(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys
    .map((key) => ({ key, before: formatValue(a[key]), after: formatValue(b[key]) }))
    .filter((change) => change.before !== change.after);
}

// Uids are identity, not content: a block whose uid was regenerated but whose
// content is identical must not show up as a change.
const withoutUids = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUids);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "uid") continue;
      out[key] = withoutUids((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

export const blockSignature = (block: JSONContent): string => JSON.stringify(withoutUids(block));

const blockUid = (block: JSONContent): string | null => {
  const uid = block.attrs?.uid;
  return typeof uid === "string" && uid ? uid : null;
};

/** All visible text and string attributes in a block, used to measure similarity. */
const blockText = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((v) => blockText(v, out));
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "uid" || key === "type") continue;
      if (typeof v === "string") out.push(v);
      else blockText(v, out);
    }
  }
  return out;
};

/** Share of words two blocks have in common, from 0 to 1. */
export function blockSimilarity(a: JSONContent, b: JSONContent): number {
  const textA = blockText(a).join(" ");
  const textB = blockText(b).join(" ");
  if (!textA && !textB) return 1;
  const common = diffWordsWithSpace(textA, textB)
    .filter((part) => !part.added && !part.removed)
    .reduce((sum, part) => sum + part.value.length, 0);
  return (2 * common) / (textA.length + textB.length);
}

/** Index in `removed` (after `from`) of the block that `block` is an edited version of, or -1. */
const findCounterpart = (block: JSONContent, removed: JSONContent[], from: number): number => {
  const uid = blockUid(block);
  if (uid) {
    const byUid = removed.findIndex((r, i) => i > from && blockUid(r) === uid);
    if (byUid !== -1) return byUid;
  }
  let best = -1;
  let bestScore = SIMILARITY_THRESHOLD;
  removed.forEach((r, i) => {
    if (i <= from || r.type !== block.type) return;
    // Two blocks with different uids are different blocks, however similar.
    const rUid = blockUid(r);
    if (uid && rUid && uid !== rUid) return;
    const score = blockSimilarity(r, block);
    if (score >= bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
};

/** Pairs edited blocks within one run of removals + additions, keeping document order. */
const resolveGap = (removed: JSONContent[], added: JSONContent[], out: VoidDiffSection[]) => {
  let lastPaired = -1;
  let pendingRemoved: JSONContent[] = [];
  let pendingAdded: JSONContent[] = [];
  const flush = () => {
    if (pendingRemoved.length || pendingAdded.length) {
      out.push({ kind: "changed", removed: pendingRemoved, added: pendingAdded });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const block of added) {
    const match = findCounterpart(block, removed, lastPaired);
    if (match === -1) {
      pendingAdded.push(block);
      continue;
    }
    pendingRemoved.push(...removed.slice(lastPaired + 1, match));
    flush();
    out.push({ kind: "modified", before: removed[match], after: block });
    lastPaired = match;
  }
  pendingRemoved.push(...removed.slice(lastPaired + 1));
  flush();
};

/** Compares two block lists and returns the sections to render, in document order. */
export function diffVoidBlocks(before: JSONContent[], after: JSONContent[]): VoidDiffSection[] {
  const parts = diffArrays(before.map(blockSignature), after.map(blockSignature));
  const sections: VoidDiffSection[] = [];
  let i = 0;
  let j = 0;
  let removed: JSONContent[] = [];
  let added: JSONContent[] = [];

  for (const part of parts) {
    const count = part.count ?? part.value.length;
    if (part.removed) {
      removed.push(...before.slice(i, i + count));
      i += count;
    } else if (part.added) {
      added.push(...after.slice(j, j + count));
      j += count;
    } else {
      resolveGap(removed, added, sections);
      removed = [];
      added = [];
      sections.push({ kind: "unchanged", blocks: after.slice(j, j + count) });
      i += count;
      j += count;
    }
  }
  resolveGap(removed, added, sections);
  return sections;
}

/** True when the sections contain at least one added, removed or modified block. */
export const hasBlockChanges = (sections: VoidDiffSection[]): boolean =>
  sections.some((section) => section.kind !== "unchanged");

export const isVoidFile = (path: string | null | undefined): boolean => !!path && path.toLowerCase().endsWith(".void");
