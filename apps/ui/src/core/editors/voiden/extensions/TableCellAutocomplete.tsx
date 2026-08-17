/**
 * Table Cell Autocomplete Extension
 *
 * Provides context-aware autocomplete suggestions when typing in
 * table cells. Suggestions are registered by each plugin via
 * context.registerTableSuggestions() — this extension only provides
 * the mechanism, not the data.
 */

import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import tippy, { Instance, Props } from "tippy.js";
import VariableList from "./VariableList";
import { getNodeType } from "./utils";
import { getCellColumnIndex, getRowCellsText } from "./tableCellSuggestions";
import { getTableSuggestions } from "@/plugins";

interface SuggestionItem {
  label: string;
  description?: string;
}

export const TableCellAutocompletePluginKey = new PluginKey(
  "tableCellAutocomplete",
);

let activePopup: Instance<Props>[] | undefined;

export const isTableCellAutocompleteOpen = () => !!activePopup?.[0]?.state?.isShown;

// ─── Manual trigger (Mod-Space) ─────────────────────────────────────────────
// The typing-triggered popup above only ever opens once there's at least one
// non-whitespace character before the cursor — @tiptap/suggestion's own match
// regex requires a text node to match against, so an empty cell shows nothing
// to browse until you start typing (see tableCellSuggestions.ts's row-context
// helper for the related "which suggestions" half of this). Mod-Space opens
// the exact same suggestion list on demand, cursor position or not, entirely
// alongside the typing-triggered plugin below rather than modifying it.
let manualPopupState: { popup: Instance<Props>[]; component: ReactRenderer; teardown: () => void } | null = null;

const closeManualPopup = () => {
  if (!manualPopupState) return;
  const { popup, component, teardown } = manualPopupState;
  manualPopupState = null;
  teardown();
  popup[0].destroy();
  component.destroy();
  if (activePopup === popup) activePopup = undefined;
};

const openManualSuggestionPopup = (editor: any, items: SuggestionItem[]) => {
  closeManualPopup();

  const { view } = editor;
  const pos = editor.state.selection.from;

  const insertItem = (item: SuggestionItem) => {
    editor.chain().focus().insertContent(item.label).run();
    closeManualPopup();
  };

  const component = new ReactRenderer(VariableList, {
    props: { items, command: insertItem },
    editor,
  });

  const popup = tippy("body", {
    getReferenceClientRect: () => {
      const coords = view.coordsAtPos(pos);
      return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
    },
    appendTo: () => document.body,
    content: component.element,
    showOnCreate: true,
    interactive: true,
    trigger: "manual",
    placement: "bottom-start",
  });
  activePopup = popup;

  // Intercept keys in the capture phase — ahead of ProseMirror's own keymap —
  // so arrow/enter drive the popup and any further typing (which the
  // typing-triggered plugin will pick up on its own) closes this one instead
  // of both popups stacking.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeManualPopup();
      return;
    }
    if (component.ref?.onKeyDown({ event })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onTransaction = ({ transaction }: { transaction: any }) => {
    if (transaction.docChanged || transaction.selectionSet) closeManualPopup();
  };

  view.dom.addEventListener("keydown", onKeyDown, true);
  editor.on("transaction", onTransaction);

  manualPopupState = {
    popup,
    component,
    teardown: () => {
      view.dom.removeEventListener("keydown", onKeyDown, true);
      editor.off("transaction", onTransaction);
    },
  };
};

export const TableCellAutocomplete = Extension.create({
  name: "tableCellAutocomplete",

  addOptions() {
    return {
      suggestion: {
        char: "",
        startOfLine: true,
        pluginKey: TableCellAutocompletePluginKey,

        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: { from: number; to: number };
          props: SuggestionItem;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(props.label)
            .run();
        },

        allow: ({ state, range }: any) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return false;

          // Only activate inside a table cell (not in regular paragraphs)
          let insideTableCell = false;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.attrs?.importedFrom) return false;
            if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
              insideTableCell = true;
              break;
            }
          }

          return insideTableCell;
        },

        items: ({ query, editor }: { query: string; editor: any }) => {
          const tableType = getNodeType(editor);
          const columnIndex = getCellColumnIndex(editor.state);
          if (columnIndex < 0) return [];

          // Look up suggestions from the plugin registry — row's other cells
          // (e.g. the header key already typed in column 0) let a plugin
          // tailor a column's suggestions instead of a fixed static list.
          const rowContext = getRowCellsText(editor.state);
          const items = getTableSuggestions(tableType, columnIndex, rowContext);
          if (!items.length) return [];

          if (!query) return items;

          // If the query exactly matches a suggestion, don't show the popup
          // (prevents popup from staying open after selecting a suggestion)
          if (items.some((item) => item.label.toLowerCase() === query.toLowerCase())) {
            return [];
          }

          return items.filter((item) =>
            item.label.toLowerCase().includes(query.toLowerCase()),
          );
        },

        render: () => {
          let component: ReactRenderer;
          let popup: Instance<Props>[];

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(VariableList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
              activePopup = popup;
            },

            onUpdate(props: any) {
              component.updateProps(props);

              if (!props.clientRect) return;

              popup[0].setProps({
                getReferenceClientRect: props.clientRect,
              });
            },

            onKeyDown(props: any) {
              if (props.event.key === "Escape") {
                popup[0].hide();
                return true;
              }
              // @ts-expect-error - component.ref is accessible
              return component.ref?.onKeyDown(props);
            },

            onExit() {
              popup[0].destroy();
              component.destroy();
              if (activePopup === popup) {
                activePopup = undefined;
              }
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Space": () => {
        const { editor } = this;
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;

        const $from = selection.$from;
        let insideTableCell = false;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.attrs?.importedFrom) return false;
          if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
            insideTableCell = true;
            break;
          }
        }
        if (!insideTableCell) return false;

        const tableType = getNodeType(editor);
        const columnIndex = getCellColumnIndex(state);
        if (columnIndex < 0) return false;

        const rowContext = getRowCellsText(state);
        const items = getTableSuggestions(tableType, columnIndex, rowContext);
        if (!items.length) return false;

        openManualSuggestionPopup(editor, items);
        return true;
      },
    };
  },
});
