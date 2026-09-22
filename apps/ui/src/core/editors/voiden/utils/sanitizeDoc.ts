/**
 * Strips text nodes that are empty or whitespace-only, recursively.
 *
 * ProseMirror hard-rejects a document containing any such node ("Empty text
 * nodes are not allowed"), and TipTap's fallback for a rejected content tree
 * is to silently discard the whole thing and render a blank document instead
 * — not just the offending node. A block as simple as a table row with one
 * blank cell (e.g. a headers-table row with no description) is enough to
 * trigger this for an entire preview.
 *
 * VoidenEditor.tsx has always sanitized parsed markdown before loading it for
 * exactly this reason. Any other place that hands parsed content straight to
 * a `useEditor`/`new Editor()` call — a read-only preview for a linkedBlock
 * or linkedFile, for instance — needs the same pass first, or it silently
 * renders empty instead of the real content.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeDoc(node: any): any {
  if (!node || typeof node !== "object") return node;

  // Fix invalid paragraph content set as a number.
  if (node.type === "paragraph" && typeof node.content === "number") {
    node.content = [{ type: "text", text: String(node.content) }];
  }

  // Remove invalid text nodes.
  if (node.type === "text" && (!node.text || (typeof node.text === "string" && node.text.trim() === ""))) {
    return null;
  }

  // Recursively sanitize child nodes.
  if (Array.isArray(node.content)) {
    node.content = node.content.map(sanitizeDoc).filter(Boolean);
  }

  return node;
}
