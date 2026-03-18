import { CommandProps, Dispatch, findParentNodeClosestToPos, mergeAttributes } from "@tiptap/core";
import TableRow from "@tiptap/extension-table-row";

import { isCellSelection } from "@/core/editors/voiden/nodes/Table";
import { Editor } from "@tiptap/react";
import { createTable } from "@tiptap/extension-table";
import { EditorState, TextSelection } from "@tiptap/pm/state";

const handleTableDelete = (editor: Editor) => {
  const { selection } = editor.state;

  if (!isCellSelection(selection)) {
    const isWrapperNode = findParentNodeClosestToPos(selection.ranges[0].$from, (node) => {
      return (
        node.type.name === "headers-table" ||
        node.type.name === "multipart-table" ||
        node.type.name === "query-table" ||
        node.type.name === "url-table" ||
        node.type.name === "path-table" ||
        node.type.name === "cookies-table" ||
        node.type.name === "assertions-table"
      );
    });

    // Use content.size instead of textContent so inline atom nodes (e.g. fileLink)
    // are not mistaken for empty — atoms have no text but do have content size.
    const isEmpty = selection.$head.node().content.size === 0;

    if (isWrapperNode && isEmpty) {
      return true;
    } else {
      return false;
    }
  }

  let cellCount = 0;
  const table = findParentNodeClosestToPos(selection.ranges[0].$from, (node) => {
    return node.type.name === "table";
  });

  table?.node.descendants((node) => {
    if (node.type.name === "table") {
      return false;
    }

    if (["tableCell", "tableHeader"].includes(node.type.name)) {
      cellCount += 1;
    }
  });

  const allCellsSelected = cellCount === selection.ranges.length;

  if (!allCellsSelected) {
    // just delete the selected row
    editor.chain().focus().deleteRow().run();
  }

  // now check the node type of the parent node of this table, if it is a wrapper table, delete the wrapper table
  const tableWrapperParent = findParentNodeClosestToPos(selection.ranges[0].$from, (node) => {
    return (
      node.type.name === "headers-table" ||
      node.type.name === "multipart-table" ||
      node.type.name === "query-table" ||
      node.type.name === "url-table" ||
      node.type.name === "cookies-table" ||
      node.type.name === "assertions-table"
    );
  });

  if (tableWrapperParent && allCellsSelected) {
    editor.chain().focus().deleteNode(tableWrapperParent.node.type.name).run();
  } else if (!tableWrapperParent && allCellsSelected) {
    editor.chain().focus().deleteTable().run();
  }
  return true;
};

export const CustomTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      disabled: {
        default: false,
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "tr",
      mergeAttributes(HTMLAttributes, {
        class: `hover:bg-muted/50 data-[state=selected]:bg-muted ${node.attrs.disabled ? "[&_*]:!text-comment bg-bg italic" : ""}`,
      }),
      0,
    ];
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-/": () => this.editor.commands.toggleRowDisabled(),
      "Mod-Backspace": () => handleTableDelete(this.editor as Editor),
      Backspace: () => handleTableDelete(this.editor as Editor),
      Tab: () => {
        if (this.editor.commands.goToNextCell()) {
          return true;
        }

        if (!this.editor.can().addRowAfter()) {
          return false;
        }

        return this.editor.chain().addRowAfter().goToNextCell().run();
      },
      Enter: () => {
        if (this.editor.commands.goToNextCell()) {
          return true;
        }

        if (!this.editor.can().addRowAfter()) {
          return false;
        }

        return this.editor.chain().addRowAfter().goToNextCell().run();
      },
    };
  },
  addCommands() {
    return {
      insertTable:
        ({ type = "table", rows = 1, cols = 2 } = {}) =>
        (props: CommandProps) => {
          const node = createTable(props.editor.schema, rows, cols, false);

          if (type === "table" && props.dispatch) {
            const offset = props.tr.selection.anchor + 1;

            props.tr
              .replaceSelectionWith(node)
              .scrollIntoView()
              .setSelection(TextSelection.near(props.tr.doc.resolve(offset)));

            return true;
          }

          props.commands.insertContent({
            type: type,
            content: [node.toJSON()],
          });

          return true;
        },
      toggleRowDisabled:
        () =>
        ({ state, dispatch }: { state: EditorState; dispatch: Dispatch }) => {
          let toggled = false;

          state.selection.ranges.forEach((range) => {
            state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
              if (node.type.name === "tableRow") {
                state.tr.setNodeMarkup(pos, null, {
                  ...node.attrs,
                  disabled: !node.attrs.disabled,
                });
                toggled = true;
              }
            });
          });

          if (toggled && dispatch) {
            dispatch(state.tr);
            return true;
          }
          return false;
        },
    };
  },
});
