import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, AllSelection } from 'prosemirror-state';
import { pasteOrchestrator } from '@/core/paste/pasteOrchestrator';

const isTableCell = (node) => node.type.name === 'tableCell' || node.type.name === 'tableHeader';
// 'url' is voiden-rest-api's request URL field; 'mcpurl' is voiden-mcp-client's
// MCP server URL field — both are single-line editable text fields nested
// inside a larger request/connection block, so Cmd+A inside either should
// select just that field's text, not escalate to the whole block/document.
const isUrlNode = (node) => node.type.name === 'url' || node.type.name === 'mcpurl';
const isBlockquote = (node) => node.type.name === 'blockquote';
const isRegisteredBlock = (node) => pasteOrchestrator.isRegisteredBlockType(node.type.name);

const findAncestorDepth = ($from, predicate) => {
    for (let depth = $from.depth; depth > 0; depth--) {
        if (predicate($from.node(depth))) {
            return depth;
        }
    }
    return null;
};

const selectNodeContent = (state, dispatch, depth) => {
    if (depth === null || depth === undefined) return false;

    const start = state.selection.$from.start(depth);
    const end = state.selection.$from.end(depth);
    const from = Math.min(start, end);
    const to = Math.max(end, from);

    if (dispatch) {
        dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    }
    return true;
};

export const cmdAll = Extension.create({
    name: 'cmdAll',
    priority: 20,

    addOptions() {
        return {
            debug: false,
        };
    },

    addProseMirrorPlugins() {
        let cmdKeyPressed = false;

        return [
            new Plugin({
                key: new PluginKey('cmdAllShortcut'),

                props: {
                    handleDOMEvents: {
                        keydown: (view, event) => {
                            if (event.key === 'Meta' || event.key === 'Control') {
                                cmdKeyPressed = true;
                                return false;
                            }

                            const isSelectAll =
                                (event.metaKey || event.ctrlKey || cmdKeyPressed) &&
                                (event.key === 'a' || event.key === 'A');

                            if (!isSelectAll) {
                                return false;
                            }

                            const { state, dispatch } = view;

                            // Table cell: select only cell content
                            const cellDepth = findAncestorDepth(state.selection.$from, isTableCell);
                            if (cellDepth !== null) {
                                event.preventDefault();
                                event.stopPropagation();
                                selectNodeContent(state, dispatch, cellDepth);
                                return true;
                            }

                            // URL node: select only the URL text
                            const urlDepth = findAncestorDepth(state.selection.$from, isUrlNode);
                            if (urlDepth !== null) {
                                event.preventDefault();
                                event.stopPropagation();
                                selectNodeContent(state, dispatch, urlDepth);
                                return true;
                            }

                            // Registered Voiden block (request/response nodes): select block content.
                            // Only activate at the immediate parent level (depth 1 from cursor) so
                            // that nodes nested inside table cells are already caught above.
                            const blockDepth = findAncestorDepth(state.selection.$from, isRegisteredBlock);
                            if (blockDepth !== null) {
                                const blockStart = state.selection.$from.start(blockDepth);
                                const blockEnd = state.selection.$from.end(blockDepth);
                                const sel = state.selection;
                                const alreadySelectsBlock =
                                    sel.from <= blockStart && sel.to >= blockEnd;

                                if (!alreadySelectsBlock) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    selectNodeContent(state, dispatch, blockDepth);
                                    return true;
                                }
                                // Already selected the block — fall through to select all
                                event.preventDefault();
                                event.stopPropagation();
                                if (dispatch) dispatch(state.tr.setSelection(new AllSelection(state.doc)));
                                return true;
                            }

                            // Blockquote: select blockquote content first, then all on second press
                            const bqDepth = findAncestorDepth(state.selection.$from, isBlockquote);
                            if (bqDepth !== null) {
                                const bqStart = state.selection.$from.start(bqDepth);
                                const bqEnd = state.selection.$from.end(bqDepth);
                                const sel = state.selection;
                                const alreadySelectsBq =
                                    sel.from <= bqStart && sel.to >= bqEnd;

                                if (!alreadySelectsBq) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    selectNodeContent(state, dispatch, bqDepth);
                                    return true;
                                }
                                // Already selected blockquote — fall through to select all
                            }

                            // Default: let ProseMirror select all
                            return false;
                        },

                        keyup: (view, event) => {
                            if (event.key === 'Meta' || event.key === 'Control' ||
                                event.key === 'a' || event.key === 'A') {
                                cmdKeyPressed = false;
                            }
                            return false;
                        },

                        blur: () => {
                            cmdKeyPressed = false;
                            return false;
                        }
                    }
                },
            }),
        ];
    },
});
