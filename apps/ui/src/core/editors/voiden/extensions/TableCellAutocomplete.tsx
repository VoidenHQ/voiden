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
import { getCellColumnIndex } from "./tableCellSuggestions";
import { getTableSuggestions } from "@/plugins";

interface SuggestionItem {
  label: string;
  description?: string;
}

export const TableCellAutocompletePluginKey = new PluginKey(
  "tableCellAutocomplete",
);

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

          // Look up suggestions from the plugin registry
          const items = getTableSuggestions(tableType, columnIndex);
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
});
