import { Extension } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dispatchVariableClick, findEnvVariableEl, createCursorHandlers, isModKey } from "@/core/editors/variableClickHelpers";

// Global state: envKey → value
let currentEnvMap = new Map<string, string>();

/** Update from a full key→value record (used on load and refresh). */
export function updateEnvironmentData(data: Record<string, string>) {
  currentEnvMap = new Map(Object.entries(data));
}

/** Backward-compat: update from a keys-only array (values shown as empty). */
export function updateEnvironmentKeys(keys: string[]) {
  currentEnvMap = new Map(keys.map(k => [k, '']));
}

/**
 * Find and highlight variables in the document.
 */
function findVariable(doc: Node): DecorationSet {
  const variableRegex = /{{(.*?)}}/g;
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.text) return;

    Array.from(node.text.matchAll(variableRegex)).forEach((match) => {
      const variableName = match[1].trim();
      const index = match.index || 0;
      const from = position + index;
      const to = from + match[0].length;

      if (variableName.startsWith('process.')) return; // handled by variableHighlighter

      const isFakerVariable = variableName.startsWith('$faker');
      const isVariableCapture = variableName.startsWith('$req') || variableName.startsWith('$res');

      const variableType = isFakerVariable ? "faker" : isVariableCapture ? "capture" : "env";
      let decorationClass: string;
      const attrs: Record<string, string> = {
        "data-variable": variableName,
        "data-variable-type": variableType,
      };

      if (isFakerVariable || isVariableCapture) {
        decorationClass = "font-mono rounded-sm font-medium text-base variable-highlight-faker";
        attrs.class = decorationClass;
      } else {
        const isVariableInEnv = currentEnvMap.has(variableName);
        if (isVariableInEnv) {
          const envValue = currentEnvMap.get(variableName) ?? '';
          decorationClass = "font-mono rounded-sm font-medium text-base variable-highlight-valid pm-env-highlight";
          attrs.class = decorationClass;
          attrs["data-var"] = variableName;
          attrs["data-var-value"] = envValue;
        } else {
          decorationClass = "font-mono rounded-sm font-medium text-base variable-highlight-invalid";
          attrs.class = decorationClass;
        }
      }

      decorations.push(Decoration.inline(from, to, attrs));

    });
  });

  return DecorationSet.create(doc, decorations);
}

const pluginKey = new PluginKey("colorHighlighter");

// Debounce timer for scheduling full decoration rebuilds
let envHighlightTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Environment highlighter extension.
 * @param envData - key→value record from the active environment
 */
export const environmentHighlighter = (envData: Record<string, string> = {}) => {
  updateEnvironmentData(envData);

  return Extension.create({
    name: "colorHighlighter",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pluginKey,
          state: {
            init(_, { doc }) {
              return findVariable(doc);
            },
            apply(transaction, oldState) {
              // Force rebuild: always do full scan immediately
              if (transaction.getMeta("forceHighlightUpdate")) {
                return findVariable(transaction.doc);
              }
              // On doc change: remap positions immediately, schedule full rebuild
              if (transaction.docChanged) {
                return oldState.map(transaction.mapping, transaction.doc);
              }
              return oldState;
            },
          },
          // Use view() to schedule debounced full rebuilds after typing pauses
          view(editorView) {
            return {
              update(view, prevState) {
                if (view.state.doc.eq(prevState.doc)) return;
                if (envHighlightTimer !== null) clearTimeout(envHighlightTimer);
                envHighlightTimer = setTimeout(() => {
                  envHighlightTimer = null;
                  view.dispatch(view.state.tr.setMeta("forceHighlightUpdate", true));
                }, 150);
              },
              destroy() {
                if (envHighlightTimer !== null) {
                  clearTimeout(envHighlightTimer);
                  envHighlightTimer = null;
                }
              },
            };
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },

            handleClick(view, _pos, event) {
              if (!isModKey(event)) return false;
              const variableEl = findEnvVariableEl(event);
              if (!variableEl) return false;
              dispatchVariableClick(variableEl, view.dom);
              event.preventDefault();
              return true;
            },
            handleDOMEvents: (() => {
              let cursor: ReturnType<typeof createCursorHandlers> | null = null;
              const get = (view: { dom: HTMLElement }) => {
                if (!cursor) cursor = createCursorHandlers(() => view.dom);
                return cursor;
              };
              return {
                mousemove(view, event) { get(view).mousemove(event); return false; },
                keydown(view, event) { get(view).keydown(event); return false; },
                keyup(view, event) { get(view).keyup(event); return false; },
              };
            })(),
          },
        }),
      ];
    },
  });
};
