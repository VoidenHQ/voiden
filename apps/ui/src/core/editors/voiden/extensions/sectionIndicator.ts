/**
 * Section Indicator Extension
 *
 * Adds a colored left border to each top-level node in the ProseMirror document,
 * cycling colors per request section (delimited by request-separator nodes).
 * This helps users visually identify which blocks belong to the same request.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const sectionIndicatorKey = new PluginKey("sectionIndicator");

// Muted colors that work well on dark backgrounds
export const SECTION_COLORS = [
  "rgba(99, 179, 237, 0.4)",   // blue
  "rgba(154, 230, 180, 0.4)",  // green
  "rgba(246, 173, 85, 0.4)",   // orange
  "rgba(183, 148, 244, 0.4)",  // purple
  "rgba(252, 129, 155, 0.4)",  // pink
  "rgba(129, 230, 217, 0.4)",  // teal
  "rgba(252, 211, 77, 0.4)",   // yellow
  "rgba(248, 113, 113, 0.4)",  // red
];

function buildDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];
  let sectionIndex = 0;

  doc.forEach((node: any, offset: number) => {
    if (node.type.name === "request-separator") {
      sectionIndex++;
      const nextColor = SECTION_COLORS[sectionIndex % SECTION_COLORS.length];

      // Separator gets the NEXT section's color — it introduces that section
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          style: `border-left: 3px solid ${nextColor}; padding-left: 8px;`,
          "data-section-color": nextColor,
        })
      );
      return;
    }

    const color = SECTION_COLORS[sectionIndex % SECTION_COLORS.length];

    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        style: `border-left: 3px solid ${color}; padding-left: 8px;`,
      })
    );
  });

  // Only add decorations if there are multiple sections
  if (sectionIndex === 0) {
    return DecorationSet.empty;
  }

  return DecorationSet.create(doc, decorations);
}

const sectionIndicatorPlugin = new Plugin({
  key: sectionIndicatorKey,
  state: {
    init(_, state) {
      return buildDecorations(state.doc);
    },
    apply(tr, old, _oldState, newState) {
      if (tr.docChanged) {
        return buildDecorations(newState.doc);
      }
      return old;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

export const SectionIndicatorExtension = Extension.create({
  name: "sectionIndicator",
  addProseMirrorPlugins() {
    return [sectionIndicatorPlugin];
  },
});
