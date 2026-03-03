import { Extension, InputRule } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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

      decorations.push(Decoration.inline(from, to, { class: decorationClass }));
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
          },
        }),
      ];
    },
  });
};
