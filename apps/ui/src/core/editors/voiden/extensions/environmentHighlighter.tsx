import { Extension } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dispatchVariableClick, findEnvVariableEl, createCursorHandlers, isModKey } from "@/core/editors/variableClickHelpers";

// Global state to hold current environment keys
let currentEnvKeys = new Set<string>();

/**
 * Update environment keys and trigger re-render
 */
export function updateEnvironmentKeys(keys: string[]) {
  currentEnvKeys = new Set(keys);
}

/**
 * Find and highlight variables in the document.
 * @param doc - The document to search
 */
function findVariable(doc: Node): DecorationSet {
  const variableRegex = /{{(.*?)}}/g;
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.text) return;

    Array.from(node.text.matchAll(variableRegex)).forEach((match) => {
      const variableName = match[1].trim(); // Extract variable name
      const index = match.index || 0;
      const from = position + index;
      const to = from + match[0].length;
      if (variableName.startsWith('process.')) {
        // Skip process variables - handled by variableHighlighter
        return;
      }
      // Check if it's a faker variable
      const isFakerVariable = variableName.startsWith('$faker');
      const isVariableCapture = variableName.startsWith('$req') || variableName.startsWith('$res');
      let decorationClass: string;

      if (isFakerVariable || isVariableCapture) {
        // Cyan for faker variables - uses CSS variables for theme support
        decorationClass = "font-mono rounded-sm font-medium px-1 text-base variable-highlight-faker";
      } else {
        // Check if variable exists in environment (using global state)
        const isVariableInEnv = currentEnvKeys.has(variableName);
        decorationClass = isVariableInEnv
          ? "font-mono rounded-sm font-medium px-1 text-base variable-highlight-valid" // Green for existing variables
          : "font-mono rounded-sm font-medium px-1 text-base variable-highlight-invalid"; // Red for non-existing variables
      }

      const variableType = isFakerVariable ? "faker" : isVariableCapture ? "capture" : "env";
      decorations.push(Decoration.inline(from, to, {
        class: decorationClass,
        "data-variable": variableName,
        "data-variable-type": variableType,
      }));
    });
  });

  return DecorationSet.create(doc, decorations);
}

const pluginKey = new PluginKey("colorHighlighter");

/**
 * Environment highlighter extension.
 * @param envKeys - Array of environment variable names (secure - no values exposed)
 * @security Only accepts variable names, never values
 */
export const environmentHighlighter = (envKeys: string[] = []) => {
  // Update global keys
  updateEnvironmentKeys(envKeys);

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
              // Always recompute if there's a meta flag or doc changed
              if (transaction.getMeta("forceHighlightUpdate") || transaction.docChanged) {
                return findVariable(transaction.doc);
              }
              return oldState;
            },
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
