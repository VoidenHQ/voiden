import { Extension } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import tippy, { Instance as TippyInstance } from "tippy.js";

// Global state: processKey → value
let currentVariableMap = new Map<string, string>();

/** Update from a full key→value record (used on load and refresh). */
export function updateVariableData(data: Record<string, string>) {
    currentVariableMap = new Map(Object.entries(data));
}

/** Backward-compat: update from a keys-only array (values shown as empty). */
export function updateVariableKeys(keys: string[]) {
    currentVariableMap = new Map(keys.map(k => [k, '']));
}

/**
 * Find and highlight process variables in the document.
 */
function findProcessVariables(doc: Node): DecorationSet {
    const variableRegex = /{{(.*?)}}/g;
    const decorations: Decoration[] = [];

    doc.descendants((node, position) => {
        if (!node.text) return;

        Array.from(node.text.matchAll(variableRegex)).forEach((match) => {
            const variableName = match[1].trim();
            const index = match.index || 0;
            const from = position + index;
            const to = from + match[0].length;
            const isVariableCapture = variableName.startsWith('$req') || variableName.startsWith('$res');
            const isProcessVariable = variableName.startsWith('process.');
            if (!isVariableCapture && !isProcessVariable) return;

            const processKey = variableName.replace('process.', '');
            const isValidProcessVar = currentVariableMap.has(processKey);
            const varValue = currentVariableMap.get(processKey) ?? '';

            let decorationClass: string;
            if (isVariableCapture) {
                decorationClass = "font-mono bg-cyan-400/20 text-cyan-300 rounded-sm font-medium px-1 text-base";
            } else {
                decorationClass = isValidProcessVar
                    ? "font-mono bg-emerald-400/20 text-emerald-300 rounded-sm font-medium px-1 text-base pm-var-highlight"
                    : "font-mono bg-rose-400/20 text-rose-300 rounded-sm font-medium px-1 text-base";
            }

            const attrs: Record<string, string> = { class: decorationClass };
            if (isValidProcessVar) {
                attrs["data-var"] = processKey;
                attrs["data-var-value"] = varValue;
            }

            decorations.push(Decoration.inline(from, to, attrs));
            const variableType = isVariableCapture ? "capture" : "process";
            decorations.push(Decoration.inline(from, to, {
                class: decorationClass,
                "data-variable": variableName,
                "data-variable-type": variableType,
            }));
        });
    });

    return DecorationSet.create(doc, decorations);
}

const pluginKey = new PluginKey("variableHighlighter");

/**
 * Variable highlighter extension.
 * @param variableData - key→value record from .voiden/.process.env.json
 */
export const variableHighlighter = (variableData: Record<string, string> = {}) => {
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

                        handleDOMEvents: {
                            mouseover(view, event) {
                                const e = event as MouseEvent;
                                const target = e.target as HTMLElement | null;
                                if (!target) return false;
                                const el = target.closest(".pm-var-highlight") as HTMLElement | null;
                                if (!el) return false;
                                const from = e.relatedTarget as HTMLElement | null;
                                if (from && el.contains(from)) return false;
                                showTooltip(el, el.dataset.var ?? "", el.dataset.varValue ?? "");
                                return false;
                            },

                            mouseout(view, event) {
                                const e = event as MouseEvent;
                                const target = e.target as HTMLElement | null;
                                if (!target) return false;
                                const el = target.closest(".pm-var-highlight") as HTMLElement | null;
                                if (!el) return false;
                                const to = e.relatedTarget as HTMLElement | null;
                                if (to && el.contains(to)) return false;
                                hideTooltip();
                                return false;
                            },
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


let tip: TippyInstance | null = null;

function buildTooltipContent(key: string, value: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "border border-border bg-panel shadow-lg w-[220px] overflow-hidden";

    // Header — variable name
    const header = document.createElement("div");
    header.className = "flex items-center gap-2 px-3 py-2 border-b border-border bg-bg";

   
    const keyEl = document.createElement("span");
    keyEl.className = "text-text px-2 rounded bg-active font-mono text-sm font-medium";
    keyEl.textContent = key;

    header.appendChild(keyEl);

    // Body — current value
    const body = document.createElement("div");
    body.className = "px-3 py-2 flex flex-col gap-0.5";

    const valueLabel = document.createElement("span");
    valueLabel.className = "text-[10px] uppercase tracking-wide text-comment font-medium";
    valueLabel.textContent = "Current value";

    const valueEl = document.createElement("span");
    valueEl.className = value
        ? "font-mono text-sm text-text break-all"
        : "font-mono text-sm text-comment italic";
    valueEl.textContent = value || "—";

    body.appendChild(valueLabel);
    body.appendChild(valueEl);

    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
}

function showTooltip(el: HTMLElement, key: string, value: string) {
    tip?.destroy();
    tip = tippy(document.body, {
        content: buildTooltipContent(key || el.textContent || "", value),
        trigger: "manual",
        placement: "bottom",
        theme: "slash-command",
        arrow: false,
        getReferenceClientRect: () => el.getBoundingClientRect(),
    });
    tip.show();
}

function hideTooltip() {
    tip?.destroy();
    tip = null;
}
