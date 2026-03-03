import { Extension } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import tippy, { Instance as TippyInstance } from "tippy.js";
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

      let decorationClass: string;
      const attrs: Record<string, string> = {};

      if (isFakerVariable || isVariableCapture) {
        decorationClass = "font-mono rounded-sm font-medium px-1 text-base variable-highlight-faker";
        attrs.class = decorationClass;
      } else {
        const isVariableInEnv = currentEnvMap.has(variableName);
        if (isVariableInEnv) {
          const envValue = currentEnvMap.get(variableName) ?? '';
          decorationClass = "font-mono rounded-sm font-medium px-1 text-base variable-highlight-valid pm-env-highlight";
          attrs.class = decorationClass;
          attrs["data-var"] = variableName;
          attrs["data-var-value"] = envValue;
        } else {
          decorationClass = "font-mono rounded-sm font-medium px-1 text-base variable-highlight-invalid";
          attrs.class = decorationClass;
        }
      }

      decorations.push(Decoration.inline(from, to, attrs));
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

            handleDOMEvents: {
              mouseover(_view, event) {
                const e = event as MouseEvent;
                const target = e.target as HTMLElement | null;
                if (!target) return false;
                const el = target.closest(".pm-env-highlight") as HTMLElement | null;
                if (!el) return false;
                const from = e.relatedTarget as HTMLElement | null;
                if (from && el.contains(from)) return false;
                showEnvTooltip(el, el.dataset.var ?? "", el.dataset.varValue ?? "");
                return false;
              },

              mouseout(_view, event) {
                const e = event as MouseEvent;
                const target = e.target as HTMLElement | null;
                if (!target) return false;
                const el = target.closest(".pm-env-highlight") as HTMLElement | null;
                if (!el) return false;
                const to = e.relatedTarget as HTMLElement | null;
                if (to && el.contains(to)) return false;
                hideEnvTooltip();
                return false;
              },
            },
            handleClick(view, _pos, event) {
              if (!isModKey(event)) return false;
              const variableEl = findEnvVariableEl(event);
              if (!variableEl) return false;
              dispatchVariableClick(variableEl, view.dom);
              event.preventDefault();
              return true;
            },
          },
        }),
      ];
    },
  });
};


let envTip: TippyInstance | null = null;

function buildEnvTooltipContent(key: string, value: string): HTMLElement {
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

function showEnvTooltip(el: HTMLElement, key: string, value: string) {
  envTip?.destroy();
  envTip = tippy(document.body, {
    content: buildEnvTooltipContent(key || el.textContent || "", value),
    trigger: "manual",
    placement: "bottom",
    theme: "slash-command",
    arrow: false,
    getReferenceClientRect: () => el.getBoundingClientRect(),
  });
  envTip.show();
}

function hideEnvTooltip() {
  envTip?.destroy();
  envTip = null;
}
