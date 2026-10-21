import YAML from "yaml";

/**
 * Helpers for files containing git conflict markers. Unlike a full rewrite,
 * resolving here only touches the chosen conflicts: every other line,
 * including unresolved conflicts, is written back exactly as it was.
 */

export type Resolution = "current" | "incoming" | "both";

export interface ConflictHunk {
  index: number;
  /** The `<<<<<<<` line, e.g. `<<<<<<< HEAD`. */
  open: string;
  current: string[];
  /** Present for diff3-style conflicts (`|||||||` section). */
  base: { marker: string; lines: string[] } | null;
  separator: string;
  incoming: string[];
  /** The `>>>>>>>` line, e.g. `>>>>>>> feature`. */
  close: string;
}

export type ConflictSegment = { kind: "text"; lines: string[] } | { kind: "conflict"; hunk: ConflictHunk };

const isOpen = (line: string) => line.startsWith("<<<<<<<");
const isBase = (line: string) => line.startsWith("|||||||");
const isSeparator = (line: string) => line.startsWith("=======");
const isClose = (line: string) => line.startsWith(">>>>>>>");

/** Splits a file into plain text and conflict hunks. An unterminated conflict is kept as plain text. */
export function parseConflicts(content: string): ConflictSegment[] {
  const lines = content.split("\n");
  const segments: ConflictSegment[] = [];
  let text: string[] = [];
  let index = 0;
  let i = 0;

  const flushText = () => {
    if (text.length) segments.push({ kind: "text", lines: text });
    text = [];
  };

  while (i < lines.length) {
    if (!isOpen(lines[i])) {
      text.push(lines[i++]);
      continue;
    }
    const start = i;
    const hunk: ConflictHunk = { index, open: lines[i], current: [], base: null, separator: "", incoming: [], close: "" };
    let part: "current" | "base" | "incoming" = "current";
    i++;
    while (i < lines.length && !isClose(lines[i])) {
      const line = lines[i];
      if (part === "current" && isBase(line)) {
        hunk.base = { marker: line, lines: [] };
        part = "base";
      } else if (part !== "incoming" && isSeparator(line)) {
        hunk.separator = line;
        part = "incoming";
      } else if (part === "current") hunk.current.push(line);
      else if (part === "base") hunk.base!.lines.push(line);
      else hunk.incoming.push(line);
      i++;
    }
    if (i >= lines.length || !hunk.separator) {
      // No closing marker: not a real conflict, keep it untouched.
      text.push(...lines.slice(start, i));
      continue;
    }
    hunk.close = lines[i++];
    flushText();
    segments.push({ kind: "conflict", hunk });
    index++;
  }
  flushText();
  return segments;
}

export const getHunks = (segments: ConflictSegment[]): ConflictHunk[] =>
  segments.flatMap((s) => (s.kind === "conflict" ? [s.hunk] : []));

const hunkLines = (hunk: ConflictHunk, resolution: Resolution | undefined): string[] => {
  if (resolution === "current") return hunk.current;
  if (resolution === "incoming") return hunk.incoming;
  if (resolution === "both") {
    // Keep both sides as separate blocks: without a blank line between them,
    // two paragraphs would merge into one.
    const last = hunk.current[hunk.current.length - 1];
    const needsGap = last !== undefined && last.trim() !== "" && hunk.incoming.length > 0 && hunk.incoming[0].trim() !== "";
    return [...hunk.current, ...(needsGap ? [last.endsWith("\r") ? "\r" : ""] : []), ...hunk.incoming];
  }
  return [
    hunk.open,
    ...hunk.current,
    ...(hunk.base ? [hunk.base.marker, ...hunk.base.lines] : []),
    hunk.separator,
    ...hunk.incoming,
    hunk.close,
  ];
};

/** Rebuilds the file, resolving only the conflicts that have a choice. */
export function resolveSegments(segments: ConflictSegment[], choose: (hunk: ConflictHunk) => Resolution | undefined): string {
  return segments.flatMap((s) => (s.kind === "text" ? s.lines : hunkLines(s.hunk, choose(s.hunk)))).join("\n");
}

/** Resolves the given conflicts (by index) and leaves the rest as they are. */
export function resolveConflicts(content: string, choices: ReadonlyMap<number, Resolution>): string {
  return resolveSegments(parseConflicts(content), (hunk) => choices.get(hunk.index));
}

/** Branch names from the markers, e.g. { current: "HEAD", incoming: "feature" }. */
export function conflictLabels(segments: ConflictSegment[]): { current: string; incoming: string } {
  const first = getHunks(segments)[0];
  const label = (marker: string | undefined, fallback: string) => marker?.slice(7).trim() || fallback;
  return { current: label(first?.open, "HEAD"), incoming: label(first?.close, "incoming") };
}

export interface ConflictGroup {
  /** Conflict indices that belong to the same block. */
  indices: number[];
  /** True when the conflict is in the file's YAML header. */
  metadata: boolean;
}

/**
 * Groups conflicts by the .void block they fall in, so two conflicts inside
 * one request are resolved together. Blocks are found in the "all current"
 * version of the file: the YAML header, each ```void fence, and each run of
 * markdown lines between blank lines.
 */
export function groupConflictsByBlock(content: string): ConflictGroup[] {
  const segments = parseConflicts(content);
  const lines: string[] = [];
  // Line in `lines` where each conflict's current side starts.
  const starts = new Map<number, number>();
  for (const s of segments) {
    if (s.kind === "text") lines.push(...s.lines);
    else {
      starts.set(s.hunk.index, lines.length);
      lines.push(...s.hunk.current);
    }
  }

  // Block id for every line of the all-current file.
  const blockOf: string[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    const last = end === -1 ? 0 : end;
    for (; i <= last; i++) blockOf[i] = "meta";
  }
  let fenceStart = -1;
  let paragraphStart = -1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (fenceStart !== -1) {
      blockOf[i] = `block-${fenceStart}`;
      if (line.startsWith("```")) fenceStart = -1;
    } else if (line.startsWith("```")) {
      fenceStart = i;
      paragraphStart = -1;
      blockOf[i] = `block-${i}`;
    } else if (!line) {
      paragraphStart = -1;
      blockOf[i] = "";
    } else {
      if (paragraphStart === -1) paragraphStart = i;
      blockOf[i] = `block-${paragraphStart}`;
    }
  }

  const groups = new Map<string, ConflictGroup>();
  for (const hunk of getHunks(segments)) {
    const start = starts.get(hunk.index)!;
    // First non-blank line of the current side; a pure insertion uses the line it sits on.
    let at = start;
    while (at < start + hunk.current.length && !blockOf[at]) at++;
    const block = (at < start + hunk.current.length || hunk.current.length === 0 ? blockOf[at] : "") || `conflict-${hunk.index}`;
    const key = block === "meta" ? "meta" : block;
    const group = groups.get(key) ?? { indices: [], metadata: key === "meta" };
    group.indices.push(hunk.index);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const VOID_FENCE_RE = /^```void\r?\n([\s\S]*?)^```/gm;
const VOID_FENCE_START_RE = /^```void\r?\n/gm;

/**
 * Checks a .void file the same way the main process does (voidValidator.ts):
 * every ```void fence must hold a `---` YAML header that parses. Leftover
 * conflict markers also make the file invalid.
 */
export function validateVoidContent(content: string): { valid: boolean; invalidBlocks: number; hasMarkers: boolean } {
  const hasMarkers = getHunks(parseConflicts(content)).length > 0;
  const total = content.match(VOID_FENCE_START_RE)?.length ?? 0;
  let parsed = 0;
  for (const match of content.matchAll(VOID_FENCE_RE)) {
    const blockLines = match[1].replace(/\r/g, "").trim().split("\n");
    if (blockLines[0]?.trim() !== "---") continue;
    const end = blockLines.indexOf("---", 1);
    if (end === -1) continue;
    try {
      YAML.parse(blockLines.slice(1, end).join("\n"));
      parsed++;
    } catch {
      // Counted as invalid below.
    }
  }
  const invalidBlocks = total - parsed;
  return { valid: invalidBlocks === 0 && !hasMarkers, invalidBlocks, hasMarkers };
}
