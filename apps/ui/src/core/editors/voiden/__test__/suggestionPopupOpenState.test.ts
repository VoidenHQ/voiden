import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { ReqSuggestion, isReqSuggestionOpen } from "@/core/editors/voiden/extensions/VariableReqSuggesion";
import { SeamlessNavigation } from "@/core/editors/voiden/extensions/seamlessNavigation";

/**
 * Regression test for: ArrowUp in the slash menu (and Enter/arrows in table cell
 * autocomplete) went to the editor instead of the popup. The is*Open() helpers
 * read tippy's `state.isShown`, which only flips to true on the popup box's
 * `transitionend` — and the app never loads tippy.css, so no transition runs and
 * isShown stayed false while the popup was visible. SeamlessNavigation and the
 * table Enter handler then treated the popup as closed.
 *
 * Unlike seamlessNavigationSuggestionPopup.test.ts, this deliberately keeps
 * tippy's default (animated) duration: jsdom never fires `transitionend`, which
 * is exactly the condition the app runs under.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
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

describe("suggestion popup open state without a show transition", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  it("voiden test: reports the popup as open even though transitionend never fires", async () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, ReqSuggestion],
      content: "<p></p>",
    });

    editor.commands.insertContent("{{$req.");

    await waitUntil(() => isReqSuggestionOpen());
    expect(isReqSuggestionOpen()).toBe(true);
  });

  it("voiden test: ArrowUp does not move the cursor to the previous block while the popup is open", async () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, ReqSuggestion, SeamlessNavigation],
      content: "<p>first block</p><p></p>",
    });

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("{{$req.");
    await waitUntil(() => isReqSuggestionOpen());

    const posBeforeArrowUp = editor.state.selection.$anchor.pos;
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    // SeamlessNavigation's block-hopping check runs on a timeout.
    await wait(30);

    expect(editor.state.selection.$anchor.pos).toBe(posBeforeArrowUp);
  });
});
