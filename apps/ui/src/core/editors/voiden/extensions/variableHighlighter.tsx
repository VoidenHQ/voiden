import { Extension } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Global state: processKey → value
let currentVariableMap = new Map<string, string>();

/** Update from a full key→value record (used on load and refresh). */
export function updateVariableData(data: Record<string, string>) {
  currentVariableMap = new Map(Object.entries(data));
}

/** Backward-compat: update from a keys-only array (values shown as empty). */
export function updateVariableKeys(keys: string[]) {
  currentVariableMap = new Map(keys.map((k) => [k, ""]));
}

/** Structural equality check so unrelated rebuilds don't touch unaffected DOM nodes. */
function decorationsEqual(a: readonly Decoration[], b: readonly Decoration[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!a[i].eq(b[i])) return false;
  }
  return true;
}

/**
 * Find and highlight process variables in the document.
 * When `oldSet` is given and the rebuild is identical, the same DecorationSet
 * instance is returned so ProseMirror can skip re-rendering unaffected nodes
 * (a full rebuild recreating every decoration was orphaning the native caret
 * paint on unrelated typing).
 */
function findProcessVariables(doc: Node, oldSet?: DecorationSet): DecorationSet {
  const variableRegex = /{{(.*?)}}/g;
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.text) return;

    Array.from(node.text.matchAll(variableRegex)).forEach((match) => {
      const variableName = match[1].trim();
      const index = match.index || 0;
      const from = position + index;
      const to = from + match[0].length;
      const isVariableCapture =
        variableName.startsWith("$req") || variableName.startsWith("$res");
      const isProcessVariable = variableName.startsWith("process.");
      if (!isVariableCapture && !isProcessVariable) return;

      const processKey = variableName.replace("process.", "");
      const isValidProcessVar = currentVariableMap.has(processKey);
      const varValue = currentVariableMap.get(processKey) ?? "";

      let decorationClass: string;
      if (isVariableCapture) {
        decorationClass =
          "font-mono rounded-sm font-medium text-base pm-var-capture";
      } else {
        decorationClass = isValidProcessVar
          ? "font-mono rounded-sm font-medium text-base pm-var-highlight"
          : "font-mono rounded-sm font-medium text-base pm-var-invalid";
      }

      const variableType = isVariableCapture ? "capture" : "process";
      const attrs: Record<string, string> = {
        class: decorationClass,
        "data-variable": variableName,
        "data-variable-type": variableType,
      };
      if (isValidProcessVar) {
        attrs["data-var"] = processKey;
        attrs["data-var-value"] = varValue;
      }
      decorations.push(Decoration.inline(from, to, attrs));
    });
  });

  if (oldSet) {
    const existing = oldSet.find(0, doc.content.size);
    if (decorationsEqual(existing, decorations)) return oldSet;
  }

  return DecorationSet.create(doc, decorations);
}

const pluginKey = new PluginKey("variableHighlighter");

/**
 * Variable highlighter extension.
 * @param variableData - key→value record from .voiden/.process.env.json
 */
export const variableHighlighter = (
  variableData: Record<string, string> = {},
) => {
  updateVariableData(variableData);

  return Extension.create({
    name: "variableHighlighter",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pluginKey,
          state: {
            init(_, { doc }) {
              return findProcessVariables(doc);
            },
            apply(transaction, oldState) {
              // Force rebuild: always do full scan immediately
              if (transaction.getMeta("forceVariableHighlightUpdate")) {
                return findProcessVariables(transaction.doc, oldState);
              }
              // On doc change: remap positions immediately, schedule full rebuild
              if (transaction.docChanged) {
                return oldState.map(transaction.mapping, transaction.doc);
              }
              return oldState;
            },
          },
          // Use view() to schedule debounced full rebuilds after typing pauses.
          // Timer is scoped per-view (not module-level) so background/cached
          // tabs don't cancel each other's pending rebuild.
          view() {
            let varHighlightTimer: ReturnType<typeof setTimeout> | null = null;
            return {
              update(view, prevState) {
                if (view.state.doc.eq(prevState.doc)) return;
                if (varHighlightTimer !== null) clearTimeout(varHighlightTimer);
                varHighlightTimer = setTimeout(() => {
                  varHighlightTimer = null;
                  view.dispatch(
                    view.state.tr.setMeta("forceVariableHighlightUpdate", true),
                  );
                }, 150);
              },
              destroy() {
                if (varHighlightTimer !== null) {
                  clearTimeout(varHighlightTimer);
                  varHighlightTimer = null;
                }
              },
            };
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
      ];
    },
  });
};

// Helper function to load variable data from file
export async function loadVariablesFromFile(): Promise<Record<string, string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (window as any).electron?.variables?.read();
    return (data as Record<string, string>) ?? {};
  } catch (error) {
    console.warn("Could not load variable data:", error);
    return {};
  }
}
