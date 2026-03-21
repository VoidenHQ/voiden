/**
 * Request Separator Node
 *
 * Visual divider that splits a .void document into independent request sections.
 * Each section between separators has its own scope for endpoint, headers, body, etc.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useRef, useState, useEffect } from "react";

const RequestSeparatorView = () => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [sectionColor, setSectionColor] = useState<string | null>(null);

  useEffect(() => {
    // Read the section color from the decoration's data attribute on the parent wrapper
    const el = wrapperRef.current;
    if (!el) return;
    const parentNode = el.closest("[data-section-color]") as HTMLElement | null;
    if (parentNode) {
      setSectionColor(parentNode.getAttribute("data-section-color"));
    }

    // Watch for changes via MutationObserver (decoration updates)
    const observer = new MutationObserver(() => {
      const parent = el.closest("[data-section-color]") as HTMLElement | null;
      setSectionColor(parent?.getAttribute("data-section-color") ?? null);
    });
    const target = el.parentElement?.parentElement;
    if (target) {
      observer.observe(target, { attributes: true, attributeFilter: ["data-section-color"] });
    }
    return () => observer.disconnect();
  }, []);

  const lineColor = sectionColor ?? "color-mix(in srgb, var(--accent) 40%, transparent)";
  const textColor = sectionColor ?? "color-mix(in srgb, var(--accent) 60%, transparent)";

  return (
    <NodeViewWrapper>
      <div
        ref={wrapperRef}
        contentEditable={false}
        data-type="request-separator"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          margin: "24px 0",
          userSelect: "none",
        }}
      >
        <div
          style={{
            flex: 1,
            height: "1px",
            borderTop: `2px dashed ${lineColor}`,
          }}
        />
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: textColor,
            whiteSpace: "nowrap",
          }}
        >
          New Request
        </span>
        <div
          style={{
            flex: 1,
            height: "1px",
            borderTop: `2px dashed ${lineColor}`,
          }}
        />
      </div>
    </NodeViewWrapper>
  );
};

export const RequestSeparatorNode = Node.create({
  name: "request-separator",

  group: "block",

  atom: true,
  draggable: true,
  selectable: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="request-separator"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "request-separator" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RequestSeparatorView);
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { $from } = this.editor.state.selection;
        const node = this.editor.state.doc.nodeAt($from.pos);
        if (node?.type.name === "request-separator") {
          this.editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
    };
  },
});
