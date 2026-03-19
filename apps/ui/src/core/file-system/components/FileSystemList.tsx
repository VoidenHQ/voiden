import React, { useState, useRef, useEffect, useLayoutEffect, useContext } from "react";
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
import { useQuery } from "@tanstack/react-query";
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
import { useFileTree, useMove } from "@/core/file-system/hooks";
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
  // If you use children, you might want to type it too:
  children?: ExtendedFileTree[];
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
  // Use state to control the input value
  const [name, setName] = useState(node.data.name);

  // On mount or when node.data.name changes, set renaming and focus the input
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
          // If it's a file, select only the name portion
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
}
const DragOverContext = React.createContext<{
  dragOverParentId: string | null;
  setDragOverParentId: (id: string | null) => void;
}>({
  dragOverParentId: null,
  setDragOverParentId: () => { },
});

// Wrapper component for your Tree
function FileTree() {
  const [dragOverParentId, setDragOverParentId] = useState<string | null>(null);

  return (
    <DragOverContext.Provider value={{ dragOverParentId, setDragOverParentId }}>
      <Tree /* your tree props */>
      </Tree>
    </DragOverContext.Provider>
  );
}

function TreeNode({ node, style, dragHandle, activeFile, removeTemporaryNode }: TreeNodeProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverTimer, setDragOverTimer] = useState<NodeJS.Timeout | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const { dragOverParentId, setDragOverParentId } = useContext(DragOverContext);
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


  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (dragOverTimer) {
        clearTimeout(dragOverTimer);
      }
    };
  }, [dragOverTimer]);

  // Helper to map git status to a Tailwind text color class.
  const getGitStatusClass = (gitStatus: any) => {
    if (!gitStatus) return "";

    // If either working_dir or index starts with a '?' then it's untracked.
    if ((gitStatus.working_dir && gitStatus.working_dir.startsWith("?")) || (gitStatus.index && gitStatus.index.startsWith("?")))
      return "text-vcs-added";

    // Modified files.
    if (gitStatus.working_dir === "M" || gitStatus.index === "M") return "text-vcs-modified";
    // Added files.
    if (gitStatus.working_dir === "A" || gitStatus.index === "A") return "text-vcs-added";
    // Deleted files.
    if (gitStatus.working_dir === "D" || gitStatus.index === "D") return "text-red-500";
    // Renamed files.
    if (gitStatus.working_dir === "R" || gitStatus.index === "R") return "text-vcs-modified";

    // Fallback.
    return "";
  };

  // Mutation to create a file via Electron.
  const createFileMutation = useMutation({
    mutationFn: async (newName: string) => {
      // Here we assume that node.data.parent is defined (it comes from our onCreate handler)
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
      // Finalize the inline edit by replacing the temporary node's text.
      node.submit(result.name);
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
      queryClient.invalidateQueries({ queryKey: ["env"] });
    },
    onError: (error) => {
      setError(error.message || "Error creating file");
      node.edit();
    },
  });

  // Mutation to create a file via Electron.
  const createVoidFileMutation = useMutation({
    mutationFn: async (newName: string) => {
      // Here we assume that node.data.parent is defined (it comes from our onCreate handler)
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
      // Finalize the inline edit by replacing the temporary node's text.
      node.submit(result.name);
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
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
      // Here we assume that node.data.parent is defined (it comes from our onCreate handler)
      const result = await window.electron?.files.createDirectory(node.data.parent!, newName);
      if (!result) throw new Error("Directory creation failed");
      return result;
    },
    onSuccess: (result) => {
      // console.debug("createDirectoryMutation onSuccess", result);
      // Finalize the inline edit by replacing the temporary node's text.
      node.submit(result);
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
    },
    onError: (error) => {
      setError(error.message || "Error creating directory");
      node.edit();
    },
  });

  // Mutation to rename a file or directory via Electron.
  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      const result = await window.electron?.state.renameFile(node.data.path, newName);
      if (!result?.success) {
        throw new Error(result?.error || "Renaming failed");
      }
      return result;
    },
    onSuccess: (_, newName) => {
      // Finalize the inline edit by replacing the current text with the new name.
      node.submit(newName);
      // Invalidate queries so the file tree list, panel tabs, and active file update.
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["tab:content"] });
      // Also invalidate the active document to ensure it's updated
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
        // Read file as array buffer
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        // move via Electron
        const result = await window.electron?.files.drop(targetPath, file.name, uint8Array);
        if (!result) throw new Error(`Failed to upload ${file.name}`);
        results.push(result);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
      queryClient.invalidateQueries({ queryKey: ["env"] });
    },
    onError: (error) => {
      console.error("File drop error:", error);
      setError(error.message || "Error drop files");
    },
  });

  const onSubmit = async (newName: string) => {
    // When the submission starts, turn off renaming.
    setIsRenaming(false);

    if (node.data.isTemporary) {
      if (!newName || newName.trim() === "") {
        // console.debug("fixes");
        removeTemporaryNode(node.id);
        return;
      }
      if (node.parent) {
        const siblings = node.parent.children || [];
        // For void files the backend appends ".void", so check against the full final name.
        const effectiveName = node.data.fileKind === "void" ? `${newName}.void` : newName;
        const duplicate = siblings.find((sibling) => sibling.id !== node.id && sibling.data.name === effectiveName);
        if (duplicate) {
          setError("Name already exists");
          node.edit();
          setIsRenaming(true); // keep renaming mode active
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
    renameMutation.mutate(newName);
  };

  // Handle file/folder drop from external sources (Finder, File Explorer, etc.)
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

    // Determine target folder: if dropped on a file, use its parent folder
    let targetFolder = node;
    let targetPath = node.data.path;

    if (node.data.type === "file") {
      if (node.parent) {
        targetFolder = node.parent;
        targetPath = node.parent.data.path;
      }
    }

    // Separate files and folders using the DataTransfer items API
    const regularFiles: File[] = [];
    const folderPaths: string[] = [];

    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        // In Electron, getAsFile() on a directory item returns a File with a .path property
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
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["env"] });
      }

      // Open the target folder if it was closed
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

    // Determine the parent to highlight siblings
    let parentId = null;
    if (node.data.type === "folder") {
      // If dragging over a folder, highlight its children (when opened)
      parentId = node.id;
    } else if (node.parent) {
      // If dragging over a file, highlight siblings (same parent)
      parentId = node.parent.id;
    }

    setDragOverParentId(parentId);

    // Auto-expand logic
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
            // Recursively close nested folders
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

    // Only clear if we're actually leaving the node
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

    // Special filenames
    if (name.startsWith(".env"))          return <Settings2 size={14} style={{ color: "#ecd53f" }} />;
    if (lower === ".gitignore" || lower === ".gitattributes")
                                          return <GitBranch size={14} style={{ color: "#f54d27" }} />;
    if (name.startsWith("Dockerfile") || lower.startsWith("docker-compose"))
                                          return <Container size={14} style={{ color: "#0db7ed" }} />;
    if (lower === "readme.md")            return <Info size={14} style={{ color: "#519aba" }} />;
    if (lower === "package.json" || lower === "package-lock.json")
                                          return <Braces size={14} style={{ color: "#cc3e44" }} />;
    if (lower === "tsconfig.json" || lower.startsWith("tsconfig."))
                                          return <Braces size={14} style={{ color: "#3178c6" }} />;

    const extMatch = path.match(/\.([0-9a-z]+)$/i);
    const ext = extMatch?.[1]?.toLowerCase();

    const iconMap: Record<string, JSX.Element> = {
      // Voiden
      void: <Infinity size={14} className="text-accent" />,

      // TypeScript / JavaScript
      ts:   <FileCode size={14} style={{ color: "#3178c6" }} />,
      tsx:  <FileCode size={14} style={{ color: "#61dafb" }} />,
      js:   <FileCode size={14} style={{ color: "#f7df1e" }} />,
      jsx:  <FileCode size={14} style={{ color: "#61dafb" }} />,
      mjs:  <FileCode size={14} style={{ color: "#f7df1e" }} />,
      cjs:  <FileCode size={14} style={{ color: "#f7df1e" }} />,

      // Web
      html: <FileCode size={14} style={{ color: "#e34c26" }} />,
      htm:  <FileCode size={14} style={{ color: "#e34c26" }} />,
      css:  <Hash size={14} style={{ color: "#563d7c" }} />,
      scss: <Hash size={14} style={{ color: "#c6538c" }} />,
      sass: <Hash size={14} style={{ color: "#c6538c" }} />,
      less: <Hash size={14} style={{ color: "#1d365d" }} />,

      // Data / Config
      json: <Braces size={14} style={{ color: "#cbcb41" }} />,
      yml:  <Braces size={14} style={{ color: "#cc3e44" }} />,
      yaml: <Braces size={14} style={{ color: "#cc3e44" }} />,
      toml: <Braces size={14} style={{ color: "#9c4221" }} />,
      xml:  <FileCode size={14} style={{ color: "#f4a261" }} />,
      csv:  <FileSpreadsheet size={14} style={{ color: "#1e7a1e" }} />,
      sql:  <Database size={14} style={{ color: "#e38c00" }} />,

      // Languages
      py:    <FileCode size={14} style={{ color: "#3776ab" }} />,
      go:    <FileCode size={14} style={{ color: "#00add8" }} />,
      rs:    <FileCode size={14} style={{ color: "#dea584" }} />,
      java:  <FileCode size={14} style={{ color: "#ea2d2e" }} />,
      rb:    <FileCode size={14} style={{ color: "#cc342d" }} />,
      php:   <FileCode size={14} style={{ color: "#8892be" }} />,
      swift: <FileCode size={14} style={{ color: "#f05138" }} />,
      kt:    <FileCode size={14} style={{ color: "#7f52ff" }} />,
      c:     <FileCode size={14} style={{ color: "#a8b9cc" }} />,
      cpp:   <FileCode size={14} style={{ color: "#00427b" }} />,
      cc:    <FileCode size={14} style={{ color: "#00427b" }} />,
      h:     <FileCode size={14} style={{ color: "#a8b9cc" }} />,
      cs:    <FileCode size={14} style={{ color: "#9b4f96" }} />,
      lua:   <FileCode size={14} style={{ color: "#000080" }} />,
      r:     <FileCode size={14} style={{ color: "#276dc3" }} />,

      // Shell / Scripts
      sh:   <FileCode size={14} style={{ color: "#89e051" }} />,
      bash: <FileCode size={14} style={{ color: "#89e051" }} />,
      zsh:  <FileCode size={14} style={{ color: "#89e051" }} />,
      fish: <FileCode size={14} style={{ color: "#89e051" }} />,

      // Docs
      md:  <FileText size={14} style={{ color: "#519aba" }} />,
      txt: <FileText size={14} style={{ color: "#a0adb8" }} />,
      pdf: <FileText size={14} style={{ color: "#e74c3c" }} />,

      // Images
      png:  <Image size={14} style={{ color: "#a074c4" }} />,
      jpg:  <Image size={14} style={{ color: "#a074c4" }} />,
      jpeg: <Image size={14} style={{ color: "#a074c4" }} />,
      gif:  <Image size={14} style={{ color: "#a074c4" }} />,
      svg:  <Image size={14} style={{ color: "#ffb13b" }} />,
      ico:  <Image size={14} style={{ color: "#a074c4" }} />,
      webp: <Image size={14} style={{ color: "#a074c4" }} />,

      // Misc
      lock: <File size={14} style={{ color: "#a0adb8" }} />,
      log:  <File size={14} style={{ color: "#a0adb8" }} />,
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
          // console.error("Failed to open file:", error);
        }
      } else {
        node.toggle();
      }
    }
  };

  useEffect(() => {
    if (!isContextMenuOpen) return;
    const reset = () => setIsContextMenuOpen(false);
    // mousedown fires before contextmenu, so right-clicking elsewhere resets the
    // previous node first. Unlike 'click', mousedown also fires after Electron's
    // native context menu is dismissed by clicking back in the window.
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

  const expandAllFromFolder = (folderNode: NodeApi<ExtendedFileTree>) => {
    const openDescendants = (currentNode: NodeApi<ExtendedFileTree>) => {
      if (currentNode.data.type === "folder" && !currentNode.isOpen) {
        currentNode.open();
      }
      currentNode.children?.forEach(openDescendants);
    };

    openDescendants(folderNode);
  };

  const collapseAllFromFolder = (folderNode: NodeApi<ExtendedFileTree>) => {
    const closeDescendants = (currentNode: NodeApi<ExtendedFileTree>) => {
      currentNode.children?.forEach((child) => {
        if (child.data.type === "folder") {
          closeDescendants(child);
          if (child.isOpen) {
            child.close();
          }
        }
      });
    };

    closeDescendants(folderNode);
    if (folderNode.isOpen) {
      folderNode.close();
    }
  };

  return (
    <div
      style={style}
      ref={dragHandle}
      className={cn(
        "group h-6 overflow-hidden transition-colors border border-transparent",
        !isDragOver && activeFile?.source !== node.data.path && !node.isSelected && 'hover:bg-hover',
        isContextMenuOpen && "border-active",
        activeFile?.source === node.data.path && !isDragOver && "bg-active",
        node.isSelected && node.tree.selectedNodes.length > 1 && activeFile?.source !== node.data.path && !isDragOver && "bg-accent/20",
        node.isFocused && !isDragOver && "ring-0",
        (isDragOver || isInternalDropTargetFolder) && 'bg-accent/30 border-l-2 border-accent',
        // Highlight all siblings when any sibling is being dragged over
        isSiblingHighlight && !isDragOver && !isInternalDropTargetFolder && "bg-accent/30 border-l-2 border-accent"
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
              <ChevronRight size={14} className={`transition-transform ${node.isOpen ? "rotate-90" : ""}`} />
            </div>
          )}
          <div className="w-30">
            {node.data.type !== "folder" && getFileIcon(node.data.name, node.data.path)}
          </div>
          {node.isEditing ? (
          <RenameInput node={node} error={error} setError={setError} onSubmit={onSubmit} setIsRenaming={setIsRenaming} />
        ) : (
          <span
            className={cn(
              "truncate text-ui-fg",
              // For the active file node (with no Git status) show white text.
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
         {
          node.data.type === "folder" && (
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
                      expandAllFromFolder(node);
                    }}
                    className="p-0.5 rounded hover:bg-hover"
                  >
                    <ChevronsUpDown size={12} />
                  </button>
              </Tip>
            </div>
          )
        }
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

export const FileSystemList = () => {
  const { data, isPending } = useFileTree();
  const { data: appState } = useGetAppState();
  const { ref, width, height } = useResizeObserver();
  const { mutateAsync: move } = useMove();
  const { data: activeFile } = useGetActiveDocument();
  const { mutateAsync: openProject } = useOpenProject();
  const { mutateAsync: closeProject } = useCloseActiveProject();
  const { mutateAsync: setActiveProject } = useSetActiveProject();
  const { mutateAsync: activateTab } = useActivateTab();
  const treeRef = useRef<TreeApi<ExtendedFileTree>>(null);

  // Open file / toggle folder on Enter key (react-arborist fires onActivate for Enter)
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
      node.toggle();
    }
  };
  const dndRootElement = useRef<HTMLDivElement>(null);
  const pendingFileKindRef = useRef<"void" | null>(null);
  const queryClient = useQueryClient();

  // Controlled tree data state.
  const [treeData, setTreeData] = useState<ExtendedFileTree[]>([]);

  // Drag over state (must be declared before any conditional returns)
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
        // If result is null/undefined (electron is missing) OR if it contains an error
        throw new Error("Project directory creation failed: Electron API unavailable or unknown error.");
      }

      // Set the active project (your existing logic)
      await setActiveProject(result);

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });

      setIsNewProjectMode(false);

      setTempProjectName("");
    } catch (error) {
      // console.error(error);
      const errorMessage = (error as Error).message || "Error creating project";
      setNewProjectError(errorMessage);
      setTempProjectName(trimmedName); // Assuming trimmedName is defined outside this block
      newProjectInputRef.current?.focus();
    }
  };
  // ---------------------------------------------

  // Full-text search state & hook
  const [rawQuery, setRawQuery] = useState<string>("");
  const searchQuery = useDebounce(rawQuery, 300);
  const [matchCase, setMatchCase] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);

  const { closeBottomPanel } = usePanelStore();
  // Access search store state
  const storeIsSearching = useSearchStore((state) => state.isSearching);
  const setStoreIsSearching = useSearchStore((state) => state.setIsSearching);

  const {
    data: searchResults,
    isLoading: isSearching,
    error: searchError,
  } = useQuery<SearchResult[], Error>({
    queryKey: ["file-search", searchQuery, matchCase, matchWholeWord],
    queryFn: async () => {
      // Pass an object with query, matchCase and matchWholeWord
      const results = await window.electron?.searchFiles({
        query: searchQuery,
        matchCase,
        matchWholeWord,
      });
      return results;
    },
    enabled: !!searchQuery,
    onError: (err: any) => {
      // console.error("[file-search] IPC error:", err);
    },
  });

  useEffect(() => {
    if (data) {
      // Cast the data to ExtendedFileTree
      setTreeData([data as ExtendedFileTree]);
    }
  }, [data]);

  // Scroll to active file in the tree (also opens parent folders).
  // Guard with get() so that if the node isn't in the tree yet (e.g. the tree hasn't
  // refreshed after a new file was just created), we don't scroll to the top.
  useEffect(() => {
    if (activeFile?.source && treeRef.current) {
      const node = treeRef.current.get(activeFile.source);
      if (node) {
        treeRef.current.scrollTo(activeFile.source, "center");
      }
    }
  }, [activeFile?.source]);

  // Provide an initial open state for the root folder.
  const getInitialOpenState = (root: ExtendedFileTree) => {
    const openState: Record<string, boolean> = {};
    if (root.type === "folder") {
      openState[root.path] = true;
    }
    return openState;
  };

  // onCreate handler for tree.create().
  // Note that Arborist may pass a null parentId; here we throw an error if that happens.
  const handleCreate = ({ parentId, index, type }: { parentId: string | null; index: number; type: "leaf" | "internal" }): ExtendedFileTree => {
    if (!parentId) {
      throw new Error("parentId cannot be null");
    }
    // console.debug("onCreate", { parentId, index, type });
    const newId = `temp-${crypto.randomUUID()}`;
    const fileKind = pendingFileKindRef.current ?? undefined;
    pendingFileKindRef.current = null; // ✅ Clear after using
    const newNode: ExtendedFileTree = {
      id: newId,
      name: "",
      path: newId,
      isTemporary: true,
      fileKind: fileKind,
      parent: parentId,
      // If the requested type is "internal", we treat it as a folder.
      type: type === "internal" ? "folder" : "file",
      children: type === "internal" ? [] : undefined,
    };
    setTreeData((prevData) => updateTreeData(prevData, parentId, newNode));
    return newNode;
  };

  // Handler to remove a temporary node from tree data.
  const handleRemoveTemporaryNode = (nodeId: string) => {
    setTreeData((prevData) => removeNodeFromTreeData(prevData, nodeId));
  };

  // Handle moving nodes.
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

    for (const conflict of result.conflicts ?? []) {
      toast.warning(`"${conflict.fileName}" already exists`, {
        description: "A file with this name already exists in the target folder.",
        action: {
          label: "Replace",
          onClick: async () => {
            const replaceResult = await window.electron?.files.moveForce([conflict]);
            if (replaceResult?.success) {
              queryClient.invalidateQueries({ queryKey: ["files:tree"] });
            } else {
              toast.error("Replace failed", { description: replaceResult?.error ?? "Unknown error" });
            }
          },
        },
      });
    }
  };

  // When linkedBlock / fileLink references are updated after a file move, reload any
  // open tabs whose source file was rewritten so editors pick up the new paths.
  useEffect(() => {
    const off = window.electron?.files.onReferencesUpdated((updatedPaths: string[]) => {
      // Clear cached block content (linkedBlock originalFile paths may have changed)
      queryClient.removeQueries({ queryKey: ["voiden-wrapper:blockContent"] });
      // Clear file-existence cache (fileLink filePath paths may have changed)
      queryClient.removeQueries({ queryKey: ["file:exists"] });

      // Reload tabs whose source file was rewritten
      for (const panelId of ["main", "right"]) {
        const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", panelId]);
        for (const tab of panelTabs?.tabs ?? []) {
          if (tab.source && updatedPaths.includes(tab.source)) {
            queryClient.removeQueries({ queryKey: ["tab:content", panelId, tab.id] });
          }
        }
      }

      // Trigger ErrorBoundary reset for any panel showing the stale content
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    });
    return () => off?.();
  }, [queryClient]);

  // Listen for the "file:create" event.
  useElectronEvent<{ path: string; type: string }>("file:create", async (eventData) => {
    // console.debug("file:create event received", eventData);
    const tree = treeRef.current;
    if (tree) {
      const folderNode = tree.get(eventData.path);
      if (folderNode) {
        const index = folderNode.children ? folderNode.children.length : 0;
        await tree.create({
          type: "leaf",
          parentId: eventData.path,
          index,
        });
        const updatedFolder = tree.get(eventData.path);
        // if (updatedFolder && updatedFolder.children?.length) {
        //   const newNode = updatedFolder.children.at(-1); // 👈 same as children[children.length - 1]
        //   newNode?.edit();
        // } else {
        //   console.error("New file node not found in updated folder.");
        // }
        if (updatedFolder && updatedFolder.children) {
          const newNode = updatedFolder.children.find((child) => child.data.isTemporary);
          if (newNode) {
            newNode.edit();
          } else {
            // console.debug("updated folder ", updatedFolder);
            // console.error("Temporary node not found in updated folder.");
          }
        }
      }
    }
  });

  // Listen for the "file:create - void" event.
  useElectronEvent<{ path: string; type: string }>("file:create-void", async (eventData) => {
    // console.debug("file:create void event received", eventData);
    const tree = treeRef.current;
    if (tree) {
      const folderNode = tree.get(eventData.path);
      if (folderNode) {
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
          // console.debug("file - create void new node");
          // console.debug(newNode);
          if (newNode) {
            newNode.edit();
          } else {
            // console.debug("updated folder ", updatedFolder);
            // console.error("Temporary node not found in updated folder.");
          }
        }
      }
    }
  });

  // Listen for the "directory:create" event.
  useElectronEvent<{ path: string; type: string }>("directory:create", async (eventData) => {
    // console.debug("directory:create event received", eventData);
    const tree = treeRef.current;
    if (tree) {
      const folderNode = tree.get(eventData.path);
      if (folderNode) {
        const index = folderNode.children ? folderNode.children.length : 0;
        // Create the new temporary node as an "internal" node (i.e. a folder)
        await tree.create({
          type: "internal",
          parentId: eventData.path,
          index,
        });
        const updatedFolder = tree.get(eventData.path);
        // if (updatedFolder && updatedFolder.children?.length) {
        //   const newNode = updatedFolder.children.at(-1); // 👈 same as children[children.length - 1]
        //   newNode?.edit();
        // } else {
        //   console.error("New file node not found in updated folder.");
        // }

        if (updatedFolder && updatedFolder.children) {
          const newNode = updatedFolder.children.find((child) => child.data.isTemporary);
          if (newNode) {
            newNode.edit();
          } else {
            // console.error("Temporary node not found in updated folder.");
          }
        }
      }
    }
  });

  // Listen for the "directory:close-project" event.
  useElectronEvent<{ path: string; type: string }>("directory:close-project", async (eventData) => {
    closeBottomPanel();
    await window.electron?.state.emptyActiveProject();
    queryClient.removeQueries({ queryKey: ["files:tree"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["app:state"] });
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    queryClient.invalidateQueries({ queryKey: ["git:branches"] });
    queryClient.invalidateQueries({ queryKey: ["environments"] });

  });

  // Listen for the "file:rename" event.
  // When this event is received, locate the node with the given path
  // and switch it to edit mode (i.e. show the temporary input field).
  useElectronEvent<{ path: string }>("file:rename", async (eventData) => {
    const tree = treeRef.current;
    if (tree) {
      const nodeToRename = tree.get(eventData.path);
      if (nodeToRename) {
        nodeToRename.edit();
      } else {
        // console.error(`Node with path ${eventData.path} not found.`);
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
        <div className="text-sm text-text flex flex-col gap-2 mt-4 ">
          Create a new Voiden project to get started.
          <button style={{ maxWidth: '200px' }} className="bg-button-primary hover:bg-button-primary-hover rounded transition px-2 py-1" onClick={() => setIsNewProjectMode(true)}>
            New Voiden project
          </button>
        </div>
        <div className="text-sm text-text flex flex-col gap-2 mt-4">
          Or open an existing project.
          <button style={{ maxWidth: '200px' }} className="bg-button-primary hover:bg-button-primary-hover transition px-2 py-1" onClick={() => openProject("~/")}>
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
        {storeIsSearching && isSearching && <Loader size={14} className="animate-spin" />}
      </div>
      {storeIsSearching ? (
        <div className="flex flex-col flex-1 overflow-y-auto p-2">
          {isSearching && <Loader size={14} className="animate-spin self-center" />}
          {searchError && <div className="text-red-500 text-sm">Error running search: {searchError.message}</div>}
          {!isSearching && !searchError && searchResults?.length === 0 && <div className="text-gray-500 text-sm">No results for "{rawQuery}"</div>}
          {!isSearching && !searchError && searchResults && searchResults.length > 0 && (
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
                      .split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")})`, matchCase ? "" : "i"))
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
                  {(nodeProps) => <TreeNode {...nodeProps} activeFile={activeFile} removeTemporaryNode={handleRemoveTemporaryNode} />}
                </Tree>
              )}
            </div>
          </DragOverContext.Provider>
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
