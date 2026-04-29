import type { Node as ProseMirrorNode } from "prosemirror-model";

// --- Types ---

export type MatchSource =
  | { type: "prosemirror"; from: number; to: number }
  | { type: "codemirror"; pmNodePos: number; cmFrom: number; cmTo: number }
  | { type: "linked"; pmNodePos: number; blockUid?: string };

export type UnifiedMatch = {
  index: number;
  source: MatchSource;
};

export interface SearchOptions {
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
}

// --- Helpers ---

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildRegex(
  term: string,
  options: SearchOptions
): RegExp | null {
  if (!term) return null;
  let pattern = options.useRegex ? term : escapeRegExp(term);
  if (!options.useRegex && options.matchWholeWord) {
    pattern = `\\b${pattern}\\b`;
  }
  const flags = options.matchCase ? "g" : "gi";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

// --- Core ---

export function extractTextFromJson(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  let text = "";
  if (typeof n.text === "string") text += n.text;
  if (typeof n.attrs === "object" && n.attrs !== null) {
    const attrs = n.attrs as Record<string, unknown>;
    if (typeof attrs.body === "string") text += "\n" + attrs.body;
    if (typeof attrs.title === "string") text += " " + attrs.title;
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) text += extractTextFromJson(child);
  }
  return text;
}

/**
 * Builds a unified list of matches across both ProseMirror text nodes
 * and CodeMirror code blocks (nodes with attrs.body and empty content).
 * Results are in document order.
 */
export type LinkedChunk = { text: string; blockUid?: string };

export function buildUnifiedMatches(
  doc: ProseMirrorNode,
  term: string,
  options: SearchOptions,
  linkedContentResolver?: (node: ProseMirrorNode, pos: number) => LinkedChunk[] | null
): UnifiedMatch[] {
  const regex = buildRegex(term, options);
  if (!regex) return [];

  const matches: UnifiedMatch[] = [];
  let index = 0;

  doc.descendants((node, pos) => {
    // ProseMirror text nodes
    if (node.isText && node.text) {
      // Reset regex state for each node
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(node.text)) !== null) {
        const from = pos + m.index;
        const to = from + m[0].length;

        let valid = true;
        if (options.matchWholeWord && !options.useRegex) {
          // Manual word boundary check for non-regex mode
          // (regex mode already has \b in the pattern)
          const wordChar = /\w/;
          const before = from > 0 ? doc.textBetween(from - 1, from) : "";
          const after = to < doc.content.size ? doc.textBetween(to, to + 1) : "";
          if ((before && wordChar.test(before)) || (after && wordChar.test(after))) {
            valid = false;
          }
        }

        if (valid) {
          matches.push({
            index: index++,
            source: { type: "prosemirror", from, to },
          });
        }

        if (m.index === regex.lastIndex) regex.lastIndex++;
      }
      return false; // Don't descend into text node children (there are none)
    }

    // CodeMirror nodes: empty content with attrs.body
    if (
      node.content.size === 0 &&
      node.attrs &&
      typeof node.attrs.body === "string" &&
      node.attrs.body.length > 0
    ) {
      const body: string = node.attrs.body;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(body)) !== null) {
        matches.push({
          index: index++,
          source: {
            type: "codemirror",
            pmNodePos: pos,
            cmFrom: m.index,
            cmTo: m.index + m[0].length,
          },
        });
        if (m.index === regex.lastIndex) regex.lastIndex++;
      }
      return false; // No children to visit
    }

    // Linked block/file nodes: search external content via resolver
    if (
      linkedContentResolver &&
      (node.type.name === "linkedBlock" || node.type.name === "linkedFile")
    ) {
      const chunks = linkedContentResolver(node, pos);
      if (chunks) {
        for (const chunk of chunks) {
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(chunk.text)) !== null) {
            matches.push({
              index: index++,
              source: { type: "linked", pmNodePos: pos, blockUid: chunk.blockUid },
            });
            if (m.index === regex.lastIndex) regex.lastIndex++;
          }
        }
      }
      return false;
    }

    return true; // Continue descending
  });

  return matches;
}

/**
 * Given a list of unified matches and a current match index,
 * returns only the PM-type matches with their original indices,
 * for use by the ProseMirror highlight plugin.
 */
export function getPmMatches(
  matches: UnifiedMatch[]
): Array<{ index: number; from: number; to: number }> {
  return matches
    .filter((m): m is UnifiedMatch & { source: { type: "prosemirror" } } =>
      m.source.type === "prosemirror"
    )
    .map((m) => ({
      index: m.index,
      from: m.source.from,
      to: m.source.to,
    }));
}

/**
 * Groups CM matches by their pmNodePos for dispatching highlights
 * to each CodeMirror instance.
 */
export function getCmMatchesByNode(
  matches: UnifiedMatch[]
): Map<number, Array<{ index: number; cmFrom: number; cmTo: number }>> {
  const grouped = new Map<number, Array<{ index: number; cmFrom: number; cmTo: number }>>();

  for (const match of matches) {
    if (match.source.type !== "codemirror") continue;
    const { pmNodePos, cmFrom, cmTo } = match.source;
    let group = grouped.get(pmNodePos);
    if (!group) {
      group = [];
      grouped.set(pmNodePos, group);
    }
    group.push({ index: match.index, cmFrom, cmTo });
  }

  return grouped;
}
