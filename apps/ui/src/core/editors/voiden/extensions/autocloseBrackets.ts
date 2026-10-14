import { Extension, InputRule } from "@tiptap/core";
import { TextSelection } from "prosemirror-state";

export const autoCloseBrackets = Extension.create({
  name: "autoCloseBrackets",
  // Must be higher than DisableMarkdownInTables (10000) so this rule runs first
  // and isn't swallowed by its catch-all inside registered block types (url, etc.)
  priority: 10001,

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
