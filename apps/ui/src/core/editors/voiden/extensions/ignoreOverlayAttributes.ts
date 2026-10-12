import { Extension } from "@tiptap/core";

// Attributes that menus and dialogs set on elements outside themselves while
// they are open, and remove again when they close.
const OVERLAY_ATTRIBUTES = new Set(["aria-hidden", "data-aria-hidden", "inert"]);

/**
 * Stops the editor redrawing its content when a menu or dialog opens.
 *
 * Radix menus and dialogs hide the rest of the page from assistive technology
 * by setting `aria-hidden` on outside elements. Live regions are exempt, so
 * the library walks down to each one and marks every sibling on the way. Each
 * code block contains a live region (CodeMirror's announcer), which puts that
 * walk inside the editor: its blocks get `aria-hidden` set and later removed.
 * ProseMirror watches its own DOM, treats those attribute changes as edits it
 * didn't make, and redraws the affected nodes, destroying and recreating every
 * code block. Right-clicking a tab was enough to trigger it.
 *
 * These attributes never carry document content, so the editor can ignore
 * changes to them. ProseMirror has no public option for this for ordinary
 * nodes, so this wraps the view's DOM observer. If that internal is missing or
 * renamed, nothing is patched and behaviour is as before.
 */
export const IgnoreOverlayAttributes = Extension.create({
  name: "ignoreOverlayAttributes",

  onCreate() {
    const observer = (this.editor.view as unknown as { domObserver?: Record<string, unknown> }).domObserver;
    if (!observer || typeof observer.registerMutation !== "function" || observer.__ignoresOverlayAttributes) return;

    const registerMutation = observer.registerMutation as (mutation: MutationRecord, added: Node[]) => unknown;
    observer.registerMutation = (mutation: MutationRecord, added: Node[]) => {
      if (mutation.type === "attributes" && mutation.attributeName && OVERLAY_ATTRIBUTES.has(mutation.attributeName)) {
        return null;
      }
      return registerMutation.call(observer, mutation, added);
    };
    observer.__ignoresOverlayAttributes = true;
  },
});
