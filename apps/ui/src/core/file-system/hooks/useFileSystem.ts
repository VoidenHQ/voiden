import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTree, FileTreeItem, TabState } from "@/types";
import { useDocumentStore } from "../stores/fileSystemStore";
import { useGetAppState } from "@/core/state/hooks";
import { getQueryClient } from "@/main";
import { useEditorStore, useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { voidenExtensions } from "@/core/editors/voiden/extensions";
import { addVersionFrontmatter, createMarkdownSerializer } from "@/core/editors/voiden/markdownConverter";
import { Schema } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import { useCodeEditorStore } from "@/core/editors/code/CodeEditorStore";
import { useEditorEnhancementStore } from "@/plugins";
// import type { Tab } from "../../../electron/src/shared/types";

// Tracks paths currently being written by the app so apy:changed events triggered
// by our own autosave can be ignored (otherwise the editor reloads and resets cursor).
export const pendingAutoSavePaths = new Set<string>();

// Write a file in 512 KB IPC chunks to avoid freezing the main process for large
// files (streamable files can be 5 MB–100 MB+). Falls back to a single write for
// small content to keep the fast path fast.
const WRITE_CHUNK_SIZE = 512 * 1024;
async function writeFileChunked(filePath: string, content: string): Promise<void> {
  if (content.length <= WRITE_CHUNK_SIZE) {
    await window.electron?.files.write(filePath, content);
    return;
  }
  for (let i = 0; i < content.length; i += WRITE_CHUNK_SIZE) {
    const chunk = content.slice(i, i + WRITE_CHUNK_SIZE);
    const isFirst = i === 0;
    const isLast = i + WRITE_CHUNK_SIZE >= content.length;
    await (window as any).electron?.files.appendChunk(filePath, chunk, isFirst, isLast);
  }
}

export const useGetActiveDirectory = () => {
  return useQuery({
    queryKey: ["directory:active"],
    queryFn: async () => {
      return window.electron?.directories.getActive();
    },
  });
};

export const useSetActiveDirectory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      await window.electron?.directories.setActive(path);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["directory:active"] });
    },
  });
};

export const useGetActiveDocument = () => {
  return useQuery({
    queryKey: ["active:document"],
    queryFn: async () => {
      return window.electron?.active.getDocument();
    },
  });
};

export const useSetActiveDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      await window.electron?.active.setDocument(path);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

function fixInlineCodeBlocks(markdown: string): string {
  return markdown.replace(/(^|[^\n])```([a-zA-Z0-9_-]+)\n([\s\S]*?)```/g, (_match, prefix, lang, content) => {
    const needsNewlineBefore = !prefix.endsWith('\n');
    const before = needsNewlineBefore ? `${prefix.trimEnd()}\n` : prefix;

    return `${before}\`\`\`${lang}\n${content.trimEnd()}\n\`\`\`\n`;
  });
}

export const prosemirrorToMarkdown = (content: string, schema: Schema) => {
  const doc = schema.nodeFromJSON(JSON.parse(content));
  const serializer = createMarkdownSerializer(schema);
  const markdown = serializer.serialize(doc);
  const sanitized = fixInlineCodeBlocks(markdown);

  const markdownWithVersion = addVersionFrontmatter(sanitized);
  return markdownWithVersion;
};

export const invalidateOnFileSave = (path: string, panelId: string, tabId: string) => {
  const queryClient = getQueryClient();
  const appState = queryClient.getQueryData<any>(["app:state"]);
  const activeDirectory = appState?.activeDirectory;
  queryClient.invalidateQueries({ queryKey: ["panel:tabs", panelId] });
  queryClient.invalidateQueries({ queryKey: ["tab:content", panelId, tabId] });
  queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
};

export const saveFileUtil = async (path: string | null, content: string, panelId: string, tabId: string, schema: Schema) => {
  const markdown = prosemirrorToMarkdown(content, schema);
  const filePath = await window.electron?.files.write(path, markdown, tabId);
  if (!filePath) return;

  invalidateOnFileSave(filePath, panelId, tabId);

  useEditorStore.getState().clearUnsaved(tabId);
  useVoidenEditorStore.getState().setFilePath(filePath);
};

export const useSaveFile = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      await window.electron?.files.write(path, content);
      await window.electron?.active.setTabDirty(path, false);
    },
    onSuccess: (_, { path }) => {
      queryClient.invalidateQueries({ queryKey: ["git:status", activeDirectory] });
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["files:read", path] });
    },
  });
};

export const useFileTree = () => {
  const { data: appState } = useGetAppState();
  const activeDirectory = appState?.activeDirectory;
  return useQuery({
    queryKey: ["files:tree", activeDirectory],
    enabled: !!activeDirectory,
    gcTime: 0,
    queryFn: async (): Promise<FileTree | undefined> => {
      if (!activeDirectory) return undefined;
      return window.electron?.files.tree(activeDirectory) ?? undefined;
    },
  });
};

/**
 * Kicks off a one-time flat file list fetch when the project opens.
 * Results are cached for the entire session (staleTime: Infinity) so the
 * '@' file-link suggestion can read them synchronously without any IPC delay.
 * Mount this hook wherever the file tree is already mounted.
 */
export const usePrefetchFileList = () => {
  const { data: appState } = useGetAppState();
  const activeDirectory = appState?.activeDirectory;
  useQuery({
    queryKey: ["files:flatList", activeDirectory],
    enabled: !!activeDirectory,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async (): Promise<{ name: string; path: string }[]> => {
      if (!activeDirectory) return [];
      return window.electron?.files.flatList(activeDirectory) ?? [];
    },
  });
};

export const useReadFile = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const { data: activeFile } = useGetActiveDocument();
  const { getDocument, setDocument } = useDocumentStore();

  return useQuery({
    queryKey: ["files:read", activeFile],
    enabled: !!activeDirectory && !!activeFile,
    gcTime: 0,
    queryFn: async () => {
      if (!activeFile) return undefined;

      // Check document store first
      const docState = getDocument(activeFile);
      if (docState) {
        return docState.content;
      }

      // If not in memory, read from disk
      const content = await window.electron?.files.read(activeFile);
      if (content) {
        // Initialize document store with disk content
        setDocument(activeFile, content);
      }
      return content;
    },
  });
};

export const useCreateFile = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();
  const { mutateAsync: setActiveDocument } = useSetActiveDocument();

  return useMutation({
    mutationFn: async (fileName: string) => {
      if (!activeDirectory) throw new Error("No active directory");
      return window.electron?.files.create(activeDirectory, fileName);
    },
    onSuccess: (data) => {
      if (!data) return;
      setActiveDocument(data.path);
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
    },
  });
};

export const useCreateVoidFile = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();
  const { mutateAsync: setActiveDocument } = useSetActiveDocument();

  return useMutation({
    mutationFn: async (fileName: string) => {
      if (!activeDirectory) throw new Error("No active directory");
      return window.electron?.files.createVoid(activeDirectory, fileName);
    },
    onSuccess: (data) => {
      if (!data) return;
      setActiveDocument(data.path);
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
    },
  });
};

export const useRenameFile = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, newName }: { path: string; newName: string }) => {
      const success = await window.electron?.files.rename(path, newName);
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
    },
  });
};

export const useDeleteFile = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      const success = await window.electron?.files.delete(path);
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
    },
  });
};

export const useDeleteDirectory = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      const success = await window.electron?.files.deleteDirectory(path);
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
    },
  });
};

export const useBulkDelete = () => {
  const { data: activeDirectory } = useGetActiveDirectory();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: FileTreeItem[]) => {
      const success = await window.electron?.files.bulkDelete(items);
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
    },
  });
};

export const useMove = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dragIds, parentId }: { dragIds: string[]; parentId: string }) => {
      return window.electron?.files.move(dragIds, parentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
    },
  });
};

export const useGetTabs = () => {
  return useQuery({
    queryKey: ["active:tabs"],
    queryFn: async () => {
      return window.electron?.active.getTabs();
    },
  });
};

export const useAddTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (filePath: string) => {
      await window.electron?.active.addTab(filePath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

export const useCloseTab = () => {
  const queryClient = useQueryClient();
  const { getDocument, removeDocument } = useDocumentStore();

  return useMutation({
    mutationFn: async (filePath: string) => {
      // Check if there are unsaved changes
      const docState = getDocument(filePath);
      if (docState && docState.content !== docState.savedContent) {
        // TODO: Show confirmation dialog
        const shouldClose = window.confirm("You have unsaved changes. Are you sure you want to close this tab?");
        if (!shouldClose) {
          return;
        }
      }

      await window.electron?.active.closeTab(filePath);
      // Clean up document store
      removeDocument(filePath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

export const useCloseAllTabs = () => {
  const queryClient = useQueryClient();
  const { documents, removeDocument } = useDocumentStore();

  return useMutation({
    mutationFn: async () => {
      // Check for unsaved changes in any document
      const unsavedDocs = Array.from(documents.entries()).filter(([, doc]) => doc.content !== doc.savedContent);
      if (unsavedDocs.length > 0) {
        const shouldClose = window.confirm(`You have unsaved changes in ${unsavedDocs.length} files. Are you sure you want to close all tabs?`);
        if (!shouldClose) {
          return;
        }
      }

      await window.electron?.active.closeAllTabs();
      // Clean up all documents from store
      documents.forEach((_, path) => removeDocument(path));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

export const useCloseTabsToRight = () => {
  const queryClient = useQueryClient();
  const { data: tabs } = useGetTabs();
  const { documents, removeDocument } = useDocumentStore();

  return useMutation({
    mutationFn: async (filePath: string) => {
      if (!tabs) return;

      const tabIndex = tabs.findIndex((tab: TabState) => tab.filePath === filePath);
      const tabsToClose = tabs.slice(tabIndex + 1);

      // Check for unsaved changes in tabs to be closed
      const unsavedDocs = tabsToClose.filter((tab: TabState) => {
        const doc = documents.get(tab.filePath);
        return doc && doc.content !== doc.savedContent;
      });

      if (unsavedDocs.length > 0) {
        const shouldClose = window.confirm(`You have unsaved changes in ${unsavedDocs.length} files. Are you sure you want to close these tabs?`);
        if (!shouldClose) {
          return;
        }
      }

      await window.electron?.active.closeTabsToRight(filePath);
      // Clean up closed documents from store
      tabsToClose.forEach((tab: TabState) => removeDocument(tab.filePath));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

export const useCloseOtherTabs = () => {
  const queryClient = useQueryClient();
  const { data: tabs } = useGetTabs();
  const { documents, removeDocument } = useDocumentStore();

  return useMutation({
    mutationFn: async (filePath: string) => {
      if (!tabs) return;

      const tabsToClose = tabs.filter((tab: TabState) => tab.filePath !== filePath);

      // Check for unsaved changes in tabs to be closed
      const unsavedDocs = tabsToClose.filter((tab: TabState) => {
        const doc = documents.get(tab.filePath);
        return doc && doc.content !== doc.savedContent;
      });

      if (unsavedDocs.length > 0) {
        const shouldClose = window.confirm(`You have unsaved changes in ${unsavedDocs.length} files. Are you sure you want to close these tabs?`);
        if (!shouldClose) {
          return;
        }
      }

      await window.electron?.active.closeOtherTabs(filePath);
      // Clean up closed documents from store
      tabsToClose.forEach((tab: TabState) => removeDocument(tab.filePath));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

export const useSetTabDirty = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ filePath, isDirty }: { filePath: string; isDirty: boolean }) => {
      await window.electron?.active.setTabDirty(filePath, isDirty);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
    },
  });
};

export const useActivateTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (filePath: string) => {
      await window.electron?.active.activateTab(filePath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["active:document"] });
    },
  });
};

// Save a specific tab by its ID
export const saveTabById = async (tabId: string, options?: { silent?: boolean }) => {
  const queryClient = getQueryClient();
  const panelTabs = queryClient.getQueryData(["panel:tabs", "main"]) as { tabs: any[]; activeTabId: string } | undefined;
  const tab = panelTabs?.tabs?.find((t: any) => t.id === tabId);
  const shouldInvalidate = !options?.silent;
  const syncTabContentCache = (savedContent: string) => {
    queryClient.setQueryData(["tab:content", "main", tabId, tab?.source], (prev: any) => {
      if (prev) {
        return {
          ...prev,
          content: savedContent,
          isAutosaved: false,
        };
      }
      return {
        type: "document",
        tabId,
        title: tab?.title ?? "",
        content: savedContent,
        isAutosaved: false,
      };
    });
  };
  
  if (!tab || !tab.source) {
    return false; // Tab not found or not persisted
  }
  
  // Get unsaved content for this tab
  const unsavedContent = useEditorStore.getState().unsaved[tabId];
  if (!unsavedContent) {
    return true; // No unsaved changes
  }
  
  try {
    if (tab.source.endsWith(".void")) {
      // Handle .void files (voiden editor)
      const voidenEditor = useVoidenEditorStore.getState().editor;
      if (voidenEditor && !voidenEditor.isDestroyed && voidenEditor.storage.tabId === tabId) {
        // Tab is currently active - use the editor's current state
        const content = JSON.stringify(voidenEditor.getJSON());
        if (shouldInvalidate) {
          const path = useVoidenEditorStore.getState().filePath;
          const panelId = voidenEditor.storage.panelId;
          return await saveFileUtil(path, content, panelId, tabId, voidenEditor.schema);
        }
        const markdown = prosemirrorToMarkdown(content, voidenEditor.schema);
        const normalizedSource = tab.source.replace(/\\/g, "/");
        pendingAutoSavePaths.add(normalizedSource);
        const filePath = await window.electron?.files.write(tab.source, markdown, tabId);
        if (!filePath) {
          pendingAutoSavePaths.delete(normalizedSource);
          return false;
        }
        syncTabContentCache(markdown);
        // Only clear if no new changes arrived during the async write
        if (useEditorStore.getState().unsaved[tabId] === unsavedContent) {
          useEditorStore.getState().clearUnsaved(tabId);
        }
        // Safety cleanup in case apy:changed never arrives
        setTimeout(() => pendingAutoSavePaths.delete(normalizedSource), 3000);
        return true;
      } else {
        // Tab is not active
        const currentFileContent = await window.electron?.files.read(tab.source);
        if (currentFileContent == null) {
          return false;
        }

        // Convert unsaved content to markdown for comparison
        const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
        const unsavedMarkdown = prosemirrorToMarkdown(unsavedContent, schema);

        // Only save if content is actually different
        if (currentFileContent === unsavedMarkdown) {
          // Clear unsaved state since content matches file
          if (!shouldInvalidate) {
            syncTabContentCache(currentFileContent);
          }
          if (useEditorStore.getState().unsaved[tabId] === unsavedContent) {
            useEditorStore.getState().clearUnsaved(tabId);
          }
          return true;
        }

        if (shouldInvalidate) {
          return await saveFileUtil(tab.source, unsavedContent, "main", tabId, schema);
        }

        const normalizedSource2 = tab.source.replace(/\\/g, "/");
        pendingAutoSavePaths.add(normalizedSource2);
        const filePath = await window.electron?.files.write(tab.source, unsavedMarkdown, tabId);
        if (!filePath) {
          pendingAutoSavePaths.delete(normalizedSource2);
          return false;
        }
        syncTabContentCache(unsavedMarkdown);
        // Only clear if no new changes arrived during the async write
        if (useEditorStore.getState().unsaved[tabId] === unsavedContent) {
          useEditorStore.getState().clearUnsaved(tabId);
        }
        // Safety cleanup in case apy:changed never arrives
        setTimeout(() => pendingAutoSavePaths.delete(normalizedSource2), 3000);
        return true;
      }
    } else {
      // Handle regular files (code editor)
      // Read current file content from disk
      const currentFileContent = await window.electron?.files.read(tab.source);
      if (currentFileContent == null) {
        return false;
      }
      
      // Only save if content is actually different
      if (currentFileContent === unsavedContent) {
        // Clear unsaved state since content matches file
        if (!shouldInvalidate) {
          syncTabContentCache(currentFileContent);
        }
        useEditorStore.getState().clearUnsaved(tabId);
        return true;
      }
      
      await window.electron?.files.write(tab.source, unsavedContent);
      if (shouldInvalidate) {
        invalidateOnFileSave(tab.source, "main", tabId);
      } else {
        syncTabContentCache(unsavedContent);
      }
      useEditorStore.getState().clearUnsaved(tabId);
      return true;
    }
  } catch (error) {
    return false;
  }
  
  return false;
};

// Global save function that works regardless of editor focus
export const globalSaveFile = async () => {
  // First try to determine the active tab and its type
  const queryClient = getQueryClient();
  const panelTabs = queryClient.getQueryData(["panel:tabs", "main"]) as { tabs: any[]; activeTabId: string } | undefined;
  const activeTabId = panelTabs?.activeTabId;
  const activeTab = panelTabs?.tabs?.find((tab: any) => tab.id === activeTabId);
  // TODO: we will also need to handle save for unsaved tab
  // If we have an active tab, determine how to save based on its type
  if (activeTab && activeTab.type) {
    if (activeTab.source?.endsWith(".void") || !activeTab.source) {
      // Use voiden-wrapper editor save logic
      const voidenEditor = useVoidenEditorStore.getState().editor;
      if (voidenEditor) {
        const content = JSON.stringify(voidenEditor.getJSON());
        const path = useVoidenEditorStore.getState().filePath;
        const panelId = voidenEditor.storage.panelId;
        const tabId = voidenEditor.storage.tabId;
        return saveFileUtil(path, content, panelId, tabId, voidenEditor.schema);
      }
    } else {
      // Use code editor save logic
      const { activeEditor, editorViews } = useCodeEditorStore.getState();

      if (activeEditor.tabId && activeEditor.source) {
        try {
          const view = editorViews.get(activeEditor.tabId);
          const content = view
            ? view.state.doc.toString()
            : activeEditor.content;
          await writeFileChunked(activeEditor.source, content);
          invalidateOnFileSave(activeEditor.source, activeEditor.panelId || "", activeEditor.tabId);
          useEditorStore.getState().clearUnsaved(activeEditor.tabId);
          return true;
        } catch (error) {
          return false;
        }
      }
    }
  }

  // Fall back to the previous behavior if we couldn't determine the active tab
  const voidenEditor = useVoidenEditorStore.getState().editor;

  if (voidenEditor) {
    // If voiden-wrapper editor exists, use its save function
    const content = JSON.stringify(voidenEditor.getJSON());
    const path = useVoidenEditorStore.getState().filePath;
    const panelId = voidenEditor.storage.panelId;
    const tabId = voidenEditor.storage.tabId;

    return saveFileUtil(path, content, panelId, tabId, voidenEditor.schema);
  } else {
    // Try to get data from CodeEditor store
    const { activeEditor, editorViews } = useCodeEditorStore.getState();

    if (activeEditor.tabId && activeEditor.source) {
      try {
        const view = editorViews.get(activeEditor.tabId);
        const content = view
          ? view.state.doc.toString()
          : activeEditor.content;
        await writeFileChunked(activeEditor.source, content);
        invalidateOnFileSave(activeEditor.source, activeEditor.panelId || "", activeEditor.tabId);
        useEditorStore.getState().clearUnsaved(activeEditor.tabId);
        return true;
      } catch (error) {
        return false;
      }
    }

    // If no editor found, try to get the active document as fallback
    const activePath = await window.electron?.active.getDocument();
    if (activePath) {
      return window.electron?.files.write(activePath, "");
    }

    return false;
  }
};
