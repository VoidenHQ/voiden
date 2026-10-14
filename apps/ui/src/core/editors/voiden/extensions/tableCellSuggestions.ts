/**
 * Table Cell Autocomplete — Helpers
 *
 * Column detection helper for the TableCellAutocomplete extension.
 * Suggestion data is registered by each plugin via context.registerTableSuggestions().
 */

import { EditorState } from "@tiptap/pm/state";

/**
 * Detect which column (0-indexed) the cursor is in within a table row.
 * Returns -1 if not inside a table row.
 */
export function getCellColumnIndex(state: EditorState): number {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "tableRow") {
      return $from.index(d);
    }
  }
  return -1;
}

/**
 * Read the plain text already typed into every cell of the table row the
 * cursor is currently in, keyed by column index. Lets a column's suggestions
 * depend on a sibling cell in the same row (e.g. a header-value column
 * tailoring its list to whichever header key was typed in column 0).
 */
export function getRowCellsText(state: EditorState): Record<number, string> {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "tableRow") {
      const result: Record<number, string> = {};
      node.forEach((cell, _offset, index) => {
        result[index] = cell.textContent;
      });
      return result;
    }
  }
  return {};
}
