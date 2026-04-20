import StarterKit from "@tiptap/starter-kit";
import { SlashCommand } from "./SlashCommand";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import Image from "@tiptap/extension-image";
import { CustomTable } from "./nodes/CustomTable";
import { CustomTableHeader } from "./nodes/CustomTableHeader";
import { CustomTableRow } from "./nodes/CustomTableRow";
import TableCell from "@tiptap/extension-table-cell";
import { CustomCodeBlock } from "./nodes/CustomCodeBlock";
import { VariableCapture } from "./nodes/VariableCapture";
import { CustomPlaceholder } from "./extensions/CustomPlaceholder";
import { AnyExtension, Extension, PasteRule } from "@tiptap/core";
import Dropcursor from "@tiptap/extension-dropcursor";
import { FileLink } from "./extensions/ExternalFile";
import { LinkedBlock } from "./extensions/BlockLink";
import { LinkedFile } from "./extensions/LinkedFile";
import { SourceSyncIndicator } from "./extensions/SourceSyncIndicator";
import { autoCloseBrackets } from "./extensions/autocloseBrackets";
import Link from "@tiptap/extension-link";
import { CustomCode } from "./extensions/CustomCode";
import { CopyExtension } from "./extensions/CopyExtension";
import { cmdEnter } from "./extensions/cmdEnter";
import { PasteHandler } from "./extensions/pasteHandler";
import { SeamlessNavigation } from "./extensions/seamlessNavigation";
import { cmdAll } from "./extensions/cmdAll";
import { RequestSeparatorNode } from "./nodes/RequestSeparatorNode";
import { TableCellAutocomplete } from "./extensions/TableCellAutocomplete";

// Extension to prevent markdown input rules in table cells
const DisableMarkdownInTables = Extension.create({
  name: 'disableMarkdownInTables',
  priority: 10000,

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const ext = this;

    return [
      new Plugin({
        key: new PluginKey('disableMarkdownInTables'),
        props: {
          // Intercept text input (space bar, regular typing)
          handleTextInput(view, from, to, text) {
            const { $from } = view.state.selection;

            // Check if we're inside a table cell
            let insideTableCell = false;
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                insideTableCell = true;
                break;
              }
            }

            if (insideTableCell) {
              // Insert text directly, bypassing all input rules (markdown transformations)
              const tr = view.state.tr.insertText(text, from, to);
              view.dispatch(tr);
              return true; // Prevent further processing
            }

            return false;
          },
        },
      }),
    ];
  },

  // Override input rules to disable them when inside table cells
  addInputRules() {
    return [];
  },
});

// Extension to prevent clicking in gaps around table blocks
const PreventTableGapClicks = Extension.create({
  name: 'preventTableGapClicks',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('preventTableGapClicks'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement;

              // If clicking directly on the ProseMirror editor div (the gap areas)
              if (target.classList.contains('ProseMirror')) {
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (!pos) return false;

                const $pos = view.state.doc.resolve(pos.pos);

                // Check if we're next to a table node
                const before = $pos.nodeBefore;
                const after = $pos.nodeAfter;

                const tableTypes = ['headers-table', 'query-table', 'url-table', 'multipart-table', 'path-table', 'cookies-table'];

                if ((before && tableTypes.includes(before.type.name)) ||
                    (after && tableTypes.includes(after.type.name))) {
                  console.log('[Gap Click] Prevented - near table node');
                  event.preventDefault();
                  event.stopPropagation();
                  return true;
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});

// Custom click handler for links
const customClickHandler = () => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click: (view: EditorView, event: MouseEvent) => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) return false;

          const $pos = view.state.doc.resolve(pos.pos);
          const linkMark = $pos.marks().find((mark) => mark.type.name === "link");

          if (linkMark?.attrs.href) {
            event.preventDefault();
            window.electron?.openExternal(linkMark.attrs.href);
            return true;
          }

          return false;
        },
      },
    },
  });
};

export const voidenExtensions: AnyExtension[] = [
  StarterKit.configure({
    gapcursor: false,
    dropcursor: false,
    codeBlock: false, // Disable default codeBlock
    code: false, // Disable default inline code mark
    // blockquote is enabled globally - DisableMarkdownInTables prevents it in tables only
  }),
  CustomCode, // Add Code mark with backtick input rules
  CustomTable.configure({
    resizable: false,
    allowTableNodeSelection: true,
  }),
  CustomTableRow,
  TableCell, // Use default TableCell instead of Custom
  CustomTableHeader,
  DisableMarkdownInTables, // Prevent markdown input rules in ALL table cells
  TableCellAutocomplete, // Context-aware autocomplete for headers, options, assertions
  PreventTableGapClicks, // Prevent clicking in gaps around table blocks
  CustomCodeBlock, // Use our custom codeBlock with CodeEditor

  CustomPlaceholder,
  SlashCommand,
  Image,
  Dropcursor.configure({
    width: 4,
    class: "text-orange-500 rounded",
  }),

  autoCloseBrackets,
  cmdEnter,
  cmdAll,

  FileLink,
  LinkedBlock,
  LinkedFile,
  SourceSyncIndicator,

  CopyExtension,
  PasteHandler,
  SeamlessNavigation,
  VariableCapture,
  RequestSeparatorNode,
  Link.configure({
    openOnClick: false, // Disable default click handler
    linkOnPaste: false, // disable default link-on-paste behavior

    HTMLAttributes: {
      target: "_blank",
      rel: "noopener noreferrer",
    },
  }).extend({
    addPasteRules() {
      return [
        new PasteRule({
          find: /(.+)/g,
          handler: ({ match, state }) => {
            const text = match[0];
            const { $from } = state.selection;
            // If the paste occurs within a url node, replace its content with plain text
            if ($from.parent.type.name === "url") {
              const nodeStart = $from.start();
              const nodeEnd = $from.end();
              state.tr.replaceRangeWith(nodeStart, nodeEnd, state.schema.text(text));
              // Return nothing (i.e. undefined) to comply with the expected type
              return;
            }
            // Otherwise, let the paste proceed normally
            return;
          },
        }),
      ];
    },
    addProseMirrorPlugins() {
      return [...(this.parent?.() || []), customClickHandler()];
    },
  }),
];
