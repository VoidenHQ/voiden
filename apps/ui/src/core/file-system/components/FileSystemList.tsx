import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { NodeApi, Tree, TreeApi } from "react-arborist";
import type { FileTreeItem } from "@/types";
import { fileTreeDndManager } from "@/core/file-system/components/FileSystemList/dndManager";
import { ChevronRight, CopyMinus, CopyPlus, FilePlus, FolderPlus, Loader } from "lucide-react";
import useResizeObserver from "use-resize-observer";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/core/lib/utils";
import { toast } from "@/core/components/ui/sonner";
import { Tip } from "@/core/components/ui/Tip";
import { useFileTree, useMove, usePrefetchFileList } from "@/core/file-system/hooks";
import { reloadVoidenEditor, useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { useActivateTab } from "@/core/layout/hooks";
import { useGetActiveDocument } from "@/core/documents/hooks";
import { useGetAppState } from "@/core/state/hooks";
import { useElectronEvent } from "@/core/providers";
import { useSearchStore } from "@/core/stores/searchStore";
import { useBlockContentStore } from "@/core/stores/blockContentStore";
import { usePanelStore } from "@/core/stores/panelStore";
import { useRevealInExplorerStore } from "@/core/stores/revealInExplorerStore";
import { emitPluginEvent, getContextMenuItems } from "@/plugins";
import { useSettings } from "@/core/settings/hooks/useSettings";

import { ExtendedFileTree } from "./FileSystemList/types";
import { DragOverContext, TreeActionsContext } from "./FileSystemList/contexts";
import {
  ensureFolderExpanded,
  findNodeByPath,
  getParentPath,
  injectChildren,
  removeNodeByPath,
  removeNodeFromTreeData,
  updateTreeData,
} from "./FileSystemList/treeData";
import { TreeNode, isExternalFileDrag } from "./FileSystemList/TreeNode";
import { useFullTextSearch } from "./FileSystemList/useFullTextSearch";
import { SearchPanel } from "./FileSystemList/SearchPanel";
import { SearchResults } from "./FileSystemList/SearchResults";
import { EmptyState } from "./FileSystemList/EmptyState";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const FileSystemList = () => {
  const { data, isPending, isFetching, dataUpdatedAt } = useFileTree();
  usePrefetchFileList();
  const { data: appState } = useGetAppState();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const pendingTabsEnabled = settings?.editor?.pending_tabs ?? false;

  const [showDeleteProgress, setShowDeleteProgress] = useState(false);
  const [isTreeBusy, setIsTreeBusy] = useState(false);
  const [treeData, setTreeData] = useState<ExtendedFileTree[]>([]);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [dragOverParentId, setDragOverParentId] = useState<string | null>(null);
  // Drives the empty-space-below-the-last-row highlight while an external
  // file drag hovers there — separate from dragOverParentId, which only
  // highlights existing rows (root-level siblings), so the empty area itself
  // had no visual feedback at all even once dropping there actually worked.
  const [isRootAreaDragOver, setIsRootAreaDragOver] = useState(false);
  // Safety net for isRootAreaDragOver getting stuck "on" — dragleave/dragend
  // aren't reliably delivered by every OS's native drag session (most visibly
  // on Windows: dragging a file in from Explorer and having the drag end
  // abnormally — dropped outside the window, cancelled, etc. — can leave the
  // highlight showing forever with nothing actually being dragged). dragover
  // fires continuously while a drag is genuinely still happening over this
  // area, so re-arming this timeout on every dragover and clearing state if
  // it ever goes quiet self-heals regardless of which "the drag ended" event
  // did or didn't fire. Mirrors the same fix in TreeNode.tsx's own rows.
  const rootDragOverWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armRootDragOverWatchdog = () => {
    if (rootDragOverWatchdogRef.current) clearTimeout(rootDragOverWatchdogRef.current);
    rootDragOverWatchdogRef.current = setTimeout(() => {
      rootDragOverWatchdogRef.current = null;
      setIsRootAreaDragOver(false);
      setDragOverParentId(null);
    }, 600);
  };
  useEffect(() => {
    return () => {
      if (rootDragOverWatchdogRef.current) clearTimeout(rootDragOverWatchdogRef.current);
    };
  }, []);
  // Mirrors the root node's real open/closed state (root starts open — see
  // getInitialOpenState below) so the header's chevron rotates in sync with
  // whether its direct children are actually showing.
  const [isRootExpanded, setIsRootExpanded] = useState(true);
  // Drives the header's single alternating expand-all/collapse-all button
  // (CopyPlus <-> CopyMinus) — a bulk-action toggle, not a live reflection of
  // every individual row's open state.
  const [isRootChildrenExpanded, setIsRootChildrenExpanded] = useState(false);

  const { ref, width, height } = useResizeObserver();
  // use-resize-observer's `ref` is a callback ref (not an object ref), so it
  // has no `.current` to read from elsewhere — keep our own object ref to the
  // same node, merged onto the div below, for the scrollbar effect to query.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = (el: HTMLDivElement | null) => {
    ref(el);
    rootRef.current = el;
  };
  const { mutateAsync: move } = useMove();
  const { data: activeFile } = useGetActiveDocument();
  const { mutateAsync: activateTab } = useActivateTab();
  const treeRef = useRef<TreeApi<ExtendedFileTree>>(null);
  const dndRootElement = useRef<HTMLDivElement>(null);
  const expandedDirsRef = useRef<Set<string>>(new Set());
  const pendingDuplicateRenamePathRef = useRef<string | null>(null);
  const pendingFileKindRef = useRef<"void" | null>(null);
  // Guards against the `data` effect resetting the whole tree on subsequent refetches.
  const isFirstLoadRef = useRef(true);

  // Scrollbar only shows while actively scrolling (or hovering) — matches a
  // macOS-style overlay scrollbar instead of the app's default always-visible
  // dimmed thumb. react-window's list owns the actual scrollable div (found
  // via the .file-tree-scroll className passed to <Tree> below), so we can't
  // attach a ref to it directly — query for it after mount instead, retrying
  // briefly in case the list hasn't rendered yet on the first pass.
  useEffect(() => {
    let attempt = 0;
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;
    let scrollEl: HTMLElement | null = null;
    let cancelled = false;

    const handleScroll = () => {
      scrollEl?.classList.add("is-scrolling");
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => scrollEl?.classList.remove("is-scrolling"), 800);
    };

    const tryAttach = () => {
      if (cancelled) return;
      scrollEl = rootRef.current?.querySelector<HTMLElement>(".file-tree-scroll") ?? null;
      if (!scrollEl) {
        if (attempt++ < 10) setTimeout(tryAttach, 100);
        return;
      }
      scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    };
    tryAttach();

    return () => {
      cancelled = true;
      if (hideTimeout) clearTimeout(hideTimeout);
      scrollEl?.removeEventListener("scroll", handleScroll);
    };
  }, [!!treeData]);

  // ─── Delete progress / file deletion events ──────────────────────────────────
  useElectronEvent("file:delete-start", () => setShowDeleteProgress(true));
  useElectronEvent("file:delete-complete", () => setShowDeleteProgress(false));
  useElectronEvent("file:bulk-delete-complete", () => setShowDeleteProgress(false));
  useElectronEvent<{ path: string }>("file:delete", (eventData) => {
    if (!eventData?.path) return;
    setTreeData((prev) => removeNodeByPath(prev, eventData.path));
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    queryClient.invalidateQueries({ queryKey: ["app:state"] });
    emitPluginEvent('file:deleted', {
      filePath: eventData.path,
      name: eventData.name ?? eventData.path.split('/').pop() ?? '',
      type: 'file',
    });
  });
  useElectronEvent<{ path: string }>("directory:delete", (eventData) => {
    if (!eventData?.path) return;
    setTreeData((prev) => removeNodeByPath(prev, eventData.path));
    expandedDirsRef.current.delete(eventData.path);
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    queryClient.invalidateQueries({ queryKey: ["app:state"] });
    emitPluginEvent('directory:deleted', {
      filePath: eventData.path,
      name: eventData.name ?? eventData.path.split('/').pop() ?? '',
      type: 'directory',
    });
  });

  // Route plugin file context menu actions back to the registered plugin handlers
  useEffect(() => {
    const unsub = window.electron?.files.onPluginFileContextAction?.((data) => {
      const items = getContextMenuItems('file', data.target);
      items.find((item) => item.id === data.id)?.action(data.target);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    // Fallback: also clear if the tree finishes a refetch (e.g. single-file delete via context menu).
    if (!isFetching) setShowDeleteProgress(false);
  }, [isFetching]);

  // ─── refreshDir ──────────────────────────────────────────────────────────────
  // Surgically re-fetches a single directory's children and injects them into
  // treeData without touching the rest of the tree. Replaces full-tree
  // invalidation so expanded state, scroll position, and siblings are preserved.
  const refreshDir = useCallback(async (dirPath: string) => {
    const electronFiles = window.electron?.files;
    if (!electronFiles) return;
    const wasOpen = treeRef.current?.get(dirPath)?.isOpen ?? false;
    try {
      const children = await electronFiles.expandDir(dirPath);
      if (children) {
        setTreeData((prev) => {
          // Preserve already-expanded siblings.
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
          // Re-open dir + previously-expanded siblings after render.
          // Skip lazy nodes — caller fetches their children first.
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
    // expandDirAll isn't in the electron typings yet; cast via unknown to keep it type-safe.
    const ipcExpandDirAll = (window.electron?.files as unknown as {
      expandDirAll?: (dirPath: string) => Promise<Record<string, ExtendedFileTree[]>>;
    } | undefined)?.expandDirAll;
    if (!ipcExpandDirAll) return;

    setIsTreeBusy(true);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      // Phase 1: one IPC call fetches the entire subtree (was N calls, one per dir).
      const allChildren = await ipcExpandDirAll(startPath);
      if (!allChildren || Object.keys(allChildren).length === 0) {
        setIsTreeBusy(false);
        return;
      }

      // Rebuild BFS level order so we inject and open parents before children.
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

      // Phase 2: inject all data in one setTreeData call (one React render).
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

      // Phase 3: open level by level. react-arborist.get() is visibility-limited
      // so parents must open before children become findable.
      for (const levelPaths of leveledPaths) {
        for (const dirPath of levelPaths) {
          expandedDirsRef.current.add(dirPath);
          treeRef.current?.get(dirPath)?.open();
        }
        await frame();
      }
    } finally {
      setIsTreeBusy(false);
    }
  }, []);

  // `includeSelf` closes folderNode along with its descendants (the normal
  // per-row "Collapse all" behavior). The root header passes includeSelf:false
  // so collapsing all children never closes the project root itself — root is
  // always force-open, and closing it would blank the entire tree with no way
  // to reopen it since its own row is permanently covered by the pinned header.
  const collapseAllFromFolder = useCallback(async (folderNode: NodeApi<ExtendedFileTree>, options?: { includeSelf?: boolean }) => {
    const includeSelf = options?.includeSelf ?? true;
    const toClose: NodeApi<ExtendedFileTree>[] = [];
    const collect = (n: NodeApi<ExtendedFileTree>) => {
      n.children?.forEach((child) => {
        if (child.data.type === "folder") {
          collect(child);
          if (child.isOpen) toClose.push(child);
        }
      });
    };
    collect(folderNode);
    if (includeSelf && folderNode.isOpen) toClose.push(folderNode);
    if (toClose.length === 0) return;

    setIsTreeBusy(true);
    try {
      // Close in batches of 20 per frame so the browser stays responsive
      // on huge trees (1000+ open nodes).
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
    async (node: NodeApi<ExtendedFileTree>) => {
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

  /** Selected/focused tree nodes as deletable FileTreeItems — excludes the
   * project root (Delete is hidden for it in the context menu too) and any
   * in-flight "new file/folder" placeholder node. */
  const buildDeletableItems = useCallback((): FileTreeItem[] => {
    const rootPath = treeData?.[0]?.path;
    const nodes = treeRef.current?.selectedNodes?.length
      ? treeRef.current.selectedNodes
      : treeRef.current?.focusedNode
        ? [treeRef.current.focusedNode]
        : [];
    return nodes
      .filter((n) => n && !n.data.isTemporary && n.data.path !== rootPath)
      .map((n) => ({ path: n.data.path, type: n.data.type, name: n.data.name }));
  }, [treeData]);

  // Delete — Cmd+Backspace (macOS) or Delete (others), matching the file
  // context menu's own "Delete" accelerator (see menus.ts). That accelerator
  // only works while the popup is actually open — Electron doesn't globally
  // register accelerators declared on a context menu — so a tree node merely
  // being selected needs its own listener, and it needs to be window-level
  // (not scoped to the tree's own container) because selecting a file with a
  // click also opens it as a tab, which typically hands keyboard focus to
  // that tab's editor — a listener scoped to the tree would then never see
  // the very next Delete/Cmd+Backspace press at all, which is what made this
  // shortcut feel like it "sometimes doesn't work".
  useEffect(() => {
    const handleGlobalDelete = async (e: KeyboardEvent) => {
      const isDeleteCombo = isMac
        ? e.key === "Backspace" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
        : e.key === "Delete" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (!isDeleteCombo) return;

      // Skip while the tree's own inline rename input is focused (plain
      // "Delete" there is normal text editing) and, more generally, while
      // focus is in any editable context anywhere in the app — an <input>,
      // <textarea>, or a contentEditable element (covers the code/voiden
      // editors) — so this global listener never hijacks ordinary text
      // deletion outside the file tree.
      if (treeRef.current?.isEditing) return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable) return;
      }

      const items = buildDeletableItems();
      if (items.length > 0) {
        e.preventDefault();
        await window.electron?.files.deleteItems(items);
      }
    };

    window.addEventListener("keydown", handleGlobalDelete);
    return () => window.removeEventListener("keydown", handleGlobalDelete);
  }, [buildDeletableItems]);

  /** Reports the tree's current focus/selection to the main process so its
   * Option+Cmd+R / Ctrl+Shift+R handler can reveal it instead of force-
   * reloading — see getFileTreeFocus() in menus.ts. Unlike buildDeletableItems,
   * the project root is a valid reveal target (only Delete excludes it). */
  const reportTreeFocus = (node: NodeApi<ExtendedFileTree> | null | undefined) => {
    if (!node || node.data.isTemporary) {
      window.electron?.files.setTreeFocusState(null);
      return;
    }
    window.electron?.files.setTreeFocusState({ path: node.data.path, type: node.data.type, name: node.data.name });
  };

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

  // ─── Full-text search ────────────────────────────────────────────────────────
  const { closeBottomPanel } = usePanelStore();
  const { storeIsSearching, openSearchTick, openWithReplaceTick } = useSearchStore(useShallow((state) => ({
    storeIsSearching: state.isSearching,
    openSearchTick: state.openTick,
    openWithReplaceTick: state.openWithReplaceTick,
  })));
  const setStoreIsSearching = useSearchStore((state) => state.setIsSearching);

  // After a replace writes to disk, reload any open tab pointing at a changed
  // file. The main-process file watcher does not reliably fire for these
  // programmatic writes, so refresh the affected tabs explicitly across every
  // panel (not just main/right).
  const handleFilesReplaced = useCallback(async (paths: string[]) => {
    useBlockContentStore.getState().clearBlocks();
    queryClient.removeQueries({ queryKey: ["voiden-wrapper:blockContent"] });
    const panelQueries = queryClient.getQueryCache().findAll({ queryKey: ["panel:tabs"] });
    for (const q of panelQueries) {
      const panelId = q.queryKey[1] as string;
      const data = q.state.data as { tabs?: { id: string; source: string | null }[] } | undefined;
      for (const tab of data?.tabs ?? []) {
        if (!tab.id) continue;
        if (tab.source && paths.includes(tab.source)) {
          useEditorStore.getState().clearUnsaved(tab.id);
          queryClient.removeQueries({ queryKey: ["tab:content", panelId, tab.id] });
          await reloadVoidenEditor(tab.id);
        } else {
          queryClient.invalidateQueries({ queryKey: ["tab:content", panelId, tab.id] });
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
  }, [queryClient]);

  const search = useFullTextSearch({
    storeIsSearching,
    openSearchTick,
    openWithReplaceTick,
    activeFileSource: activeFile?.source,
    activeDirectory: appState?.activeDirectory,
    onFilesReplaced: handleFilesReplaced,
  });

  // ─── Sync server data → treeData ─────────────────────────────────────────────
  // First load: initialise treeData from server response, then re-expand any
  // directories that were open before (e.g. after a project switch).
  //
  // Subsequent refetches (delete events, etc.): merge in new root children while
  // preserving expanded subtrees so open folders don't collapse.
  useEffect(() => {
    if (!data) return;

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      setTreeData([data as ExtendedFileTree]);

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

    // Subsequent refetches: merge in new root children while preserving expanded subtrees.
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
    // dataUpdatedAt (not data) drives this — React Query's structural sharing keeps
    // the data reference the same when only deep children changed.
    const dirsToRefresh = [...expandedDirsRef.current];
    if (dirsToRefresh.length > 0) {
      const electronFiles = window.electron?.files;
      if (electronFiles) {
        (async () => {
          const results: { dirPath: string; children: ExtendedFileTree[] }[] = [];
          await Promise.all(
            dirsToRefresh.map(async (dirPath) => {
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
              const node = treeRef.current?.get(dirPath);
              if (node && !node.isOpen) node.open();
            }
          }, 0);
        })();
      }
    }
  }, [data, dataUpdatedAt]);

  // Reset first-load guard whenever the active project changes so switching
  // projects re-initialises the tree correctly.
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
  // `files:tree` invalidation alone doesn't work — the subsequent-refetch handler
  // discards incoming data to preserve expanded state. refreshDir patches the parent.
  useElectronEvent<{ path: string }>("file:new", (eventData) => {
    const newPath = eventData?.path;
    if (!newPath) return;
    // Walk up until we find an ancestor already rendered. Needed when a deep
    // path (e.g. from OpenAPI import) is created before intermediate dirs exist.
    let target = getParentPath(newPath);
    while (target && !treeRef.current?.get(target)) {
      const parent = getParentPath(target);
      if (!parent || parent === target) { target = ""; break; }
      target = parent;
    }
    if (target) refreshDir(target);
    const isDir = eventData?.type === 'directory' || eventData?.type === 'folder';
    emitPluginEvent(isDir ? 'directory:created' : 'file:created', {
      filePath: newPath,
      name: eventData?.name ?? newPath.split('/').pop() ?? '',
      type: isDir ? 'directory' : 'file',
    });
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

  // Row *selection* (highlighting whatever the active tab is) tracks the
  // active file continuously — this is cheap and non-disruptive (it doesn't
  // move scroll position or open/close anything), so unlike the expand+
  // scroll effect below it doesn't need gating behind an explicit signal.
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;

    if (!activeFile?.source) {
      const { anchor, mostRecent } = tree.state.nodes.selection;
      tree.setSelection({ ids: [], anchor, mostRecent });
      return;
    }

    const source = activeFile.source;
    tree.setSelection({ ids: [source], anchor: source, mostRecent: source });
  }, [activeFile?.source]);

  // Expand-ancestors-and-scroll only runs for an explicit "reveal this file"
  // request (Quick Open, a search result, ...) — see revealInExplorerStore's
  // doc comment for why this can no longer just key off activeFile?.source.
  const pendingRevealPath = useRevealInExplorerStore((s) => s.pendingRevealPath);
  const clearReveal = useRevealInExplorerStore((s) => s.clearReveal);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || !pendingRevealPath) return;
    // Only actually reveal once the requested path really is the active
    // file — avoids expanding/scrolling to somewhere the user isn't
    // currently looking at if a reveal request and the tab-activation it's
    // paired with haven't both landed yet.
    if (activeFile?.source !== pendingRevealPath) return;

    const source = pendingRevealPath;
    let cancelled = false;

    const expandAndScroll = async () => {
      const ancestors: string[] = [];
      let cursor = getParentPath(source);
      while (cursor) {
        ancestors.unshift(cursor);
        const parent = getParentPath(cursor);
        if (!parent || parent === cursor) break;
        cursor = parent;
      }

      for (const ancestorPath of ancestors) {
        if (cancelled) return;
        const node = tree.get(ancestorPath);
        if (!node) continue;

        if (node.data.lazy) {
          const children = await window.electron?.files.expandDir(ancestorPath);
          if (children) {
            setTreeData((prev) => injectChildren(prev, ancestorPath, children as ExtendedFileTree[]));
            expandedDirsRef.current.add(ancestorPath);
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

      setTimeout(() => {
        if (cancelled) return;
        treeRef.current?.scrollTo(source, "auto");
      }, 50);
    };

    expandAndScroll().finally(() => {
      if (!cancelled) clearReveal();
    });

    return () => {
      cancelled = true;
    };
  }, [pendingRevealPath, activeFile?.source, clearReveal]);

  const getInitialOpenState = (root: ExtendedFileTree) => {
    const openState: Record<string, boolean> = {};
    if (root.type === "folder") {
      openState[root.path] = true;
    }
    return openState;
  };

  const handleCreate = ({ parentId, type }: { parentId: string | null; index: number; type: "leaf" | "internal" }): ExtendedFileTree => {
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
      fileKind,
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
    // react-arborist reports parentId/parentNode as null when a drop lands
    // in empty space rather than on any row — its own MoveHandler type has
    // both typed nullable for exactly this reason (confirmed against
    // node_modules/react-arborist's types/handlers.d.ts). That's "drop at
    // the tree's root", not "no valid target" — bailing out here silently
    // ate every drop that didn't land squarely on an existing row, which is
    // most of the empty area below the last item. Resolve it to the actual
    // project root instead of discarding it.
    const rootPath = treeData?.[0]?.path;
    const resolvedParentId = parentId ?? rootPath ?? null;
    if (!resolvedParentId) return;
    const resolvedParentNode = parentNode ?? treeRef.current?.get(resolvedParentId) ?? null;
    if (!resolvedParentNode) return;

    const draggedItems = dragIds.map((id) => resolvedParentNode.tree.get(id));
    const isSameDirectory = draggedItems.some((node) => node?.data.parent === resolvedParentId);
    if (isSameDirectory) return;

    const result = await move({ dragIds, parentId: resolvedParentId });
    if (!result) return;

    if (result.error) {
      toast.error("Move failed", { description: result.error });
      return;
    }

    const sourceDirs = new Set(
      dragIds
        .map((id) => resolvedParentNode.tree.get(id)?.data.parent)
        .filter(Boolean) as string[],
    );
    for (const dir of sourceDirs) {
      await refreshDir(dir);
    }
    await refreshDir(resolvedParentId);

    // Invalidate tab content for all open panels so moved files refresh
    // and references resolve with new paths.
    invalidateAllPanelTabContent(queryClient);
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
              for (const dir of sourceDirs) await refreshDir(dir);
              await refreshDir(resolvedParentId);
              invalidateAllPanelTabContent(queryClient);
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

  // External-file drops (from Finder/Explorer) landing in the empty space
  // below the last row never reach a row's own onDrop at all — that handler
  // only exists on each TreeNode's own DOM element (see TreeNode.tsx), so
  // there's nothing there to bubble from when the cursor isn't over an
  // actual row. Rows call stopPropagation() for external drags once they
  // handle one (TreeNode.tsx's handleDragOver/handleDrop), so this
  // container-level pair only ever fires for a drag that no row already
  // claimed — i.e. genuinely empty space — and treats it as "drop into the
  // project root", the same fallback used for internal reordering above.
  const handleContainerDragOver = (e: DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();

    setIsRootAreaDragOver(true);
    armRootDragOverWatchdog();
    // Reuses the same context TreeNode.tsx's rows read for their own
    // "sibling of the drop target" highlight (bg-accent/30 on dragOverParentId
    // matches), so root-level items visibly highlight the same way they
    // already do when a drag hovers directly over one of them — dropping in
    // the empty space is really "drop into the root", so the root's existing
    // children should read as the drop's siblings here too.
    const rootPath = treeData?.[0]?.path;
    if (rootPath) setDragOverParentId(rootPath);
  };

  const handleContainerDragLeave = (e: DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    // Only clear on actually leaving the container's bounds, not when
    // moving between its own children — same boundary check TreeNode.tsx's
    // handleDragLeave uses, for the same reason.
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX >= rect.right || e.clientY < rect.top || e.clientY >= rect.bottom) {
      setIsRootAreaDragOver(false);
      setDragOverParentId(null);
      if (rootDragOverWatchdogRef.current) {
        clearTimeout(rootDragOverWatchdogRef.current);
        rootDragOverWatchdogRef.current = null;
      }
    }
  };

  const handleContainerDrop = async (e: DragEvent) => {
    setIsRootAreaDragOver(false);
    setDragOverParentId(null);
    if (rootDragOverWatchdogRef.current) {
      clearTimeout(rootDragOverWatchdogRef.current);
      rootDragOverWatchdogRef.current = null;
    }
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rootPath = treeData?.[0]?.path;
    if (!rootPath) return;

    const regularFiles: File[] = [];
    const folderPaths: string[] = [];
    const unresolvedFolderNames: string[] = [];
    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        // A directory DataTransferItem's own getAsFile() returns null per
        // spec (File objects represent files, not directories) — Electron
        // used to patch a `.path` onto it anyway, but removed that in
        // v30+ as a deliberate Chromium-security-driven change (see
        // electron/electron#44370, #44600, #47284). webUtils.getPathForFile
        // is the current replacement, exposed via the preload since it only
        // works called from there.
        const file = item.getAsFile();
        const path = file ? window.electron?.utils.getPathForFile(file) : undefined;
        if (path) {
          folderPaths.push(path);
        } else {
          unresolvedFolderNames.push(entry.name);
        }
      } else {
        const file = item.getAsFile();
        if (file) regularFiles.push(file);
      }
    }

    if (unresolvedFolderNames.length > 0) {
      toast.error("Couldn't read folder path", {
        description: `"${unresolvedFolderNames.join('", "')}" could not be resolved to a real filesystem path from the drag data.`,
      });
    }

    try {
      for (const file of regularFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const result = await window.electron?.files.drop(rootPath, file.name, uint8Array);
        if (!result) throw new Error(`Failed to upload ${file.name}`);
      }
      for (const folderPath of folderPaths) {
        const result = await window.electron?.files.dropFolder(rootPath, folderPath);
        if (result && !result.success) {
          throw new Error(result.error ?? `Failed to drop folder "${folderPath}"`);
        }
      }
      if (regularFiles.length > 0 || folderPaths.length > 0) {
        await refreshDir(rootPath);
        queryClient.invalidateQueries({ queryKey: ["env"] });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to drop items onto project root:", err);
      toast.error("Drop failed", { description: message });
    }
  };

  useEffect(() => {
    const off = window.electron?.files.onReferencesUpdated(async (updatedPaths: string[]) => {
      useBlockContentStore.getState().clearBlocks();
      queryClient.removeQueries({ queryKey: ["voiden-wrapper:blockContent"] });
      queryClient.removeQueries({ queryKey: ["file:exists"] });

      for (const panelId of ["main"]) {
        const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", panelId]);
        for (const tab of panelTabs?.tabs ?? []) {
          if (!tab.id) continue;
          if (tab.source && updatedPaths.includes(tab.source)) {
            // Tab's file was rewritten on disk with updated references.
            // Clear stale unsaved content so editor isn't blocked, remove cached query
            // data, then force reload from disk.
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

  // Shared by the "New file..." context-menu item (via the file:create electron
  // event) and the root folder's toolbar "New File" button.
  const handleCreateFile = useCallback(async (path: string) => {
    const tree = treeRef.current;
    if (!tree) return;
    const folderNode = tree.get(path);
    if (!folderNode) return;

    ensureFolderExpanded(folderNode, path, expandedDirsRef);

    if (folderNode.data.lazy) {
      const electronFiles = window.electron?.files as NonNullable<typeof window.electron>["files"] | undefined;
      if (electronFiles) {
        const children = await electronFiles.expandDir(path);
        if (children) {
          expandedDirsRef.current.add(path);
          setTreeData((prev) => injectChildren(prev, path, children as ExtendedFileTree[]));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          treeRef.current?.get(path)?.open();
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    const index = tree.get(path)?.children?.length ?? 0;
    await tree.create({ type: "leaf", parentId: path, index });
    const updatedFolder = tree.get(path);
    if (updatedFolder?.children) {
      const newNode = updatedFolder.children.find((child) => child.data.isTemporary);
      if (newNode) newNode.edit();
    }
  }, []);

  useElectronEvent<{ path: string; type: string }>("file:create", (eventData) => {
    if (eventData?.path) void handleCreateFile(eventData.path);
  });

  useElectronEvent<{ path: string; type: string }>("file:create-void", async (eventData) => {
    const tree = treeRef.current;
    if (!tree) return;
    const folderNode = tree.get(eventData.path);
    if (!folderNode) return;
    ensureFolderExpanded(folderNode, eventData.path, expandedDirsRef);
    const index = folderNode.children ? folderNode.children.length : 0;
    pendingFileKindRef.current = "void";
    await tree.create({ type: "leaf", parentId: eventData.path, index });
    const updatedFolder = tree.get(eventData.path);
    const newNode = updatedFolder?.children?.find((child) => child.data.isTemporary);
    if (newNode) newNode.edit();
  });

  useElectronEvent<{ path: string }>("file:create-inherited-config", async (eventData) => {
    if (!window.electron?.files?.createInheritedConfig) return;
    const result = await window.electron.files.createInheritedConfig(eventData.path);
    if (!result?.path) return;

    // Refresh the folder so the file appears in the tree.
    await refreshDir(eventData.path);

    // Derive a meaningful tab title from the containing folder name.
    const folderName = eventData.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "inherited";
    const inheritedTabTitle = `${folderName} — inherited`;

    // Open the file in a new tab.
    const newTab = {
      id: crypto.randomUUID(),
      type: "document" as const,
      title: inheritedTabTitle,
      source: result.path,
      directory: null,
    };
    const response = await window.electron?.state.addPanelTab("main", newTab);
    if (response?.tabId) {
      activateTab({ panelId: "main", tabId: response.tabId });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    }
  });

  // Shared by the "New folder..." context-menu item (via the directory:create
  // electron event) and the root folder's toolbar "New Folder" button.
  const handleCreateDirectory = useCallback(async (path: string) => {
    const tree = treeRef.current;
    if (!tree) return;
    const folderNode = tree.get(path);
    if (!folderNode) return;
    ensureFolderExpanded(folderNode, path, expandedDirsRef);
    const index = folderNode.children ? folderNode.children.length : 0;
    await tree.create({ type: "internal", parentId: path, index });
    const updatedFolder = tree.get(path);
    const newNode = updatedFolder?.children?.find((child) => child.data.isTemporary);
    if (newNode) newNode.edit();
  }, []);

  useElectronEvent<{ path: string; type: string }>("directory:create", (eventData) => {
    if (eventData?.path) void handleCreateDirectory(eventData.path);
  });

  useElectronEvent<{ path: string; type: string }>("directory:close-project", async () => {
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
    if (!tree) return;
    const nodeToRename = tree.get(eventData.path);
    if (nodeToRename) nodeToRename.edit();
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
    return <EmptyState />;
  }

  const onSearchClose = () => {
    setStoreIsSearching(false);
    search.resetSearch();
  };

  return (
    <div
      className="flex flex-col h-full w-full bg-bg"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (data) {
          const _rootTarget = { path: data.path, type: data.type, name: data.name };
          window.electron?.files.showFileContextMenu({
            ..._rootTarget,
            isProjectRoot: true,
            pluginItems: getContextMenuItems('file', _rootTarget).map((i) => ({ id: i.id, label: i.label })),
          });
        }
      }}
    >
      {/* Loading progress bar — always reserve space to prevent layout shift */}
      <div className="h-0.5 w-full overflow-hidden flex-shrink-0 relative">
        {(showDeleteProgress || search.isSearching || isTreeBusy) && (
          <div
            className="absolute h-full w-1/3 bg-accent rounded-full"
            style={{ animation: "fileTreeProgress 1.2s ease-in-out infinite", transform: "translateX(-100%)" }}
          />
        )}
      </div>

      {/* Search Panel — always rendered, visibility controlled by CSS */}
      <div className={cn("p-2", !storeIsSearching && "hidden")}>
        <SearchPanel search={search} onClose={onSearchClose} />
      </div>

      {/* Search Results — always rendered, visibility controlled by CSS */}
      <div
        className={cn("flex flex-col flex-1 overflow-y-auto p-2", !storeIsSearching && "hidden")}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <SearchResults
          rawQuery={search.rawQuery}
          searchQuery={search.searchQuery}
          searchResults={search.searchResults}
          isSearching={search.isSearching}
          searchError={search.searchError}
          matchCase={search.matchCase}
          matchWholeWord={search.matchWholeWord}
          useRegex={search.useRegex}
          useMultiline={search.useMultiline}
          activateTab={activateTab}
          onReplaceMatch={search.showReplace ? search.replaceMatch : undefined}
          onReplaceInFile={search.showReplace ? search.replaceInFile : undefined}
          isReplacing={search.isReplacing}
          replacedMatches={search.replacedMatches}
        />
      </div>

      {/* File System Tree — always rendered, visibility controlled by CSS */}
      <div ref={setRootRef} className={cn("file-tree-root relative flex-1 overflow-hidden", storeIsSearching && "hidden")}>
        {/* Pinned root/project folder header — rendered outside react-arborist's
            virtualized list (which unmounts off-screen rows) so it stays visible
            no matter how far the tree is scrolled, VS Code-style. It's an overlay
            that always covers row 0 (the actual root row, still present in
            `treeData` for the tree's own logic), rather than a duplicate row. */}
        {treeData?.[0] && (
          <div
            className="group/root-header absolute text-comment top-0 left-0 right-0 h-[22px] z-[5] flex items-center justify-between bg-panel border-b border-border"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.electron?.files.showFileContextMenu({
                path: treeData[0].path,
                type: "folder",
                name: treeData[0].name,
                isProjectRoot: true,
              });
            }}
          >
            {/* Icons stay pinned to the right (justify-between) rather than
                hugging the name — min-w-0/flex-1/truncate below keep a long
                name from pushing them off-screen; a short name just leaves a
                gap before them, which is the intended toolbar-style layout. */}
            <button
              className="flex items-center gap-1 pl-2 min-w-0 flex-1 h-full"
              onClick={(e) => {
                e.stopPropagation();
                // Plain disclosure toggle — shows/hides root's direct children,
                // same as clicking any other folder's own chevron. Not a
                // recursive expand/collapse of everything nested inside.
                const rootNode = treeRef.current?.get(treeData[0].path);
                if (!rootNode) return;
                rootNode.toggle();
                setIsRootExpanded(rootNode.isOpen);
              }}
            >
              <ChevronRight size={14} className={cn("flex-shrink-0 transition-transform", isRootExpanded && "rotate-90")} />
              <span className="truncate font-semibold ">{treeData[0].name}</span>
            </button>
            {/* Always visible (not hover-reveal) so these stay reachable at any
                sidebar width — the name above truncates first via min-w-0. */}
            <div className="flex items-center flex-shrink-0 min-w-0 px-2">
              <Tip label="New File" side="bottom" align="end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateFile(treeData[0].path);
                  }}
                  className="p-0.5 hover:text-text rounded hover:bg-hover"
                >
                  <FilePlus size={14} />
                </button>
              </Tip>
              <Tip label="New Folder" side="bottom" align="end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateDirectory(treeData[0].path);
                  }}
                  className="p-0.5 hover:text-text rounded hover:bg-hover ml-1"
                >
                  <FolderPlus size={14} />
                </button>
              </Tip>
              <Tip label={isRootChildrenExpanded ? "Collapse all" : "Expand all"} side="bottom" align="end">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isRootChildrenExpanded) {
                      const rootNode = treeRef.current?.get(treeData[0].path);
                      if (rootNode) await collapseAllFromFolder(rootNode, { includeSelf: false });
                    } else {
                      await expandAllRecursive(treeData[0].path);
                    }
                    setIsRootChildrenExpanded((prev) => !prev);
                  }}
                  className="p-0.5 hover:text-text rounded hover:bg-hover ml-1"
                >
                  {isRootChildrenExpanded ? <CopyMinus size={14} /> : <CopyPlus size={14} />}
                </button>
              </Tip>
            </div>
          </div>
        )}
        <TreeActionsContext.Provider value={{ expandAllRecursive, collapseAllFromFolder, createFile: handleCreateFile, createDirectory: handleCreateDirectory }}>
          <DragOverContext.Provider value={{ dragOverParentId, setDragOverParentId }}>
            <div
              ref={dndRootElement}
              className={cn(isRootAreaDragOver && "bg-accent/10")}
              onKeyDown={async (e) => {
                // Delete used to be handled here too, but this listener only
                // ever fires while keyboard focus is literally inside this
                // tree container — selecting a file with a click also opens
                // it as a tab, which typically hands focus to that tab's
                // editor, so the very next Delete/Cmd+Backspace press would
                // silently do nothing (the keydown never reaches this
                // element at all). That's the "sometimes doesn't work"
                // symptom. Delete is now handled by a window-level listener
                // below instead, which works regardless of where focus is —
                // see the effect that calls buildDeletableItems().

                // event.key is "Enter" regardless of modifiers, so Cmd/Ctrl+Enter
                // (send request) was being caught here too whenever keyboard focus
                // was still on the tree — e.g. right after single-clicking a file,
                // since opening a tab doesn't explicitly move focus into the editor.
                // That silently re-activated (permanently opened/promoted) the tree's
                // currently-selected node on every request send. Only plain Enter
                // should trigger tree-node activation.
                if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
                const focused = treeRef.current?.focusedNode ?? treeRef.current?.selectedNodes?.[0];
                if (!focused || focused.data.isTemporary) return;
                e.preventDefault();
                await handleActivate(focused);
              }}
              onBlur={(e) => {
                // Cleared focus (not just moved to a different row inside the
                // tree) — let Option+Cmd+R / Ctrl+Shift+R fall through to
                // Force Reload again instead of reveal. See reportTreeFocus.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  window.electron?.files.setTreeFocusState(null);
                }
              }}
              onDragOver={handleContainerDragOver}
              onDragLeave={handleContainerDragLeave}
              onDrop={handleContainerDrop}
            >
              {treeData && (
                <Tree
                  className="file-tree-scroll"
                  dndManager={fileTreeDndManager}
                  dndRootElement={dndRootElement.current}
                  ref={treeRef}
                  data={treeData}
                  width={width}
                  height={height}
                  rowHeight={22}
                  indent={12}
                  idAccessor="path"
                  initialOpenState={getInitialOpenState(data as ExtendedFileTree)}
                  openByDefault={false}
                  onMove={handleMove}
                  disableDrag={() => false}
                  onCreate={handleCreate}
                  onFocus={reportTreeFocus}
                  onSelect={(nodes) => reportTreeFocus(nodes?.[0])}
                  disableDrop={({ parentNode, dragNodes }) => {
                    // A null parentNode is a drop into the empty space below
                    // the list — react-arborist's own way of representing a
                    // root-level drop (see handleMove's comment above for the
                    // confirming source reference), not an invalid target.
                    // Disabling it unconditionally silently blocked every
                    // drop that didn't land squarely on a row. Only actually
                    // disable it when every dragged node is already directly
                    // in the root — that's the real no-op case; a node
                    // currently nested in a subfolder should still be
                    // droppable back up to the root.
                    if (!parentNode) {
                      const rootPath = treeData?.[0]?.path;
                      return dragNodes.every((node) => node.data.parent === rootPath);
                    }
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
                      pendingTabsEnabled={pendingTabsEnabled}
                    />
                  )}
                </Tree>
              )}
            </div>
          </DragOverContext.Provider>
        </TreeActionsContext.Provider>
        {/* Empty space at bottom to keep context menu accessible */}
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
    </div>
  );
};

function invalidateAllPanelTabContent(queryClient: ReturnType<typeof useQueryClient>) {
  for (const panelId of ["main", "right"]) {
    const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", panelId]);
    for (const tab of panelTabs?.tabs ?? []) {
      if (tab.source) {
        queryClient.invalidateQueries({ queryKey: ["tab:content", panelId, tab.id] });
      }
    }
  }
}
