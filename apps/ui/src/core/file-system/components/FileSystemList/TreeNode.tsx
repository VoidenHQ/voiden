import React, { useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { NodeApi, NodeRendererProps, TreeApi } from "react-arborist";
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

export interface TreeNodeProps extends NodeRendererProps<ExtendedFileTree> {
  activeFile: { source: string } | null;
  removeTemporaryNode: (nodeId: string) => void;
  onFolderToggle: (node: NodeApi<ExtendedFileTree>) => void;
  refreshDir: (dirPath: string) => Promise<void>;
  expandedDirsRef: React.MutableRefObject<Set<string>>;
  treeRef: React.RefObject<TreeApi<ExtendedFileTree>>;
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
}: TreeNodeProps) {
  const [error, setError] = useState<string | null>(null);
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

  const handleSelect = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.shiftKey) {
      node.selectContiguous();
    } else if (event.metaKey || event.ctrlKey) {
      node.selectMulti();
    } else {
      node.select();
      if (node.data.type === "file") {
        const newTab = {
          id: crypto.randomUUID(),
          type: "document" as const,
          title: node.data.name,
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
      } else {
        onFolderToggle(node);
      }
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

  return (
    <div
      style={style}
      ref={dragHandle}
      className={cn(
        "group h-6 overflow-hidden transition-colors border border-transparent",
        !isDragOver && activeFile?.source !== node.data.path && !node.isSelected && "hover:bg-hover",
        isContextMenuOpen && "border-active",
        activeFile?.source === node.data.path && !isDragOver && "bg-active",
        node.isSelected && node.tree.selectedNodes.length > 1 && activeFile?.source !== node.data.path && !isDragOver && "bg-accent/20",
        node.isFocused && !isDragOver && "ring-0",
        (isDragOver || isInternalDropTargetFolder) && `bg-accent/30 ${node.data.type === "folder" ? "border-l-2 border-accent" : ""}`,
        isSiblingHighlight && !isDragOver && !isInternalDropTargetFolder && "bg-accent/30 hover:bg-accent/30",
      )}
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="absolute left-0 h-full">
        {Array.from({ length: node.level }).map((_, i) => (
          <div key={i} className="absolute w-px bg-active h-6" style={{ left: `${(i + 1) * 12 + 3}px` }} />
        ))}
      </div>
      <div className="pl-2 relative flex items-center justify-between gap-2">
        <div className={`flex items-center ${node.data.type === "folder" ? "gap-1" : "gap-2"} w-full`}>
          {node.data.type === "folder" && (
            <div className="w-30 flex items-center">
              {/* Chevron rotates whenever folder is open, including empty folders */}
              <ChevronRight size={14} className={`transition-transform ${node.isOpen ? "rotate-90" : ""}`} />
            </div>
          )}
          <div className="w-30">{node.data.type !== "folder" && getFileIcon(node.data.name, node.data.path)}</div>
          {node.isEditing ? (
            <RenameInput node={node} error={error} setError={setError} onSubmit={onSubmit} setIsRenaming={setIsRenaming} />
          ) : (
            <span className={cn("truncate text-ui-fg", nameClass)}>{node.data.name}</span>
          )}
        </div>
        {node.data.type === "folder" && (
          <div className="flex items-center px-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
            <Tip label="Collapse all" side="bottom" align="end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  collapseAllFromFolder(node);
                }}
                className="p-0.5 rounded hover:bg-hover ml-1"
              >
                <ChevronsDownUp size={12} />
              </button>
            </Tip>
            <Tip label="Expand all" side="bottom" align="end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  expandAllRecursive(node.data.path);
                }}
                className="p-0.5 rounded hover:bg-hover"
              >
                <ChevronsUpDown size={12} />
              </button>
            </Tip>
          </div>
        )}
      </div>
    </div>
  );
}
