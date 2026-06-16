import React, { useEffect, useState, useCallback, useRef } from "react";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import {
  getSectionColor,
  getFirstSectionLabel,
} from "@/core/editors/voiden/extensions/sectionIndicator";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  AlignLeft,
  Code,
  Heading1,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link,
  Variable,
  ImageIcon,
  Table2,
  Box,
  ChevronDown,
  ChevronRight,
  LayoutList,
  FileJson,
  icons,
} from "lucide-react";
import { cn } from "@/core/lib/utils";
import { getBlockOutlineMeta } from "@/plugins";

// ── Types ──────────────────────────────────────────────────────────────────

interface BlockInfo {
  type: string;
  pos: number;
  preview?: string;
  rowCount?: number;
}

interface SectionInfo {
  index: number;
  label: string;
  colorIndex: number;
  separatorPos: number | null;
  methodText?: string;
  urlText?: string;
  blocks: BlockInfo[];
}

// ── Core block metadata (generic markdown / built-in types only) ───────────
// Plugin-owned block types (e.g. headers-table, query-table) are registered
// at runtime via context.registerBlockOutlineMeta() and resolved through
// getBlockOutlineMeta() + the lucide `icons` map.

const CORE_BLOCK_META: Record<string, { label: string; Icon: React.ElementType }> = {
  codeBlock:       { label: "Code Block",     Icon: Code },
  paragraph:       { label: "Text",           Icon: AlignLeft },
  heading:         { label: "Heading",        Icon: Heading1 },
  bulletList:      { label: "List",           Icon: List },
  orderedList:     { label: "Numbered List",  Icon: ListOrdered },
  blockquote:      { label: "Quote",          Icon: Quote },
  horizontalRule:  { label: "Divider",        Icon: Minus },
  linkedBlock:     { label: "Linked Block",   Icon: Link },
  linkedFile:      { label: "Linked File",    Icon: FileJson },
  variableCapture: { label: "Variables",      Icon: Variable },
  image:           { label: "Image",          Icon: ImageIcon },
  table:           { label: "Table",          Icon: Table2 },
};

/** Resolves label + icon for any block type: plugin registry first, then core fallback. */
function resolveBlockMeta(type: string): { label: string; Icon: React.ElementType } {
  const pluginMeta = getBlockOutlineMeta(type);
  if (pluginMeta) {
    const IconComponent = icons[pluginMeta.icon as keyof typeof icons] as React.ElementType | undefined;
    return { label: pluginMeta.label, Icon: IconComponent ?? Box };
  }
  return CORE_BLOCK_META[type] ?? { label: type, Icon: Box };
}

const SKIP_TYPES = new Set(["request-separator", "title", "method", "url"]);

// ── Helpers ────────────────────────────────────────────────────────────────

function buildBlockInfo(node: ProseMirrorNode, pos: number): BlockInfo {
  const type = node.type.name;
  let preview: string | undefined;
  let rowCount: number | undefined;

  // Ask the plugin registry first — it owns the block-specific extraction logic.
  const pluginMeta = getBlockOutlineMeta(type);
  if (pluginMeta) {
    preview = pluginMeta.getPreview?.(node.attrs, node.textContent);
    rowCount = pluginMeta.getRowCount?.(node.attrs, node.childCount, node.textContent);
  } else if (type === "codeBlock") {
    // Core TipTap node — kept here because it belongs to the built-in schema.
    const lang: string = node.attrs.language || "";
    if (lang) preview = lang;
    rowCount = node.textContent.split("\n").length;
  } else {
    const text = node.textContent.trim();
    if (text) preview = text.length > 36 ? text.slice(0, 36) + "…" : text;
  }

  return { type, pos, preview, rowCount };
}

// ── Main component ─────────────────────────────────────────────────────────

export const BlockOverviewPanel: React.FC = () => {
  const editor = useVoidenEditorStore((s) => s.editor);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const debounceRef = useRef<number | null>(null);

  const buildSections = useCallback(() => {
    if (!editor) { setSections([]); return; }

    const { doc } = editor.state;
    const firstLabel = getFirstSectionLabel(editor.view.dom as HTMLElement);

    const result: SectionInfo[] = [];
    let current: SectionInfo = {
      index: 0,
      label: firstLabel,
      colorIndex: -1,
      separatorPos: null,
      blocks: [],
    };

    const processNode = (node: ProseMirrorNode, nodePos: number) => {
      const outlineMeta = getBlockOutlineMeta(node.type.name);
      if (outlineMeta?.asSectionField) {
        const fieldResult = outlineMeta.asSectionField(node.attrs, node.textContent.trim());
        if (fieldResult) current[fieldResult.field] = fieldResult.value;
      } else if (outlineMeta?.transparent) {
        // Transparent container: descend into children as if they were top-level
        node.forEach((child: ProseMirrorNode, childOffset: number) => {
          processNode(child, nodePos + childOffset + 1);
        });
      } else if (!SKIP_TYPES.has(node.type.name)) {
        current.blocks.push(buildBlockInfo(node, nodePos));
      }
    };

    let pos = 0;
    doc.forEach((node: ProseMirrorNode) => {
      if (node.type.name === "request-separator") {
        // Only push the section if it has actual content — avoids a phantom
        // empty section when the document starts with a request-separator.
        if (current.methodText || current.urlText || current.blocks.length > 0) {
          result.push(current);
        }
        current = {
          index: result.length,
          label: node.attrs.label || "New Request",
          colorIndex: node.attrs.colorIndex ?? 0,
          separatorPos: pos,
          blocks: [],
        };
      } else {
        processNode(node, pos);
      }
      pos += node.nodeSize;
    });
    // Always include the last section (it's the only one if there are no separators)
    if (current.methodText || current.urlText || current.blocks.length > 0 || result.length === 0) {
      result.push(current);
    }

    setSections(result);
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      return new Set(result.map((_, i) => i));
    });
  }, [editor]);

  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!editor) { setSections([]); return; }

    const schedule = () => {
      if (isDraggingRef.current) return;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(buildSections, 120);
    };

    const onDragStart = () => { isDraggingRef.current = true; };
    const onDragEnd = () => {
      isDraggingRef.current = false;
      buildSections();
    };

    buildSections();
    editor.on("update", schedule);
    document.addEventListener('voiden:block-drag-start', onDragStart);
    document.addEventListener('voiden:block-drag-end', onDragEnd);
    return () => {
      editor.off("update", schedule);
      document.removeEventListener('voiden:block-drag-start', onDragStart);
      document.removeEventListener('voiden:block-drag-end', onDragEnd);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [editor, buildSections]);

  const scrollToSection = useCallback((sectionIndex: number) => {
    window.dispatchEvent(new CustomEvent("voiden:scroll-to-section", { detail: { sectionIndex } }));
  }, []);

  const scrollToBlock = useCallback((pos: number) => {
    window.dispatchEvent(new CustomEvent("voiden:scroll-to-block-pos", { detail: { pos } }));
  }, []);

  const toggleSection = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }, []);

  // ── Empty state ──────────────────────────────────────────────────────────

  if (!editor || sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-comment">
        <LayoutList size={20} className="opacity-40" />
        <span className="text-xs">Open a .void file to see its blocks</span>
      </div>
    );
  }

  const hasSeparators = sections.some((s) => s.separatorPos !== null);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto select-none">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-1.5 sticky top-0 bg-bg z-10">
        <LayoutList size={12} className="text-comment" />
        <span className="text-xs font-medium text-comment uppercase tracking-wide">
          Outline
        </span>
        {hasSeparators && (
          <span className="ml-auto text-[10px] text-comment/50">
            {sections.length} {sections.length !== 1 ? "requests" : "request"}
          </span>
        )}
      </div>

      <div className="py-1">
        {sections.map((section) => {
          const isExpanded = expanded.has(section.index);
          const color = section.colorIndex >= 0 ? getSectionColor(section.colorIndex) : "#888888";
          const hasContent = !!(section.methodText || section.urlText || section.blocks.length > 0);

          return (
            <div key={section.index} className={cn("mb-1", hasSeparators && "px-2")}>
              {/* ── Section header: color dot + method badge + url ──────── */}
              {hasSeparators && (
                <button
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-active text-left group mb-0.5"
                  onClick={() => {
                    scrollToSection(section.index);
                    if (hasContent) toggleSection(section.index);
                  }}
                >
                  <div
                    className="w-1 h-3.5 rounded-full flex-shrink-0"
                    style={{ background: color }}
                  />
                  {section.methodText && (
                    <span
                      className="font-mono font-bold text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ color, background: `${color}25` }}
                    >
                      {section.methodText}
                    </span>
                  )}
                  <span className="flex-1 truncate font-mono text-[10px] text-comment/70">
                    {section.urlText || section.label || "New Request"}
                  </span>
                  {hasContent && (
                    isExpanded
                      ? <ChevronDown size={10} className="text-comment/60 flex-shrink-0" />
                      : <ChevronRight size={10} className="text-comment/60 flex-shrink-0" />
                  )}
                </button>
              )}

              {/* ── Section body ────────────────────────────────────────── */}
              {(!hasSeparators || isExpanded) && (
                <div className="space-y-0.5">
                  {/* For single-request files: show method + url as a compact info row */}
                  {!hasSeparators && (section.methodText || section.urlText) && (
                    <button
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-active text-left mb-1"
                      onClick={() => scrollToSection(section.index)}
                    >
                      {section.methodText && (
                        <span
                          className="font-mono font-bold text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ color, background: `${color}25` }}
                        >
                          {section.methodText}
                        </span>
                      )}
                      {section.urlText && (
                        <span className="font-mono text-[10px] text-comment/70 truncate">
                          {section.urlText}
                        </span>
                      )}
                    </button>
                  )}

                  {/* Block cards */}
                  {section.blocks.map((block, i) => {
                    const { Icon, label } = resolveBlockMeta(block.type);

                    return (
                      <button
                        key={i}
                        className="w-full flex items-start gap-2 px-2 py-2 rounded hover:bg-active text-left group/block"
                        onClick={() => scrollToBlock(block.pos)}
                      >
                        {/* Icon badge */}
                        <div className="mt-0.5 w-5 h-5 rounded flex items-center justify-center bg-active/70 group-hover/block:bg-border flex-shrink-0">
                          <Icon size={11} className="text-comment group-hover/block:text-text" />
                        </div>

                        {/* Text content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 min-w-0">
                            <span className="text-[11px] font-medium text-text/80 group-hover/block:text-text leading-tight truncate">
                              {label}
                            </span>
                            {block.rowCount !== undefined && block.rowCount > 0 && (
                              <span className="text-[9px] text-comment/50 bg-active px-1 py-px rounded flex-shrink-0 font-mono leading-tight">
                                {block.rowCount}
                              </span>
                            )}
                          </div>
                          {block.preview && (
                            <span className="text-[10px] text-comment/55 truncate block leading-snug mt-0.5">
                              {block.preview}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {/* Empty placeholder */}
                  {!section.methodText && !section.urlText && section.blocks.length === 0 && (
                    <p className="px-2 py-1.5 text-[10px] text-comment/40 italic">Empty</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BlockOverviewPanel;
