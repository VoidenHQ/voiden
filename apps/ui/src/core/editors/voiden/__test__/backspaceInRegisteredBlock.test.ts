import { describe, it, expect, beforeAll } from "vitest";
import { Editor, Node, Extension, InputRule } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { pasteOrchestrator } from "@/core/paste/pasteOrchestrator";

/**
 * Regression test for: Backspace / Mod-Backspace / Alt-Backspace in a
 * "registered Voiden block" (e.g. the request URL field) silently does
 * nothing on the first press and only deletes on the second press.
 *
 * Root cause: DisableMarkdownInTables (apps/ui/src/core/editors/voiden/extensions.ts)
 * has a catch-all input rule that manually inserts every typed character
 * inside these blocks via `state.tr.insertText(...)`. Tiptap's shared
 * inputRulesPlugin then records that transaction as an "undoable" input
 * rule (the same bookkeeping used for e.g. the "--" -> "—" em-dash
 * substitution). Tiptap's core Keymap extension binds Backspace,
 * Mod-Backspace and Alt-Backspace all to `undoInputRule` first, and its
 * default behavior for a plain (non-substituted) input rule is to delete
 * the just-inserted text and then immediately re-insert the same text — a
 * visible no-op, but the key event is still consumed (preventDefault), so
 * the browser's native word/line delete never gets a chance to run either.
 * Only a second press, once the stored "undoable" state has been cleared,
 * falls through far enough to fail and let native deletion apply.
 *
 * The fix adds high-priority Backspace / Mod-Backspace / Alt-Backspace
 * shortcuts to DisableMarkdownInTables that perform the delete themselves,
 * so they run before tiptap's core Keymap extension and undoInputRule never
 * gets a chance to no-op the keystroke.
 *
 * extensions.ts can't be imported directly here: it's pulled into a
 * pre-existing import cycle through VoidenEditor.tsx's zustand store (which
 * evaluates `voidenExtensions` eagerly at module scope), so this test
 * mirrors the relevant part of DisableMarkdownInTables inline. Keep the
 * `isRestrictedContext` + keyboard-shortcut logic below in sync with
 * extensions.ts if either changes.
 */

const TestBlock = Node.create({
  name: "testBlock",
  content: "inline*",
  group: "block",
  marks: "",
  parseHTML() {
    return [{ tag: "testblock" }];
  },
  renderHTML() {
    return ["testblock", 0];
  },
});

beforeAll(() => {
  pasteOrchestrator.registerBlockOwner("testBlock", {} as any, "test-plugin");
});

const typeChar = (editor: Editor, char: string) => {
  const { from } = editor.state.selection;
  editor.view.someProp("handleTextInput", (fn) => fn(editor.view, from, from, char));
};

const isInRestrictedContext = ($from: { depth: number; node: (depth: number) => { type: { name: string } } }) => {
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (
      node.type.name === "tableCell" ||
      node.type.name === "tableHeader" ||
      pasteOrchestrator.isRegisteredBlockType(node.type.name)
    ) {
      return true;
    }
  }
  return false;
};

// Catch-all input rule matching extensions.ts' DisableMarkdownInTables, minus
// the Backspace shortcut — isolates tiptap's default undoInputRule behavior.
const CatchAllInputRuleOnly = Extension.create({
  name: "catchAllInputRuleOnly",
  priority: 10000,
  addInputRules() {
    return [
      new InputRule({
        find: /[\s\S]$/,
        handler: ({ state, range, match }) => {
          const text = match[0];
          if (text === "\n") return null;
          if (isInRestrictedContext(state.selection.$from)) {
            state.tr.insertText(text, range.from, range.to);
            return;
          }
          return null;
        },
      }),
    ];
  },
});

// Same as above plus the fix: high-priority Backspace / Mod-Backspace /
// Alt-Backspace shortcuts that delete directly instead of letting
// undoInputRule run.
const CatchAllInputRuleWithFix = Extension.create({
  name: "catchAllInputRuleWithFix",
  priority: 10000,
  addInputRules() {
    return [
      new InputRule({
        find: /[\s\S]$/,
        handler: ({ state, range, match }) => {
          const text = match[0];
          if (text === "\n") return null;
          if (isInRestrictedContext(state.selection.$from)) {
            state.tr.insertText(text, range.from, range.to);
            return;
          }
          return null;
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset === 0 || !isInRestrictedContext($from)) {
          return false;
        }
        return this.editor.commands.deleteRange({ from: $from.pos - 1, to: $from.pos });
      },
      "Mod-Backspace": () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset === 0 || !isInRestrictedContext($from)) {
          return false;
        }
        return this.editor.commands.deleteRange({ from: $from.pos - $from.parentOffset, to: $from.pos });
      },
      "Alt-Backspace": () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset === 0 || !isInRestrictedContext($from)) {
          return false;
        }
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
        let i = textBefore.length;
        while (i > 0 && /\s/.test(textBefore[i - 1])) i--;
        if (i > 0) {
          const isWord = /\w/.test(textBefore[i - 1]);
          while (i > 0 && /\w/.test(textBefore[i - 1]) === isWord && !/\s/.test(textBefore[i - 1])) i--;
        }
        return this.editor.commands.deleteRange({ from: $from.pos - $from.parentOffset + i, to: $from.pos });
      },
    };
  },
});

describe("Backspace inside a registered Voiden block", () => {
  it("voiden test: undoInputRule alone (tiptap's default core Backspace handling) deletes then re-inserts the same character — a visible no-op", () => {
    const editor = new Editor({
      extensions: [Document.extend({ content: "testBlock" }), TestBlock, Text, CatchAllInputRuleOnly],
      content: "<testblock></testblock>",
    });

    typeChar(editor, "a");
    expect(editor.state.doc.textContent).toBe("a");

    const handled = editor.commands.undoInputRule();

    expect(handled).toBe(true);
    // The character is still there — undoInputRule deleted it and
    // immediately re-inserted the same text, so nothing visibly changed.
    expect(editor.state.doc.textContent).toBe("a");

    editor.destroy();
  });

  it("voiden test: with the fix, a real Backspace keypress deletes the character on the first press", () => {
    const editor = new Editor({
      extensions: [Document.extend({ content: "testBlock" }), TestBlock, Text, CatchAllInputRuleWithFix],
      content: "<testblock></testblock>",
    });

    typeChar(editor, "a");
    expect(editor.state.doc.textContent).toBe("a");

    // Dispatches a real 'Backspace' KeyboardEvent through ProseMirror's
    // handleKeyDown chain, exercising every registered extension's keymap in
    // priority order — the same path a real keypress takes.
    editor.commands.keyboardShortcut("Backspace");

    expect(editor.state.doc.textContent).toBe("");

    editor.destroy();
  });

  it("voiden test: with the fix, a real Mod-Backspace keypress deletes back to the block start on the first press", () => {
    const editor = new Editor({
      extensions: [Document.extend({ content: "testBlock" }), TestBlock, Text, CatchAllInputRuleWithFix],
      content: "<testblock></testblock>",
    });

    "hello world".split("").forEach((char) => typeChar(editor, char));
    expect(editor.state.doc.textContent).toBe("hello world");

    editor.commands.keyboardShortcut("Mod-Backspace");

    expect(editor.state.doc.textContent).toBe("");

    editor.destroy();
  });

  it("voiden test: with the fix, a real Alt-Backspace keypress deletes one word back on the first press", () => {
    const editor = new Editor({
      extensions: [Document.extend({ content: "testBlock" }), TestBlock, Text, CatchAllInputRuleWithFix],
      content: "<testblock></testblock>",
    });

    "hello world".split("").forEach((char) => typeChar(editor, char));
    expect(editor.state.doc.textContent).toBe("hello world");

    editor.commands.keyboardShortcut("Alt-Backspace");

    expect(editor.state.doc.textContent).toBe("hello ");

    editor.destroy();
  });
});
