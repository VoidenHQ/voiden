import { create } from "zustand";
import { useEffect } from "react";
import * as _ReactShim from "react";
import * as _ReactJSXShim from "react/jsx-runtime";
import * as _ReactDOMShim from "react-dom";
import * as _ReactDOMClientShim from "react-dom/client";
import { coreExtensionPlugins } from "@voiden/core-extensions";
import { PluginErrorBoundary } from "@/core/components/ErrorBoundary";
import { getProjects } from "@/core/projects/hooks";
import { useGetExtensions } from "@/core/extensions/hooks";
import { getQueryClient } from "./main";
import {
  Panel,
  Plugin,
  PluginContext,
  SlashCommand,
  SlashCommandGroup,
  Tab,
  EditorAction,
  StatusBarItem,
  PluginHelpers,
  BlockPasteHandler,
  BlockExtension,
  PatternHandler,
} from "@voiden/sdk/ui";
import { extensionLogger } from "@/core/lib/logger";
import { AnyExtension } from "@tiptap/core";
import { historyAdapterRegistry } from "@/core/history/adapterRegistry";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";
import { useVoidenEditorStore, useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { proseClasses } from "@/core/editors/voiden/VoidenEditor";
import { useCodeEditorStore } from "@/core/editors/code/CodeEditorStore";
import { usePanelStore } from "@/core/stores/panelStore";
import { requestOrchestrator } from "@/core/request-engine/requestOrchestrator";
import { pasteOrchestrator } from "@/core/paste/pasteOrchestrator";
import { CodeEditor as GenericCodeEditor } from "@/core/editors/code/lib/components/CodeEditor";
import { Table, TableBody, TableRow, TableCell } from "@/core/components/ui/table";
import { NodeViewWrapper } from "@tiptap/react";
import { useSendRestRequest } from "@/core/request-engine";
import { RequestBlockHeader } from "@/core/editors/voiden/nodes/RequestBlockHeader";
import { useParentResponseDoc } from "@/core/extensions/hooks/useParentResponseDoc";
import { toast } from "sonner";
import { HistoryEntry } from "@/core/history/types";
import { buildCurlFromEntry } from "@/core/history/historyManager";
import { buildVoidMarkdownFromEntry } from "@/core/history/voidFileBuilder";
import { prosemirrorToMarkdown } from "@/core/file-system/hooks/useFileSystem";

export type VoidBuilderHelpers = {
  /** Convert a ProseMirror doc JSON string to .void markdown using the full editor schema */
  toMarkdown: (docJson: string, schema: any) => string;
};

// ── Plugin history exporter registry ─────────────────────────────────────────
// Plugins register custom cURL builders, void file builders, and optional entry renderers.
const historyExporters: Record<string, {
  buildCurl?: (entry: HistoryEntry, projectPath?: string) => string;
  buildVoidFile?: (entry: HistoryEntry, schema: any, helpers: VoidBuilderHelpers) => string;
  renderer?: React.ComponentType<{ entry: HistoryEntry }>;
}> = {};

// ── Curl importer registry ────────────────────────────────────────────────────
// Each plugin registers its own curl importer. Core iterates these instead of
// calling plugin-specific functions directly.
type CurlImporter = (curlString: string, editor: any) => Promise<boolean>;
const curlImporters: CurlImporter[] = [];

/**
 * Build a cURL string for a history entry, delegating to the plugin's registered builder
 * (if any) before falling back to the default REST cURL builder.
 */
export function buildCurlForEntry(entry: HistoryEntry, projectPath?: string): string {
  if (entry.source && historyExporters[entry.source]?.buildCurl) {
    return historyExporters[entry.source].buildCurl!(entry, projectPath);
  }
  return buildCurlFromEntry(entry, projectPath);
}

/**
 * Returns the plugin-registered renderer for a history entry, or null if none.
 * The renderer is a React component receiving { entry } and responsible for rendering
 * the plugin-specific expanded detail view of the entry.
 */
export function getHistoryRenderer(entry: HistoryEntry): React.ComponentType<{ entry: HistoryEntry }> | null {
  if (entry.source && historyExporters[entry.source]?.renderer) {
    return historyExporters[entry.source].renderer!;
  }
  return null;
}

/**
 * Build .void file markdown for a history entry.
 * Delegates to the plugin's registered void builder (if any), falling back to
 * the default REST-API builder that generates a request + headers + body block.
 */
export function buildVoidFileForEntry(entry: HistoryEntry, schema: any): string {
  if (entry.source && historyExporters[entry.source]?.buildVoidFile) {
    return historyExporters[entry.source].buildVoidFile!(entry, schema, { toMarkdown: prosemirrorToMarkdown });
  }
  return buildVoidMarkdownFromEntry(entry, schema);
}

interface PluginError {
  extensionId: string;
  error: string;
}

interface PluginStoreState {
  isInitialized: boolean;
  pluginErrors: PluginError[];
  addPluginError: (extensionId: string, error: string) => void;
  clearPluginErrors: () => void;
  sidebar: {
    left: any[];
    right: any[];
  };
  panels: {
    [key: string]: any[];
  };
  initialize: () => void;
  addSidebarTab: (sidebarId: "left" | "right", tab: any) => void;
  registerPanel: (panelId: string, panel: any) => void;
  editorActions: EditorAction[];
  addEditorAction: (action: EditorAction) => void;
  statusBarItems: StatusBarItem[];
  addStatusBarItem: (item: StatusBarItem) => void;
}

export const usePluginStore = create<PluginStoreState>((set) => ({
  isInitialized: false,
  pluginErrors: [],
  addPluginError: (extensionId, error) =>
    set((state) => ({
      pluginErrors: [...state.pluginErrors, { extensionId, error }],
    })),
  clearPluginErrors: () => set({ pluginErrors: [] }),
  sidebar: {
    left: [],
    right: [],
  },
  panels: {
    main: [],
    bottom: [],
  },
  initialize: () => set({ isInitialized: true }),
  addSidebarTab: (sidebarId, tab) => {
    set((state) => ({
      sidebar: {
        ...state.sidebar,
        [sidebarId]: [...state.sidebar[sidebarId], tab],
      },
    }));
  },
  registerPanel: (panelId, panel) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: [...(state.panels[panelId] || []), panel],
      },
    }));
  },
  editorActions: [],
  addEditorAction: (action) => {
    set((state) => ({
      editorActions: [...state.editorActions, action],
    }));
  },
  statusBarItems: [],
  addStatusBarItem: (item) => {
    set((state) => ({
      statusBarItems: [...state.statusBarItems, item],
    }));
  },
}));

interface EditorEnhancementStore {
  voidenSlashGroups: SlashCommandGroup[];
  addVoidenSlashGroup: (group: SlashCommandGroup) => void;
  voidenExtensions: AnyExtension[];
  addVoidenExtension: (extension: AnyExtension) => void;
  removeVoidenExtension: (extensionName: string) => void;
  codemirrorExtensions: any[];
  addCodemirrorExtension: (extension: any) => void;
  removeCodemirrorExtension: (extension: any) => void;
  clearAllExtensions: () => void;
}

export const useEditorEnhancementStore = create<EditorEnhancementStore>((set) => ({
  voidenSlashGroups: [],
  voidenExtensions: [],
  codemirrorExtensions: [],
  addVoidenSlashGroup: (group) =>
    set((state) => ({
      voidenSlashGroups: [...state.voidenSlashGroups, group],
    })),
  addVoidenExtension: (extension) =>
    set((state) => ({
      voidenExtensions: [...state.voidenExtensions, extension],
    })),
  removeVoidenExtension: (extensionName) =>
    set((state) => ({
      voidenExtensions: state.voidenExtensions.filter((ext) => ext.name !== extensionName),
    })),
  addCodemirrorExtension: (extension) =>
    set((state) => ({
      codemirrorExtensions: [...state.codemirrorExtensions, extension],
    })),
  removeCodemirrorExtension: (extension) =>
    set((state) => ({
      codemirrorExtensions: state.codemirrorExtensions.filter((ext) => ext !== extension),
    })),
  clearAllExtensions: () =>
    set(() => ({
      voidenExtensions: [],
      codemirrorExtensions: [],
      voidenSlashGroups: [],
    })),
}));

// Global store for helpers exposed by plugins
const exposedHelpers: Record<string, PluginHelpers> = {};

// Global registry for linkable node types (for external file linking)
// Core node types that are always linkable (not owned by any plugin)
const coreLinkableNodeTypes = ['runtime-variables'];
const coreNodeDisplayNames: Record<string, string> = { 'runtime-variables': 'Runtime Variables' };

const linkableNodeTypes = new Set<string>(coreLinkableNodeTypes);

// Global registry for node display names (for showing human-readable names in UI)
const nodeDisplayNames = new Map<string, string>(Object.entries(coreNodeDisplayNames));

// Global registry for loaded plugin instances (for cleanup)
const loadedPlugins: Map<string, { onload: () => Promise<void>; onunload: () => Promise<void> }> = new Map();

// Also expose on window for React components to access
declare global {
  interface Window {
    __voidenHelpers__?: Record<string, PluginHelpers>;
    __voiden_shims__?: Record<string, unknown>;
  }
}

if (typeof window !== 'undefined') {
  window.__voidenHelpers__ = exposedHelpers;
  window.__voiden_shims__ = {
    "react": _ReactShim,
    "react/jsx-runtime": _ReactJSXShim,
    "react-dom": _ReactDOMShim,
    "react-dom/client": _ReactDOMClientShim,
  };
}

/**
 * Get all registered linkable node types
 * Used by ExternalFile.tsx to filter blocks that can be linked
 */
export const getLinkableNodeTypes = (): string[] => {
  return Array.from(linkableNodeTypes);
};

/**
 * Get the display name for a node type
 * Used by ExternalFile.tsx to show human-readable names in the block picker
 */
export const getNodeDisplayName = (nodeType: string): string | undefined => {
  return nodeDisplayNames.get(nodeType);
};

export const createPlugin = (pluginModule: (context: PluginContext) => Plugin, extensionId: string) => {
  // Define the API that your plugins will use.
  const context: PluginContext = {
    exposeHelpers: (helpers: PluginHelpers) => {
      extensionLogger.info(`Plugin "${extensionId}" exposing helpers:`, Object.keys(helpers));
      exposedHelpers[extensionId] = helpers;
    },
    registerSidebarTab: (sidebarId: "left" | "right", tab: Tab) => {
      // Update your Zustand store immediately.
      usePluginStore.getState().addSidebarTab(sidebarId, tab);
      // Inform your electron backend.
      window.electron?.sidebar.registerSidebarTab(sidebarId, {
        extensionId: extensionId,
        id: tab.id,
        title: tab.title,
      });
      // Immediately tell React Query to refetch sidebar tabs.
      const queryClient = getQueryClient();
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs", sidebarId] });
      // Alternatively, if you want an immediate refetch rather than waiting for a background refresh:
      // queryClient.refetchQueries({ queryKey: ["sidebar:tabs", sidebarId] });
    },
    addVoidenSlashGroup: (group: SlashCommandGroup) => {
      useEditorEnhancementStore.getState().addVoidenSlashGroup(group);
    },
    addVoidenSlashCommand: (command: SlashCommand) => {},
    registerVoidenExtension: (extension: AnyExtension) => {
      useEditorEnhancementStore.getState().addVoidenExtension(extension);
    },
    unregisterVoidenExtension: (extensionName: string) => {
      useEditorEnhancementStore.getState().removeVoidenExtension(extensionName);
    },
    registerCodemirrorExtension: (extension: any) => {
      useEditorEnhancementStore.getState().addCodemirrorExtension(extension);
    },
    unregisterCodemirrorExtension: (extension: any) => {
      useEditorEnhancementStore.getState().removeCodemirrorExtension(extension);
    },
    registerPanel: (panelId: string, panel: Tab) => {
      usePluginStore.getState().registerPanel(panelId, panel);
    },
    addTab: async (tabId: string, tab: Panel) => {
      // Store the React component in Zustand so the renderer can find it
      if (tab.component) {
        usePluginStore.getState().registerPanel(tabId, {
          id: tab.id,
          title: tab.title,
          component: tab.component,
        });
      }
      const addedTab = await window.electron?.tab.add(tabId, {
        extensionId: extensionId,
        id: tab.id,
        title: tab.title,
      });
      const queryClient = getQueryClient();
      queryClient.invalidateQueries({
        queryKey: ["panel:tabs", addedTab.panelId],
      });
    },
    registerEditorAction: (action) => {
      if (!action.component || typeof action.component !== 'function') {
        console.error(`[Plugin Context] Invalid component for editor action ${action.id} from ${extensionId}`);
        return;
      }
      usePluginStore.getState().addEditorAction(action);
    },
    registerStatusBarItem: (item: StatusBarItem) => {
      if (!item.id) {
        console.error(`[Plugin Context] Missing id for status bar item from ${extensionId}`);
        return;
      }
      if (!item.onClick || typeof item.onClick !== 'function') {
        console.error(`[Plugin Context] Invalid onClick for status bar item ${item.id} from ${extensionId}`);
        return;
      }
      if (!item.icon) {
        console.error(`[Plugin Context] Missing icon for status bar item ${item.id} from ${extensionId}`);
        return;
      }
      usePluginStore.getState().addStatusBarItem(item);
    },
    project: {
      getActiveEditor: (type: "voiden" | "code") => {
        if (type === "voiden") {
          return useVoidenEditorStore.getState().editor;
        } else {
          return useCodeEditorStore.getState().activeEditor.editor;
        }
      },
      getActiveProject: async () => {
        const projects = await getProjects();
        return projects?.activeProject;
      },
      getVoidFiles: async () => {
        // Retrieve all files from the active project using the electron API.
        const voidFiles = (await window.electron?.files?.getVoidFiles?.()) || [];
        return voidFiles;
      },
      createFile: async (filePath: string, content: string) => {
        await window.electron?.files?.write(filePath, content);
      },
      createFolder: async (folderPath: string) => {
        // Note: This API might need updating on the electron side
        await window.electron?.files?.createDirectory("", folderPath);
      },
      openFile: async (relativePath: string,skipJoin=false) => {
        // Safe API for plugins to open files
        // Only allows opening files within the project
        const projects = await getProjects();
        const activeProject = projects?.activeProject;
        if (!activeProject) {
          throw new Error("No active project found");
        }
        const absolutePath = skipJoin ? relativePath: await window.electron?.utils?.pathJoin(activeProject, relativePath);
        if (!absolutePath) {
          throw new Error("Failed to compute absolute path");
        }
        const fileName = relativePath.split('/').pop() || relativePath;
        await window.electron?.ipc?.invoke("fileLink:open", absolutePath, fileName);

        // Invalidate queries to refresh UI
        const queryClient = getQueryClient();
        queryClient.invalidateQueries({ queryKey: ["panel:tabs", "main"] });
        queryClient.invalidateQueries({ queryKey: ["tab:content", "main", fileName] });
      },
      searchFiles: async (query: string) => {
        // Expose full-text search to plugins
        return await window.electron?.searchFiles(query);
      },
      getPath: async () => {
        const projects = await getProjects();
        const activeProject = projects?.activeProject;
        return activeProject;
      },
      importCurl: async (title: string, curlString: string) => {
        const tabId = crypto.randomUUID();
        const tabTitle = title.endsWith('.void') ? title : `${title}.void`;

        // Pre-write empty doc as autosave so VoidenEditor doesn't crash on mount
        const emptyDoc = JSON.stringify({ type: "doc", content: [] });
        await window.electron?.autosave?.save(tabId, emptyDoc);

        // Create the document tab
        await window.electron?.state.addPanelTab("main", {
          id: tabId,
          type: "document",
          title: tabTitle,
          source: null,
        });

        // Activate the newly created tab so it becomes visible
        await window.electron?.state.activatePanelTab("main", tabId);

        // Invalidate queries so UI picks up the new tab
        const queryClient = getQueryClient();
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });

        // Parse the curl
        // Poll for the VoidenEditor to mount with this tabId, then paste curl
        const tryPaste = async (attempts: number) => {
          if (attempts <= 0) return;
          const editor = useVoidenEditorStore.getState().editor;
          if (editor && editor.storage.tabId === tabId) {
            let handled = false;
            for (const importer of curlImporters) {
              try { handled = await importer(curlString, editor); } catch { /* skip */ }
              if (handled) return;
            }
            pasteOrchestrator.handlePatternText(editor.view, curlString);
          } else {
            setTimeout(() => tryPaste(attempts - 1), 200);
          }
        };
        setTimeout(() => tryPaste(15), 400);
      },
    },
    tab:{
      getActiveTab:async()=>{
        const tab = (await window.electron?.tab.getActiveTab?.()) || {};
        return tab;
      },
    },
    files:{
       read: async (path: string) => {
        const content = (await window.electron?.files?.read(path))||''
        return content;
       }
    },
    helpers: {
      parseVoid: (markdown) => {
        const editor = useVoidenEditorStore.getState().editor;
        if (!editor) {
          throw new Error("No active editor found.");
        }

        return parseMarkdown(markdown ?? "", editor.schema);
      },
      from: <T extends PluginHelpers = PluginHelpers>(pluginId: string): T | undefined => {
        const helpers = exposedHelpers[pluginId];
        if (!helpers) {
          extensionLogger.warn(`No helpers found for plugin: ${pluginId}`);
          return undefined;
        }
        return helpers as T;
      },
    },
    ui: {
      getProseClasses: () => {
        let classes: string;
        if (Array.isArray(proseClasses)) {
          classes = proseClasses.join(" ");
        } else if (typeof proseClasses === 'string') {
          classes = proseClasses;
        } else {
          classes = String(proseClasses);
        }
        return classes;
      },
      openRightPanel: () => {
        usePanelStore.getState().openRightPanel();
      },
      openRightSidebarTab: async (id: string,openResponsePanel?:boolean) => {
        // 1) fetch right sidebar tabs from main
        const sidebarData = await window.electron?.sidebar?.getTabs('right');
        const tabs = sidebarData?.tabs || [];

        // 2) find our tab by customTabKey
        const pluginTab = tabs.find((t: any) => t?.meta?.customTabKey === id);
        if(!pluginTab && openResponsePanel){
          const tab = tabs.find((t: any) => t.type === 'responsePanel');
          usePanelStore.getState().openRightPanel();
          // 4) activate it
          await window.electron?.sidebar?.activateTab('right', tab.id);
          return;
        }
        if (pluginTab?.id) {
          // 3) make sure the panel is visible
          usePanelStore.getState().openRightPanel();

          // 4) activate it
          await window.electron?.sidebar?.activateTab('right', pluginTab.id);
        }
      },
      closeRightPanel: () => {
        usePanelStore.getState().closeRightPanel();
      },
      toggleRightPanel: () => {
        const { rightPanelOpen, openRightPanel, closeRightPanel } = usePanelStore.getState();
        if (rightPanelOpen) {
          closeRightPanel();
        } else {
          openRightPanel();
        }
      },
      openBottomPanel: () => {
        usePanelStore.getState().openBottomPanel();
      },
      closeBottomPanel: () => {
        usePanelStore.getState().closeBottomPanel();
      },
      components: {
        CodeEditor: GenericCodeEditor,
        Table,
        TableBody,
        TableRow,
        TableCell,
        NodeViewWrapper,
        RequestBlockHeader,
      },
      hooks: {
        useSendRestRequest,
        useParentResponseDoc,
      },
      showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => {
        if (type) {
          toast[type](message, { duration: 4000, closeButton: true });
        } else {
          toast(message, { duration: 4000, closeButton: true });
        }
      },
    },
    paste: {
      registerBlockOwner: (handler: BlockPasteHandler) => {
        pasteOrchestrator.registerBlockOwner(handler.blockType, handler, extensionId);
      },
      registerBlockExtension: (extension: BlockExtension) => {
        pasteOrchestrator.registerBlockExtension(extension, extensionId);
      },
      registerPatternHandler: (handler: PatternHandler) => {
        pasteOrchestrator.registerPatternHandler(handler, extensionId);
      },
      registerCurlImporter: (handler: CurlImporter) => {
        curlImporters.push(handler);
      },
    },
    history: {
      /**
       * Save a history entry for a given .void file path.
       * The entry is automatically tagged with the calling plugin's ID as `source`.
       */
      save: async (partial: Omit<HistoryEntry, 'id' | 'timestamp'>, filePath: string): Promise<void> => {
        try {
          const { appendToHistory } = await import('@/core/history/historyManager');
          const { useHistoryStore } = await import('@/core/history/historyStore');
          const projects = await getProjects();
          const projectPath = projects?.activeProject ?? null;
          if (!projectPath) return;
          const settings = await (window as any).electron?.userSettings?.get();
          if (settings?.history?.enabled === false) return;
          const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));
          const entry: HistoryEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            timestamp: Date.now(),
            source: extensionId,
            ...partial,
          };
          const updated = await appendToHistory(projectPath, filePath, entry, retentionDays);
          const store = useHistoryStore.getState();
          if (store.currentFilePath === filePath) {
            store.setEntries(filePath, updated.entries);
          }
          // Update global history so the sidebar refreshes without a manual reload
          const entryWithFile = { ...entry, filePath };
          store.setAllEntries([entryWithFile, ...store.allEntries.filter((e) => e.id !== entryWithFile.id)]);
        } catch (e) {
          extensionLogger.error(`[history] Plugin ${extensionId} failed to save entry:`, e);
        }
      },
      /**
       * Register a custom cURL builder for this plugin's history entries.
       * Used by the global history sidebar when rendering entries with source === extensionId.
       */
      registerCurlBuilder: (builder: (entry: HistoryEntry, projectPath?: string) => string): void => {
        historyExporters[extensionId] = { ...historyExporters[extensionId], buildCurl: builder };
      },
      /**
       * Register a custom React renderer for this plugin's history entries.
       * The component receives { entry } and is rendered in the expanded detail view
       * of the global history sidebar — keeping plugin-specific rendering out of core.
       */
      registerRenderer: (component: React.ComponentType<{ entry: HistoryEntry }>): void => {
        historyExporters[extensionId] = { ...historyExporters[extensionId], renderer: component };
      },
      /**
       * Register a custom .void file builder for this plugin's history entries.
       * Called during export — receives the entry and the full TipTap schema.
       * Return a markdown string that will be written as the .void file content.
       */
      registerVoidBuilder: (builder: (entry: HistoryEntry, schema: any, helpers: VoidBuilderHelpers) => string): void => {
        historyExporters[extensionId] = { ...historyExporters[extensionId], buildVoidFile: builder };
      },
      /**
       * Read all history entries across all .void files in the active project.
       */
      readAll: async (): Promise<Array<HistoryEntry & { filePath: string }>> => {
        try {
          const { readAllHistory } = await import('@/core/history/historyManager');
          const projects = await getProjects();
          const projectPath = projects?.activeProject ?? null;
          if (!projectPath) return [];
          const settings = await (window as any).electron?.userSettings?.get();
          const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));
          return readAllHistory(projectPath, retentionDays);
        } catch {
          return [];
        }
      },
    },
    onBuildRequest: (handler) => {
      requestOrchestrator.registerRequestHandler(handler);
    },
    onProcessResponse: (handler) => {
      requestOrchestrator.registerResponseHandler(handler);
    },
    registerResponseSection: (section) => {
      requestOrchestrator.registerResponseSection(section);
    },
    openVoidenTab: async (title: string, content: any, options?: { readOnly?: boolean }) => {
      try {
        const { useResponseStore } = await import('@/core/request-engine/stores/responseStore');

        const tabId = useResponseStore.getState().currentRequestTabId;

        if (!tabId) {
          useResponseStore.getState().setResponse('__default__', content, null);
        } else {
          useResponseStore.getState().setResponse(tabId, content, null);
        }
      } catch (error) {
        extensionLogger.error("Error storing response:", error);
        throw error;
      }
    },
    registerLinkableNodeTypes: (nodeTypes: string[]) => {
      extensionLogger.info(`Plugin "${extensionId}" registering ${nodeTypes.length} linkable node types:`, nodeTypes);
      nodeTypes.forEach(type => linkableNodeTypes.add(type));
    },
    registerNodeDisplayNames: (displayNames: Record<string, string>) => {
      extensionLogger.info(`Plugin "${extensionId}" registering ${Object.keys(displayNames).length} node display names:`, displayNames);
      Object.entries(displayNames).forEach(([nodeType, displayName]) => {
        nodeDisplayNames.set(nodeType, displayName);
      });
    },
    registerHistoryAdapter: (adapter: any) => {
      extensionLogger.info(`Plugin "${extensionId}" registering history adapter`);
      historyAdapterRegistry.register(adapter);
    },
  };

  const plugin = pluginModule(context);

  return {
    onload: async () => plugin.onload(context),
    onunload: async () => {
      await plugin.onunload();
    },
  };
};

export const getPlugins = async () => {
  usePluginStore.getState().clearPluginErrors();

  // Unload all currently loaded plugins first
  extensionLogger.info(`Unloading ${loadedPlugins.size} plugin(s)`);
  for (const [pluginId, plugin] of loadedPlugins.entries()) {
    try {
      extensionLogger.info(`Unloading plugin: ${pluginId}`);
      await plugin.onunload();
    } catch (error) {
      extensionLogger.error(`Error unloading plugin ${pluginId}:`, error);
    }
  }
  loadedPlugins.clear();

  // Clear all stores and registries
  useEditorEnhancementStore.setState({
    voidenExtensions: [],
    voidenSlashGroups: [],
    codemirrorExtensions: [],
  });
  usePluginStore.setState({
    sidebar: { left: [], right: [] },
    editorActions: [],
    statusBarItems: [],
    panels: { main: [], bottom: [] },
  });
  Object.keys(exposedHelpers).forEach(key => delete exposedHelpers[key]);
  Object.keys(historyExporters).forEach(key => delete historyExporters[key]);
  curlImporters.length = 0;
  linkableNodeTypes.clear(); // Clear linkable node types on plugin reload
  coreLinkableNodeTypes.forEach(type => linkableNodeTypes.add(type)); // Re-seed core linkable types
  nodeDisplayNames.clear(); // Clear node display names on plugin reload
  Object.entries(coreNodeDisplayNames).forEach(([type, name]) => nodeDisplayNames.set(type, name)); // Re-seed core display names
  requestOrchestrator.clear();
  pasteOrchestrator.clear();
  historyAdapterRegistry.clear();

  // ── Core history (not a plugin — registered here so it survives plugin reloads) ──
  {
    const { hookRegistry: hr, PipelineStage } = await import('@/core/request-engine/pipeline');
    const { preProcessingHistoryHook, postProcessingHistoryHook, initHistoryContext } = await import('@/core/history/pipelineHooks');

    hr.unregisterExtension('core-history');

    initHistoryContext(
      async () => {
        const p = await getProjects();
        return p?.activeProject ?? null;
      },
      async (title: string, curlString: string) => {
        const tabId = crypto.randomUUID();
        const tabTitle = title.endsWith('.void') ? title : `${title}.void`;
        const emptyDoc = JSON.stringify({ type: 'doc', content: [] });
        await window.electron?.autosave?.save(tabId, emptyDoc);
        await window.electron?.state.addPanelTab('main', { id: tabId, type: 'document', title: tabTitle, source: null });
        await window.electron?.state.activatePanelTab('main', tabId);
        const qc = getQueryClient();
        qc.invalidateQueries({ queryKey: ['panel:tabs'], exact: false });
        qc.invalidateQueries({ queryKey: ['tab:content'], exact: false });
        const tryPaste = async (attempts: number) => {
          if (attempts <= 0) return;
          const editor = useVoidenEditorStore.getState().editor;
          if (editor && editor.storage.tabId === tabId) {
            let handled = false;
            for (const importer of curlImporters) {
              try { handled = await importer(curlString, editor); } catch { /* skip */ }
              if (handled) return;
            }
            pasteOrchestrator.handlePatternText(editor.view, curlString);
          } else {
            setTimeout(() => tryPaste(attempts - 1), 200);
          }
        };
        setTimeout(() => tryPaste(15), 400);
      },
      async (title: string, markdown: string) => {
        const [{ getSchema }, { voidenExtensions }] = await Promise.all([
          import('@tiptap/core'),
          import('@/core/editors/voiden/extensions'),
        ]);
        const pluginExts = useEditorEnhancementStore.getState().voidenExtensions;
        const schema = getSchema([...voidenExtensions, ...pluginExts]);
        const doc = parseMarkdown(markdown, schema);

        const tabId = crypto.randomUUID();
        const tabTitle = title.endsWith('.void') ? title : `${title}.void`;
        await window.electron?.autosave?.save(tabId, JSON.stringify(doc));
        await window.electron?.state.addPanelTab('main', { id: tabId, type: 'document', title: tabTitle, source: null });
        await window.electron?.state.activatePanelTab('main', tabId);
        const qc = getQueryClient();
        qc.invalidateQueries({ queryKey: ['panel:tabs'], exact: false });
        qc.invalidateQueries({ queryKey: ['tab:content'], exact: false });
      },
    );

    hr.registerHook('core-history', PipelineStage.PreProcessing, preProcessingHistoryHook, 50);
    hr.registerHook('core-history', PipelineStage.PostProcessing, postProcessingHistoryHook, 50);
  }

  const extensions = getQueryClient().getQueryData(["extensions"]) as any[];

  // Register block ownership and create placeholders for disabled plugins
  const { registerBlockOwnership, createPlaceholderBlock } = await import('@/core/editors/voiden/extensions/PlaceholderBlock');

  if (extensions) {
    for (const extension of extensions) {
      const ownedBlocks = extension.capabilities?.blocks?.owns || [];

      // Register ownership for all plugins (enabled and disabled)
      ownedBlocks.forEach((blockType: string) => {
        registerBlockOwnership(blockType, extension.id, extension.name);
      });

      // Create placeholder nodes for DISABLED plugins
      if (!extension.enabled && ownedBlocks.length > 0) {
        extensionLogger.info(`Creating placeholders for disabled plugin: ${extension.id} (${ownedBlocks.length} blocks)`);
        ownedBlocks.forEach((blockType: string) => {
          const placeholderNode = createPlaceholderBlock(blockType);
          useEditorEnhancementStore.getState().addVoidenExtension(placeholderNode);
        });
      }
    }
  }

  if (!extensions) {
    extensionLogger.warn("No extensions found in cache");
    usePluginStore.getState().initialize();
    return;
  }

  const enabledExtensions = extensions.filter((extension: any) => extension.enabled);
  extensionLogger.info(`Loading ${enabledExtensions.length} enabled extension(s)`);

  for (const extension of enabledExtensions) {
    const startTime = performance.now();
    try {

      if (extension.type === "core") {
        extensionLogger.info(`Loading core extension: ${extension.id}`);

        // Validate extension is in registry
        const returnCoreExtension = (id: string) => {
          if (coreExtensionPlugins[id]) {
            return coreExtensionPlugins[id];
          }
          extensionLogger.warn(`Core extension ${id} not found in registry`);
          return undefined;
        };

        const plugin = returnCoreExtension(extension.id);
        if (!plugin) {
          console.warn(`[Plugin Loader] Core extension ${extension.id} not found in registry, skipping`);
          continue;
        }

        // Validate plugin is a function
        if (typeof plugin !== 'function') {
          throw new Error(`Core extension ${extension.id} is not a function (got ${typeof plugin})`);
        }

        const pluginInstance = createPlugin(plugin, extension.id);

        // Validate plugin instance has required methods
        if (!pluginInstance || typeof pluginInstance.onload !== 'function') {
          throw new Error(`Plugin instance for ${extension.id} missing required onload method`);
        }

        await pluginInstance.onload();

        loadedPlugins.set(extension.id, pluginInstance);
        const loadTime = (performance.now() - startTime).toFixed(2);

      } else {
        extensionLogger.info(`Loading external extension: ${extension.id}`);

        // Validate installedPath exists
        if (!extension.installedPath) {
          throw new Error(`External extension ${extension.id} missing installedPath`);
        }

        const mod = await import(
          /* @vite-ignore */
          `${extension.installedPath}/main.js`
        );

        // Validate module exports default
        if (!mod || !mod.default) {
          throw new Error(`External extension ${extension.id} does not export a default function`);
        }

        if (typeof mod.default !== 'function') {
          throw new Error(`External extension ${extension.id} default export is not a function (got ${typeof mod.default})`);
        }

        const pluginInstance = createPlugin(mod.default, extension.id);

        // Validate plugin instance
        if (!pluginInstance || typeof pluginInstance.onload !== 'function') {
          throw new Error(`Plugin instance for ${extension.id} missing required onload method`);
        }

        await pluginInstance.onload();

        loadedPlugins.set(extension.id, pluginInstance);
        const loadTime = (performance.now() - startTime).toFixed(2);
      }
    } catch (error) {
      const loadTime = (performance.now() - startTime).toFixed(2);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(`[Plugin Loader] ✗ Failed to load ${extension.id} after ${loadTime}ms`);
      console.error(`[Plugin Loader] Error type: ${error?.constructor?.name || 'Unknown'}`);
      console.error(`[Plugin Loader] Error message: ${errorMessage}`);
      if (errorStack) {
        console.error(`[Plugin Loader] Stack trace:`, errorStack);
      }

      extensionLogger.error(`Error loading extension ${extension.id}:`, error);

      // Store detailed error information
      const detailedError = `${errorMessage}${errorStack ? '\n\nStack:\n' + errorStack : ''}`;
      usePluginStore.getState().addPluginError(extension.id, detailedError);
    }
  }
  usePluginStore.getState().initialize();
};

export const PluginProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: extensions, isLoading: extLoading } = useGetExtensions();
  const isInitialized = usePluginStore((state) => state.isInitialized);

  useEffect(() => {
    const reloadPlugins = async () => {
      // IMPORTANT: Set isInitialized to false FIRST to prevent components from rendering during reload
      usePluginStore.setState({ isInitialized: false });

      // Small delay to let React process the state change
      await new Promise(resolve => setTimeout(resolve, 10));

      useEditorEnhancementStore.setState({
        voidenExtensions: [],
        voidenSlashGroups: [],
        codemirrorExtensions: [],
      });
      try {
        await getPlugins();
      } catch (err) {
        extensionLogger.error("Error reloading extensions:", err);
        console.error("[PluginProvider] Critical error loading plugins:", err);
        // Store the error for display
        usePluginStore.getState().addPluginError('__plugin_system__', String(err));
        // Still mark as initialized even on error so UI doesn't stay stuck
        usePluginStore.getState().initialize();
      }
    };

    // Debounce plugin reload to avoid React errors during rapid state changes
    if (!extLoading) {
      const timeoutId = setTimeout(() => {
        reloadPlugins();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [extensions, extLoading]);

  if (extLoading || !isInitialized)
    return <div className="bg-bg h-screen w-screen flex items-center justify-center text-text">Loading plugins...</div>;

  return (
    <PluginErrorBoundary>
      {children}
    </PluginErrorBoundary>
  );
};
