import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import tippy from "tippy.js";
import { ReqSuggestion, isReqSuggestionOpen } from "@/core/editors/voiden/extensions/VariableReqSuggesion";
import { SeamlessNavigation } from "@/core/editors/voiden/extensions/seamlessNavigation";

/**
 * Regression test for: pressing ArrowUp while a suggestion popup (import/file-link,
 * {{$req./{{$res. variables, etc.) is open on the first item moved the cursor out of
 * the popup and into the editor. Root cause: SeamlessNavigation's raw `keydown`
 * DOM handler ran its own block-hopping logic whenever the popup's onKeyDown didn't
 * dispatch a ProseMirror transaction, regardless of whether a suggestion popup owned
 * the arrow key. It only special-cased the slash-command and table-cell-autocomplete
 * popups, missing the file-link/req/res suggestion popups.
 */

beforeAll(() => {
  // jsdom never fires `transitionend`, which is what tippy's default (animated)
  // popup relies on to flip `state.isShown` to true after mounting; force
  // instant, non-animated popups so `isShown` reflects visibility synchronously
  // enough for the poll below.
  tippy.setDefaultProps({ duration: 0 });
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout engine; tippy just needs these to exist.
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => {},
  })) as any;
});

const waitUntil = async (predicate: () => boolean, timeoutMs = 500) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SeamlessNavigation + suggestion popups", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  it("voiden test: does NOT move the cursor to the previous block on ArrowUp while the {{$req. popup is open", async () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, ReqSuggestion, SeamlessNavigation],
      content: "<p>first block</p><p></p>",
    });

    // Place the cursor at the start of the second (empty) paragraph, then type the
    // ReqSuggestion trigger char sequence so the popup opens.
    const secondParagraphStart = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(secondParagraphStart);
    editor.commands.insertContent("{{$req.");

    await waitUntil(() => isReqSuggestionOpen());

    const posBeforeArrowUp = editor.state.selection.$anchor.pos;

    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
    );

    // SeamlessNavigation's block-hopping check runs on a 10ms timeout.
    await wait(30);

    expect(editor.state.selection.$anchor.pos).toBe(posBeforeArrowUp);
  });

  it("voiden test: DOES move the cursor to the previous block on ArrowUp when no popup is open", async () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, ReqSuggestion, SeamlessNavigation],
      content: "<p>first block</p><p></p>",
    });

    const secondParagraphStart = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(secondParagraphStart);

    expect(isReqSuggestionOpen()).toBe(false);

    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
    );

    await wait(30);

    // Cursor should have hopped into the first paragraph (proves SeamlessNavigation
    // is otherwise still doing its job when no suggestion popup owns the key).
    expect(editor.state.selection.$anchor.pos).toBeLessThan(secondParagraphStart);
  });
});
