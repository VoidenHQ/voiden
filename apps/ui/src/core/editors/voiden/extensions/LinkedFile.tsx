import React, { useMemo, useState } from "react";
import { Editor, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes } from "@tiptap/react";
import { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";
import { proseClasses, useVoidenExtensionsAndSchema } from "@/core/editors/voiden/VoidenEditor";
import { openFile } from "./ExternalFile";
import { getBlocksForSection } from "@/core/editors/voiden/utils/expandLinkedBlocks";
import { Tip } from "@/core/components/ui/Tip";

// Read-only editor that renders an entire file's worth of blocks.
function FilePreviewEditor({ blocks }: { blocks: JSONContent[] }) {
  const { finalExtensions } = useVoidenExtensionsAndSchema();

  const previewExtensions = useMemo(
    () => finalExtensions.filter((ext) => ext?.name !== "seamlessNavigation"),
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

  return (
    <div className="w-full">
      <EditorContent editor={editor} />
    </div>
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
      if (!markdown || typeof markdown !== "string") {
        throw new Error(`No content returned for: ${originalFile}`);
      }
      const parsed = parseMarkdown(markdown, editor.schema);
      const allBlocks = parsed?.content ?? [];
      if (sectionUid !== null) {
        return getBlocksForSection(allBlocks, sectionUid);
      }
      return allBlocks;
    },
  });
};

const LinkedFileNodeView = ({ node, editor }: any) => {
  const { originalFile, sectionUid } = node.attrs;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const queryClient = useQueryClient();

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

  if (error || (!blocks && !isLoading)) {
    return (
      <NodeViewWrapper className="my-3">
        <div
          className="flex items-center gap-1.5 px-3 text-xs"
          style={{ color: "var(--status-error, #ef4444)" }}
        >
          <Link2 size={11} />
          <span>Cannot load linked file: {fileName}</span>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-1" contentEditable={false}>
      {/* Separator-styled header */}
      <div
        className="flex items-center gap-2"
        style={{ margin: "24px 0 0", userSelect: "none" }}
        contentEditable={false}
      >
        <div
          style={{
            flex: 1,
            height: "2px",
            backgroundColor: "var(--ui-line, #555)",
            opacity: 0.35,
            borderRadius: "1px",
          }}
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <Link2 size={11} className="opacity-50" style={{ color: "var(--text)" }} />

          <button
            onClick={handleGoToOriginal}
            className="text-[10px] font-bold tracking-widest uppercase hover:underline transition-colors"
            style={{ color: "var(--text)", opacity: 0.6 }}
            title={`Go to source: ${originalFile}`}
          >
            {fileName}
          </button>

          <Tip label={isCollapsed ? "Expand" : "Collapse"}>
            <button
              onClick={() => setIsCollapsed((v) => !v)}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-hover transition-colors"
              style={{ color: "var(--text)", opacity: 0.5 }}
            >
              {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            </button>
          </Tip>
        </div>

        <div
          style={{
            flex: 1,
            height: "2px",
            backgroundColor: "var(--ui-line, #555)",
            opacity: 0.35,
            borderRadius: "1px",
          }}
        />
      </div>

      {/* File content (collapsible) */}
      {!isCollapsed && (
        <div className="mt-1">
          {isLoading ? (
            <div className="p-2 text-xs text-comment flex items-center justify-center">
              Loading {fileName}…
            </div>
          ) : blocks && blocks.length > 0 ? (
            <FilePreviewEditor blocks={blocks} />
          ) : null}
        </div>
      )}
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
