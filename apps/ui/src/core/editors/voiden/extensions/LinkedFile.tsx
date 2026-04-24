import React, { useEffect, useMemo, useRef, useState } from "react";
import { Editor, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes } from "@tiptap/react";
import { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Link2, Play, Unlink } from "lucide-react";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";
import { proseClasses, useVoidenExtensionsAndSchema } from "@/core/editors/voiden/VoidenEditor";
import { FindHighlightExtension, findHighlightPluginKey } from "@/core/editors/voiden/search/findHighlight";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { useShallow } from "zustand/react/shallow";
import { openFile } from "./ExternalFile";
import { LinkedFilePmNodePosContext } from "./linkedFileContext";
import { getBlocksForSection } from "@/core/editors/voiden/utils/expandLinkedBlocks";
import { Tip } from "@/core/components/ui/Tip";
import { useSendRestRequest } from "@/core/request-engine/hooks";

// Read-only editor that renders an entire file's worth of blocks.
function FilePreviewEditor({ blocks, pmNodePos }: { blocks: JSONContent[]; pmNodePos?: number }) {
  const { finalExtensions } = useVoidenExtensionsAndSchema();
  const { term, matchCase, matchWholeWord, useRegex, currentLinkedPmNodePos, currentLinkedBlockUid, currentLinkedLocalIndex } = useSearchStore(useShallow((s) => ({
    term: s.term,
    matchCase: s.matchCase,
    matchWholeWord: s.matchWholeWord,
    useRegex: s.useRegex,
    currentLinkedPmNodePos: s.currentLinkedPmNodePos,
    currentLinkedBlockUid: s.currentLinkedBlockUid,
    currentLinkedLocalIndex: s.currentLinkedLocalIndex,
  })));
  const isCurrent = pmNodePos !== undefined && currentLinkedPmNodePos === pmNodePos && currentLinkedBlockUid === null;

  const previewExtensions = useMemo(
    () => [...finalExtensions.filter((ext) => ext?.name !== "seamlessNavigation"), FindHighlightExtension],
    [finalExtensions],
  );

  const editor = useEditor(
    {
      content: blocks.length > 0 ? { type: "doc", content: blocks } : "",
      extensions: previewExtensions,
      editorProps: { attributes: { class: proseClasses } },
      editable: false,
    },
    [blocks, previewExtensions],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(findHighlightPluginKey, {
        term,
        matchCase,
        matchWholeWord,
        useRegex,
        currentMatch: isCurrent ? currentLinkedLocalIndex : -1,
      }),
    );
  }, [editor, term, matchCase, matchWholeWord, useRegex, isCurrent, currentLinkedLocalIndex]);

  return (
    <LinkedFilePmNodePosContext.Provider value={pmNodePos}>
      <div className="w-full">
        <EditorContent editor={editor} />
      </div>
    </LinkedFilePmNodePosContext.Provider>
  );
}

// Fetch and parse the linked file into an array of blocks.
// When sectionUid is non-null, only blocks for that section are returned.
const useGetLinkedFileBlocks = (originalFile: string, sectionUid: string | null, editor: Editor) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["voiden-wrapper:linkedFileContent", originalFile, sectionUid],
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<JSONContent[]> => {
      const projects = queryClient.getQueryData<{
        projects: { path: string; name: string }[];
        activeProject: string;
      }>(["projects"]);
      const activeProject = projects?.activeProject;
      if (!activeProject || !originalFile) {
        throw new Error(`No active project for linked file: ${originalFile}`);
      }
      const absolutePath = await window.electron?.utils?.pathJoin(activeProject, originalFile);
      if (!absolutePath) throw new Error(`No absolute path for: ${originalFile}`);
      const markdown = await window.electron?.voiden?.getBlockContent(absolutePath);
      if (typeof markdown !== "string") {
        throw new Error(`No content returned for: ${originalFile}`);
      }
      // Empty file — return no blocks (not an error)
      if (markdown.trim() === "") return [];
      const parsed = parseMarkdown(markdown, editor.schema);
      const allBlocks = parsed?.content ?? [];
      if (sectionUid !== null) {
        return getBlocksForSection(allBlocks, sectionUid);
      }
      return allBlocks;
    },
  });
};

const LinkedFileNodeView = ({ node, editor, getPos }: any) => {
  const { originalFile, sectionUid } = node.attrs;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const queryClient = useQueryClient();
  const nodeRef = useRef<HTMLDivElement>(null);
  const { runSection } = useSendRestRequest(editor);

  const fileName = originalFile?.split("/").pop() || "Unknown file";

  const { data: blocks, isLoading, error } = useGetLinkedFileBlocks(originalFile, sectionUid ?? null, editor);

  const handleGoToOriginal = async (e: React.MouseEvent) => {
    e.preventDefault();
    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;
    if (!activeProject || !originalFile) return;
    const absolutePath = await window.electron?.utils?.pathJoin(activeProject, originalFile);
    if (!absolutePath) return;
    openFile(absolutePath, fileName);
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    // Count separators before this node's ProseMirror position — more reliable
    // than DOM walking since atom nodes may have extra wrapper elements.
    const nodePos = getPos();
    let sectionIndex = 0;
    editor.state.doc.forEach((child: any, offset: number) => {
      if (child.type.name === "request-separator" && offset < nodePos) {
        sectionIndex++;
      }
    });
    runSection(sectionIndex);
  };

  const handleUnlink = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!blocks || blocks.length === 0) return;
    const pos = getPos();
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, blocks)
      .run();
  };

  if (error || (!blocks && !isLoading)) {
    return (
      <NodeViewWrapper className="my-3">
        <div className="rounded-md border overflow-hidden" style={{ borderColor: "var(--ui-line)" }}>
          <div className="h-8 px-3 flex items-center gap-2 bg-red-500/10 border-b border-red-500/30">
            <Link2 size={12} style={{ color: "var(--icon-error)" }} />
            <span className="text-xs text-red-600">Cannot load linked file: {fileName}</span>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false} ref={nodeRef}>
      <div className="rounded-md border overflow-hidden" style={{ borderColor: "var(--ui-line)" }}>
        {/* Header bar */}
        <div
          className="h-8 px-3 flex items-center justify-between border-b bg-accent/5"
          style={{ borderColor: "var(--ui-line)", userSelect: "none" }}
          contentEditable={false}
        >
          {/* Left: icon + label + filename link */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Link2 size={12} className="text-text opacity-50 shrink-0" />
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text opacity-60 shrink-0">
              Imported:
            </span>
            <button
              onClick={handleGoToOriginal}
              className="text-xs text-accent hover:text-text transition-colors hover:underline truncate"
              title={`Go to source: ${originalFile}`}
            >
              {fileName}
            </button>
          </div>

          {/* Right: unlink + collapse */}
          <div className="flex items-center gap-1 shrink-0">
            <Tip label="Unlink — inline all blocks locally">
              <button
                onClick={handleUnlink}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-hover text-comment hover:text-text transition-colors"
              >
                <Unlink size={12} />
              </button>
            </Tip>
            <Tip label="Run section requests">
              <button
                onClick={handlePlay}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-hover text-status-success transition-colors"
              >
                <Play size={12} />
              </button>
            </Tip>
            <Tip label={isCollapsed ? "Expand" : "Collapse"}>
              <button
                onClick={() => setIsCollapsed((v) => !v)}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-hover transition-colors"
                style={{ color: "var(--text)", opacity: 1 }}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            </Tip>
          </div>
        </div>

        {/* File content (collapsible) */}
        {!isCollapsed && (
          <div className="px-2">
            {isLoading ? (
              <div className="p-3 text-xs text-comment flex items-center justify-center">
                Loading {fileName}…
              </div>
            ) : blocks && blocks.length > 0 ? (
              <FilePreviewEditor blocks={blocks} pmNodePos={getPos()} />
            ) : null}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const LinkedFile = Node.create({
  name: "linkedFile",

  group: "block",

  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      uid: { default: null },
      originalFile: { default: null },
      sectionUid: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-linked-file]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        {
          "data-linked-file": "",
          "data-original-file": node.attrs.originalFile,
          class: "linked-file-container",
        },
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkedFileNodeView);
  },
});
