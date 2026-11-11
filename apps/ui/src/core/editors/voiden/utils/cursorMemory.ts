import { Selection, TextSelection } from "prosemirror-state";
import type { Editor } from "@tiptap/react";

/** Where the cursor was in each file when the user left it, kept across tab closes and restarts. */
const STORAGE_KEY = "voiden:cursorPositions";
/** Oldest entries are dropped beyond this, so the map can't grow forever. */
const MAX_ENTRIES = 300;

type Cursor = { from: number; to: number };

function readAll(): Record<string, Cursor> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getSavedCursor(key: string): Cursor | null {
  return readAll()[key] ?? null;
}

export function saveCursor(key: string, cursor: Cursor) {
  const all = readAll();
  delete all[key]; // re-insert so it counts as most recent
  all[key] = cursor;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[old];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable: cursor memory is best-effort.
  }
}

/**
 * Put the cursor where the user left this file, or at the end of the file the first time
 * it's opened. "End" is the end of the last top-level text block, so nothing is inserted
 * and the file isn't marked as edited.
 */
export function placeInitialCursor(editor: Editor, saved: Cursor | null) {
  const { doc } = editor.state;
  let selection: Selection | null = null;
  if (saved) {
    const max = doc.content.size;
    const clamp = (pos: number) => Math.min(Math.max(0, pos), max);
    try {
      selection = TextSelection.between(doc.resolve(clamp(saved.from)), doc.resolve(clamp(saved.to)));
    } catch {
      selection = null;
    }
  }
  if (!selection) {
    let endPos = -1;
    doc.forEach((node, offset) => {
      if (node.isTextblock) endPos = offset + node.nodeSize - 1;
    });
    selection = endPos >= 0 ? TextSelection.create(doc, endPos) : Selection.atEnd(doc);
  }
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
}
