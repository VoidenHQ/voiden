import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { escapeRegExp } from "./unifiedSearch";

export const findHighlightPluginKey = new PluginKey("findHighlight");

const findHighlightPlugin = new Plugin({
  key: findHighlightPluginKey,
  state: {
    init() {
      return DecorationSet.empty;
    },
    apply(tr, old, _oldState, newState) {
      const meta = tr.getMeta(findHighlightPluginKey);
      if (!meta || typeof meta !== "object") {
        return old.map(tr.mapping, newState.doc);
      }
      const { term, matchCase, matchWholeWord, useRegex, currentMatch = -1 } = meta;
      if (!term) {
        return DecorationSet.empty;
      }
      const rawPattern = useRegex ? term : escapeRegExp(term);
      const flags = matchCase ? "g" : "gi";
      let regex: RegExp;
      try {
        regex = new RegExp(rawPattern, flags);
      } catch {
        return DecorationSet.empty;
      }
      const decorations: Decoration[] = [];
      let matchIndex = 0;
      newState.doc.descendants((node, pos) => {
        if (node.isText && node.text) {
          let m: RegExpExecArray | null;
          while ((m = regex.exec(node.text)) !== null) {
            const start = pos + m.index;
            const end = start + m[0].length;
            let valid = true;
            if (matchWholeWord) {
              const before = start > 0 ? newState.doc.textBetween(start - 1, start) : "";
              const after = end < newState.doc.content.size ? newState.doc.textBetween(end, end + 1) : "";
              const wordChar = /\w/;
              if ((before && wordChar.test(before)) || (after && wordChar.test(after))) {
                valid = false;
              }
            }
            if (valid) {
              const isCur = matchIndex === currentMatch;
              decorations.push(
                Decoration.inline(start, end, {
                  style: isCur ? "background-color: rgba(255, 165, 0, 0.7);" : "background-color: rgba(255, 255, 0, 0.4);",
                  ...(isCur ? { class: "find-current-match" } : {}),
                }),
              );
              matchIndex++;
            }
            if (m.index === regex.lastIndex) regex.lastIndex++;
          }
        }
        return true;
      });
      return DecorationSet.create(newState.doc, decorations);
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

export const FindHighlightExtension = Extension.create({
  name: "findHighlight",
  addProseMirrorPlugins() {
    return [findHighlightPlugin];
  },
});
