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
