import { mergeAttributes } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";

export const CustomTable = Table.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),

      ArrowDown: () => {
        const { schema, tr, selection } = this.editor.state;
        const { $anchor } = selection;

        // Check if we're in a table cell
        let inTableCell = false;
        let tableDepth = -1;
        for (let d = $anchor.depth; d > 0; d--) {
          const node = $anchor.node(d);
          if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            inTableCell = true;
          }
          if (node.type.name.includes('-table') || node.type.name === 'table') {
            tableDepth = d;
            break;
          }
        }

        if (!inTableCell || tableDepth === -1) {
          return false;
        }

        // Check if we're in the last row
        const tableNode = $anchor.node(tableDepth);
        let isLastRow = false;

        // Find which row we're in
        tableNode.forEach((node, offset, index) => {
          if (node.type.name === 'tableRow') {
            const rowStart = $anchor.start(tableDepth) + offset;
            const rowEnd = rowStart + node.nodeSize;
            if ($anchor.pos >= rowStart && $anchor.pos < rowEnd) {
              // Check if this is the last row
              isLastRow = (index === tableNode.childCount - 1);
            }
          }
        });


        if (!isLastRow) {
          // Not in last row, let default table navigation handle it
          return false;
        }

        // We're in the last row - let the default handler move us out
        // The appendTransaction will catch the invalid position and navigate appropriately
        const lastNode = this.editor.state.doc.lastChild;
        if (lastNode?.type.name !== "paragraph") {
          const paragraph = schema.nodes.paragraph.create();
          const transaction = tr.insert(
            this.editor.state.doc.content.size,
            paragraph,
          );
          this.editor.view.dispatch(transaction);
        }

        return false;
      },

      ArrowUp: () => {
        const { selection } = this.editor.state;
        const { $anchor } = selection;

        // Check if we're actually IN a table cell (check ancestors)
        let inTableCell = false;
        for (let d = $anchor.depth; d > 0; d--) {
          const node = $anchor.node(d);
          if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            inTableCell = true;
            break;
          }
        }


        // If NOT in a table cell, don't let table handle it
        if (!inTableCell) {
          return false;
        }

        // We're in a table cell, let default table navigation handle it
        return false;
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "table",
      mergeAttributes(HTMLAttributes, {
        class:
          "border border-collapse table-fixed rounded max-w-full not-prose w-full",
        style: "background-color: var(--editor-bg);",
      }),
      ["tbody", 0],
    ];
  },
});
// resizable is currently broken with HTMLAttributes: https://github.com/ueberdosis/tiptap/issues/4572
// .configure({
//   resizable: true,
// })
