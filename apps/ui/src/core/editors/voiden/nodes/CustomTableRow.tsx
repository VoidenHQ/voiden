import { CommandProps, Dispatch, findParentNodeClosestToPos, mergeAttributes } from "@tiptap/core";
import TableRow from "@tiptap/extension-table-row";

import { isCellSelection } from "@/core/editors/voiden/nodes/Table";
import { Editor } from "@tiptap/react";
import { createTable } from "@tiptap/extension-table";
import { EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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
        node.type.name === "options-table" ||
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rowToggleDecorations"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];

            state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
              if (node.type.name !== "tableRow") return;

              const disabled = !!node.attrs.disabled;

              const widget = Decoration.widget(
                pos + 1,
                (view, getPos) => {
                  const td = document.createElement("td");
                  td.setAttribute("contenteditable", "false");
                  td.setAttribute("data-row-toggle", "true");
                  td.style.cssText =
                    "width:28px;min-width:28px;max-width:28px;padding:0;text-align:center;user-select:none;cursor:pointer;vertical-align:middle;border-right:1px solid var(--ui-line,#3a3a3a);";

                  const box = document.createElement("div");
                  box.style.cssText =
                    "width:13px;height:13px;border-radius:3px;margin:2px auto;display:flex;align-items:center;justify-content:center;border:1.5px solid;transition:opacity 0.1s;";

                  if (disabled) {
                    box.style.borderColor = "var(--ui-line,#555)";
                    box.style.backgroundColor = "transparent";
                  } else {
                    box.style.borderColor = "var(--accent,#3b82f6)";
                    box.style.backgroundColor = "var(--accent,#3b82f6)";
                    box.innerHTML =
                      '<svg viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:8px;height:8px;display:block"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                  }

                  td.title = disabled ? "Enable row (⌘/)" : "Disable row (⌘/)";
                  td.appendChild(box);

                  td.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const { state: s, dispatch } = view;
                    if (!dispatch) return;

                    // Resolve current position to handle document mutations since decoration was created
                    const widgetPos = getPos();
                    if (widgetPos == null) return;

                    const $pos = s.doc.resolve(widgetPos);
                    for (let d = $pos.depth; d >= 0; d--) {
                      if ($pos.node(d).type.name === "tableRow") {
                        const rowPos = $pos.before(d);
                        const rowNode = $pos.node(d);
                        dispatch(
                          s.tr.setNodeMarkup(rowPos, null, {
                            ...rowNode.attrs,
                            disabled: !rowNode.attrs.disabled,
                          }),
                        );
                        return;
                      }
                    }
                  });

                  return td;
                },
                { side: -1 },
              );

              decorations.push(widget);
              return false;
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
