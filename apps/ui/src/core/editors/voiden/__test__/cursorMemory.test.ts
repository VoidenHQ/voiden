import { describe, expect, it, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import type { Editor } from "@tiptap/react";
import { placeInitialCursor } from "@/core/editors/voiden/utils/cursorMemory";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { group: "inline" },
  },
});

const makeEditor = (paragraphs: string[]) => {
  const doc = schema.node(
    "doc",
    null,
    paragraphs.map((p) => schema.node("paragraph", null, p ? [schema.text(p)] : [])),
  );
  const state = EditorState.create({ doc });
  const dispatched: Transaction[] = [];
  const editor = { state, view: { dispatch: vi.fn((tr: Transaction) => dispatched.push(tr)) } } as unknown as Editor;
  return { editor, dispatched };
};

describe("placeInitialCursor", () => {
  it("voiden test : does not scroll the view to the cursor (end-of-file flash on open)", () => {
    // Scrolling here shows the end of the document for a frame before the scroll
    // restore snaps a freshly opened file back to the top.
    const { editor, dispatched } = makeEditor(["first", "second", "last"]);
    placeInitialCursor(editor, null);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].scrolledIntoView).toBe(false);
  });

  it("voiden test : does not scroll when restoring a saved cursor either", () => {
    const { editor, dispatched } = makeEditor(["first", "second", "last"]);
    placeInitialCursor(editor, { from: 3, to: 3 });
    expect(dispatched[0].scrolledIntoView).toBe(false);
  });

  it("voiden test : still puts the cursor at the end of the last text block the first time", () => {
    const { editor, dispatched } = makeEditor(["first", "second", "last"]);
    placeInitialCursor(editor, null);
    const sel = dispatched[0].selection as TextSelection;
    expect(sel.empty).toBe(true);
    expect(sel.$from.parent.textContent).toBe("last");
    expect(sel.$from.parentOffset).toBe("last".length);
  });

  it("voiden test : restores a saved cursor position", () => {
    const { editor, dispatched } = makeEditor(["first", "second", "last"]);
    placeInitialCursor(editor, { from: 3, to: 3 });
    expect(dispatched[0].selection.from).toBe(3);
  });
});
