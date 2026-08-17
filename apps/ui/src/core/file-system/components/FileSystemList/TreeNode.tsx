import React, { useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CopyMinus, CopyPlus } from "lucide-react";
import { NodeApi, NodeRendererProps, TreeApi } from "react-arborist";
const INHERITED_FILENAME = ".voiden-inherited.void";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";
import { useActivateTab } from "@/core/layout/hooks";
import { useFocusStore } from "@/core/stores/focusStore";
import { DragOverContext, TreeActionsContext } from "./contexts";
import { ExtendedFileTree } from "./types";
import { getFileIcon } from "./fileIcon";
import { getGitStatusClass } from "./gitStatus";
import { RenameInput } from "./RenameInput";
import { useTreeNodeMutations } from "./useTreeNodeMutations";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { getSchema } from "@tiptap/core";
import { voidenExtensions } from "@/core/editors/voiden/extensions";
import { prosemirrorToMarkdown } from "@/core/file-system/hooks";
import { useEditorEnhancementStore } from "@/plugins";
import { confirmAndSaveTab } from "@/core/stores/unsavedChangesDialogStore";

export interface TreeNodeProps extends NodeRendererProps<ExtendedFileTree> {
  activeFile: { source: string } | null;
  removeTemporaryNode: (nodeId: string) => void;
  onFolderToggle: (node: NodeApi<ExtendedFileTree>) => void;
  refreshDir: (dirPath: string) => Promise<void>;
  expandedDirsRef: React.MutableRefObject<Set<string>>;
  treeRef: React.RefObject<TreeApi<ExtendedFileTree>>;
  pendingTabsEnabled?: boolean;
}

// Whether any folder anywhere below `node` is currently open — used to decide
// which of the alternating expand-all/collapse-all icons to show. Computed
// fresh from the tree's real state every render (react-arborist re-renders
// every row on any open/close change) instead of tracked as local state, so
// it can't drift out of sync with folders opened/closed by other means (e.g.
// clicking a nested folder's own chevron directly).
function hasOpenDescendant(node: NodeApi<ExtendedFileTree>): boolean {
  if (!node.children) return false;
  for (const child of node.children) {
    if (child.data.type !== "folder") continue;
    if (child.isOpen) return true;
    if (hasOpenDescendant(child)) return true;
  }
  return false;
}

const isInternalTreeDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("application/x-arborist-node");
const isExternalFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files") && !isInternalTreeDrag(e);
const isKnownFileSystemDrag = (e: React.DragEvent) => isInternalTreeDrag(e) || isExternalFileDrag(e);

function getNameClass(data: ExtendedFileTree, activeFile: { source: string } | null): string {
  if (activeFile?.source === data.path && !data.git) {
    return "";
  }
  if (data.type === "file") {
    if (data.git) {
      return getGitStatusClass(data.git);
    }
    return "";
  }
  if (data.type === "folder") {
    if (data.aggregatedGitStatus) {
      return getGitStatusClass(data.aggregatedGitStatus);
    }
    return "";
  }
  return "";
}

export function TreeNode({
  node,
  style,
  dragHandle,
  activeFile,
  removeTemporaryNode,
  onFolderToggle,
  refreshDir,
  expandedDirsRef,
  treeRef,
  pendingTabsEnabled,
}: TreeNodeProps) {
  const [error, setError] = useState<string | null>(null);
  // Bumped after this row's own expand-all/collapse-all action finishes, to
  // force a re-render that recomputes hasOpenDescendant(node) below. Nested
  // .open()/.close() calls several levels down don't reliably propagate a
  // re-render back up to this specific row on their own, so without this the
  // icon (and the branch its onClick reads) can stay stuck on stale state.
  const [, forceRerender] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragOverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const { dragOverParentId, setDragOverParentId } = useContext(DragOverContext);
  const { expandAllRecursive, collapseAllFromFolder } = useContext(TreeActionsContext);
  const setIsRenaming = useFocusStore((state) => state.setIsRenaming);
  const { mutate: activateTab } = useActivateTab();
  const queryClient = useQueryClient();

  const isInternalDropTargetFolder = node.data.type === "folder" && Boolean(node.willReceiveDrop);

  const {
    createFileMutation,
    createVoidFileMutation,
    createDirectoryMutation,
    renameMutation,
    dropFilesMutation,
  } = useTreeNodeMutations({
    node,
    setError,
    refreshDir,
    expandedDirsRef,
    treeRef,
    onFolderToggle,
  });

  useEffect(() => {
    if (!isInternalDropTargetFolder) return;
    setIsDragOver(true);
    setDragOverParentId(null);
    if (!node.isOpen && !dragOverTimerRef.current) {
      dragOverTimerRef.current = setTimeout(() => {
        dragOverTimerRef.current = null;
        if (!node.isOpen) onFolderToggle(node);
      }, 800);
    }
  }, [isInternalDropTargetFolder, node, setDragOverParentId, onFolderToggle]);

  useEffect(() => {
    return () => {
      if (dragOverTimerRef.current) {
        clearTimeout(dragOverTimerRef.current);
        dragOverTimerRef.current = null;
      }
    };
  }, []);

  const onSubmit = async (newName: string) => {
    setIsRenaming(false);

    if (node.data.isTemporary) {
      if (!newName || newName.trim() === "") {
        removeTemporaryNode(node.id);
        return;
      }
      if (node.parent) {
        const siblings = node.parent.children || [];
        const effectiveName = node.data.fileKind === "void" ? `${newName}.void` : newName;
        const duplicate = siblings.find((sibling) => sibling.id !== node.id && sibling.data.name === effectiveName);
        if (duplicate) {
          setError("Name already exists");
          node.edit();
          setIsRenaming(true);
          return;
        }
      }
      if (node.data.type === "folder") {
        createDirectoryMutation.mutate(newName);
      } else if (node.data.fileKind === "void") {
        createVoidFileMutation.mutate(newName);
      } else {
        createFileMutation.mutate(newName);
      }
      return;
    }

    if (newName === node.data.name) {
      node.reset();
      return;
    }

    if (node.parent) {
      const siblings = node.parent.children || [];
      const duplicate = siblings.find((sibling) => sibling.id !== node.id && sibling.data.name === newName);
      if (duplicate) {
        setError("Name already exists");
        node.edit();
        setIsRenaming(true);
        return;
      }
    }

    renameMutation.mutate({ oldPath: node.data.path, newName });
  };

  const handleDrop = async (e: React.DragEvent) => {
    setIsDragOver(false);
    setDragOverParentId(null);
    if (dragOverTimerRef.current) {
      clearTimeout(dragOverTimerRef.current);
      dragOverTimerRef.current = null;
    }

    if (!isExternalFileDrag(e)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    let targetFolder: NodeApi<ExtendedFileTree> = node;
    let targetPath = node.data.path;

    if (node.data.type === "file") {
      if (node.parent) {
        targetFolder = node.parent;
        targetPath = node.parent.data.path;
      }
    }

    const regularFiles: File[] = [];
    const folderPaths: string[] = [];

    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        const file = item.getAsFile() as (File & { path?: string }) | null;
        if (file?.path) {
          folderPaths.push(file.path);
        }
      } else {
        const file = item.getAsFile();
        if (file) regularFiles.push(file);
      }
    }

    try {
      if (regularFiles.length > 0) {
        await dropFilesMutation.mutateAsync({ files: regularFiles, targetPath });
      }

      for (const folderPath of folderPaths) {
        const result = await window.electron?.files.dropFolder(targetPath, folderPath);
        if (result && !result.success) {
          throw new Error(result.error ?? `Failed to drop folder "${folderPath}"`);
        }
      }

      if (folderPaths.length > 0) {
        await refreshDir(targetPath);
        await queryClient.invalidateQueries({ queryKey: ["env"] });
      }

      if (targetFolder.data.type === "folder" && !targetFolder.isOpen) {
        targetFolder.open();
      }
    } catch (err) {
      console.error("Failed to drop items:", err);
    }
  };

  const isSiblingHighlight = dragOverParentId === node.parent?.id;

  const handleDragOver = (e: React.DragEvent) => {
    if (!isKnownFileSystemDrag(e)) {
      return;
    }

    if (isInternalTreeDrag(e)) {
      if (node.data.type !== "folder") {
        return;
      }

      setIsDragOver(true);
      setDragOverParentId(null);

      if (!node.isOpen && !dragOverTimerRef.current) {
        dragOverTimerRef.current = setTimeout(() => {
          dragOverTimerRef.current = null;
          if (!node.isOpen) onFolderToggle(node);
        }, 800);
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    setIsDragOver(true);

    let parentId = null;
    if (node.data.type === "folder") {
      parentId = node.id;
    } else if (node.parent) {
      parentId = node.parent.id;
    }

    setDragOverParentId(parentId);

    if (node.data.type === "folder" && !node.isOpen && !dragOverTimerRef.current) {
      dragOverTimerRef.current = setTimeout(() => {
        dragOverTimerRef.current = null;
        if (!node.isOpen) onFolderToggle(node);
      }, 800);
    } else if (node.data.type === "folder") {
      const closeAllDescendants = (parentNode: typeof node) => {
        if (!parentNode.children) return;
        parentNode.children.forEach((child) => {
          if (child.data.type === "folder" && child.isOpen) {
            child.close();
            closeAllDescendants(child);
          }
        });
      };
      closeAllDescendants(node);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isKnownFileSystemDrag(e)) {
      return;
    }

    if (isExternalFileDrag(e)) {
      e.preventDefault();
      e.stopPropagation();
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
      setDragOverParentId(null);

      if (dragOverTimerRef.current) {
        clearTimeout(dragOverTimerRef.current);
        dragOverTimerRef.current = null;
      }
    }
  };

  const getTabTitle = () => {
    const isInherited = node.data.name === INHERITED_FILENAME;
    if (isInherited) {
      const parts = node.data.path.replace(/\\/g, "/").split("/");
      const folderName = parts[parts.length - 2] ?? "inherited";
      return `${folderName} — inherited`;
    }
    return node.data.name;
  };

  const handleSelect = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.shiftKey) {
      node.selectContiguous();
    } else if (event.metaKey || event.ctrlKey) {
      node.selectMulti();
    } else {
      node.select();
      if (node.data.type === "file") {
        if (pendingTabsEnabled) {
          const panelData = queryClient.getQueryData<{ tabs: Array<{ id: string; title: string; pending?: boolean; source: string | null }>; activeTabId: string }>(["panel:tabs", "main"]);
          const existingPendingTab = panelData?.tabs?.find(t => t.pending);
          if (existingPendingTab && existingPendingTab.source !== node.data.path) {
            const unsavedContent = useEditorStore.getState().unsaved[existingPendingTab.id];
            if (unsavedContent) {
              let contentToSave = unsavedContent;
              if (existingPendingTab.source && existingPendingTab.source.endsWith(".void")) {
                const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
                contentToSave = prosemirrorToMarkdown(unsavedContent, schema);
              }
              const proceed = await confirmAndSaveTab(existingPendingTab, existingPendingTab.id, contentToSave);
              if (!proceed) return;
            }
          }
        }

        const newTab = {
          id: crypto.randomUUID(),
          type: "document" as const,
          title: getTabTitle(),
          source: node.data.path,
          directory: null,
          pending: pendingTabsEnabled ? true : undefined,
        };

        try {
          const { tabId = null } = (await window.electron?.state.addPanelTab("main", newTab)) ?? {};
          if (tabId) {
            activateTab({ panelId: "main", tabId });
          }
        } catch {
          // ignore
        }
      } else {
        onFolderToggle(node);
      }
    }
  };

  const handleDoubleClick = async (_event: React.MouseEvent<HTMLDivElement>) => {
    if (node.data.type !== "file") return;
    // Open as permanent (no pending flag) — promotes any existing pending tab
    const newTab = {
      id: crypto.randomUUID(),
      type: "document" as const,
      title: getTabTitle(),
      source: node.data.path,
      directory: null,
    };
    try {
      const { tabId = null } = (await window.electron?.state.addPanelTab("main", newTab)) ?? {};
      if (tabId) {
        activateTab({ panelId: "main", tabId });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!isContextMenuOpen) return;
    const reset = () => setIsContextMenuOpen(false);
    window.addEventListener("mousedown", reset, { once: true });
    return () => {
      window.removeEventListener("mousedown", reset);
    };
  }, [isContextMenuOpen]);

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsContextMenuOpen(true);

    if (!node.isSelected) {
      node.select();
    }
    const selectedNodes = node.tree.selectedNodes;
    if (selectedNodes.length > 1) {
      window.electron?.files.showBulkDeleteMenu(
        selectedNodes.map((n) => ({
          path: n.data.path,
          type: n.data.type,
          name: n.data.name,
        })),
      );
    } else {
      window.electron?.files.showFileContextMenu({
        path: node.data.path,
        type: node.data.type,
        name: node.data.name,
        isProjectRoot: node.level === 0,
      });
    }
  };

  const nameClass = getNameClass(node.data, activeFile);
  const showCollapseAll = node.data.type === "folder" && hasOpenDescendant(node);
  const isRangeSelected = node.isSelected && node.tree.selectedNodes.length > 1;

  return (
    <div
      style={style}
      ref={dragHandle}
      className={cn(
        "group h-[22px] overflow-hidden transition-colors border border-transparent",
        !isDragOver && !node.isSelected && "hover:bg-hover",
        isContextMenuOpen && "border-active",
        // Selection stays visible (background) even after focus moves away
        // (e.g. clicking into the editor) — a border is added only while
        // this row is still the actually-focused selection, so the two
        // states ("selected" vs "selected AND focused") read differently,
        // matching Cursor's sidebar.
        node.isSelected && !isRangeSelected && !isDragOver && "bg-active",
        node.isSelected && !isRangeSelected && node.isFocused && !isDragOver && "border-border",
        isRangeSelected && !isDragOver && "bg-accent/20",
        node.isFocused && !isDragOver && "ring-0",
        (isDragOver || isInternalDropTargetFolder) && `bg-accent/30 ${node.data.type === "folder" ? "border-l-2 border-accent" : ""}`,
        isSiblingHighlight && !isDragOver && !isInternalDropTargetFolder && "bg-accent/30 hover:bg-accent/30",
      )}
      onClick={handleSelect}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="absolute left-0 h-full">
        {Array.from({ length: node.level }).map((_, i) => (
          <div key={i} className="absolute w-px bg-active h-[22px]" style={{ left: `${(i + 1) * 12 + 3}px` }} />
        ))}
      </div>
      <div className="pl-2 relative flex items-center justify-between gap-2">
        <div className={`flex items-center min-w-0 flex-1 ${node.data.type === "folder" ? "gap-1" : "gap-2"}`}>
          {node.data.type === "folder" && (
            <div className="w-30 flex items-center">
              {/* Chevron rotates whenever folder is open, including empty folders */}
              <ChevronRight size={14} className={`transition-transform ${node.isOpen ? "rotate-90" : ""}`} />
            </div>
          )}
          <div className="w-30">{node.data.type !== "folder" && getFileIcon(node.data.name, node.data.path)}</div>
          {node.isEditing ? (
            <RenameInput node={node} error={error} setError={setError} onSubmit={onSubmit} setIsRenaming={setIsRenaming} />
          ) : node.data.name === INHERITED_FILENAME ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={cn("truncate text-comment text-[11px]", nameClass)}>Config Inheritance</span>
              <span className="flex-shrink-0 text-[9px] px-1 py-px rounded font-medium leading-none" style={{ backgroundColor: 'var(--ui-line)', color: 'var(--syntax-comment)' }}>
                inherited
              </span>
            </span>
          ) : (
            <span className={cn("truncate text-ui-fg font-normal opacity-75", nameClass)}>{node.data.name}</span>
          )}
        </div>
        {node.data.type === "folder" && (
          <div className="flex items-center flex-shrink-0 px-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
            <Tip label={showCollapseAll ? "Collapse all" : "Expand all"} side="bottom" align="end">
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (showCollapseAll) {
                    await collapseAllFromFolder(node);
                  } else {
                    await expandAllRecursive(node.data.path);
                  }
                  forceRerender((n) => n + 1);
                }}
                className="p-0.5 rounded hover:bg-hover ml-1"
              >
                {showCollapseAll ? <CopyMinus size={12} /> : <CopyPlus size={12} />}
              </button>
            </Tip>
          </div>
        )}
      </div>
    </div>
  );
}
