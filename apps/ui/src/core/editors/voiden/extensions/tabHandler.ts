import { Extension } from "@tiptap/core";

const TAB_CHAR = "\u00A0\u00A0\u00A0\u00A0";

export const TabHandler = Extension.create({
  name: "tabHandler",
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        // table handles its own tabbing
        if (editor.isActive("table")) {
          return false;
        }

        // Check if we're at the start of a list item
        if (editor.isActive("listItem")) {
          // Prevent accidental deep nesting by limiting indent depth
          const { $from } = editor.state.selection;
          let listDepth = 0;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              listDepth++;
            }
          }

          // Cap nesting at 3 levels to avoid runaway indentation
          if (listDepth >= 3) {
            return true;
          }

          // Attempt to sink the list item (indent one level)
          editor.chain().sinkListItem("listItem").run();
          return true;
        }

        editor
          .chain()
          .command(({ tr, state }) => {
            const { selection } = state;
            const { $from } = selection;
            const lineStart = $from.start();

            tr.insertText(TAB_CHAR, lineStart);
            return true;
          })
          .run();

        // Prevent default behavior (losing focus)
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const { selection, doc } = editor.state;
        const { $from } = selection;

        // Check if we're at the start of a list item
        if (editor.isActive("listItem")) {
          // If so, lift the list item
          return editor.chain().liftListItem("listItem").run();
        }

        const lineStart = $from.start();
        if (doc.textBetween(lineStart, lineStart + 4) === TAB_CHAR) {
          // If so, delete it
          editor
            .chain()
            .command(({ tr }) => {
              tr.delete(lineStart, lineStart + 4);
              return true;
            })
            .run();
          return true;
        }

        // Prevent default behavior (losing focus)
        return true;
      },
    };
  },
});
