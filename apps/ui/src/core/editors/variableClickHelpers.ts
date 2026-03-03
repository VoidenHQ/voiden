/**
 * Shared helpers for Cmd+click-to-jump on environment variable decorations.
 * Used by both the CodeMirror (createHighlightPlugin) and ProseMirror
 * (environmentHighlighter) editors to avoid duplicating interaction logic.
 */

const ENV_SELECTOR = '[data-variable-type="env"]';
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** Check whether the platform modifier key (Cmd on Mac, Ctrl on Windows/Linux) is pressed. */
export function isModKey(event: MouseEvent | KeyboardEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** The KeyboardEvent.key value for the platform modifier key. */
const MOD_KEY = isMac ? "Meta" : "Control";

/** Dispatch a `variable-click` CustomEvent from `emitter`, pulling the variable name from the DOM. */
export function dispatchVariableClick(variableEl: HTMLElement, emitter: HTMLElement): void {
  emitter.dispatchEvent(
    new CustomEvent("variable-click", {
      detail: {
        variableName: variableEl.dataset.variable!,
        variableType: "env",
      },
      bubbles: true,
    }),
  );
}

/** Find the closest env-variable element from the event target, or null. */
export function findEnvVariableEl(event: Event): HTMLElement | null {
  return (event.target as HTMLElement).closest<HTMLElement>(ENV_SELECTOR);
}

/**
 * Returns a set of DOM-event handlers that manage the pointer cursor when
 * hovering over env variables with the platform modifier key held
 * (Cmd on Mac, Ctrl on Windows/Linux).
 *
 * Tracks the previous "should show pointer" state so that `style.cursor` is
 * only written when it actually changes — avoiding unnecessary work on every
 * mousemove.
 */
export function createCursorHandlers(getDom: () => HTMLElement) {
  let wasPointer = false;

  function applyCursor(shouldBePointer: boolean) {
    if (shouldBePointer === wasPointer) return;
    wasPointer = shouldBePointer;
    getDom().style.cursor = shouldBePointer ? "pointer" : "";
  }

  return {
    mousemove(event: MouseEvent) {
      const envEl = findEnvVariableEl(event);
      applyCursor(isModKey(event) && !!envEl);
    },
    keydown(event: KeyboardEvent) {
      if (event.key === MOD_KEY) {
        const hovered = getDom().querySelector(`${ENV_SELECTOR}:hover`);
        applyCursor(!!hovered);
      }
    },
    keyup(event: KeyboardEvent) {
      if (event.key === MOD_KEY) {
        applyCursor(false);
      }
    },
  };
}
