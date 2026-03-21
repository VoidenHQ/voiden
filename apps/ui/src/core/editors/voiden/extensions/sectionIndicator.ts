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
 * Returns an array of { colorIndex, firstNodeIndex, lastNodeIndex } for each section.
 */
function computeSections(doc: any): Array<{
  colorIndex: number;
  firstChildIndex: number;
  lastChildIndex: number;
}> {
  const sections: Array<{
    colorIndex: number;
    firstChildIndex: number;
    lastChildIndex: number;
  }> = [];

  let currentColorIndex = 0;
  let currentFirstChild = 0;
  let childIndex = 0;
  let hasSeparators = false;

  doc.forEach((node: any) => {
    if (node.type.name === "request-separator") {
      hasSeparators = true;
      // Close the current section (up to the node before this separator)
      if (childIndex > currentFirstChild) {
        sections.push({
          colorIndex: currentColorIndex,
          firstChildIndex: currentFirstChild,
          lastChildIndex: childIndex - 1,
        });
      }
      // The separator itself starts the new section
      currentColorIndex = typeof node.attrs.colorIndex === "number"
        ? node.attrs.colorIndex
        : 0;
      currentFirstChild = childIndex; // separator is part of the new section
    }
    childIndex++;
  });

  if (!hasSeparators) return [];

  // Close the last section
  if (childIndex > currentFirstChild) {
    sections.push({
      colorIndex: currentColorIndex,
      firstChildIndex: currentFirstChild,
      lastChildIndex: childIndex - 1,
    });
  }

  return sections;
}

/**
 * Update overlay lines to match section positions.
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

  const proseDom = view.dom;
  const proseRect = proseDom.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  // Get all top-level children
  const children = Array.from(proseDom.children) as HTMLElement[];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const overlay = overlays[i];

    const firstEl = children[section.firstChildIndex];
    const lastEl = children[section.lastChildIndex];

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

export const SectionIndicatorExtension = Extension.create({
  name: "sectionIndicator",
  addProseMirrorPlugins() {
    return [sectionIndicatorPlugin];
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
