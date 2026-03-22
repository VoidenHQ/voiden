/**
 * Section Indicator Extension
 *
 * Draws continuous colored lines on the left side of the editor to visually
 * group nodes by request section. Uses DOM overlay divs (not node decorations)
 * to avoid interfering with ProseMirror's node rendering.
 *
 * Colors are stored on each separator's `colorIndex` attribute and persisted
 * in the .void file.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { useResponseStore } from "@/core/request-engine/stores/responseStore";
import type { EditorView } from "prosemirror-view";

const sectionIndicatorKey = new PluginKey("sectionIndicator");

/**
 * 10 curated colors ordered for maximum adjacent contrast.
 */
export const SECTION_COLORS = [
  "#6BA3D6",  // 0  blue
  "#D4956A",  // 1  orange
  "#5DBCB5",  // 2  teal
  "#D47A93",  // 3  rose
  "#8EC76A",  // 4  lime
  "#A98ED4",  // 5  purple
  "#CDB458",  // 6  amber
  "#5BC0D9",  // 7  cyan
  "#D47272",  // 8  red
  "#6BBF92",  // 9  green
];

export function pickDistinctColorIndex(
  prevColorIndex: number,
  nextColorIndex: number
): number {
  const avoid = new Set<number>();
  if (prevColorIndex >= 0) avoid.add(prevColorIndex);
  if (nextColorIndex >= 0) avoid.add(nextColorIndex);

  const candidates = Array.from({ length: SECTION_COLORS.length }, (_, i) => i)
    .filter((i) => !avoid.has(i));

  if (candidates.length === 0) {
    return Math.floor(Math.random() * SECTION_COLORS.length);
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function getSectionColor(colorIndex: number): string {
  return SECTION_COLORS[colorIndex % SECTION_COLORS.length];
}

export function getSectionBorderColor(colorIndex: number): string {
  const hex = SECTION_COLORS[colorIndex % SECTION_COLORS.length];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.6)`;
}

export function getSectionLineColor(colorIndex: number): string {
  const hex = SECTION_COLORS[colorIndex % SECTION_COLORS.length];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.55)`;
}

/**
 * Compute section ranges from the document.
 * Returns an array of { colorIndex, firstPos, lastPos } for each section,
 * using document offsets so we can reliably find DOM elements via the view.
 */
function computeSections(doc: any): Array<{
  colorIndex: number;
  firstPos: number;
  lastPos: number;
}> {
  const sections: Array<{
    colorIndex: number;
    firstPos: number;
    lastPos: number;
  }> = [];

  let currentColorIndex = 0;
  let currentFirstPos = 0;
  let hasSeparators = false;
  // Track the start position of each top-level node
  const nodePositions: number[] = [];

  doc.forEach((node: any, offset: number) => {
    nodePositions.push(offset);
    if (node.type.name === "request-separator") {
      hasSeparators = true;
      // Close the current section (up to the node before this separator)
      if (nodePositions.length > 1 && offset > currentFirstPos) {
        sections.push({
          colorIndex: currentColorIndex,
          firstPos: currentFirstPos,
          lastPos: nodePositions[nodePositions.length - 2],
        });
      }
      // The separator itself starts the new section
      currentColorIndex = typeof node.attrs.colorIndex === "number"
        ? node.attrs.colorIndex
        : 0;
      currentFirstPos = offset;
    }
  });

  if (!hasSeparators) return [];

  // Close the last section
  const lastPos = nodePositions[nodePositions.length - 1];
  if (lastPos !== undefined && lastPos >= currentFirstPos) {
    sections.push({
      colorIndex: currentColorIndex,
      firstPos: currentFirstPos,
      lastPos,
    });
  }

  return sections;
}

/**
 * Update overlay lines to match section positions.
 * Uses ProseMirror's view.nodeDOM() to reliably find DOM elements,
 * avoiding index mismatches caused by widget decorations.
 */
function updateOverlays(
  view: EditorView,
  container: HTMLElement,
  overlays: HTMLElement[]
) {
  const doc = view.state.doc;
  const sections = computeSections(doc);

  // Ensure we have the right number of overlays
  while (overlays.length < sections.length) {
    const el = document.createElement("div");
    el.className = "section-indicator-overlay";
    container.appendChild(el);
    overlays.push(el);
  }
  while (overlays.length > sections.length) {
    const el = overlays.pop()!;
    el.remove();
  }

  const containerRect = container.getBoundingClientRect();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const overlay = overlays[i];

    // Use view.nodeDOM() to find the correct DOM elements by document position
    const firstEl = view.nodeDOM(section.firstPos) as HTMLElement | null;
    const lastEl = view.nodeDOM(section.lastPos) as HTMLElement | null;

    if (!firstEl || !lastEl) {
      overlay.style.display = "none";
      continue;
    }

    const firstRect = firstEl.getBoundingClientRect();
    const lastRect = lastEl.getBoundingClientRect();

    const top = firstRect.top - containerRect.top;
    const bottom = lastRect.bottom - containerRect.top;

    overlay.style.display = "block";
    overlay.style.top = `${top}px`;
    overlay.style.height = `${bottom - top}px`;
    overlay.style.backgroundColor = getSectionBorderColor(section.colorIndex);

    // Also set data attribute for the separator view to read
    const separatorEl = firstEl.querySelector?.('[data-type="request-separator"]')
      ?? (firstEl.getAttribute?.('data-type') === 'request-separator' ? firstEl : null);
    if (separatorEl) {
      (firstEl as HTMLElement).setAttribute("data-section-color", getSectionLineColor(section.colorIndex));
    }
  }
}

const sectionIndicatorPlugin = new Plugin({
  key: sectionIndicatorKey,
  view(editorView) {
    // Create a container for overlay lines
    const container = document.createElement("div");
    container.style.position = "relative";
    container.style.pointerEvents = "none";
    container.style.zIndex = "1";

    // Insert the container as a sibling of the ProseMirror DOM,
    // positioned to overlay it
    const proseDom = editorView.dom;
    const parent = proseDom.parentElement;
    if (parent) {
      parent.style.position = "relative";
      parent.insertBefore(container, proseDom);
      // Make container overlay the editor
      container.style.position = "absolute";
      container.style.top = "0";
      container.style.left = "0";
      container.style.bottom = "0";
      container.style.width = "100%";
    }

    const overlays: HTMLElement[] = [];
    let rafId: number | null = null;

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateOverlays(editorView, container, overlays);
      });
    };

    // Initial render
    scheduleUpdate();

    return {
      update(view) {
        scheduleUpdate();
      },
      destroy() {
        if (rafId) cancelAnimationFrame(rafId);
        container.remove();
      },
    };
  },
});

/**
 * Global store for first section labels, keyed by editor DOM element.
 * Since the first section has no separator node to store its label,
 * we persist it here and expose it for the response panel.
 */
const firstSectionLabels = new WeakMap<HTMLElement, string>();

/** Get the first section's label for an editor */
export function getFirstSectionLabel(editorDom: HTMLElement | null): string {
  if (!editorDom) return "Request 1";
  return firstSectionLabels.get(editorDom) || "Request 1";
}

/** Set the first section's label for an editor */
export function setFirstSectionLabel(editorDom: HTMLElement | null, label: string) {
  if (!editorDom) return;
  firstSectionLabels.set(editorDom, label);
}

/**
 * Plugin that adds a visual first-section header at the top of the document
 * when there are multiple sections. Uses widget decoration.
 * Double-click the label to rename it.
 */
const firstSectionHeaderKey = new PluginKey("firstSectionHeader");

function buildFirstSectionDecoration(doc: any, editorDom: HTMLElement | null, editorView: EditorView | null): DecorationSet {
  let hasSeparators = false;
  // Also check if the first node IS a separator (then no need for the virtual header)
  let firstNodeIsSeparator = false;
  let firstChild = true;
  doc.forEach((node: any) => {
    if (node.type.name === "request-separator") {
      hasSeparators = true;
      if (firstChild) firstNodeIsSeparator = true;
    }
    firstChild = false;
  });

  if (!hasSeparators || firstNodeIsSeparator) return DecorationSet.empty;

  const color = getSectionLineColor(0);
  const label = getFirstSectionLabel(editorDom);

  // Read alignment setting
  let alignment = "center";
  try {
    const settingsRaw = (window as any).__voidenSettings;
    if (settingsRaw?.appearance?.separator_alignment) {
      alignment = settingsRaw.appearance.separator_alignment;
    }
  } catch {}

  const justifyMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };

  const widget = Decoration.widget(0, () => {
    const wrapper = document.createElement("div");
    wrapper.contentEditable = "false";
    wrapper.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      margin: 0 0 12px 0; user-select: none;
      justify-content: ${justifyMap[alignment] || "center"};
    `;

    const line1 = document.createElement("div");
    line1.style.cssText = `width: 24px; height: 2px; background-color: ${color}; opacity: 0.5; border-radius: 1px;`;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    labelSpan.title = "Double-click to rename";
    labelSpan.style.cssText = `
      font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
      text-transform: uppercase; color: ${color}; white-space: nowrap;
      cursor: text; padding: 2px 4px; border-radius: 3px;
    `;

    const line2 = document.createElement("div");
    line2.style.cssText = `width: 24px; height: 2px; background-color: ${color}; opacity: 0.5; border-radius: 1px;`;

    // Double-click to edit
    labelSpan.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const input = document.createElement("input");
      input.type = "text";
      input.value = label === "Request 1" ? "" : label;
      input.placeholder = "Request 1";
      input.style.cssText = `
        font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
        text-transform: uppercase; color: ${color}; white-space: nowrap;
        background: var(--editor-bg, transparent);
        border: 1px solid ${color}; border-radius: 3px;
        padding: 2px 8px; outline: none; text-align: center;
        min-width: 80px; max-width: 200px; font-family: inherit;
      `;

      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const newLabel = input.value.trim() || "Request 1";

        // If label was actually changed from default, insert a real separator
        // node at position 0 so it gets persisted to the .void file.
        // Also shift response store entries since inserting a separator at pos 0
        // pushes all sections up by 1.
        if (newLabel !== "Request 1" && editorView) {
          const sepType = editorView.state.schema.nodes["request-separator"];
          if (sepType) {
            const tr = editorView.state.tr.insert(0, sepType.create({
              colorIndex: 0,
              label: newLabel,
            }));
            editorView.dispatch(tr);

            // Shift response store entries: section N becomes section N+1
            // because inserting a separator at 0 creates a new empty section 0
            try {
              const store = useResponseStore.getState();
              const tabId = store.activeTabId;
              if (tabId && store.responses[tabId]) {
                const oldSections = store.responses[tabId];
                const newSections: Record<number, any> = {};
                for (const [key, value] of Object.entries(oldSections)) {
                  newSections[Number(key) + 1] = value;
                }
                useResponseStore.setState((state: any) => ({
                  responses: { ...state.responses, [tabId]: newSections },
                }));
              }
            } catch { /* ignore */ }

            return;
          }
        }

        // Fallback: just update the visual
        setFirstSectionLabel(editorDom, newLabel);
        labelSpan.textContent = newLabel;
        if (input.parentNode) input.replaceWith(labelSpan);
      };

      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ke) => {
        ke.stopPropagation();
        if (ke.key === "Enter") { ke.preventDefault(); commit(); }
        if (ke.key === "Escape") { committed = true; if (input.parentNode) input.replaceWith(labelSpan); }
      });

      labelSpan.replaceWith(input);
      input.focus();
    });

    wrapper.append(line1, labelSpan, line2);
    return wrapper;
  }, { side: -1, key: "first-section-header" });

  return DecorationSet.create(doc, [widget]);
}

function createFirstSectionHeaderPlugin() {
  let currentView: EditorView | null = null;

  return new Plugin({
    key: firstSectionHeaderKey,
    view(view) {
      currentView = view;
      return {};
    },
    state: {
      init(_, state) {
        return DecorationSet.empty;
      },
      apply(tr, old, _oldState, newState) {
        if (tr.docChanged || old === DecorationSet.empty) {
          return buildFirstSectionDecoration(newState.doc, currentView?.dom ?? null, currentView);
        }
        return old;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

export const SectionIndicatorExtension = Extension.create({
  name: "sectionIndicator",
  addProseMirrorPlugins() {
    return [sectionIndicatorPlugin, createFirstSectionHeaderPlugin()];
  },

  onTransaction({ editor, transaction }) {
    if (!transaction.docChanged) return;
    this.storage.pendingColorFix = true;
  },

  onUpdate({ editor }) {
    if (this.storage.pendingColorFix) {
      this.storage.pendingColorFix = false;
      fixSeparatorColors(editor);
    }
  },

  addStorage() {
    return {
      pendingColorFix: false,
    };
  },
});

function fixSeparatorColors(editor: any) {
  const { doc } = editor.state;
  const separators: Array<{ pos: number; colorIndex: number }> = [];

  doc.forEach((node: any, offset: number) => {
    if (node.type.name === "request-separator") {
      separators.push({
        pos: offset,
        colorIndex: typeof node.attrs.colorIndex === "number" ? node.attrs.colorIndex : 0,
      });
    }
  });

  if (separators.length === 0) return;

  let needsFix = false;
  let prevColor = 0;
  for (const sep of separators) {
    if (sep.colorIndex === prevColor) {
      needsFix = true;
      break;
    }
    prevColor = sep.colorIndex;
  }

  if (!needsFix) return;

  const newColors: number[] = [];
  prevColor = 0;

  for (let i = 0; i < separators.length; i++) {
    const nextColor = i + 1 < separators.length ? separators[i + 1].colorIndex : -1;
    const newColor = pickDistinctColorIndex(prevColor, nextColor);
    newColors.push(newColor);
    prevColor = newColor;
  }

  let tr = editor.state.tr;
  let changed = false;

  for (let i = 0; i < separators.length; i++) {
    if (separators[i].colorIndex !== newColors[i]) {
      const node = tr.doc.nodeAt(separators[i].pos);
      if (node && node.type.name === "request-separator") {
        tr = tr.setNodeMarkup(separators[i].pos, undefined, {
          ...node.attrs,
          colorIndex: newColors[i],
        });
        changed = true;
      }
    }
  }

  if (changed) {
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }
}
