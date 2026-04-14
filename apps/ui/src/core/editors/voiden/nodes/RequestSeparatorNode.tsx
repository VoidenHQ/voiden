/**
 * Request Separator Node
 *
 * Visual divider that splits a .void document into independent request sections.
 * Each section between separators has its own scope for endpoint, headers, body, etc.
 * Stores a `colorIndex` attribute for section color and a `label` for the section name.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewProps, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useRef, useState, useEffect, useCallback } from "react";
import { getSectionLineColor } from "../extensions/sectionIndicator";
import { useSettings } from "@/core/settings/hooks/useSettings";

const RequestSeparatorView = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [decorationColor, setDecorationColor] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { settings } = useSettings();
  const alignment = settings?.appearance?.separator_alignment ?? "center";

  // Auto-assign a uid if missing (handles older .void files that pre-date uid support)
  useEffect(() => {
    if (!node.attrs.uid && editor.isEditable) {
      updateAttributes({ uid: crypto.randomUUID() });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Read section color from decoration data attribute (set by sectionIndicator plugin)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const parentNode = el.closest("[data-section-color]") as HTMLElement | null;
    if (parentNode) {
      setDecorationColor(parentNode.getAttribute("data-section-color"));
    }

    const observer = new MutationObserver(() => {
      const parent = el.closest("[data-section-color]") as HTMLElement | null;
      setDecorationColor(parent?.getAttribute("data-section-color") ?? null);
    });
    const target = el.parentElement?.parentElement;
    if (target) {
      observer.observe(target, { attributes: true, attributeFilter: ["data-section-color"] });
    }
    return () => observer.disconnect();
  }, []);

  const colorIndex = typeof node.attrs.colorIndex === "number" ? node.attrs.colorIndex : 0;
  const lineColor = decorationColor ?? getSectionLineColor(colorIndex);
  const textColor = decorationColor ?? getSectionLineColor(colorIndex);
  const label = node.attrs.label || "New Request";

  const startEditing = useCallback(() => {
    if (!editor.isEditable) return;
    setEditValue(label === "New Request" ? "" : label);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [label, editor.isEditable]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    updateAttributes({ label: trimmed || "New Request" });
    setIsEditing(false);
  }, [editValue, updateAttributes]);

  return (
    <NodeViewWrapper>
      <div
        ref={wrapperRef}
        contentEditable={false}
        data-type="request-separator"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: alignment === "left" ? "flex-start" : alignment === "right" ? "flex-end" : "center",
          gap: "8px",
          margin: "28px 0 16px",
          userSelect: "none",
        }}
      >
        {/* Short left dash */}
        <div
          style={{
            width: "24px",
            height: "2px",
            backgroundColor: lineColor,
            opacity: 0.5,
            borderRadius: "1px",
          }}
        />
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            placeholder="New Request"
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === "Escape") {
                setIsEditing(false);
              }
              // Prevent ProseMirror from handling these keys
              e.stopPropagation();
            }}
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: textColor,
              whiteSpace: "nowrap",
              background: "var(--editor-bg, transparent)",
              border: `1px solid ${lineColor}`,
              borderRadius: "3px",
              padding: "2px 8px",
              outline: "none",
              textAlign: "center",
              minWidth: "80px",
              maxWidth: "200px",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            onDoubleClick={startEditing}
            title="Double-click to rename"
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: textColor,
              whiteSpace: "nowrap",
              cursor: editor.isEditable ? "text" : "default",
              padding: "2px 4px",
              borderRadius: "3px",
            }}
          >
            {label}
          </span>
        )}
        {/* Short right dash */}
        <div
          style={{
            width: "24px",
            height: "2px",
            backgroundColor: lineColor,
            opacity: 0.5,
            borderRadius: "1px",
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

  addAttributes() {
    return {
      uid: {
        default: null,
        // Auto-generate a uid when one isn't present (e.g. older files without uid)
        parseHTML: (element) => element.getAttribute("data-uid") || null,
        renderHTML: (attributes) => attributes.uid ? { "data-uid": attributes.uid } : {},
      },
      colorIndex: {
        default: 0,
      },
      label: {
        default: "New Request",
      },
    };
  },

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
