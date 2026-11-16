import { Extension, InputRule } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";

/**
 * Typing `}` right before an auto-inserted `}` steps over it instead of adding another, so
 * typing `{{token}}` in full gives `{{token}}`, not `{{token}}}}`. Only inside an open `{{…`,
 * so other braces in the text are left alone.
 */
const typeOverClosingBraces = new Plugin({
  key: new PluginKey("autoCloseBracketsTypeOver"),
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== "}" || from !== to) return false;
      const { doc, selection } = view.state;
      const { $from } = selection;
      // Inline atoms (file links, etc.) count as one placeholder char, so positions line up.
      const before = doc.textBetween($from.start(), from, undefined, "\ufffc");
      const after = doc.textBetween(from, Math.min(from + 1, $from.end()), undefined, "\ufffc");
      if (after !== "}" || !/\{\{[^{}]*\}?$/.test(before)) return false;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1)));
      return true;
    },
  },
});

export const autoCloseBrackets = Extension.create({
  name: "autoCloseBrackets",
  // Must be higher than DisableMarkdownInTables (10000) so this rule runs first
  // and isn't swallowed by its catch-all inside registered block types (url, etc.)
  priority: 10001,

  addProseMirrorPlugins() {
    return [typeOverClosingBraces];
  },

  addInputRules() {
    return [
      // {{ → {{|}} with cursor positioned between the two pairs
      new InputRule({
        find: /\{\{$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          // If `}` already follows the cursor the first `{` was auto-closed
          // to `{}` — doc is now `{{ | }`. Just add a second `}`.
          const charAfter = state.doc.textBetween(
            range.to,
            Math.min(range.to + 1, state.doc.content.size),
          );

          if (charAfter === "}") {
            tr.insertText("}", range.to);
            tr.setSelection(TextSelection.create(tr.doc, range.from + 2));
          } else {
            tr.delete(range.from, range.to);
            tr.insertText("{{}}", range.from);
            tr.setSelection(TextSelection.create(tr.doc, range.from + 2));
          }
        },
      }),
    ];
  },
});
