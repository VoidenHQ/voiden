/**
 * Block Multi-Select Extension
 *
 * Lets the user build an ephemeral, non-contiguous selection of top-level
 * blocks — pick block 1 and block 3 without block 2, in any order — using
 * the same conventions as a file manager: Ctrl/Cmd+Click toggles one block,
 * Shift+Click adds the whole range since the last-touched block. Selected
 * blocks get a left-accent-border + tint highlight so the selection is
 * visible at a glance. Backspace deletes the whole selection; Escape clears
 * it. Purely UI state (a plugin-local Set of block uids), never written to
 * the document/file.
 *
 * VoidenDragMenu.tsx reads the current selection via getSelectedBlockUids()
 * to drag the whole set together; it's responsible for clearing the
 * selection once a move completes.
 */
import { Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface MultiSelectState {
  selected: Set<string>;
  /** Last block touched by a toggle/range-add — the far end a Shift+Click extends from. */
  anchor: string | null;
}

export const BlockMultiSelectPluginKey = new PluginKey<MultiSelectState>("blockMultiSelect");

// Same node types VoidenDragMenu already hides its grip for — not
// meaningful to include in a "move these together" selection.
const EXCLUDED_TYPES = new Set(["title", "method", "url"]);

export const getSelectedBlockUids = (state: EditorState): Set<string> => {
  return BlockMultiSelectPluginKey.getState(state)?.selected ?? new Set();
};

export const clearBlockSelection = (editor: { state: EditorState; view: { dispatch: (tr: unknown) => void } }) => {
  if (getSelectedBlockUids(editor.state).size === 0) return;
  editor.view.dispatch(editor.state.tr.setMeta(BlockMultiSelectPluginKey, { clear: true }));
};

// Every top-level (uid, pos, size) triple in doc order, excluding node types
// that aren't selectable blocks — shared by the range-select and delete paths.
const listSelectableBlocks = (doc: EditorState["doc"]) => {
  const blocks: { uid: string; pos: number; size: number }[] = [];
  let pos = 0;
  doc.forEach((node) => {
    if (node.attrs?.uid && !EXCLUDED_TYPES.has(node.type.name)) {
      blocks.push({ uid: node.attrs.uid, pos, size: node.nodeSize });
    }
    pos += node.nodeSize;
  });
  return blocks;
};

export const BlockMultiSelect = Extension.create({
  name: "blockMultiSelect",

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        if (getSelectedBlockUids(this.editor.state).size === 0) return false;
        clearBlockSelection(this.editor);
        return true;
      },

      // Backspace targets the selection whenever one exists, same as
      // Backspace acting on a text selection deletes it instead of a single
      // character — the highlight makes it obvious what's about to go.
      // Falls through to normal per-character Backspace otherwise.
      Backspace: () => {
        const selected = getSelectedBlockUids(this.editor.state);
        if (selected.size === 0) return false;

        const { state } = this.editor;
        const entries = listSelectableBlocks(state.doc).filter((b) => selected.has(b.uid));
        if (entries.length === 0) return false;

        let tr = state.tr;
        for (let i = entries.length - 1; i >= 0; i--) {
          tr = tr.delete(entries[i].pos, entries[i].pos + entries[i].size);
        }
        tr.setMeta(BlockMultiSelectPluginKey, { clear: true });
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<MultiSelectState>({
        key: BlockMultiSelectPluginKey,
        state: {
          init: () => ({ selected: new Set<string>(), anchor: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(BlockMultiSelectPluginKey);
            if (!meta) return prev;
            if (meta.clear) return { selected: new Set<string>(), anchor: null };
            if (meta.toggle) {
              const next = new Set(prev.selected);
              if (next.has(meta.toggle)) next.delete(meta.toggle);
              else next.add(meta.toggle);
              return { selected: next, anchor: meta.toggle };
            }
            if (meta.addRange) {
              const next = new Set(prev.selected);
              (meta.addRange as string[]).forEach((uid) => next.add(uid));
              return { selected: next, anchor: meta.anchor ?? prev.anchor };
            }
            return prev;
          },
        },
        props: {
          // Shift+Click has to be caught on `mousedown`, before ProseMirror's
          // own click handling runs: internally `MouseDown.allowDefault` is
          // set to `event.shiftKey` on mousedown, and on mouseup ProseMirror
          // checks that flag and — when true — skips `handleClickOn`/
          // `handleClick` entirely in favor of the browser's native
          // shift-click-extends-selection behavior. `handleDOMEvents` runs
          // ahead of ProseMirror's built-in mousedown handler, so returning
          // true here (after `preventDefault`) is what makes it possible to
          // treat shift-click as "add the range since the last-touched
          // block" instead of a text-selection extend.
          handleDOMEvents: {
            mousedown(view, event) {
              if (!event.shiftKey || event.button !== 0) return false;

              const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!result) return false;
              const blocks = listSelectableBlocks(view.state.doc);
              const target = blocks.find((b) => result.pos >= b.pos && result.pos < b.pos + b.size);
              if (!target) return false;

              event.preventDefault();

              const pluginState = BlockMultiSelectPluginKey.getState(view.state);
              const anchorBlock = pluginState?.anchor ? blocks.find((b) => b.uid === pluginState.anchor) : undefined;

              const from = anchorBlock ? Math.min(anchorBlock.pos, target.pos) : target.pos;
              const to = anchorBlock
                ? Math.max(anchorBlock.pos + anchorBlock.size, target.pos + target.size)
                : target.pos + target.size;

              const uidsInRange = blocks.filter((b) => b.pos >= from && b.pos < to).map((b) => b.uid);
              view.dispatch(view.state.tr.setMeta(BlockMultiSelectPluginKey, { addRange: uidsInRange, anchor: target.uid }));
              return true;
            },
          },

          // Ctrl/Cmd+Click toggles the clicked block, so a non-contiguous
          // pick (block 1 and block 3, skipping 2) is one click each.
          // ProseMirror calls this once per ancestor of the click, innermost
          // first, and `nodePos` is "the position right before `node`" —
          // for a *top-level* block that position sits in the doc's own
          // content flow, so it resolves to depth 0 (NOT depth 1 —
          // `.node(1)` on it throws). Depth 0 is exactly the signal that
          // `node` is a direct child of the doc, i.e. the block we care
          // about; deeper calls (nested containers) bail and let the
          // top-level call handle it.
          handleClickOn(view, _pos, node, nodePos, event) {
            if (!(event.ctrlKey || event.metaKey)) return false;

            const uid = node.attrs?.uid;
            if (!uid || EXCLUDED_TYPES.has(node.type.name)) return false;
            if (view.state.doc.resolve(nodePos).depth !== 0) return false;

            event.preventDefault();
            view.dispatch(view.state.tr.setMeta(BlockMultiSelectPluginKey, { toggle: uid }));
            return true;
          },

          // Selected blocks get a left-accent-border + tint highlight. A
          // plain node decoration follows the node's real position for
          // free, no separate overlay/position-tracking needed.
          decorations(state) {
            const pluginState = BlockMultiSelectPluginKey.getState(state);
            const selected = pluginState?.selected ?? new Set<string>();
            if (selected.size === 0 || state.doc.childCount === 0) return null;

            const decorations: Decoration[] = [];
            state.doc.forEach((node, pos) => {
              const uid = node.attrs?.uid;
              if (!uid || EXCLUDED_TYPES.has(node.type.name)) return;
              if (!selected.has(uid)) return;

              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  style:
                    "border-left: 3px solid var(--accent); background-color: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 4px;",
                }),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
