import StarterKit from "@tiptap/starter-kit";
import { SlashCommand } from "./SlashCommand";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { pasteOrchestrator } from "@/core/paste/pasteOrchestrator";
import Image from "@tiptap/extension-image";
import { CustomTable } from "./nodes/CustomTable";
import { CustomTableHeader } from "./nodes/CustomTableHeader";
import { CustomTableRow } from "./nodes/CustomTableRow";
import TableCell from "@tiptap/extension-table-cell";
import { CustomCodeBlock } from "./nodes/CustomCodeBlock";
import { VariableCapture } from "./nodes/VariableCapture";
import { CustomPlaceholder } from "./extensions/CustomPlaceholder";
import { AnyExtension, Extension, InputRule, PasteRule } from "@tiptap/core";
import Dropcursor from "@tiptap/extension-dropcursor";
import { FileLink, isFileLinkSuggestionOpen } from "./extensions/ExternalFile";
import { LinkedBlock } from "./extensions/BlockLink";
import { LinkedFile } from "./extensions/LinkedFile";
import { SourceSyncIndicator } from "./extensions/SourceSyncIndicator";
import { autoCloseBrackets } from "./extensions/autocloseBrackets";
import Link from "@tiptap/extension-link";
import { CustomCode } from "./extensions/CustomCode";
import { CopyExtension } from "./extensions/CopyExtension";
import { cmdEnter } from "./extensions/cmdEnter";
import { isMac } from "@/core/lib/utils";
import { PasteHandler } from "./extensions/pasteHandler";
import { SeamlessNavigation } from "./extensions/seamlessNavigation";
import { cmdAll } from "./extensions/cmdAll";
import { RequestSeparatorNode } from "./nodes/RequestSeparatorNode";
import { MissingPluginBlock } from "./extensions/MissingPluginBlock";
import { TableCellAutocomplete, isTableCellAutocompleteOpen } from "./extensions/TableCellAutocomplete";
import { isSlashMenuOpen } from "./SlashCommand";

// Extension to prevent markdown input rules in table cells and registered Voiden blocks.
//
// WHY addInputRules and not handleTextInput:
// TipTap builds one shared inputRulesPlugin and places it BEFORE all extension plugins
// in ProseMirror's plugin array. That means handleTextInput added by an extension
// (even at priority 10000) always runs AFTER the inputRulesPlugin's handleTextInput —
// too late to stop italic/bold/code rules from firing. The only way to win is to add
// our own rules into the same inputRulesPlugin at the front of the rule list (which
// is determined by extension priority). A catch-all rule that runs first and absorbs
// any typed character inside Voiden blocks / table cells prevents later rules from
// ever seeing those characters.
const isInRestrictedInputContext = ($from: { depth: number; node: (depth: number) => { type: { name: string } } }) => {
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (
      node.type.name === 'tableCell' ||
      node.type.name === 'tableHeader' ||
      pasteOrchestrator.isRegisteredBlockType(node.type.name)
    ) {
      return true;
    }
  }
  return false;
};

// Finds the start-of-previous-word offset (within parentOffset chars of
// `parent`'s text) for word-backward delete — skips trailing whitespace, then
// consumes a run of same-class (word vs. non-word) characters.
// leafText keeps atom nodes at 1 char so string index == doc position offset.
const findWordBoundaryBefore = (parent: { textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string }, parentOffset: number) => {
  const textBefore = parent.textBetween(0, parentOffset, undefined, '￼');
  let i = textBefore.length;
  while (i > 0 && /\s/.test(textBefore[i - 1])) i--;
  if (i > 0) {
    const isWord = /\w/.test(textBefore[i - 1]);
    while (i > 0 && /\w/.test(textBefore[i - 1]) === isWord && !/\s/.test(textBefore[i - 1])) i--;
  }
  return i;
};

const DisableMarkdownInTables = Extension.create({
  name: 'disableMarkdownInTables',
  priority: 10000,

  addInputRules() {
    return [
      new InputRule({
        // Match any single character at the end of the text block content.
        // /[\s\S]$/ captures even newlines so we can explicitly skip Enter.
        find: /[\s\S]$/,
        handler: ({ state, range, match }) => {
          const text = match[0];

          // Let Enter be handled by node keyboard shortcuts instead.
          if (text === '\n') return null;

          const { $from } = state.selection;
          if (isInRestrictedInputContext($from)) {
            // Insert the character as plain text.
            // A non-null return with steps on the transaction causes
            // inputRulesPlugin to mark this event as "matched", which stops
            // all subsequent rules (italic, bold, code, heading, etc.)
            // from running for this keystroke.
            state.tr.insertText(text, range.from, range.to);
            return; // void (not null) = handled
          }

          return null; // Outside restricted context — let other rules apply.
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Every keystroke inside these blocks is manually inserted by the input
      // rule above, which makes tiptap's core Keymap extension treat each one
      // as an "undoable" input rule. Backspace, Mod-Backspace and Alt-Backspace
      // all share that same default handling (undoInputRule) which reacts by
      // deleting that insertion and immediately re-inserting the same text, so
      // the first press of any of them after typing is a silent no-op — the
      // key event still gets preventDefault()'d, so the browser's native
      // word/line delete never runs either. Only a second press, once the
      // pending "undoable" state is gone, falls through far enough to fail
      // and let native deletion apply. Do the backward delete ourselves for
      // all three so none of them ever reach that path.
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;

        if (!empty || $from.parentOffset === 0 || !isInRestrictedInputContext($from)) {
          return false;
        }

        // Atom nodes (e.g. fileLink) aren't plain characters — some occupy
        // more than 1 position. Deleting a hardcoded single position leaves
        // the node un-removable instead of deleting the whole atom.
        const nodeBefore = $from.nodeBefore;
        if (nodeBefore && nodeBefore.type.spec.atom) {
          return this.editor.commands.deleteRange({ from: $from.pos - nodeBefore.nodeSize, to: $from.pos });
        }

        return this.editor.commands.deleteRange({ from: $from.pos - 1, to: $from.pos });
      },

      // Mod-Backspace is Cmd-Backspace on Mac (native convention: delete to
      // start of line) but Ctrl-Backspace on Windows/Linux, where the native
      // convention is delete-previous-WORD, not delete-to-line-start (that's
      // what Alt-Backspace is reserved for on Mac; Windows has no native
      // binding for Alt-Backspace at all, so hardcoding word-delete to
      // Alt-Backspace only worked for Mac users). Branch so each platform's
      // Mod-Backspace matches what its users actually expect.
      'Mod-Backspace': () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;

        if (!empty || $from.parentOffset === 0 || !isInRestrictedInputContext($from)) {
          return false;
        }

        if (!isMac) {
          const i = findWordBoundaryBefore($from.parent, $from.parentOffset);
          return this.editor.commands.deleteRange({ from: $from.pos - $from.parentOffset + i, to: $from.pos });
        }

        return this.editor.commands.deleteRange({ from: $from.pos - $from.parentOffset, to: $from.pos });
      },

      // Alt-Backspace is Option-Backspace on Mac (native convention:
      // delete-previous-word). It has no native meaning on Windows/Linux —
      // that's Ctrl-Backspace there, already handled above by Mod-Backspace —
      // so swallow it as a no-op on those platforms instead of word-deleting.
      'Alt-Backspace': () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;

        if (!empty || $from.parentOffset === 0 || !isInRestrictedInputContext($from)) {
          return false;
        }

        if (!isMac) {
          return true;
        }

        const i = findWordBoundaryBefore($from.parent, $from.parentOffset);
        return this.editor.commands.deleteRange({ from: $from.pos - $from.parentOffset + i, to: $from.pos });
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('disableMarkdownInTables'),
        props: {
          // Fallback: intercepts paste inside table cells / Voiden blocks so
          // pasted text is inserted as plain text (no markdown conversion).
          handleTextInput(view, from, to, text) {
            const { $from } = view.state.selection;

            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d);
              if (
                node.type.name === 'tableCell' ||
                node.type.name === 'tableHeader' ||
                pasteOrchestrator.isRegisteredBlockType(node.type.name)
              ) {
                view.dispatch(view.state.tr.insertText(text, from, to));
                return true;
              }
            }

            return false;
          },

          // Tiptap's shared inputRulesPlugin also runs input rules on Enter
          // (text '\n') so things like the code-block fence can trigger on
          // Enter — and it runs via `handleKeyDown`, before any extension's
          // own keymap. Our '\n' skip above (so table navigation owns Enter)
          // therefore let later rules like Heading's `/^(#{1,6})\s$/` match
          // the newline and convert "# " + Enter into a heading.
          // handleDOMEvents fires before handleKeyDown, so intercepting here
          // is the only way to stop that conversion before it happens.
          handleDOMEvents: {
            keydown: (view, event) => {
              if (event.key !== 'Enter' || event.shiftKey || !editor) return false;

              // A suggestion popup (slash command, table cell autocomplete, file
              // link picker) owns Enter while it's open — don't steal it for
              // cell navigation. Checked independently of TableCellAutocomplete
              // because FileLink's "@" trigger requires startOfLine, which is
              // false once earlier content (e.g. a prior file attachment)
              // already occupies the cell.
              if (isSlashMenuOpen() || isTableCellAutocompleteOpen() || isFileLinkSuggestionOpen()) return false;

              const { $from } = view.state.selection;
              const inTableCell = (() => {
                for (let d = $from.depth; d > 0; d--) {
                  const typeName = $from.node(d).type.name;
                  if (typeName === 'tableCell' || typeName === 'tableHeader') return true;
                }
                return false;
              })();

              if (!inTableCell) return false;

              event.preventDefault();
              if (editor.commands.goToNextCell()) return true;
              if (editor.can().addRowAfter()) {
                editor.chain().addRowAfter().goToNextCell().run();
              }
              return true;
            },
          },
        },
      }),
    ];
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
  MissingPluginBlock,
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
