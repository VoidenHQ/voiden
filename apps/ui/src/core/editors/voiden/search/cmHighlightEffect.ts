import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

/**
 * StateEffect dispatched from VoidenEditor's unified search to highlight
 * matches inside a CodeMirror instance. Each CM instance receives its own
 * set of ranges and which one (if any) is the "current" match.
 */
export const unifiedSearchHighlight = StateEffect.define<{
  ranges: Array<{ from: number; to: number }>;
  currentIndex: number; // index into `ranges` that is active, -1 = none
}>();

const matchMark = Decoration.mark({
  attributes: { style: "background-color: rgba(255, 255, 0, 0.4);" },
});

const currentMatchMark = Decoration.mark({
  attributes: { style: "background-color: rgba(255, 165, 0, 0.7);" },
});

/**
 * StateField that maintains highlight decorations driven by the unified search.
 * Add this to CodeMirror extensions when the editor is embedded in TipTap.
 */
export const unifiedSearchField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // Check for our effect
    for (const effect of tr.effects) {
      if (effect.is(unifiedSearchHighlight)) {
        const { ranges, currentIndex } = effect.value;
        if (ranges.length === 0) {
          return Decoration.none;
        }

        const decos = ranges
          .map((range, i) =>
            range.from < range.to
              ? (i === currentIndex ? currentMatchMark : matchMark).range(
                  range.from,
                  range.to
                )
              : null
          )
          .filter((d): d is ReturnType<typeof matchMark.range> => d !== null);

        return Decoration.set(decos, true);
      }
    }

    // Map decorations through document changes
    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }

    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
