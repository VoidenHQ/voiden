import React, { useEffect, useReducer, useRef } from "react";
import { Editor, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes } from "@tiptap/react";
import { BlockPreviewEditor, openFile } from "./ExternalFile";
import { useBlockContentStore } from "@/core/stores/blockContentStore";
import { Tip } from "@/core/components/ui/Tip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";
import { useElectronEvent } from "@/core/providers";
import { useSendRestRequest } from "@/core/request-engine/hooks";
import { Link2, Unlink, Play } from "lucide-react";

// Helper to recursively find a block by uid.
const findBlockByUid = (nodes: any[], blockUid: string): any | null => {
  for (const node of nodes) {
    if (node.attrs && node.attrs.uid === blockUid) return node;
    if (node.content && Array.isArray(node.content)) {
      const result = findBlockByUid(node.content, blockUid);
      if (result) return result;
    }
  }
  return null;
};

const useGetBlockContent = (blockUid: string, originalFile: string, editor: Editor) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["voiden-wrapper:blockContent", originalFile, blockUid],
    refetchOnMount: true,         // Refetch when tab is focused/mounted
    refetchOnWindowFocus: false,  // Don't refetch on window focus (only tab focus)
    refetchOnReconnect: false,    // Don't refetch on network reconnect
    staleTime: 0,                 // Always consider stale so refetchOnMount works
    gcTime: 10 * 60 * 1000,       // Keep in cache for 10 minutes
    retry: false,
    queryFn: async () => {
      const projects = queryClient.getQueryData<{
        projects: { path: string; name: string }[];
        activeProject: string;
      }>(["projects"]);
      const activeProject = projects?.activeProject;
      if (!activeProject || !originalFile) {
        throw new Error(`No active project or original file for block uid: ${blockUid}`);
      }
      const absolutePath = await window.electron?.utils.pathJoin(activeProject, originalFile);
      if (!absolutePath) {
        throw new Error(`No absolute path for block uid: ${blockUid}`);
      }
      const markdown = await window.electron?.voiden.getBlockContent(absolutePath);
      if (!markdown) {
        throw new Error(`No markdown returned for block uid: ${blockUid}`);
      }
      const nodes = parseMarkdown(markdown, editor.schema);
      const block = findBlockByUid(nodes.content, blockUid);
      if (!block) {
        throw new Error(`Block with uid ${blockUid} not found`);
      }
      // Update central store.
      useBlockContentStore.getState().setBlock(blockUid, block);
      return block;
    },
  });
};

// Note: We now accept "getPos" from TipTap's NodeView props.
const LinkedBlockNodeView = ({ node, editor, getPos }: any) => {
  const { blockUid, originalFile, type } = node.attrs;
  const queryClient = useQueryClient();
  const removeBlock = useBlockContentStore((state) => state.removeBlock);
  const nodeRef = useRef<HTMLDivElement>(null);
  const { refetchFromElement } = useSendRestRequest(editor);

  // Force a re-render of this node view whenever the query state changes.
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // Clear the block from the store when it's deleted.
  useElectronEvent<{ uid: string }>("block:delete", (data) => {
    if (data.uid === blockUid) {
      removeBlock(data.uid);
      queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent", originalFile, blockUid] });
    }
  });

  // Get block content via React Query.
  // isLoading = true only for initial load, not background refetches
  const { data: content, isLoading, error } = useGetBlockContent(blockUid, originalFile, editor);

  // Force an update whenever the query's error or data changes.
  useEffect(() => {
    // forceUpdate();
  }, [error, content]);

  const handleGoToOriginal = async (e: React.MouseEvent) => {
    e.preventDefault();
    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;

    if (!activeProject || !originalFile) {
      return;
    }

    const absolutePath = await window.electron?.utils.pathJoin(activeProject, originalFile);
    if (!absolutePath) {
      return;
    }

    // Extract filename from the original file path
    const fileName = originalFile.split('/').pop() || originalFile;

    // Use the same IPC method as go to file.
    openFile(absolutePath, fileName);
  };

  // The unlink handler replaces the current linked block node with its actual content.
  const handleUnlink = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!content) return;
    // Retrieve the current node position.
    const pos = getPos();
    // Replace the linked block with its actual content.
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, content)
      .run();
  };

  const fileName = originalFile?.split('/').pop() || 'Unknown file';

  // Show error state
  if (error || (!content && !isLoading)) {
    return (
      <NodeViewWrapper className="group flex flex-col rounded-md mb-3 relative border-l-2 border-l-red-500 overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1 bg-red-500/10 border border-red-500/30 border-l-0">
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <Link2 size={12} style={{ color: 'var(--icon-error)' }} />
            <span>Missing or outdated block</span>
          </div>
        </div>
        <div className="p-2 bg-bg/50 border border-t-0 border-red-500/30 border-l-0 text-xs text-red-600">
          Block UID: {blockUid}
        </div>
      </NodeViewWrapper>
    );
  }

  // Show loading state only for initial load
  if (isLoading) {
    return (
      <NodeViewWrapper className="my-2">
        <div className="p-2 flex items-center justify-center text-xs text-comment">
          Loading imported block...
        </div>
      </NodeViewWrapper>
    );
  }

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    if (nodeRef.current) {
      refetchFromElement(nodeRef.current);
    }
  };

  // All linked blocks get the same header with unlink button
  return (
    <NodeViewWrapper className="my-3" ref={nodeRef}>
      <div className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--ui-line)' }}>
        {/* Header bar with "IMPORTED" label and clickable filename */}
        <div className="h-8 px-3 flex items-center justify-between border-b bg-accent/5" style={{ borderColor: 'var(--ui-line)' }}>
          <div className="flex items-center gap-2 flex-1">
            <Link2 size={12} className="text-text opacity-50" />
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text opacity-60">Imported:</span>
            <button
              onClick={handleGoToOriginal}
              className="text-xs text-accent hover:text-text transition-colors hover:underline"
              title={`Go to source: ${originalFile}`}
            >
              {fileName}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <Tip label="Unlink to edit locally">
              <button
                onClick={handleUnlink}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-hover text-comment hover:text-text transition-colors"
              >
                <Unlink size={12} />
              </button>
            </Tip>
            <Tip label="Run request">
              <button
                onClick={handlePlay}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-hover text-status-success transition-colors"
              >
                <Play size={12} />
              </button>
            </Tip>
          </div>
        </div>

        {/* Block content */}
        <BlockPreviewEditor block={content!} />
      </div>
    </NodeViewWrapper>
  );
};

export const LinkedBlock = Node.create({
  name: "linkedBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      blockUid: { default: null },
      originalFile: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-linked-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        {
          "data-linked-block": "",
          "data-block-uid": node.attrs.blockUid,
          class: "linked-block-container",
        },
        HTMLAttributes,
      ),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LinkedBlockNodeView);
  },
});
