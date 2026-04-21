import React, { useState, useRef, useEffect, useLayoutEffect, useContext, useCallback } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}
import { NodeRendererProps, Tree, NodeApi, TreeApi } from "react-arborist";
import { Tip } from "@/core/components/ui/Tip";
import {
  Infinity,
  FileText,
  FileSpreadsheet,
  Image,
  Braces,
  Container,
  GitBranch,
  Info,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File,
  Loader,
  Settings2,
  FileCode,
  Database,
  X,
  Type,
  Hash,
} from "lucide-react";
import { cn } from "@/core/lib/utils";
import { FileTree } from "@/types";
import type { SearchResult } from "@/types";
import { useFileTree, useMove, usePrefetchFileList } from "@/core/file-system/hooks";
import { useEditorStore, reloadVoidenEditor } from "@/core/editors/voiden/VoidenEditor";
import { toast } from "@/core/components/ui/sonner";
import useResizeObserver from "use-resize-observer";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActivateTab, useBottomPanel } from "@/core/layout/hooks";
import { useGetActiveDocument } from "@/core/documents/hooks";
import { useGetAppState } from "@/core/state/hooks";
import { useOpenProject, useCloseActiveProject } from "@/core/projects/hooks";
import { useElectronEvent } from "@/core/providers";
import { useFocusStore } from "@/core/stores/focusStore";
import { useSearchStore } from "@/core/stores/searchStore";
import { useBlockContentStore } from "@/core/stores/blockContentStore";
import { Input } from "@/core/components/ui/input";
import { useSetActiveProject } from "@/core/projects/hooks";
import { toggle } from "fp-ts/lib/ReadonlySet";
import { usePanelStore } from "@/core/stores/panelStore";

/*
  Extend your base FileTree type to include the properties we need.
  (You can also add these fields to your FileTree definition if appropriate.)
*/
type ExtendedFileTree = FileTree & {
  id: string;
  parent?: string;
  isTemporary?: boolean;
  fileKind?: "file" | "void" | undefined;
  children?: ExtendedFileTree[];
  lazy?: boolean;
};

interface RenameInputProps {
  node: any;
  error: string | null;
  setError: (msg: string | null) => void;
  onSubmit: (newName: string) => void;
  setIsRenaming: (renaming: boolean) => void;
}

function RenameInput({ node, error, setError, onSubmit, setIsRenaming }: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(node.data.name);

  useLayoutEffect(() => {
    setIsRenaming(true);
    setName(node.data.name);
    inputRef.current?.focus();
  }, [node.data.name, setIsRenaming]);

  return (
    <div className="flex flex-col flex-1">
      <input
        autoFocus
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => {
          if (node.data.type === "file") {
            const text = name.split(".")[0];
            e.target.setSelectionRange(0, text.length);
          }
          setError(null);
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onBlur={(e) => onSubmit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            onSubmit(name);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={`px-1 py-0 border rounded h-5 bg-stone-800 text-stone-200 focus:outline-none focus:ring-1 ${error ? "border-red-500 focus:ring-red-500" : "border-stone-700 focus:ring-orange-500"
          }`}
      />
      {error && <span className="bg-red-500 text-xs text-white absolute top-7 left-12 p-1 rounded z-10">{error}</span>}
    </div>
  );
}

// ─── TREE NODE COMPONENT ─────────────────────────────────────────────

interface TreeNodeProps extends NodeRendererProps<ExtendedFileTree> {
  activeFile: { source: string } | null;
  removeTemporaryNode: (nodeId: string) => void;
  onFolderToggle: (node: any) => void;
  refreshDir: (dirPath: string) => Promise<void>;
  expandedDirsRef: React.MutableRefObject<Set<string>>;
  treeRef: React.RefObject<TreeApi<ExtendedFileTree>>;
}

const DragOverContext = React.createContext<{
  dragOverParentId: string | null;
  setDragOverParentId: (id: string | null) => void;
}>({
  dragOverParentId: null,
  setDragOverParentId: () => { },
});

const TreeActionsContext = React.createContext<{
  expandAllRecursive: (startPath: string) => Promise<void>;
  collapseAllFromFolder: (folderNode: NodeApi<ExtendedFileTree>) => Promise<void>;
}>({
  expandAllRecursive: async () => { },
  collapseAllFromFolder: async () => { },
});

function TreeNode({ node, style, dragHandle, activeFile, removeTemporaryNode, onFolderToggle, refreshDir, expandedDirsRef, treeRef }: TreeNodeProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverTimer, setDragOverTimer] = useState<NodeJS.Timeout | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const { dragOverParentId, setDragOverParentId } = useContext(DragOverContext);
  const { expandAllRecursive } = useContext(TreeActionsContext);
  const queryClient = useQueryClient();
  const setIsRenaming = useFocusStore((state) => state.setIsRenaming);
  const { mutate: activateTab } = useActivateTab();

  const isInternalTreeDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("application/x-arborist-node");
  const isExternalFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files") && !isInternalTreeDrag(e);
  const isKnownFileSystemDrag = (e: React.DragEvent) => isInternalTreeDrag(e) || isExternalFileDrag(e);
  const isInternalDropTargetFolder = node.data.type === "folder" && Boolean(node.willReceiveDrop);

  useEffect(() => {
    if (!isInternalDropTargetFolder) return;
    setIsDragOver(true);
    setDragOverParentId(null);
    if (!node.isOpen && !dragOverTimer) {
      const timer = setTimeout(() => {
        node.open();
      }, 200);
      setDragOverTimer(timer);
    }
  }, [isInternalDropTargetFolder, node, dragOverTimer, setDragOverParentId]);

  useEffect(() => {
    return () => {
      if (dragOverTimer) {
        clearTimeout(dragOverTimer);
      }
    };
  }, [dragOverTimer]);

  const getGitStatusClass = (gitStatus: any) => {
    if (!gitStatus) return "";
    if ((gitStatus.working_dir && gitStatus.working_dir.startsWith("?")) || (gitStatus.index && gitStatus.index.startsWith("?")))
      return "text-vcs-added";
    if (gitStatus.working_dir === "M" || gitStatus.index === "M") return "text-vcs-modified";
    if (gitStatus.working_dir === "A" || gitStatus.index === "A") return "text-vcs-added";
    if (gitStatus.working_dir === "D" || gitStatus.index === "D") return "text-red-500";
    if (gitStatus.working_dir === "R" || gitStatus.index === "R") return "text-vcs-modified";
    return "";
  };

  // Mutation to create a file via Electron.
  const createFileMutation = useMutation({
    mutationFn: async (newName: string) => {
      const result = await window.electron?.files.create(node.data.parent!, newName);
      if (!result) throw new Error("File creation failed");

      const newTab = {
        id: crypto.randomUUID(),
        type: "document" as const,
        title: result.name,
        source: result.path,
        directory: null,
      };

      const response = await window.electron?.state.addPanelTab("main", newTab);
      if (response?.tabId) {
        await window.electron?.state.activatePanelTab("main", response.tabId);
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      }
      return result;
    },
    onSuccess: (result) => {
      node.submit(result.name);
      // Surgically refresh only the parent directory — no full tree refetch
      refreshDir(node.data.parent!);
      queryClient.invalidateQueries({ queryKey: ["env"] });
    },
    onError: (error) => {
      setError(error.message || "Error creating file");
      node.edit();
    },
  });

  // Mutation to create a void file via Electron.
  const createVoidFileMutation = useMutation({
    mutationFn: async (newName: string) => {
      const result = await window.electron?.files.createVoid(node.data.parent!, newName);
      if (!result) throw new Error("File creation failed");

      const newTab = {
        id: crypto.randomUUID(),
        type: "document" as const,
        title: result.name,
        source: result.path,
        directory: null,
      };

      const response = await window.electron?.state.addPanelTab("main", newTab);
      if (response?.tabId) {
        await window.electron?.state.activatePanelTab("main", response.tabId);
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      }
      return result;
    },
    onSuccess: (result) => {
      node.submit(result.name);
      // Surgically refresh only the parent directory — no full tree refetch
      refreshDir(node.data.parent!);
      queryClient.invalidateQueries({ queryKey: ["env"] });
    },
    onError: (error) => {
      setError(error.message || "Error creating file");
      node.edit();
    },
  });

  // Mutation to create a directory via Electron.
  const createDirectoryMutation = useMutation({
    mutationFn: async (newName: string) => {
      const result = await window.electron?.files.createDirectory(node.data.parent!, newName);
      if (!result) throw new Error("Directory creation failed");
      return result;
    },
    onSuccess: (result) => {
      node.submit(result);
      // Surgically refresh only the parent directory — no full tree refetch
      refreshDir(node.data.parent!);
    },
    onError: (error) => {
      setError(error.message || "Error creating directory");
      node.edit();
    },
  });

  // Mutation to rename a file or directory via Electron.
  const renameMutation = useMutation({
    mutationFn: async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const result = await window.electron?.state.renameFile(oldPath, newName);
      if (!result?.success) {
        throw new Error(result?.error || "Renaming failed");
      }
      return result;
    },
    onSuccess: async (result, { oldPath, newName }) => {
      node.submit(newName);
      
      // Preserve expanded state for folders: track if folder was open before rename
      const wasFolderOpen = node.data.type === "folder" && node.isOpen;
      const newPath = result.data.path;
      
      // Get the parent path to refresh the containing directory
      const parentPath = node.data.parent || getParentPath(oldPath);
      
      if (parentPath) {
        // If the renamed item was an expanded folder, add its new path to expanded dirs
        // before refreshing the parent so it gets re-opened
        if (wasFolderOpen) {
          expandedDirsRef.current.add(newPath);
        }
        
        // Remove old path from expanded dirs if it's a folder
        if (node.data.type === "folder") {
          expandedDirsRef.current.delete(oldPath);
        }
        
        // Refresh parent directory to see renamed node with new name
        await refreshDir(parentPath);
        
        // After refresh, re-open the renamed folder if it was expanded.
        // Use onFolderToggle (expandLazyNode) — not raw open() — so children
        // are fetched from disk first (the renamed folder is a lazy stub after refresh).
        if (wasFolderOpen) {
          setTimeout(() => {
            const renamedNode = treeRef.current?.get(newPath);
            if (renamedNode && !renamedNode.isOpen) {
              onFolderToggle(renamedNode);
            }
          }, 0);
        }
      }
      
      // Invalidate queries to update UI with new paths/names and references
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["tab:content"] });
      queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"] });
      queryClient.invalidateQueries({ queryKey: ["file:exists"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
    },
    onError: (error) => {
      setError(error.message || "Error renaming file");
      node.edit();
    },
  });

  // Mutation to drop files
  const dropFilesMutation = useMutation({
    mutationFn: async ({ files, targetPath }: { files: File[]; targetPath: string }) => {
      const results = [];
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const result = await window.electron?.files.drop(targetPath, file.name, uint8Array);
        if (!result) throw new Error(`Failed to upload ${file.name}`);
        results.push(result);
      }
      return results;
    },
    onSuccess: (_, { targetPath }) => {
      // Surgically refresh only the drop target directory — no full tree refetch
      refreshDir(targetPath);
      queryClient.invalidateQueries({ queryKey: ["env"] });
    },
    onError: (error) => {
      console.error("File drop error:", error);
      setError(error.message || "Error drop files");
    },
  });

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

    // ── Existing node rename ──────────────────────────────────────────
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

    // Capture the current path before any state update and pass it explicitly
    renameMutation.mutate({ oldPath: node.data.path, newName });
  };

  const handleDrop = async (e: React.DragEvent) => {
    setIsDragOver(false);
    setDragOverParentId(null);
    if (dragOverTimer) {
      clearTimeout(dragOverTimer);
      setDragOverTimer(null);
    }

    if (!isExternalFileDrag(e)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    let targetFolder = node;
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
        // Refresh only the target directory instead of the whole tree
        await refreshDir(targetPath);
        queryClient.invalidateQueries({ queryKey: ["env"] });
      }

      if (targetFolder.data.type === "folder" && !targetFolder.isOpen) {
        targetFolder.open();
      }
    } catch (error) {
      console.error("Failed to drop items:", error);
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

      if (!node.isOpen && !dragOverTimer) {
        const timer = setTimeout(() => {
          node.open();
        }, 200);
        setDragOverTimer(timer);
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

    if (node.data.type === "folder" && !node.isOpen && !dragOverTimer) {
      const timer = setTimeout(() => {
        node.open();
      }, 200);
      setDragOverTimer(timer);
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

      if (dragOverTimer) {
        clearTimeout(dragOverTimer);
        setDragOverTimer(null);
      }
    }
  };

  const getFileIcon = (name: string, path: string): JSX.Element => {
    const lower = name.toLowerCase();

    if (name.startsWith(".env")) return <Settings2 size={14} style={{ color: "#ecd53f" }} />;
    if (lower === ".gitignore" || lower === ".gitattributes")
      return <GitBranch size={14} style={{ color: "#f54d27" }} />;
    if (name.startsWith("Dockerfile") || lower.startsWith("docker-compose"))
      return <Container size={14} style={{ color: "#0db7ed" }} />;
    if (lower === "readme.md") return <Info size={14} style={{ color: "#519aba" }} />;
    if (lower === "package.json" || lower === "package-lock.json")
      return <Braces size={14} style={{ color: "#cc3e44" }} />;
    if (lower === "tsconfig.json" || lower.startsWith("tsconfig."))
      return <Braces size={14} style={{ color: "#3178c6" }} />;

    const extMatch = path.match(/\.([0-9a-z]+)$/i);
    const ext = extMatch?.[1]?.toLowerCase();

    const iconMap: Record<string, JSX.Element> = {
      void: <Infinity size={14} className="text-accent" />,
      ts: <FileCode size={14} style={{ color: "#3178c6" }} />,
      tsx: <FileCode size={14} style={{ color: "#61dafb" }} />,
      js: <FileCode size={14} style={{ color: "#f7df1e" }} />,
      jsx: <FileCode size={14} style={{ color: "#61dafb" }} />,
      mjs: <FileCode size={14} style={{ color: "#f7df1e" }} />,
      cjs: <FileCode size={14} style={{ color: "#f7df1e" }} />,
      html: <FileCode size={14} style={{ color: "#e34c26" }} />,
      htm: <FileCode size={14} style={{ color: "#e34c26" }} />,
      css: <Hash size={14} style={{ color: "#563d7c" }} />,
      scss: <Hash size={14} style={{ color: "#c6538c" }} />,
      sass: <Hash size={14} style={{ color: "#c6538c" }} />,
      less: <Hash size={14} style={{ color: "#1d365d" }} />,
      json: <Braces size={14} style={{ color: "#cbcb41" }} />,
      yml: <Braces size={14} style={{ color: "#cc3e44" }} />,
      yaml: <Braces size={14} style={{ color: "#cc3e44" }} />,
      toml: <Braces size={14} style={{ color: "#9c4221" }} />,
      xml: <FileCode size={14} style={{ color: "#f4a261" }} />,
      csv: <FileSpreadsheet size={14} style={{ color: "#1e7a1e" }} />,
      sql: <Database size={14} style={{ color: "#e38c00" }} />,
      py: <FileCode size={14} style={{ color: "#3776ab" }} />,
      go: <FileCode size={14} style={{ color: "#00add8" }} />,
      rs: <FileCode size={14} style={{ color: "#dea584" }} />,
      java: <FileCode size={14} style={{ color: "#ea2d2e" }} />,
      rb: <FileCode size={14} style={{ color: "#cc342d" }} />,
      php: <FileCode size={14} style={{ color: "#8892be" }} />,
      swift: <FileCode size={14} style={{ color: "#f05138" }} />,
      kt: <FileCode size={14} style={{ color: "#7f52ff" }} />,
      c: <FileCode size={14} style={{ color: "#a8b9cc" }} />,
      cpp: <FileCode size={14} style={{ color: "#00427b" }} />,
      cc: <FileCode size={14} style={{ color: "#00427b" }} />,
      h: <FileCode size={14} style={{ color: "#a8b9cc" }} />,
      cs: <FileCode size={14} style={{ color: "#9b4f96" }} />,
      lua: <FileCode size={14} style={{ color: "#000080" }} />,
      r: <FileCode size={14} style={{ color: "#276dc3" }} />,
      sh: <FileCode size={14} style={{ color: "#89e051" }} />,
      bash: <FileCode size={14} style={{ color: "#89e051" }} />,
      zsh: <FileCode size={14} style={{ color: "#89e051" }} />,
      fish: <FileCode size={14} style={{ color: "#89e051" }} />,
      md: <FileText size={14} style={{ color: "#519aba" }} />,
      txt: <FileText size={14} style={{ color: "#a0adb8" }} />,
      pdf: <FileText size={14} style={{ color: "#e74c3c" }} />,
      png: <Image size={14} style={{ color: "#a074c4" }} />,
      jpg: <Image size={14} style={{ color: "#a074c4" }} />,
      jpeg: <Image size={14} style={{ color: "#a074c4" }} />,
      gif: <Image size={14} style={{ color: "#a074c4" }} />,
      svg: <Image size={14} style={{ color: "#ffb13b" }} />,
      ico: <Image size={14} style={{ color: "#a074c4" }} />,
      webp: <Image size={14} style={{ color: "#a074c4" }} />,
      lock: <File size={14} style={{ color: "#a0adb8" }} />,
      log: <File size={14} style={{ color: "#a0adb8" }} />,
    };

    return iconMap[ext ?? ""] ?? <File size={14} style={{ color: "#a0adb8" }} />;
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
        } catch (error) {
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

  const { collapseAllFromFolder } = useContext(TreeActionsContext);

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
        (isDragOver || isInternalDropTargetFolder) && "bg-accent/30 border-l-2 border-accent",
        isSiblingHighlight && !isDragOver && !isInternalDropTargetFolder && "bg-accent/30 ",
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
              {/* Chevron rotates whenever the folder is open, including empty folders */}
              <ChevronRight size={14} className={`transition-transform ${node.isOpen ? "rotate-90" : ""}`} />
            </div>
          )}
          <div className="w-30">{node.data.type !== "folder" && getFileIcon(node.data.name, node.data.path)}</div>
          {node.isEditing ? (
            <RenameInput node={node} error={error} setError={setError} onSubmit={onSubmit} setIsRenaming={setIsRenaming} />
          ) : (
            <span
              className={cn(
                "truncate text-ui-fg",
                activeFile?.source === node.data.path && !node.data.git
                  ? ""
                  : node.data.type === "file"
                    ? node.data.git
                      ? getGitStatusClass(node.data.git)
                      : ""
                    : node.data.type === "folder"
                      ? node.data.aggregatedGitStatus
                        ? getGitStatusClass(node.data.aggregatedGitStatus)
                        : ""
                      : "",
              )}
            >
              {node.data.name}
            </span>
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

// Helper to recursively update tree data when creating a new node.
const updateTreeData = (nodes: ExtendedFileTree[], parentId: string, newNode: ExtendedFileTree): ExtendedFileTree[] => {
  return nodes.map((node) => {
    if (node.path === parentId) {
      return { ...node, children: [...(node.children || []), newNode] };
    }
    if (node.children) {
      return { ...node, children: updateTreeData(node.children, parentId, newNode) };
    }
    return node;
  });
};

// Helper to recursively remove a node from tree data.
const removeNodeFromTreeData = (nodes: ExtendedFileTree[], nodeId: string): ExtendedFileTree[] => {
  return nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => (node.children ? { ...node, children: removeNodeFromTreeData(node.children, nodeId) } : node));
};

// Recursively injects children into the node at targetPath, clearing its lazy flag.
function injectChildren(nodes: ExtendedFileTree[], targetPath: string, children: ExtendedFileTree[]): ExtendedFileTree[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children: children as ExtendedFileTree[], lazy: false };
    }
    if (node.children && node.children.length > 0) {
      return { ...node, children: injectChildren(node.children, targetPath, children) };
    }
    return node;
  });
}

function getParentPath(path: string): string {
  if (!path) return "";
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (sep === -1) return "";
  return path.slice(0, sep);
}

// Finds a node anywhere in the tree by its path.
function findNodeByPath(nodes: ExtendedFileTree[], targetPath: string): ExtendedFileTree | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

function ensureFolderExpanded(folderNode: NodeApi<ExtendedFileTree> | undefined, path: string, expandedDirsRef: React.MutableRefObject<Set<string>>) {
  if (!folderNode) return;
  if (!folderNode.isOpen) {
    folderNode.open();
    expandedDirsRef.current.add(path);
  }
}

function removeNodeByPath(nodes: ExtendedFileTree[], targetPath: string): ExtendedFileTree[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) => (node.children ? { ...node, children: removeNodeByPath(node.children, targetPath) } : node));
}

export const FileSystemList = () => {
  const { data, isPending, isFetching, dataUpdatedAt } = useFileTree();
  usePrefetchFileList();
  const { data: appState } = useGetAppState();

  const [showDeleteProgress, setShowDeleteProgress] = useState(false);
  const [isTreeBusy, setIsTreeBusy] = useState(false);
  useElectronEvent("file:delete-start", () => {
    setShowDeleteProgress(true);
  });
  useElectronEvent("file:bulk-delete-complete", () => {
    setShowDeleteProgress(false);
  });
  useElectronEvent<{ path: string }>("file:delete", (eventData) => {
    if (!eventData?.path) return;
    setTreeData((prev) => removeNodeByPath(prev, eventData.path));
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    queryClient.invalidateQueries({ queryKey: ["app:state"] });
  });

  useElectronEvent<{ path: string }>("directory:delete", (eventData) => {
    if (!eventData?.path) return;
    setTreeData((prev) => removeNodeByPath(prev, eventData.path));
    expandedDirsRef.current.delete(eventData.path);
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    queryClient.invalidateQueries({ queryKey: ["app:state"] });
  });
  useEffect(() => {
    // Fallback: also clear if the tree finishes a refetch (e.g. single-file delete via context menu).
    if (!isFetching) setShowDeleteProgress(false);
  }, [isFetching]);

  const { ref, width, height } = useResizeObserver();
  const { mutateAsync: move } = useMove();
  const { data: activeFile } = useGetActiveDocument();
  const { mutateAsync: openProject } = useOpenProject();
  const { mutateAsync: closeProject } = useCloseActiveProject();
  const { mutateAsync: setActiveProject } = useSetActiveProject();
  const { mutateAsync: activateTab } = useActivateTab();
  const treeRef = useRef<TreeApi<ExtendedFileTree>>(null);
  const expandedDirsRef = useRef<Set<string>>(new Set());
  const pendingDuplicateRenamePathRef = useRef<string | null>(null);
  // Track whether the tree has been initialized at least once — used to guard
  // against the `data` effect resetting the whole tree on subsequent refetches.
  const isFirstLoadRef = useRef(true);

  const handleActivate = async (node: NodeApi<ExtendedFileTree>) => {
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
      expandLazyNode(node);
    }
  };

  const dndRootElement = useRef<HTMLDivElement>(null);
  const pendingFileKindRef = useRef<"void" | null>(null);
  const queryClient = useQueryClient();

  const [treeData, setTreeData] = useState<ExtendedFileTree[]>([]);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // ─── refreshDir ──────────────────────────────────────────────────────────────
  // Surgically re-fetches a single directory's children and injects them into
  // treeData without touching the rest of the tree.  This replaces
  // invalidateQueries({ queryKey: ["files:tree"] }) for local mutations so that
  // expanded state, scroll position, and sibling nodes are all preserved.
  const refreshDir = useCallback(async (dirPath: string) => {
    const electronFiles = window.electron?.files;
    if (!electronFiles) return;
    // Capture open state BEFORE the async fetch so we restore it correctly
    const wasOpen = treeRef.current?.get(dirPath)?.isOpen ?? false;
    try {
      const children = await (electronFiles as any).expandDir(dirPath);
      if (children) {
        setTreeData((prev) => {
          // Preserve already-expanded siblings: if a new child folder is currently
          // expanded, keep its existing children so it doesn't collapse.
          const mergedChildren = (children as ExtendedFileTree[]).map((newChild) => {
            if (newChild.type === "folder" && expandedDirsRef.current.has(newChild.path)) {
              const existing = findNodeByPath(prev, newChild.path);
              if (existing?.children) {
                return { ...newChild, children: existing.children, lazy: false };
              }
            }
            return newChild;
          });
          return injectChildren(prev, dirPath, mergedChildren);
        });
        if (wasOpen) {
          expandedDirsRef.current.add(dirPath);
          // Re-open the folder and any previously-expanded siblings after render.
          // Skip lazy nodes — they need children fetched before opening; the caller
          // is responsible for those (e.g. rename mutation calls expandLazyNode).
          setTimeout(() => {
            treeRef.current?.get(dirPath)?.open();
            for (const expandedPath of expandedDirsRef.current) {
              if (expandedPath === dirPath) continue;
              const node = treeRef.current?.get(expandedPath);
              if (node && !node.isOpen && !node.data.lazy) node.open();
            }
          }, 0);
        } else {
          expandedDirsRef.current.delete(dirPath);
          setTimeout(() => {
            for (const expandedPath of expandedDirsRef.current) {
              const node = treeRef.current?.get(expandedPath);
              if (node && !node.isOpen && !node.data.lazy) node.open();
            }
          }, 0);
        }
      }
    } catch (e) {
      console.error("refreshDir failed", e);
    }
  }, []);

  const expandAllRecursive = useCallback(async (startPath: string) => {
    const ipcExpandDirAll = (window.electron as any)?.files?.expandDirAll as
      | ((dirPath: string) => Promise<Record<string, ExtendedFileTree[]>>)
      | undefined;
    if (!ipcExpandDirAll) return;

    setIsTreeBusy(true);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(resolve));

    // Phase 1 — one IPC call gets the entire subtree at once.
    // Previously this was N calls (one per directory), causing N round-trips
    // and N separate IPC-triggered refreshes. Now it's a single round-trip.
    const allChildren = await ipcExpandDirAll(startPath);

    if (!allChildren || Object.keys(allChildren).length === 0) {
      setIsTreeBusy(false);
      return;
    }

    // Rebuild BFS level order from the returned flat map so we can inject
    // and open parents before children (injectChildren requires parent first).
    const leveledPaths: string[][] = [];
    let currentLevel = [startPath];
    while (currentLevel.length > 0) {
      leveledPaths.push([...currentLevel]);
      const nextLevel: string[] = [];
      for (const dirPath of currentLevel) {
        for (const child of allChildren[dirPath] ?? []) {
          if (child.type === "folder") nextLevel.push(child.path);
        }
      }
      currentLevel = nextLevel;
    }

    // Phase 2 — inject all data in one setTreeData call (one React render).
    setTreeData((prev) => {
      let updated = prev;
      for (const levelPaths of leveledPaths) {
        for (const dirPath of levelPaths) {
          const children = allChildren[dirPath];
          if (children) updated = injectChildren(updated, dirPath, children);
        }
      }
      return updated;
    });
    await frame();

    // Phase 3 — open level by level. react-arborist.get() is visibility-limited
    // so we must open parents before children can be found.
    for (const levelPaths of leveledPaths) {
      for (const dirPath of levelPaths) {
        expandedDirsRef.current.add(dirPath);
        treeRef.current?.get(dirPath)?.open();
      }
      await frame();
    }

    setIsTreeBusy(false);
  }, []);

  const collapseAllFromFolder = useCallback(async (folderNode: NodeApi<ExtendedFileTree>) => {
    // Collect all open folder nodes first (BFS read — no DOM writes yet).
    const toClose: NodeApi<ExtendedFileTree>[] = [];
    const collect = (node: NodeApi<ExtendedFileTree>) => {
      node.children?.forEach((child) => {
        if (child.data.type === "folder") {
          collect(child);
          if (child.isOpen) toClose.push(child);
        }
      });
    };
    collect(folderNode);
    if (folderNode.isOpen) toClose.push(folderNode);
    if (toClose.length === 0) return;

    setIsTreeBusy(true);
    try {
      // Close in batches of 20 per animation frame so the browser stays
      // responsive on huge trees (1000+ open nodes).
      const BATCH = 20;
      for (let i = 0; i < toClose.length; i += BATCH) {
        toClose.slice(i, i + BATCH).forEach((n) => {
          expandedDirsRef.current.delete(n.data.path);
          n.close();
        });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      setIsTreeBusy(false);
    }
  }, []);

  const expandLazyNode = useCallback(
    async (node: any) => {
      const nodePath: string = node.data.path;
      if (loadingDirs.has(nodePath)) return;
      if (!node.data.lazy) {
        if (node.isOpen) {
          expandedDirsRef.current.delete(nodePath);
        } else {
          expandedDirsRef.current.add(nodePath);
        }
        node.toggle();
        return;
      }
      if (node.data.children && node.data.children.length > 0) {
        if (node.isOpen) {
          expandedDirsRef.current.delete(nodePath);
        } else {
          expandedDirsRef.current.add(nodePath);
        }
        node.toggle();
        return;
      }

      setLoadingDirs((prev) => new Set(prev).add(nodePath));
      try {
        const children = await window.electron?.files.expandDir(nodePath);
        if (children) {
          setTreeData((prev) => injectChildren(prev, nodePath, children as ExtendedFileTree[]));
          expandedDirsRef.current.add(nodePath);
          setTimeout(() => treeRef.current?.get(nodePath)?.open(), 0);
        }
      } finally {
        setLoadingDirs((prev) => {
          const s = new Set(prev);
          s.delete(nodePath);
          return s;
        });
      }
    },
    [loadingDirs],
  );

  const [dragOverParentId, setDragOverParentId] = useState<string | null>(null);

  // --- NEW PROJECT CREATION STATE & HANDLERS ---
  const [isNewProjectMode, setIsNewProjectMode] = useState(false);
  const [tempProjectName, setTempProjectName] = useState("");
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNewProjectMode) {
      newProjectInputRef.current?.focus();
      setNewProjectError(null);
    }
  }, [isNewProjectMode]);

  const handleCreateNewProject = async (name: string) => {
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setIsNewProjectMode(false);
      setTempProjectName("");
      return;
    }

    try {
      const result = await window.electron?.files.createProjectDirectory(trimmedName);

      if (!result) {
        throw new Error("Project directory creation failed: Electron API unavailable or unknown error.");
      }

      await setActiveProject(result);

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });

      setIsNewProjectMode(false);
      setTempProjectName("");
    } catch (error) {
      const errorMessage = (error as Error).message || "Error creating project";
      setNewProjectError(errorMessage);
      setTempProjectName(trimmedName);
      newProjectInputRef.current?.focus();
    }
  };

  // Full-text search state & hook
  const [rawQuery, setRawQuery] = useState<string>("");
  const searchQuery = useDebounce(rawQuery, 300);
  const [matchCase, setMatchCase] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);

  const { closeBottomPanel } = usePanelStore();
  const storeIsSearching = useSearchStore((state) => state.isSearching);
  const setStoreIsSearching = useSearchStore((state) => state.setIsSearching);

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchIdRef = useRef(0);
  const seenSearchResultsRef = useRef(new Set<string>());

  useEffect(() => {
    // Cancel the previous search unconditionally
    window.electron?.cancelSearch?.(searchIdRef.current);

    if (!searchQuery) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    searchIdRef.current += 1;
    const currentId = searchIdRef.current;

    setSearchResults([]);
    seenSearchResultsRef.current = new Set();
    setIsSearching(true);
    setSearchError(null);

    window.electron?.startSearch?.({ query: searchQuery, matchCase, matchWholeWord, searchId: currentId });

    const unsubResult = window.electron?.onSearchResult?.((data) => {
      if (data.searchId !== currentId) return;
      const key = `${data.result.path}:${data.result.line}`;
      if (!seenSearchResultsRef.current.has(key)) {
        seenSearchResultsRef.current.add(key);
        setSearchResults((prev) => [...prev, data.result]);
      }
    });

    const unsubDone = window.electron?.onSearchDone?.((data) => {
      if (data.searchId !== currentId) return;
      setIsSearching(false);
      if (data.error) setSearchError(data.error);
    });

    return () => {
      unsubResult?.();
      unsubDone?.();
      window.electron?.cancelSearch?.(currentId);
    };
  }, [searchQuery, matchCase, matchWholeWord]);

  // ─── Sync server data → treeData ─────────────────────────────────────────────
  // On the FIRST load we initialise treeData from the server response and then
  // re-expand any directories that were open before (e.g. after a project switch).
  //
  // On SUBSEQUENT server refetches (triggered by delete events, etc.) we merge in
  // new root children while preserving expanded subtrees so open folders don't
  // collapse.  This keeps the tree responsive without losing expansion state.
  useEffect(() => {
    if (!data) return;

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      setTreeData([data as ExtendedFileTree]);

      // Track root so refreshDir's re-open loop can restore it if react-arborist
      // resets its open state when treeData changes.
      if ((data as ExtendedFileTree).type === "folder") {
        expandedDirsRef.current.add((data as ExtendedFileTree).path);
      }

      const dirsToReExpand = [...expandedDirsRef.current];
      if (dirsToReExpand.length === 0) return;

      const electronFiles = window.electron?.files;
      if (!electronFiles) return;

      (async () => {
        const results: { dirPath: string; children: ExtendedFileTree[] }[] = [];
        await Promise.all(
          dirsToReExpand.map(async (dirPath) => {
            try {
              const children = await electronFiles.expandDir(dirPath);
              if (children) results.push({ dirPath, children: children as ExtendedFileTree[] });
            } catch {
              expandedDirsRef.current.delete(dirPath);
            }
          }),
        );
        if (results.length === 0) return;
        setTreeData((prev) => {
          let updated = prev;
          for (const { dirPath, children } of results) {
            updated = injectChildren(updated, dirPath, children);
          }
          return updated;
        });
        setTimeout(() => {
          for (const { dirPath } of results) {
            treeRef.current?.get(dirPath)?.open();
          }
        }, 0);
      })();

      return;
    }

    // Subsequent refetches: merge in new root children while preserving expanded
    // subtrees so open folders don't collapse.
    setTreeData((prev) => {
      if (prev.length === 0) return [data as ExtendedFileTree];

      const incoming = data as ExtendedFileTree;

      const mergeChildren = (existingChildren: ExtendedFileTree[] | undefined, incomingChildren: ExtendedFileTree[]) => {
        const existingByPath = new Map((existingChildren ?? []).map((child) => [child.path, child]));
        return incomingChildren.map((child) => {
          const existing = existingByPath.get(child.path);
          if (!existing) return child;
          if (child.type === "folder") {
            const isExpanded =
              expandedDirsRef.current.has(child.path) ||
              Boolean(treeRef.current?.get(child.path)?.isOpen);
            if (isExpanded && existing.children) {
              return { ...child, children: existing.children, lazy: false };
            }
          }
          return child;
        });
      };

      return prev.map((existingRoot) => {
        if (existingRoot.path !== incoming.path) return existingRoot;
        const mergedChildren = mergeChildren(
          existingRoot.children,
          (incoming.children ?? []) as ExtendedFileTree[],
        );
        return { ...incoming, children: mergedChildren };
      });
    });

    // Re-fetch all expanded dirs so changes in deep folders are reflected.
    // dataUpdatedAt (not data) drives this — React Query's structural sharing
    // keeps the data reference the same when only deep children changed, but
    // dataUpdatedAt always increments on every successful refetch.
    const dirsToRefresh = [...expandedDirsRef.current];
    if (dirsToRefresh.length > 0) {
      const electronFiles = window.electron?.files;
      if (electronFiles) {
        (async () => {
          const results: { dirPath: string; children: ExtendedFileTree[] }[] = [];
          await Promise.all(
            dirsToRefresh.map(async (dirPath) => {
              try {
                const children = await (electronFiles as any).expandDir(dirPath);
                if (children) results.push({ dirPath, children: children as ExtendedFileTree[] });
              } catch {
                expandedDirsRef.current.delete(dirPath);
              }
            }),
          );
          if (results.length === 0) return;
          setTreeData((prev) => {
            let updated = prev;
            for (const { dirPath, children } of results) {
              updated = injectChildren(updated, dirPath, children);
            }
            return updated;
          });
          setTimeout(() => {
            for (const { dirPath } of results) {
              const node = treeRef.current?.get(dirPath);
              if (node && !node.isOpen) node.open();
            }
          }, 0);
        })();
      }
    }

  }, [data, dataUpdatedAt]);

  // Reset the first-load guard whenever the active project changes so that
  // switching projects re-initialises the tree correctly.
  useEffect(() => {
    isFirstLoadRef.current = true;
    expandedDirsRef.current.clear();
  }, [appState?.activeDirectory]);

  const tryStartDuplicateRename = useCallback((path: string) => {
    const tree = treeRef.current;
    if (!tree) return false;
    const nodeToRename = tree.get(path);
    if (!nodeToRename) return false;

    let parent = nodeToRename.parent;
    while (parent) {
      if (parent.data.type === "folder" && !parent.isOpen) {
        parent.open();
      }
      parent = parent.parent;
    }

    tree.scrollTo(path, "auto");
    nodeToRename.edit();
    return true;
  }, []);

  // External file/folder additions detected by the file watcher.
  // `files:tree` invalidation alone doesn't work here because the subsequent-
  // refetch handler keeps existing children and discards incoming data to
  // preserve expanded state. refreshDir surgically updates the parent dir instead.
  useElectronEvent<{ path: string }>("file:new", (eventData) => {
    const newPath = eventData?.path;
    if (!newPath) return;
    const parentPath = getParentPath(newPath);
    if (parentPath) {
      refreshDir(parentPath);
    }
  });

  useElectronEvent<{ path: string }>("file:duplicate", (eventData) => {
    const path = eventData?.path;
    if (!path) return;

    const parentPath = getParentPath(path);
    if (parentPath) {
      refreshDir(parentPath);
      const parentNode = treeRef.current?.get(parentPath);
      ensureFolderExpanded(parentNode, parentPath, expandedDirsRef);
    } else {
      refreshDir(path);
    }

    if (tryStartDuplicateRename(path)) return;
    pendingDuplicateRenamePathRef.current = path;
  });

  useEffect(() => {
    const pendingPath = pendingDuplicateRenamePathRef.current;
    if (!pendingPath) return;

    if (tryStartDuplicateRename(pendingPath)) {
      pendingDuplicateRenamePathRef.current = null;
    }
  }, [treeData, tryStartDuplicateRename]);

  useEffect(() => {
    if (!activeFile?.source) return;

    const expandAndScroll = async () => {
      const tree = treeRef.current;
      if (!tree) return;

      // Build ancestor paths top-down (from project root down to direct parent)
      const ancestors: string[] = [];
      let cursor = getParentPath(activeFile.source);
      while (cursor) {
        ancestors.unshift(cursor);
        const parent = getParentPath(cursor);
        if (!parent || parent === cursor) break;
        cursor = parent;
      }

      for (const ancestorPath of ancestors) {
        const node = tree.get(ancestorPath);
        if (!node) continue;

        if (node.data.lazy) {
          // Lazy folder: fetch children, inject into tree, then open
          const children = await window.electron?.files.expandDir(ancestorPath);
          if (children) {
            setTreeData((prev) => injectChildren(prev, ancestorPath, children as ExtendedFileTree[]));
            expandedDirsRef.current.add(ancestorPath);
            // Wait for the state update to render before opening / continuing
            await new Promise<void>((resolve) =>
              setTimeout(() => {
                treeRef.current?.get(ancestorPath)?.open();
                resolve();
              }, 0),
            );
          }
        } else if (!node.isOpen) {
          node.open();
          expandedDirsRef.current.add(ancestorPath);
        }
      }

      // Scroll to the file after all ancestors are expanded
      setTimeout(() => {
        treeRef.current?.scrollTo(activeFile.source, "auto");
      }, 50);
    };

    expandAndScroll();
  }, [activeFile?.source]);

  const getInitialOpenState = (root: ExtendedFileTree) => {
    const openState: Record<string, boolean> = {};
    if (root.type === "folder") {
      openState[root.path] = true;
    }
    return openState;
  };

  const handleCreate = ({ parentId, index, type }: { parentId: string | null; index: number; type: "leaf" | "internal" }): ExtendedFileTree => {
    if (!parentId) {
      throw new Error("parentId cannot be null");
    }
    const newId = `temp-${crypto.randomUUID()}`;
    const fileKind = pendingFileKindRef.current ?? undefined;
    pendingFileKindRef.current = null;
    const newNode: ExtendedFileTree = {
      id: newId,
      name: "",
      path: newId,
      isTemporary: true,
      fileKind: fileKind,
      parent: parentId,
      type: type === "internal" ? "folder" : "file",
      children: type === "internal" ? [] : undefined,
    };
    setTreeData((prevData) => updateTreeData(prevData, parentId, newNode));
    return newNode;
  };

  const handleRemoveTemporaryNode = (nodeId: string) => {
    setTreeData((prevData) => removeNodeFromTreeData(prevData, nodeId));
  };

  const handleMove = async ({
    dragIds,
    parentId,
    parentNode,
  }: {
    dragIds: string[];
    parentId: string | null;
    parentNode: NodeApi<ExtendedFileTree> | null;
  }) => {
    if (!parentId || !parentNode) return;
    const draggedItems = dragIds.map((id) => parentNode.tree.get(id));
    const isSameDirectory = draggedItems.some((node) => node?.data.parent === parentId);
    if (isSameDirectory) return;

    const result = await move({ dragIds, parentId });
    if (!result) return;

    if (result.error) {
      toast.error("Move failed", { description: result.error });
      return;
    }

    // Refresh source directories for each moved node
    const sourceDirs = new Set(
      dragIds
        .map((id) => parentNode.tree.get(id)?.data.parent)
        .filter(Boolean) as string[],
    );
    for (const dir of sourceDirs) {
      await refreshDir(dir);
    }
    // Refresh the target directory
    await refreshDir(parentId);

    // Invalidate tab content for all open panels to reflect moved file changes
    // and ensure references are resolved with new paths
    for (const panelId of ["main", "right"]) {
      const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", panelId]);
      for (const tab of panelTabs?.tabs ?? []) {
        if (tab.source) {
          queryClient.invalidateQueries({ queryKey: ["tab:content", panelId, tab.id] });
        }
      }
    }
    
    // Also invalidate block content and other reference-related queries
    queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"] });
    queryClient.invalidateQueries({ queryKey: ["file:exists"] });

    for (const conflict of result.conflicts ?? []) {
      toast.warning(`"${conflict.fileName}" already exists`, {
        description: "A file with this name already exists in the target folder.",
        action: {
          label: "Replace",
          onClick: async () => {
            const replaceResult = await window.electron?.files.moveForce([conflict]);
            if (replaceResult?.success) {
              // Refresh only the affected directories after a forced replace
              for (const dir of sourceDirs) await refreshDir(dir);
              await refreshDir(parentId);
              
              // Invalidate tab content after force move
              for (const panelId of ["main", "right"]) {
                const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", panelId]);
                for (const tab of panelTabs?.tabs ?? []) {
                  if (tab.source) {
                    queryClient.invalidateQueries({ queryKey: ["tab:content", panelId, tab.id] });
                  }
                }
              }
              queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"] });
              queryClient.invalidateQueries({ queryKey: ["file:exists"] });
            } else {
              toast.error("Replace failed", { description: replaceResult?.error ?? "Unknown error" });
            }
          },
        },
      });
    }
  };

  useEffect(() => {
    const off = window.electron?.files.onReferencesUpdated(async (updatedPaths: string[]) => {
      // Clear linkedBlock cache so updated references are refetched
      useBlockContentStore.getState().clearBlocks();
      
      // Remove caches for block content and file existence checks
      queryClient.removeQueries({ queryKey: ["voiden-wrapper:blockContent"] });
      queryClient.removeQueries({ queryKey: ["file:exists"] });

      for (const panelId of ["main"]) {
        const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", panelId]);
        for (const tab of panelTabs?.tabs ?? []) {
          if (!tab.id) continue;
          if (tab.source && updatedPaths.includes(tab.source)) {
            // This tab's file was rewritten on disk with updated references.
            // Clear any stale unsaved content so the editor isn't blocked from reloading,
            // remove the cached query data, then force a reload from disk.
            useEditorStore.getState().clearUnsaved(tab.id);
            queryClient.removeQueries({ queryKey: ["tab:content", panelId, tab.id] });
            await reloadVoidenEditor(tab.id);
          } else {
            queryClient.invalidateQueries({ queryKey: ["tab:content", panelId, tab.id] });
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    });
    return () => off?.();
  }, [queryClient]);

  useElectronEvent<{ path: string; type: string }>("file:create", async (eventData) => {
    const tree = treeRef.current;
    if (!tree) return;
    const folderNode = tree.get(eventData.path);
    if (!folderNode) return;

    ensureFolderExpanded(folderNode, eventData.path, expandedDirsRef);

    if (folderNode.data.lazy) {
      const electronFiles = window.electron?.files as NonNullable<typeof window.electron>["files"] | undefined;
      if (electronFiles) {
        const children = await electronFiles.expandDir(eventData.path);
        if (children) {
          expandedDirsRef.current.add(eventData.path);
          setTreeData((prev) => injectChildren(prev, eventData.path, children as ExtendedFileTree[]));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          treeRef.current?.get(eventData.path)?.open();
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    const index = tree.get(eventData.path)?.children?.length ?? 0;
    await tree.create({ type: "leaf", parentId: eventData.path, index });
    const updatedFolder = tree.get(eventData.path);
    if (updatedFolder?.children) {
      const newNode = updatedFolder.children.find((child) => child.data.isTemporary);
      if (newNode) newNode.edit();
    }
  });

  useElectronEvent<{ path: string; type: string }>("file:create-void", async (eventData) => {
    const tree = treeRef.current;
    if (tree) {
      const folderNode = tree.get(eventData.path);
      if (folderNode) {
        ensureFolderExpanded(folderNode, eventData.path, expandedDirsRef);
        const index = folderNode.children ? folderNode.children.length : 0;
        pendingFileKindRef.current = "void";
        await tree.create({
          type: "leaf",
          parentId: eventData.path,
          index,
        });

        const updatedFolder = tree.get(eventData.path);
        if (updatedFolder && updatedFolder.children) {
          const newNode = updatedFolder.children.find((child) => child.data.isTemporary);
          if (newNode) {
            newNode.edit();
          }
        }
      }
    }
  });

  useElectronEvent<{ path: string; type: string }>("directory:create", async (eventData) => {
    const tree = treeRef.current;
    if (tree) {
      const folderNode = tree.get(eventData.path);
      if (folderNode) {
        ensureFolderExpanded(folderNode, eventData.path, expandedDirsRef);
        const index = folderNode.children ? folderNode.children.length : 0;
        await tree.create({
          type: "internal",
          parentId: eventData.path,
          index,
        });

        const updatedFolder = tree.get(eventData.path);
        if (updatedFolder && updatedFolder.children) {
          const newNode = updatedFolder.children.find((child) => child.data.isTemporary);
          if (newNode) {
            newNode.edit();
          }
        }
      }
    }
  });

  useElectronEvent<{ path: string; type: string }>("directory:close-project", async (eventData) => {
    closeBottomPanel();
    await window.electron?.state.emptyActiveProject();
    queryClient.removeQueries({ queryKey: ["files:tree"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["app:state"] });
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    queryClient.invalidateQueries({ queryKey: ["git:branches"] });
    queryClient.removeQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("git:");
      },
    });
    queryClient.invalidateQueries({ queryKey: ["environments"] });
  });

  useElectronEvent<{ path: string }>("file:rename", async (eventData) => {
    const tree = treeRef.current;
    if (tree) {
      const nodeToRename = tree.get(eventData.path);
      if (nodeToRename) {
        nodeToRename.edit();
      }
    }
  });

  if (isPending && appState?.activeDirectory) {
    return (
      <div className="flex flex-col h-full w-full p-2">
        <div className="flex justify-center items-center h-full">
          <Loader size={14} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (!data) {
    if (isNewProjectMode) {
      return (
        <div className="flex flex-col h-full w-full p-2">
          <div className="flex flex-col">
            <input
              autoFocus
              ref={newProjectInputRef}
              type="text"
              className={`px-2 py-1 border rounded h-7 bg-stone-800 text-stone-200 focus:outline-none focus:ring-1 ${newProjectError ? "border-red-500 focus:ring-red-500" : "border-stone-700 focus:ring-orange-500"
                }`}
              placeholder="Enter new project name..."
              value={tempProjectName}
              onChange={(e) => {
                setTempProjectName(e.target.value);
                setNewProjectError(null);
              }}
              onBlur={(e) => {
                if (!newProjectError) {
                  handleCreateNewProject(e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateNewProject(tempProjectName);
                } else if (e.key === "Escape") {
                  setIsNewProjectMode(false);
                  setTempProjectName("");
                  setNewProjectError(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {newProjectError && <span className="text-red-500 text-xs mt-1">{newProjectError}</span>}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full w-full px-4 py-2 gap-4">
        <div className="text-sm text-text flex flex-col gap-2 mt-4">
          Create a new Voiden project to get started.
          <button
            style={{ maxWidth: "200px" }}
            className="bg-button-primary hover:bg-button-primary-hover rounded transition px-2 py-1"
            onClick={() => setIsNewProjectMode(true)}
          >
            New Voiden project
          </button>
        </div>
        <div className="text-sm text-text flex flex-col gap-2 mt-4">
          Or open an existing project.
          <button
            style={{ maxWidth: "200px" }}
            className="bg-button-primary hover:bg-button-primary-hover transition px-2 py-1"
            onClick={() => openProject("~/")}
          >
            Open a project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full w-full bg-bg"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (data) {
          window.electron?.files.showFileContextMenu({
            path: data.path,
            type: data.type,
            name: data.name,
            isProjectRoot: true,
          });
        }
      }}
    >
      {/* Loading progress bar — always reserve the space to prevent layout shift */}
      <div className="h-0.5 w-full overflow-hidden flex-shrink-0 relative">
        {(showDeleteProgress || isSearching || isTreeBusy) && (
          <div
            className="absolute h-full w-1/3 bg-accent rounded-full"
            style={{ animation: "fileTreeProgress 1.2s ease-in-out infinite" }}
          />
        )}
      </div>
      <div className="p-2 flex items-center gap-2 justify-end">
        {storeIsSearching && (
          <>
            <Input
              type="text"
              className="flex-1 px-2 py-1 border rounded bg-bg"
              placeholder="Search file contents…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setStoreIsSearching(false);
                  setRawQuery("");
                }
                e.stopPropagation();
              }}
              onKeyUp={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              autoFocus
            />
            <Tip label="Match case" side="bottom">
              <button onClick={() => setMatchCase((c) => !c)} className={matchCase ? "bg-active" : ""}>
                <Type size={16} />
              </button>
            </Tip>
            <Tip label="Match whole word" side="bottom">
              <button onClick={() => setMatchWholeWord((w) => !w)} className={matchWholeWord ? "bg-active" : ""}>
                <Hash size={16} />
              </button>
            </Tip>
            <Tip label="Close search" side="bottom">
              <button
                onClick={() => {
                  setStoreIsSearching(false);
                  setRawQuery("");
                }}
                className="p-1 rounded hover:bg-active"
              >
                <X size={16} />
              </button>
            </Tip>
          </>
        )}
        {storeIsSearching && isSearching && <Loader size={14} className="animate-spin text-accent" />}
      </div>
      {storeIsSearching ? (
        <div className="flex flex-col flex-1 overflow-y-auto p-2">
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <svg className="animate-spin h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            </div>
          )}
          {searchError && <div className="text-red-500 text-sm">Error running search: {searchError}</div>}
          {!isSearching && !searchError && searchResults.length === 0 && searchQuery && (
            <div className="text-gray-500 text-sm">No results for "{rawQuery}"</div>
          )}
          {searchResults.length > 0 && (
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {searchResults.map(({ path, line, preview }) => (
                <div
                  key={`${path}:${line}`}
                  className="p-3 bg-active rounded-lg border border-gray-200 hover:bg-transparent transition cursor-pointer"
                  onClick={async () => {
                    const newTab = {
                      id: crypto.randomUUID(),
                      type: "document" as const,
                      title: path.split("/").pop() || path,
                      source: path,
                      directory: null,
                    };
                    const response = await window.electron.state.addPanelTab("main", newTab);
                    const tabId = response?.tabId;
                    if (tabId) {
                      await activateTab({ panelId: "main", tabId });
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-gray-300 truncate">{path.split("/").pop() || path}</span>
                    <span className="text-xs text-gray-300">Line {line}</span>
                  </div>
                  <p className="mt-1 text-sm text-white break-words">
                    {preview
                      .split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, matchCase ? "" : "i"))
                      .map((part, idx) => (
                        <React.Fragment key={idx}>
                          {idx % 2 === 1 ? <mark className="bg-accent text-black rounded">{part}</mark> : part}
                        </React.Fragment>
                      ))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div ref={ref} className="flex-1 overflow-hidden">
          <TreeActionsContext.Provider value={{ expandAllRecursive, collapseAllFromFolder }}>
            <DragOverContext.Provider value={{ dragOverParentId, setDragOverParentId }}>
              <div
                ref={dndRootElement}
                onKeyDown={async (e) => {
                  if (e.key !== "Enter") return;
                  const focused = treeRef.current?.focusedNode ?? treeRef.current?.selectedNodes?.[0];
                  if (!focused || focused.data.isTemporary) return;
                  e.preventDefault();
                  await handleActivate(focused);
                }}
              >
                {treeData && (
                  <Tree
                    dndRootElement={dndRootElement.current}
                    ref={treeRef}
                    data={treeData}
                    width={width}
                    height={height}
                    rowHeight={24}
                    indent={12}
                    idAccessor="path"
                    initialOpenState={getInitialOpenState(data as ExtendedFileTree)}
                    openByDefault={false}
                    onMove={handleMove}
                    disableDrag={() => false}
                    onCreate={handleCreate}
                    disableDrop={({ parentNode, dragNodes }) => {
                      if (!parentNode) return true;
                      return dragNodes.some((node) => node.data.parent === parentNode.data.path);
                    }}
                  >
                    {(nodeProps) => (
                      <TreeNode
                        {...nodeProps}
                        activeFile={activeFile}
                        removeTemporaryNode={handleRemoveTemporaryNode}
                        onFolderToggle={expandLazyNode}
                        refreshDir={refreshDir}
                        expandedDirsRef={expandedDirsRef}
                        treeRef={treeRef}
                      />
                    )}
                  </Tree>
                )}
              </div>
            </DragOverContext.Provider>
          </TreeActionsContext.Provider>
          {/* Empty space at bottom to ensure context menu is always accessible */}
          <div
            className="min-h-[200px]"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (data) {
                window.electron?.files.showFileContextMenu({
                  path: data.path,
                  type: data.type,
                  name: data.name,
                  isProjectRoot: true,
                });
              }
            }}
          />
        </div>
      )}
    </div>
  );
};
