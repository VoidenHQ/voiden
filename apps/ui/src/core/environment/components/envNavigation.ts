import type React from "react";

/**
 * Shared keyboard navigation for the environment editor tree.
 * All navigable items (env headers, variable sub-headers, variable rows)
 * use [data-env-item] and this helper finds the next/prev one in DOM order.
 */
export function focusEnvItem(current: HTMLElement, direction: "up" | "down") {
  const container = current.closest("[data-env-tree]");
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-env-item]"));
  const index = items.indexOf(current);
  const target = items[direction === "down" ? index + 1 : index - 1];
  target?.focus();
}

/**
 * Shared arrow-key handler for tree items (env headers, variable sub-headers, variable rows).
 *
 * @param e            The keyboard event
 * @param el           The DOM element with [data-env-item]
 * @param expanded     Current expand state, or `null` for non-collapsible items (e.g. VariableRow)
 * @param setExpanded  Toggle callback — only needed when `expanded !== null`
 * @returns `true` if the key was handled (caller should skip its own logic for that key)
 */
export function handleTreeKeyDown(
  e: React.KeyboardEvent,
  el: HTMLElement,
  expanded: boolean | null,
  setExpanded?: (v: boolean) => void,
): boolean {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      focusEnvItem(el, "down");
      return true;
    case "ArrowUp":
      e.preventDefault();
      focusEnvItem(el, "up");
      return true;
    case "ArrowRight":
      if (expanded !== null && setExpanded) {
        e.preventDefault();
        if (!expanded) {
          setExpanded(true);
        } else {
          focusEnvItem(el, "down");
        }
        return true;
      }
      return false;
    case "ArrowLeft":
      if (expanded !== null && setExpanded) {
        e.preventDefault();
        if (expanded) {
          setExpanded(false);
        } else {
          focusEnvItem(el, "up");
        }
        return true;
      }
      return false;
    default:
      return false;
  }
}
