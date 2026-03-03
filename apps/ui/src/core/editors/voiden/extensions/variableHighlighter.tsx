import { Extension } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import tippy, { Instance as TippyInstance } from "tippy.js";

// Global state to hold current variable keys
let currentVariableKeys = new Set<string>();

/**
 * Update variable keys from .voiden/.process.env.json
 */
export function updateVariableKeys(keys: string[]) {
    currentVariableKeys = new Set(keys);
}

/**
 * Find and highlight process variables in the document.
 * @param doc - The document to search
 */
function findProcessVariables(doc: Node): DecorationSet {
    const variableRegex = /{{(.*?)}}/g;
        ;
    const decorations: Decoration[] = [];

    doc.descendants((node, position) => {
        if (!node.text) return;

        Array.from(node.text.matchAll(variableRegex)).forEach((match) => {
            const variableName = match[1].trim(); // Extract variable name (e.g., "process.userId")
            const index = match.index || 0;
            const from = position + index;
            const to = from + match[0].length;
            const isVariableCapture = variableName.startsWith('$req') || variableName.startsWith('$res');
            const isProcessVariable = variableName.startsWith('process.');
            if (!isVariableCapture && !isProcessVariable) {
                return; // Skip non-process and non-variable-capture variables
            }
            // Extract the key after "process."
            const processKey = variableName.replace('process.', '');
            const isValidProcessVar = currentVariableKeys.has(processKey);
            

            let decorationClass: string;

            if (isVariableCapture) {
                // Bright cyan for faker variables - high contrast on dark backgrounds
                decorationClass = "font-mono bg-cyan-400/20 text-cyan-300 rounded-sm font-medium px-1 text-base";
            } else {
                decorationClass = isValidProcessVar
                    ? "font-mono bg-emerald-400/20 text-emerald-300 rounded-sm font-medium px-1 text-base" // Purple for valid process variables
                    : "font-mono bg-rose-400/20 text-rose-300 rounded-sm font-medium px-1 text-base"; // Red for invalid
            }


            decorations.push(Decoration.inline(from, to, { class: decorationClass }));
        });
    });

    return DecorationSet.create(doc, decorations);
}

const pluginKey = new PluginKey("variableHighlighter");

/**
 * Variable highlighter extension with process variable suggestions.
 * @param variableKeys - Array of keys from .voiden/.process.env.json
 */
export const variableHighlighter = (variableKeys: string[] = []) => {
    // Update global keys
    updateVariableKeys(variableKeys);

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
                            if (transaction.getMeta("forceVariableHighlightUpdate") || transaction.docChanged) {
                                return findProcessVariables(transaction.doc);
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
        }
    });
};

// Helper function to load variables from file
export async function loadVariablesFromFile(): Promise<string[]> {
    try {
        const fileContent = await window.electron?.files?.read('.voiden/.process.env.json');
        const variables = JSON.parse(fileContent || '{}');
        return Object.keys(variables);
    } catch (error) {
        console.warn("Could not load .voiden/.process.env.json:", error);
        return [];
    }
}