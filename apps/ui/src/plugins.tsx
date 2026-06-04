import { create } from "zustand";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as _ReactShim from "react";
import * as _ReactJSXShim from "react/jsx-runtime";
import * as _ReactDOMShim from "react-dom";
import * as _ReactDOMClientShim from "react-dom/client";
import * as _ZustandShim from "zustand";
import * as _TiptapCore from "@tiptap/core";
import * as _TiptapPMModel from "@tiptap/pm/model";
import * as _TiptapPMState from "@tiptap/pm/state";
import * as _TiptapPMTables from "@tiptap/pm/tables";
import * as _TiptapPMView from "@tiptap/pm/view";
import * as _TiptapSuggestion from "@tiptap/suggestion";
import * as _LucideReact from "lucide-react";
import * as _Tippy from "tippy.js";
import * as _Yaml from "yaml";
import { ErrorBoundary } from "@/core/components/ErrorBoundary";
import { AlertCircle, Copy, Check } from "lucide-react";
import { getProjects } from "@/core/projects/hooks";
import { useGetExtensions, useSetExtensionEnabled, useUninstallExtension } from "@/core/extensions/hooks";
import { getQueryClient } from "./main";
import {
  Panel,
  Plugin,
  type PluginContext,
  SlashCommand,
  type SlashCommandGroup,
  Tab,
  EditorAction,
  StatusBarItem,
  PluginHelpers,
  BlockPasteHandler,
  BlockExtension,
  PatternHandler,
  UIExtension,
  THEME_CLASSES,
} from "@voiden/sdk/ui";
import { parseCookies } from "@voiden/sdk/shared";
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
import { useResponseBodyHeight } from "@/core/extensions/hooks/useResponseBodyHeight";
import { Tip } from "@/core/components/ui/Tip";
import { toast } from "sonner";
import { HistoryEntry } from "@/core/history/types";
import { buildCurlFromEntry } from "@/core/history/historyManager";
import { buildVoidMarkdownFromEntry } from "@/core/history/voidFileBuilder";
import { prosemirrorToMarkdown } from "@/core/file-system/hooks/useFileSystem";
import * as _ReactQuery from '@tanstack/react-query';
import * as _TiptapReact from '@tiptap/react';
import * as _CodeMirrorState from '@codemirror/state';
import * as _CodeMirrorView from '@codemirror/view';
import * as _CodeMirrorAutocomplete from '@codemirror/autocomplete';
import * as _ReactDnd from 'react-dnd';
import * as _ReactDndHtml5Backend from 'react-dnd-html5-backend';
import * as _ReactMarkdown from 'react-markdown';
import * as _RemarkGfm from 'remark-gfm';
import { useActiveEnvironment, useEnvironments } from "@/core/environment/hooks";
import { getResponsePanelPosition as getResponsePanelPositionFn } from "@/core/stores/responsePanelPosition";
import { getTable, parseAuthNode, buildHeadersWithCookies, findNode, findNodes, createNewRequestObject, getRequest } from "@/core/request-engine/getRequestFromJson";
import { voidenExtensions as coreVoidenExtensions } from "@/core/editors/voiden/extensions";
import { expandLinkedBlocksInDoc } from "@/core/editors/voiden/utils/expandLinkedBlocks";
import { useResponseStore } from "@/core/request-engine/stores/responseStore";
import { replaceProcessVariablesInText } from "@/core/request-engine/runtimeVariables";
import { hookRegistry, PipelineStage } from "@/core/request-engine/pipeline";
import { clearHelpRegistry } from "@/core/help/helpRegistry";
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

// ── Plugin help command registry ─────────────────────────────────────────────
export interface PluginHelpCommand {
  id: string;
  label: string;
  description?: string;
  component: React.ComponentType<any>;
}

interface PluginError {
  extensionId: string;
  error: string;
  kind?: 'permission' | 'load' | 'runtime';
}

export interface PluginCommand {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<any>;
  shortcut?: string;
  when?: () => boolean;
  action: () => void;
}

export interface PluginTopBarItem {
  id: string;
  icon: React.ComponentType<any>;
  tooltip?: string;
  position?: 'left' | 'right';
  onClick: () => void;
}

export interface PluginContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<any>;
  surface: 'tab' | 'file' | 'block';
  when?: (target: any) => boolean;
  action: (target: any) => void;
}

export type PluginSettingField =
  | { type: 'text';   key: string; label: string; description?: string; placeholder?: string; defaultValue?: string }
  | { type: 'number'; key: string; label: string; description?: string; placeholder?: string; defaultValue?: number; min?: number; max?: number; step?: number }
  | { type: 'select'; key: string; label: string; description?: string; options: Array<{ label: string; value: string }>; defaultValue?: string }
  | { type: 'toggle'; key: string; label: string; description?: string; defaultValue?: boolean };

export interface PluginSettingsSection {
  id: string;
  title: string;
  icon?: React.ComponentType<any>;
  fields: PluginSettingField[];
  /** Injected by the host — not part of the public SDK surface */
  pluginId: string;
}

export interface CorePluginUpdateInfo {
  pluginId: string;
  currentVersion: string | null;
  remoteVersion: string;
  voidenVersion?: string;
  hasUpdate: boolean;
  compatible: boolean;
  requiredAppVersion: string | null;
}

interface PluginStoreState {
  isInitialized: boolean;
  /** True permanently after the first successful initialize() — never reset to false. */
  hasEverInitialized: boolean;
  pluginErrors: PluginError[];
  addPluginError: (extensionId: string, error: string, kind?: PluginError['kind']) => void;
  clearPluginErrors: () => void;
  sidebar: { left: any[]; right: any[] };
  panels: { [key: string]: any[] };
  initialize: () => void;
  addSidebarTab: (sidebarId: "left" | "right", tab: any) => void;
  registerPanel: (panelId: string, panel: any) => void;
  editorActions: EditorAction[];
  addEditorAction: (action: EditorAction) => void;
  statusBarItems: StatusBarItem[];
  addStatusBarItem: (item: StatusBarItem) => void;
  /** Keyed by pluginId. Populated after the startup update check. */
  coreUpdateInfo: Record<string, CorePluginUpdateInfo>;
  setCoreUpdateInfo: (info: CorePluginUpdateInfo[]) => void;
  /** Tracks which core plugins are currently being installed (global — survives PluginProvider remounts). */
  installingCorePlugins: Record<string, boolean>;
  setInstallingPlugin: (pluginId: string, installing: boolean) => void;
  /** Help commands registered by plugins — shown in the command palette under Help: */
  helpCommands: PluginHelpCommand[];
  addHelpCommand: (cmd: PluginHelpCommand) => void;
  pluginCommands: PluginCommand[];
  addPluginCommand: (cmd: PluginCommand) => void;
  topBarItems: PluginTopBarItem[];
  addTopBarItem: (item: PluginTopBarItem) => void;
  contextMenuItems: PluginContextMenuItem[];
  addContextMenuItem: (item: PluginContextMenuItem) => void;
  settingsPageSections: PluginSettingsSection[];
  addSettingsSection: (section: PluginSettingsSection) => void;
}

export const usePluginStore = create<PluginStoreState>((set) => ({
  isInitialized: false,
  hasEverInitialized: false,
  pluginErrors: [],
  addPluginError: (extensionId, error, kind) =>
    set((state) => ({
      pluginErrors: [...state.pluginErrors, { extensionId, error, kind }],
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
  initialize: () => set({ isInitialized: true, hasEverInitialized: true }),
  coreUpdateInfo: {},
  setCoreUpdateInfo: (info) =>
    set({ coreUpdateInfo: Object.fromEntries(info.map((i) => [i.pluginId, i])) }),
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
  installingCorePlugins: {},
  setInstallingPlugin: (pluginId, installing) =>
    set((state) => ({
      installingCorePlugins: installing
        ? { ...state.installingCorePlugins, [pluginId]: true }
        : Object.fromEntries(Object.entries(state.installingCorePlugins).filter(([k]) => k !== pluginId)),
    })),
  editorActions: [],
  addEditorAction: (action) => {
    set((state) => ({
      editorActions: state.editorActions.some((a) => a.id === action.id)
        ? state.editorActions
        : [...state.editorActions, action],
    }));
  },
  statusBarItems: [],
  addStatusBarItem: (item) => {
    set((state) => ({
      statusBarItems: [...state.statusBarItems, item],
    }));
  },
  helpCommands: [],
  addHelpCommand: (cmd) => {
    set((state) => ({
      helpCommands: [...state.helpCommands, cmd],
    }));
  },
  pluginCommands: [],
  addPluginCommand: (cmd) => set((state) => ({ pluginCommands: [...state.pluginCommands, cmd] })),
  topBarItems: [],
  addTopBarItem: (item) => set((state) => ({ topBarItems: [...state.topBarItems, item] })),
  contextMenuItems: [],
  addContextMenuItem: (item) => set((state) => ({ contextMenuItems: [...state.contextMenuItems, item] })),
  settingsPageSections: [],
  addSettingsSection: (section) => set((state) => ({ settingsPageSections: [...state.settingsPageSections, section] })),
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

// Global registry for table cell autocomplete suggestions (plugin-owned)
const tableSuggestionsRegistry = new Map<string, { [columnIndex: number]: Array<{ label: string; description?: string }> }>();

// Global registry for loaded plugin instances (for cleanup)
const loadedPlugins: Map<string, { onload: () => Promise<void>; onunload: () => Promise<void> }> = new Map();

// Also expose on window for React components to access
declare global {
  interface Window {
    __voidenHelpers__?: Record<string, any>;
    __voiden_shims__?: Record<string, unknown>;
    /** Keyed by pluginId — populated when an OTA bundle is loaded. Overrides baked-in registry metadata. */
    __voiden_ota_manifests__?: Record<string, any>;
  }
}

if (typeof window !== 'undefined') {
  window.__voiden_ota_manifests__ = {};
}

if (typeof window !== 'undefined') {
  window.__voidenHelpers__ = exposedHelpers;
  window.__voiden_shims__ = {
    // React — shared instances so plugin hooks work correctly
    "react": _ReactShim,
    // In Vite dev mode @vitejs/plugin-react switches the jsx runtime to react/jsx-dev-runtime
    // (which exports jsxDEV instead of jsx). Expose a plain object so plugin bundles get real
    // functions regardless of which runtime mode the host is in.
    "react/jsx-runtime": {
      jsx:      (_ReactJSXShim as any).jsx      ?? (_ReactJSXShim as any).jsxDEV ?? _ReactShim.createElement,
      jsxs:     (_ReactJSXShim as any).jsxs     ?? (_ReactJSXShim as any).jsxDEV ?? _ReactShim.createElement,
      Fragment: (_ReactJSXShim as any).Fragment  ?? (_ReactShim as any).Fragment,
    },
    "react-dom": _ReactDOMShim,
    "react-dom/client": _ReactDOMClientShim,
    // @tanstack/react-query — shared instance so QueryClientContext matches QueryClientProvider
    "@tanstack/react-query": _ReactQuery,
    // @tiptap/react — shared instance so ReactNodeViewRenderer context matches NodeViewWrapper
    "@tiptap/react": _TiptapReact,
    // CodeMirror — shared instances so extension instanceof checks pass
    "@codemirror/state": _CodeMirrorState,
    "@codemirror/view": _CodeMirrorView,
    "@codemirror/autocomplete": _CodeMirrorAutocomplete,
    // @/core/* — host app internals exposed for OTA-loaded plugin bundles
    "@/core/file-system/hooks/useFileSystem": { prosemirrorToMarkdown },
    "@/core/editors/voiden/extensions": { voidenExtensions: coreVoidenExtensions },
    "@/core/editors/voiden/VoidenEditor": { useEditorStore, useVoidenEditorStore, proseClasses },
    "@/core/editors/voiden/utils/expandLinkedBlocks": { expandLinkedBlocksInDoc },
    "@/core/editors/voiden/markdownConverter": { parseMarkdown },
    "@/core/request-engine/getRequestFromJson": { getTable, parseAuthNode, buildHeadersWithCookies, findNode, findNodes, createNewRequestObject, getRequest },
    "@/core/request-engine/stores/responseStore": { useResponseStore },
    "@/core/request-engine/requestOrchestrator": { requestOrchestrator },
    "@/core/request-engine/runtimeVariables": { replaceProcessVariablesInText },
    "@/core/request-engine/pipeline": { hookRegistry, PipelineStage },
    "@/core/history/adapterRegistry": { historyAdapterRegistry },
    "@/core/stores/panelStore": { usePanelStore },
    "@/core/stores/responsePanelPosition": { getResponsePanelPosition: getResponsePanelPositionFn },
    "@/core/environment/hooks": { useActiveEnvironment, useEnvironments },
    // @voiden/sdk — base classes plugins extend (UIExtension, etc.)
    "@voiden/sdk": { UIExtension, PipelineStage },
    "@voiden/sdk/shared": { parseCookies },
    // Host module aliases
    "@/plugins": { useEditorEnhancementStore, usePluginStore, emitPluginEvent, getContextMenuItems },
    // Zustand — shared instance so stores work across plugin/host boundary
    "zustand": _ZustandShim,
    // @tiptap/* — shared instances so Node.create(), Extension.create() etc work
    "@tiptap/core": _TiptapCore,
    "@tiptap/pm/model": _TiptapPMModel,
    "@tiptap/pm/state": _TiptapPMState,
    "@tiptap/pm/tables": _TiptapPMTables,
    "@tiptap/pm/view": _TiptapPMView,
    "@tiptap/suggestion": _TiptapSuggestion,
    // UI utilities — icons and tooltip engine shared with tiptap extensions
    "lucide-react": _LucideReact,
    "tippy.js": _Tippy,
    "yaml": _Yaml,
    // react-dnd / react-dnd-html5-backend — shared instances prevent duplicate HTML5 backend registration
    "react-dnd": _ReactDnd,
    "react-dnd-html5-backend": _ReactDndHtml5Backend,
    // react-markdown + remark-gfm — shared so plugins don't bundle their own copies
    "react-markdown": _ReactMarkdown,
    "remark-gfm": _RemarkGfm,
    // @/main is a lazy getter — getQueryClient lives in main.tsx which imports
    // plugins.tsx, creating a circular dep. Accessing it eagerly here hits the
    // Temporal Dead Zone. The getter defers the read until a plugin uses the shim.
  } as Record<string, unknown>;
  Object.defineProperty(window.__voiden_shims__, '@/main', {
    get: () => ({ getQueryClient }),
    enumerable: true,
    configurable: true,
  });
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

/**
 * Get table cell suggestions for a specific table type and column.
 * Used by TableCellAutocomplete extension.
 */
export const getTableSuggestions = (
  tableType: string,
  columnIndex: number,
): Array<{ label: string; description?: string }> => {
  const config = tableSuggestionsRegistry.get(tableType);
  if (!config) return [];
  return config[columnIndex] || [];
};

export class PluginPermissionError extends Error {
  readonly extensionId: string;
  readonly permission: string;

  constructor(extensionId: string, permission: string) {
    super(
      `Plugin "${extensionId}" requires the "${permission}" permission. ` +
      `Add "${permission}" to the permissions array in its manifest.json.`
    );
    this.name = 'PluginPermissionError';
    this.extensionId = extensionId;
    this.permission = permission;
  }
}

type PluginEventCallback = (data: any) => void;
const pluginEventBus = new Map<string, Set<PluginEventCallback>>();

export function emitPluginEvent(event: string, data?: any): void {
  const listeners = pluginEventBus.get(event);
  if (!listeners) return;
  listeners.forEach((cb) => {
    try { cb(data); } catch (e) { console.error(`[PluginEvents] Error in "${event}" handler:`, e); }
  });
}

export function subscribePluginEvent(event: string, cb: PluginEventCallback): () => void {
  if (!pluginEventBus.has(event)) pluginEventBus.set(event, new Set());
  pluginEventBus.get(event)!.add(cb);
  return () => pluginEventBus.get(event)?.delete(cb);
}

export function getContextMenuItems(
  surface: PluginContextMenuItem['surface'],
  target: any
): PluginContextMenuItem[] {
  return usePluginStore
    .getState()
    .contextMenuItems.filter(
      (item) => item.surface === surface && (!item.when || item.when(target))
    );
}

export const createPlugin = (
  pluginModule: (context: PluginContext) => Plugin,
  extensionId: string,
  options: { isCore?: boolean; permissions?: string[] } = {}
) => {
  const { isCore = false, permissions = [] } = options;

  const requirePermission = (perm: string): void => {
    if (isCore) return;
    if (!permissions.includes(perm)) {
      const err = new PluginPermissionError(extensionId, perm);
      usePluginStore.getState().addPluginError(extensionId, err.message, 'permission');
      throw err;
    }
  };
  // Define the API that your plugins will use.
  const context: any = {
    // Provide pipeline API so plugins never need to import @voiden/executors directly.
    // The hookRegistry is imported from the app's pipeline alias (same singleton).
    pipeline: {
      registerHook: async (stage: string, handler: any, priority?: number) => {
        const { hookRegistry } = await import('@/core/request-engine/pipeline');
        hookRegistry.registerHook(extensionId, stage as any, handler, priority);
      },
      unregister: async () => {
        const { hookRegistry } = await import('@/core/request-engine/pipeline');
        hookRegistry.unregisterExtension(extensionId);
      },
    },
    response: {
      getCurrentTabId: async (): Promise<string | null> => {
        const { useResponseStore } = await import('@/core/request-engine/stores/responseStore');
        return useResponseStore.getState().currentRequestTabId ?? null;
      },
      setError: async (tabId: string | null, error: string): Promise<void> => {
        const { useResponseStore } = await import('@/core/request-engine/stores/responseStore');
        useResponseStore.getState().setError(tabId, error);
      },
    },
    exposeHelpers: (helpers: PluginHelpers) => {
      extensionLogger.info(`Plugin "${extensionId}" exposing helpers:`, Object.keys(helpers));
      exposedHelpers[extensionId] = helpers;
    },
    registerSidebarTab: (sidebarId: "left" | "right", tab: Tab) => {
      if (tab.component) tab = { ...tab, component: tagComponent(extensionId, tab.component) };
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
    getVoidenSlashGroups: (): SlashCommandGroup[] => {
      return useEditorEnhancementStore.getState().voidenSlashGroups;
    },
    addVoidenSlashCommand: (command: SlashCommand) => {
      // Legacy single-command API — wraps into a group keyed by extensionId
      const existing = useEditorEnhancementStore.getState().voidenSlashGroups.find(g => g.name === extensionId);
      if (existing) {
        existing.commands.push(command as any);
        useEditorEnhancementStore.getState().addVoidenSlashGroup({ ...existing });
      } else {
        useEditorEnhancementStore.getState().addVoidenSlashGroup({
          name: extensionId,
          title: extensionId,
          commands: [command as any],
        });
      }
    },
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
      if (panel.component) panel = { ...panel, component: tagComponent(extensionId, panel.component) };
      usePluginStore.getState().registerPanel(panelId, panel);
    },
    addTab: async (tabId: string, tab: Panel) => {
      // Store the React component in Zustand so the renderer can find it
      if (tab.component) {
        usePluginStore.getState().registerPanel(tabId, {
          id: tab.id,
          title: tab.title,
          component: tagComponent(extensionId, tab.component),
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
    registerEditorAction: (action: any) => {
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
          const view = useCodeEditorStore.getState().activeEditor.editor;
          if (!view) return null;
          // EditorView has no .getText() — expose a compatible shim so plugin
          // callers can use the same getText() pattern as the Voiden (TipTap) editor.
          return {
            getText: () => view.state.doc.toString(),
            _view: view,
          };
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
      openFile: async (relativePath: string, skipJoin = false) => {
        // Safe API for plugins to open files
        // Only allows opening files within the project
        const projects = await getProjects();
        const activeProject = projects?.activeProject;
        if (!activeProject) {
          throw new Error("No active project found");
        }
        const absolutePath = skipJoin ? relativePath : await window.electron?.utils?.pathJoin(activeProject, relativePath);
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
    } as any,
    tab: {
      getActiveTab: async () => {
        const tab = (await window.electron?.tab.getActiveTab?.()) || {};
        return tab;
      },
    },
    files: {
      read: async (path: string) => {
        const content = (await window.electron?.files?.read(path)) || ''
        return content;
      }
    },
    helpers: {
      parseVoid: (markdown: string | undefined) => {
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
      // Environment hooks — must only be called inside React components / TipTap node views
      useActiveEnvironment,
      useEnvironments,
      // Editor utilities
      useEditorStore,
      expandLinkedBlocksInDoc,
      prosemirrorToMarkdown,
      getVoidenExtensions: () => coreVoidenExtensions,
      // Request-building utilities — available to all plugins without @/core imports
      requestUtils: {
        getTable,
        parseAuthNode,
        buildHeadersWithCookies,
        findNode,
        findNodes,
        createNewRequestObject,
      },
    } as any,
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
      openRightSidebarTab: async (id: string, openResponsePanel?: boolean) => {
        // 1) fetch right sidebar tabs from main
        const sidebarData = await window.electron?.sidebar?.getTabs('right');
        const tabs = sidebarData?.tabs || [];

        // 2) find our tab by customTabKey
        const pluginTab = tabs.find((t: any) => t?.meta?.customTabKey === id);
        if (!pluginTab && openResponsePanel) {
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
      getResponsePanelPosition: (): 'right' | 'bottom' => getResponsePanelPositionFn(),
      setBottomActiveView: (view: string) => {
        (usePanelStore.getState() as any).setBottomActiveView(view);
      },
      expandBottomPanel: () => {
        const { bottomPanelRef } = usePanelStore.getState() as any;
        bottomPanelRef?.current?.expand();
      },
      components: {
        CodeEditor: GenericCodeEditor,
        Table,
        TableBody,
        TableRow,
        TableCell,
        NodeViewWrapper,
        RequestBlockHeader,
        Tip,
      } as any,
      hooks: {
        useSendRestRequest,
        useParentResponseDoc,
        useResponseBodyHeight,
      },
      showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => {
        if (type) {
          toast[type](message, { duration: 4000, closeButton: true });
        } else {
          toast(message, { duration: 4000, closeButton: true });
        }
      },
      registerSettings: (section: Omit<PluginSettingsSection, 'pluginId'>) => {
        requirePermission('settings');
        extensionLogger.info(`Plugin "${extensionId}" registering settings section: ${section.id}`);
        usePluginStore.getState().addSettingsSection({ ...section, pluginId: extensionId });
      },
    } as any,
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
    } as any,
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
    onBuildRequest: (handler: any) => {
      requestOrchestrator.registerRequestHandler(handler);
    },
    onProcessResponse: (handler: any) => {
      requestOrchestrator.registerResponseHandler(handler);
    },
    registerResponseSection: (section: any) => {
      requestOrchestrator.registerResponseSection(section);
    },
    openVoidenTab: async (title: string, content: any, options?: { readOnly?: boolean }) => {
      try {
        const { useResponseStore } = await import('@/core/request-engine/stores/responseStore');

        const tabId = useResponseStore.getState().currentRequestTabId;
        console.log('[openVoidenTab] title:', title, 'tabId:', tabId, 'isLoading:', useResponseStore.getState().isLoading, 'content:', JSON.stringify(content).slice(0, 200));

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
    registerTableSuggestions: (tableType: string, suggestions: { [columnIndex: number]: Array<{ label: string; description?: string }> }) => {
      extensionLogger.info(`Plugin "${extensionId}" registering table suggestions for "${tableType}"`);
      tableSuggestionsRegistry.set(tableType, suggestions);
    },
    registerHistoryAdapter: (adapter: any) => {
      extensionLogger.info(`Plugin "${extensionId}" registering history adapter`);
      historyAdapterRegistry.register(adapter);
    },
    registerHelpCommand: (cmd: PluginHelpCommand) => {
      extensionLogger.info(`Plugin "${extensionId}" registering help command: ${cmd.id}`);
      usePluginStore.getState().addHelpCommand(cmd);
    },
    registerCommand: (cmd: PluginCommand) => {
      requirePermission('commandPalette');
      extensionLogger.info(`Plugin "${extensionId}" registering command: ${cmd.id}`);
      usePluginStore.getState().addPluginCommand(cmd);
    },
    registerTopBarItem: (item: PluginTopBarItem) => {
      extensionLogger.info(`Plugin "${extensionId}" registering top bar item: ${item.id}`);
      usePluginStore.getState().addTopBarItem({ ...item, icon: tagComponent(extensionId, item.icon) });
    },
    registerContextMenu: (item: PluginContextMenuItem) => {
      requirePermission('contextMenus');
      extensionLogger.info(`Plugin "${extensionId}" registering context menu: ${item.id} for surface "${item.surface}"`);
      usePluginStore.getState().addContextMenuItem(item);
    },
    events: {
      on: (event: string, cb: PluginEventCallback): (() => void) => {
        requirePermission('events');
        return subscribePluginEvent(event, cb);
      },
    },
    fs: {
      read: async (relativePath: string): Promise<string> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) throw new Error('No active project');
        const abs = await window.electron?.utils?.pathJoin(base, relativePath);
        if (!abs) throw new Error('Failed to resolve path');
        return window.electron?.files?.read(abs) ?? '';
      },
      write: async (relativePath: string, content: string): Promise<void> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) throw new Error('No active project');
        const abs = await window.electron?.utils?.pathJoin(base, relativePath);
        if (!abs) throw new Error('Failed to resolve path');
        await window.electron?.files?.write(abs, content);
      },
      create: async (relativePath: string, content = ''): Promise<void> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) throw new Error('No active project');
        const abs = await window.electron?.utils?.pathJoin(base, relativePath);
        if (!abs) throw new Error('Failed to resolve path');
        await window.electron?.files?.write(abs, content);
      },
      createDirectory: async (relativePath: string): Promise<void> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) throw new Error('No active project');
        const abs = await window.electron?.utils?.pathJoin(base, relativePath);
        if (!abs) throw new Error('Failed to resolve path');
        await window.electron?.files?.createDirectory(abs);
      },
      delete: async (relativePath: string): Promise<void> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) throw new Error('No active project');
        const abs = await window.electron?.utils?.pathJoin(base, relativePath);
        if (!abs) throw new Error('Failed to resolve path');
        await window.electron?.files?.delete(abs);
      },
      move: async (fromRelative: string, toRelative: string): Promise<void> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) throw new Error('No active project');
        const absFrom = await window.electron?.utils?.pathJoin(base, fromRelative);
        const absToDir = await window.electron?.utils?.pathJoin(base, toRelative.replace(/\/[^/]+$/, ''));
        if (!absFrom || !absToDir) throw new Error('Failed to resolve path');
        await window.electron?.files?.createDirectory(absToDir);
        const result = await window.electron?.files?.move([absFrom], absToDir);
        if (result && !result.success) throw new Error(result.error ?? 'Move failed');
      },
      exists: async (relativePath: string): Promise<boolean> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) return false;
        const abs = await window.electron?.utils?.pathJoin(base, relativePath);
        if (!abs) return false;
        try {
          const [fileExists, dirExists] = await Promise.all([
            window.electron?.files?.getFileExist(abs) ?? false,
            window.electron?.files?.getDirectoryExist(abs) ?? false,
          ]);
          return fileExists || dirExists;
        } catch { return false; }
      },
      list: async (relativePath = ''): Promise<Array<{ name: string; path: string; type: 'file' | 'directory' }>> => {
        requirePermission('filesystem');
        const projects = await getProjects();
        const base = projects?.activeProject;
        if (!base) return [];
        const target = relativePath
          ? (await window.electron?.utils?.pathJoin(base, relativePath)) ?? base
          : base;
        const entries = await window.electron?.files?.expandDir(target) ?? [];
        return (entries as any[]).map((e: any) => ({
          name: e.name ?? e.id?.split('/').pop() ?? '',
          path: e.path ?? e.id ?? '',
          type: (e.type === 'internal' || e.children !== undefined) ? 'directory' : 'file',
        }));
      },
    },
    settings: {
      get: async <T = any>(key: string): Promise<T | undefined> => {
        requirePermission('settings');
        return window.electron?.pluginSettings?.get(extensionId, key) as Promise<T | undefined>;
      },
      set: async <T = any>(key: string, value: T): Promise<void> => {
        requirePermission('settings');
        await window.electron?.pluginSettings?.set(extensionId, key, value);
      },
      delete: async (key: string): Promise<void> => {
        requirePermission('settings');
        await window.electron?.pluginSettings?.delete(extensionId, key);
      },
      onChange: (cb: (key: string, value: any) => void): (() => void) => {
        requirePermission('settings');
        return window.electron?.pluginSettings?.onChanged((pluginId, key, value) => {
          if (pluginId === extensionId) cb(key, value);
        }) ?? (() => {});
      },
    },
    theme: THEME_CLASSES,
  };

  const plugin = pluginModule(context);

  return {
    onload: async () => plugin.onload(context),
    onunload: async () => {
      await plugin.onunload?.();
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
    helpCommands: [],
    pluginCommands: [],
    topBarItems: [],
    contextMenuItems: [],
    settingsPageSections: [],
    panels: { main: [], bottom: [] },
  });
  pluginEventBus.clear();
  Object.keys(exposedHelpers).forEach(key => delete exposedHelpers[key]);
  Object.keys(historyExporters).forEach(key => delete historyExporters[key]);
  curlImporters.length = 0;
  linkableNodeTypes.clear(); // Clear linkable node types on plugin reload
  coreLinkableNodeTypes.forEach(type => linkableNodeTypes.add(type)); // Re-seed core linkable types
  nodeDisplayNames.clear(); // Clear node display names on plugin reload
  Object.entries(coreNodeDisplayNames).forEach(([type, name]) => nodeDisplayNames.set(type, name)); // Re-seed core display names
  tableSuggestionsRegistry.clear();
  clearHelpRegistry();
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

  const coreExtApi = (window as any).electron?.coreExtensions;

  // Priority 1: OTA-cached bundles (user-downloaded updates)
  let cachedCorePaths: Record<string, string> = {};
  try {
    if (coreExtApi?.getCachedPlugins) {
      cachedCorePaths = await coreExtApi.getCachedPlugins();
    }
  } catch (e) {
    extensionLogger.warn('Failed to fetch cached core extension paths:', e);
  }

  // Priority 2: Build-time pre-downloaded bundles (fetched from plugin repos during cleanup)
  // These are better than workspace compiled code — same OTA format, correct shims.
  let bundledCorePaths: Record<string, string> = {};
  try {
    if (coreExtApi?.getBundledPlugins) {
      bundledCorePaths = await coreExtApi.getBundledPlugins();
      console.log('[Plugin Loader] Bundled plugin paths found:', Object.keys(bundledCorePaths));
    }
  } catch (e) {
    console.error('[Plugin Loader] Failed to fetch bundled plugin paths:', e);
    extensionLogger.warn('Failed to fetch bundled plugin paths:', e);
  }

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

        let plugin: ((context: PluginContext) => Plugin) | undefined;

        // Prefer a downloaded-and-cached bundle (updated version) over the bundled one.
        // We read the file via IPC then create a Blob URL — direct file:// imports are
        // blocked by Electron's CSP when the renderer is served from http://localhost.
        const cachedPath = cachedCorePaths[extension.id];
        if (cachedPath) {
          extensionLogger.info(`Using cached bundle for ${extension.id}: ${cachedPath}`);
          let blobUrl: string | null = null;
          try {
            const content = await (window as any).electron?.coreExtensions?.readPluginFile?.(cachedPath);
            if (content) {
              const blob = new Blob([content], { type: 'application/javascript' });
              blobUrl = URL.createObjectURL(blob);
              const mod = await import(/* @vite-ignore */ blobUrl);
              // Bundles older than BUNDLE_SHIM_VERSION lack critical host shims (e.g.
              // @tanstack/react-query) and cause "Invalid hook call" at render time.
              // Skip them so the built-in version is used until new bundles are released.
              const BUNDLE_SHIM_VERSION = 2;
              if ((mod?.__voiden_bundle_version__ ?? 0) < BUNDLE_SHIM_VERSION) {
                extensionLogger.warn(
                  `Cached bundle for ${extension.id} uses shim v${mod?.__voiden_bundle_version__ ?? 0}` +
                  ` (need v${BUNDLE_SHIM_VERSION}) — falling back to built-in version`
                );
              } else if (mod?.default && typeof mod.default === 'function') {
                plugin = mod.default;
                if (mod.__voiden_manifest__ && window.__voiden_ota_manifests__) {
                  window.__voiden_ota_manifests__[extension.id] = mod.__voiden_manifest__;
                  // Patch the main-process extension registry so getAll() returns updated metadata.
                  // Awaited so the registry is fully updated before we invalidate the query below.
                  await window.electron?.extensions?.updateCoreMeta?.(extension.id, mod.__voiden_manifest__);
                }
              } else {
                extensionLogger.warn(`Cached bundle for ${extension.id} has no default export — falling back to bundled version`);
              }
            }
          } catch (cacheErr) {
            console.error(`[Plugin Loader] Failed to import cached bundle for ${extension.id}:`, cacheErr);
            extensionLogger.warn(`Failed to load cached bundle for ${extension.id}:`, cacheErr, '— falling back to bundled version');
          } finally {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
          }
        }

        // Priority 2: build-time pre-downloaded bundle (cleanup.sh fetched from plugin repo)
        if (!plugin) {
          const bundledPath = bundledCorePaths[extension.id];
          if (bundledPath) {
            extensionLogger.info(`Using build-time bundle for ${extension.id}: ${bundledPath}`);
            let blobUrl: string | null = null;
            try {
              const content = await coreExtApi?.readPluginFile?.(bundledPath);
              if (content) {
                const blob = new Blob([content], { type: 'application/javascript' });
                blobUrl = URL.createObjectURL(blob);
                const mod = await import(/* @vite-ignore */ blobUrl);
                const BUNDLE_SHIM_VERSION = 2;
                if ((mod?.__voiden_bundle_version__ ?? 0) >= BUNDLE_SHIM_VERSION && mod?.default && typeof mod.default === 'function') {
                  plugin = mod.default;
                  console.log(`[Plugin Loader] Bundle version OK for ${extension.id}: v${mod.__voiden_bundle_version__}`);
                  if (mod.__voiden_manifest__ && window.__voiden_ota_manifests__) {
                    window.__voiden_ota_manifests__[extension.id] = mod.__voiden_manifest__;
                    await window.electron?.extensions?.updateCoreMeta?.(extension.id, mod.__voiden_manifest__);
                  }
                } else {
                  console.warn(`[Plugin Loader] Bundle rejected for ${extension.id}: version=${mod?.__voiden_bundle_version__}, hasDefault=${typeof mod?.default}`);
                }
              }
            } catch (bundleErr) {
              console.error(`[Plugin Loader] Failed to import build-time bundle for ${extension.id}:`, bundleErr);
              extensionLogger.warn(`Failed to load build-time bundle for ${extension.id}:`, bundleErr);
            } finally {
              if (blobUrl) URL.revokeObjectURL(blobUrl);
            }
          }
        }

        // No plugin loaded — OTA will download on next launch
        if (!plugin) {
          extensionLogger.warn(`Core extension ${extension.id} not found in any bundle — OTA will download on next launch`);
          console.warn(`[Plugin Loader] Core extension ${extension.id} not available locally, skipping`);
          continue;
        }

        // Validate plugin is a function
        if (typeof plugin !== 'function') {
          throw new Error(`Core extension ${extension.id} is not a function (got ${typeof plugin})`);
        }

        const pluginInstance = createPlugin(plugin, extension.id, {
          isCore: true,
          permissions: extension.permissions ?? [],
        });

        // Validate plugin instance has required methods
        if (!pluginInstance || typeof pluginInstance.onload !== 'function') {
          throw new Error(`Plugin instance for ${extension.id} missing required onload method`);
        }

        await pluginInstance.onload();

        loadedPlugins.set(extension.id, pluginInstance);
        const loadTime = (performance.now() - startTime).toFixed(2);
        console.log(`[Plugin Loader] ✓ Loaded ${extension.id} in ${loadTime}ms`);

      } else {
        extensionLogger.info(`Loading external extension: ${extension.id}`);

        if (!extension.installedPath) {
          throw new Error(`External extension ${extension.id} missing installedPath`);
        }

        const installPath = extension.installedPath;

        // Read main.js via IPC and import it as a Blob URL instead of an absolute
        // file path. When the renderer imports an absolute path, Vite's dev-server
        // serves it (fs.strict:false) AND adds it to its HMR watch graph, so the
        // next write to that path (e.g. reinstall) sends a full-page reload.
        // Blob URLs bypass Vite entirely — Vite never sees the path.
        const mainContent = await window.electron?.files?.read(`${installPath}/main.js`);
        if (!mainContent) {
          throw new Error(`External extension ${extension.id} main.js not found or empty`);
        }

        // Shim files are placed alongside main.js by the installer when the plugin
        // uses bare imports (react, zustand, etc.). Relative imports like
        // './__voiden_shim_react__.js' don't resolve when the parent is a blob URL,
        // so we read each shim, create its own Blob URL, and patch the reference
        // in main.js before bundling.
        const SHIM_FILES = [
          '__voiden_shim_react_jsx_dev_runtime__.js',
          '__voiden_shim_react_jsx_runtime__.js',
          '__voiden_shim_react_dom_client__.js',
          '__voiden_shim_react_dom__.js',
          '__voiden_shim_react__.js',
          '__voiden_shim_sdk_ui__.js',
          '__voiden_shim_sdk__.js',
        ];

        const shimBlobUrls: string[] = [];
        let patchedContent = mainContent;
        for (const shimFile of SHIM_FILES) {
          const shimContent = await window.electron?.files?.read(`${installPath}/${shimFile}`);
          if (shimContent) {
            const shimBlob = new Blob([shimContent], { type: 'application/javascript' });
            const shimBlobUrl = URL.createObjectURL(shimBlob);
            shimBlobUrls.push(shimBlobUrl);
            const rel = `./${shimFile}`;
            const esc = rel.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
            patchedContent = patchedContent
              .replace(new RegExp(`'${esc}'`, 'g'), `'${shimBlobUrl}'`)
              .replace(new RegExp(`"${esc}"`, 'g'), `"${shimBlobUrl}"`);
          }
        }

        const mainBlob = new Blob([patchedContent], { type: 'application/javascript' });
        const mainBlobUrl = URL.createObjectURL(mainBlob);
        let mod: any;
        try {
          mod = await import(/* @vite-ignore */ mainBlobUrl);
        } finally {
          // Modules are cached after first import — safe to revoke immediately.
          URL.revokeObjectURL(mainBlobUrl);
          for (const url of shimBlobUrls) URL.revokeObjectURL(url);
        }

        if (!mod || !mod.default) {
          throw new Error(`External extension ${extension.id} does not export a default function`);
        }

        if (typeof mod.default !== 'function') {
          throw new Error(`External extension ${extension.id} default export is not a function (got ${typeof mod.default})`);
        }

        const pluginInstance = createPlugin(mod.default, extension.id, {
          isCore: false,
          permissions: extension.permissions ?? [],
        });

        if (!pluginInstance || typeof pluginInstance.onload !== 'function') {
          throw new Error(`Plugin instance for ${extension.id} missing required onload method`);
        }

        await pluginInstance.onload();

        loadedPlugins.set(extension.id, pluginInstance);
        const loadTime = (performance.now() - startTime).toFixed(2);
        console.log(`[Plugin Loader] ✓ Loaded ${extension.id} in ${loadTime}ms`);
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
      usePluginStore.getState().addPluginError(extension.id, detailedError, 'load');
    }
  }
  // If any OTA bundles patched the main-process registry, invalidate the extensions
  // query so ExtensionDetails, ExtensionBrowser etc. immediately show updated metadata.
  if (Object.keys(window.__voiden_ota_manifests__ ?? {}).length > 0) {
    getQueryClient().invalidateQueries({ queryKey: ['extensions'] });
  }

  console.log(
    `[Plugin Loader] Done. ${loadedPlugins.size} plugins loaded.`,
    `Request handlers: ${requestOrchestrator.requestHandlers.length},`,
    `Response handlers: ${requestOrchestrator.responseHandlers.length}`
  );

  usePluginStore.getState().initialize();
};

const LOADING_STEPS = [
  "Initializing core",
  "Linking modules",
  "Syncing pipeline",
  "Environment ready",
];

const PluginLoadingScreen = () => {
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setStep((s) => (s < 3 ? s + 1 : s));
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // Restart the grid every 3s so it loops
  useEffect(() => {
    const t = setTimeout(() => setCycle((c) => c + 1), 3000);
    return () => clearTimeout(t);
  }, [cycle]);

  return (
    <div className="fixed inset-0 bg-bg flex flex-col items-center justify-center select-none z-[9999]">
      <div className="flex flex-col items-center gap-14">

        {/* Plugin cards snapping into a grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={cycle}
            className="grid grid-cols-3 gap-[10px]"
            exit={{ opacity: 0, scale: 0.93, transition: { duration: 0.22 } }}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <motion.div
                key={i}
                className="relative overflow-hidden rounded"
                style={{
                  width: 46,
                  height: 33,
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--ui-panel-bg)',
                }}
                initial={{ opacity: 0, scale: 0.25, y: 12 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  boxShadow: [
                    '0 0 0px rgba(var(--common-accent), 0)',
                    '0 0 12px rgba(var(--common-accent), 0.5)',
                    '0 0 0px rgba(var(--common-accent), 0)',
                  ],
                }}
                transition={{
                  delay: i * 0.11,
                  type: 'spring',
                  stiffness: 500,
                  damping: 22,
                  boxShadow: {
                    delay: 0.95,
                    duration: 1.1,
                    ease: 'easeInOut',
                    type: 'tween',
                  },
                }}
              >
                {/* Accent dot */}
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    top: 8, left: 7, width: 5, height: 5,
                    backgroundColor: 'rgb(var(--common-accent))',
                  }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.11 + 0.18, type: 'spring', stiffness: 700, damping: 18 }}
                />
                {/* Line 1 */}
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    top: 9, left: 17, right: 6, height: 2,
                    backgroundColor: 'var(--border)',
                    transformOrigin: 'left',
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ delay: i * 0.11 + 0.26, duration: 0.2 }}
                />
                {/* Line 2 */}
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    top: 16, left: 17, right: 13, height: 2,
                    backgroundColor: 'var(--border)',
                    opacity: 0.4,
                    transformOrigin: 'left',
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 0.4 }}
                  transition={{ delay: i * 0.11 + 0.36, duration: 0.16 }}
                />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>

        {/* Minimal Info */}
        <div className="flex flex-col items-center gap-6">
          <div className="h-4 flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={step}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="text-[10px] font-mono tracking-[0.5em] text-comment uppercase font-bold"
              >
                {LOADING_STEPS[step]}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Activity Pips */}
          <div className="flex gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full border border-border"
                animate={{
                  backgroundColor: step >= i ? "rgb(var(--common-accent))" : "transparent",
                  borderColor: step >= i ? "rgb(var(--common-accent))" : "var(--border)",
                }}
                transition={{ duration: 0.5 }}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

// Wraps a plugin-registered component with a HOC whose displayName contains the extensionId.
// Even if the wrapped value is invalid (object instead of component), the HOC itself is a
// valid function, so React's component stack will show `VoidenPlugin_<extensionId>` on error.
function tagComponent(extensionId: string, Component: any): React.ComponentType<any> {
  const Tagged = (props: any) => {
    const C = Component;
    return <C {...props} />;
  };
  Tagged.displayName = `VoidenPlugin_${extensionId}`;
  return Tagged;
}

function findBrokenExtensions(
  error: Error | null,
  errorInfo: import('react').ErrorInfo | null,
  extensions: any[],
  pluginErrors: { extensionId: string }[]
): any[] {
  if (!extensions?.length) return [];

  // Load-time errors already have the extension ID tracked
  const loadErrorIds = new Set(
    pluginErrors.map((e) => e.extensionId).filter((id) => id !== '__plugin_system__')
  );
  if (loadErrorIds.size > 0) {
    const matched = extensions.filter((ext) => loadErrorIds.has(ext.id));
    if (matched.length > 0) return matched;
  }

  // Render-time errors: parse component stack for VoidenPlugin_ tags injected by tagComponent()
  const componentStack = errorInfo?.componentStack ?? '';
  const pluginMatch = componentStack.match(/VoidenPlugin_([^\s\n)]+)/);
  if (pluginMatch) {
    const matchedId = pluginMatch[1];
    const ext = extensions.find((e) => e.id === matchedId);
    if (ext) return [ext];
  }

  // Fallback: match error stack/message against extension IDs (works when bundle path contains the ID)
  const stack = (error?.stack ?? '') + (error?.message ?? '');
  const matched = extensions.filter((ext) => ext.id && stack.includes(ext.id));
  return matched;
}

const PluginErrorFallback: React.FC<{
  error: Error | null;
  errorInfo: import('react').ErrorInfo | null;
  onReset: () => void;
}> = ({ error, errorInfo, onReset }) => {
  const { data: extensions } = useGetExtensions();
  const pluginErrors = usePluginStore((s) => s.pluginErrors);
  const { mutate: setEnabled } = useSetExtensionEnabled();
  const { mutate: uninstall } = useUninstallExtension();
  const [copied, setCopied] = useState(false);

  const allExtensions = (extensions ?? []) as any[];
  const brokenExts = findBrokenExtensions(error, errorInfo, allExtensions, pluginErrors);

  const handleCopy = () => {
    navigator.clipboard.writeText(error?.stack || error?.message || 'Unknown error');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-4 bg-bg">
      <div className="max-w-md w-full bg-editor border border-border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-8 h-8 text-orange-500 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-text">Plugin Error</h3>
            <p className="text-sm text-comment">A plugin caused an error</p>
          </div>
        </div>

        {brokenExts.length > 0 && (
          <div className="space-y-1">
            {brokenExts.map((ext: any) => (
              <div key={ext.id} className="flex items-center justify-between gap-2 p-2 bg-bg rounded border border-border">
                <span className="text-sm font-medium text-text truncate flex-1">{ext.name || ext.id}</span>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEnabled({ extensionId: ext.id, enabled: false })}
                    className="text-xs px-2 py-1 bg-editor border border-border text-comment hover:text-text rounded transition-colors"
                  >
                    Disable
                  </button>
                  <button
                    onClick={() => uninstall(ext.id)}
                    className="text-xs px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm text-red-400 font-mono bg-bg p-3 rounded border border-border break-words">
          {error?.message || 'Unknown plugin error'}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="flex-1 bg-accent text-bg px-3 py-2 rounded text-sm hover:bg-accent/90 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 bg-editor border border-border text-text px-3 py-2 rounded text-sm hover:bg-active transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Error'}
          </button>
        </div>

        {brokenExts.length === 0 && allExtensions.filter((e) => e.enabled).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-comment font-medium">Disable or uninstall an extension to recover:</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {allExtensions.filter((e) => e.enabled).map((ext: any) => (
                <div key={ext.id} className="flex items-center justify-between gap-2 p-2 bg-bg rounded border border-border">
                  <span className="text-xs text-text truncate flex-1">{ext.name || ext.id}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEnabled({ extensionId: ext.id, enabled: false })}
                      className="text-xs px-2 py-1 bg-editor border border-border text-comment hover:text-text rounded transition-colors"
                    >
                      Disable
                    </button>
                    <button
                      onClick={() => uninstall(ext.id)}
                      className="text-xs px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const PluginErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [resetKey, setResetKey] = useState(0);
  return (
    <ErrorBoundary
      level="plugin"
      resetKey={resetKey}
      fallbackRender={({ error, errorInfo, reset }) => (
        <PluginErrorFallback
          error={error}
          errorInfo={errorInfo}
          onReset={() => {
            reset();
            setResetKey((k) => k + 1);
          }}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
};

export const PluginProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: extensions, isLoading: extLoading } = useGetExtensions();
  const isInitialized = usePluginStore((state) => state.isInitialized);
  const hasEverInitialized = usePluginStore((state) => state.hasEverInitialized);
  const updateCheckRan = useRef(false);

  // After the first initialization, check GitHub for updated core extension bundles.
  // Downloads happen in the background; a toast with a restart button appears if anything changed.
  useEffect(() => {
    if (!isInitialized || updateCheckRan.current) return;
    updateCheckRan.current = true;

    (async () => {
      try {
        const coreExtApi = (window as any).electron?.coreExtensions;
        if (!coreExtApi?.checkForUpdates) {
          console.warn('[CoreExtensions] coreExtensions API not available on window.electron');
          return;
        }

        console.log('[CoreExtensions] Checking for available updates...');
        const result = await coreExtApi.checkForUpdates();

        if (result?.error) {
          console.warn('[CoreExtensions] Update check error:', result.error);
          return;
        }

        if (result?.plugins?.length) {
          usePluginStore.getState().setCoreUpdateInfo(result.plugins);
          const updatable = result.plugins.filter((p: any) => p.hasUpdate && p.compatible);
          const incompatible = result.plugins.filter((p: any) => p.hasUpdate && !p.compatible);
          if (updatable.length > 0) {
            console.log(`[CoreExtensions] ${updatable.length} update(s) available:`, updatable.map((p: any) => p.pluginId).join(', '));
          }
          if (incompatible.length > 0) {
            console.log(`[CoreExtensions] ${incompatible.length} update(s) require a newer app version:`, incompatible.map((p: any) => `${p.pluginId} (${p.requiredAppVersion})`).join(', '));
          }
        }
      } catch (err) {
        console.warn('[CoreExtensions] Update check threw unexpectedly:', err);
      }
    })();
  }, [isInitialized]);

  const reloadingRef = useRef(false);
  const reloadPlugins = useCallback(async () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    // Always set isInitialized: false so that mounted editors unmount cleanly
    // before extensions are cleared (prevents TipTap removeChild DOM errors).
    // PanelContent and PluginProvider both use hasEverInitialized to decide
    // whether to show the animated loading screen or just wait silently.
    usePluginStore.setState({ isInitialized: false });

    // Yield to React so it can process the null render from PanelContent
    // and unmount the TipTap editor before we wipe voidenExtensions.
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
      usePluginStore.getState().addPluginError('__plugin_system__', String(err));
      usePluginStore.getState().initialize();
    } finally {
      reloadingRef.current = false;
    }
  }, [getPlugins]);

  // Hot-reload: main process signals this when bundled-plugins/ changes (dev only)
  useEffect(() => {
    const ipc = (window as any).electron?.ipc;
    if (!ipc) return;
    const handler = () => reloadPlugins();
    ipc.on('coreExtensions:bundledPluginsChanged', handler);
    return () => ipc.removeListener('coreExtensions:bundledPluginsChanged', handler);
  }, [reloadPlugins]);

  // Plugin update: UI components dispatch this event after OTA update to reload without restart
  useEffect(() => {
    const handler = () => reloadPlugins();
    window.addEventListener('voiden:reloadPlugins', handler);
    return () => window.removeEventListener('voiden:reloadPlugins', handler);
  }, [reloadPlugins]);

  // Log main-process extension load results to DevTools console (same format as renderer plugins).
  // On mount: pull startup results (fired before renderer subscribed).
  // At runtime: subscribe to live events (e.g. after OTA install).
  useEffect(() => {
    if (!isInitialized) return;
    const coreExtApi = (window as any).electron?.coreExtensions;
    if (!coreExtApi) return;

    const logResult = (r: { id: string; success: boolean; path?: string; error?: string; duration: number }) => {
      if (r.success) {
        extensionLogger.info(`[MainProcess] ✓ Loaded ${r.id} in ${r.duration.toFixed(1)}ms`, r.path ? `— ${r.path}` : '');
      } else {
        extensionLogger.warn(`[MainProcess] ✗ Failed to load ${r.id}: ${r.error}`);
      }
    };

    coreExtApi.getMainProcessResults?.().then((results: any[]) => results?.forEach(logResult));

    const unsub = coreExtApi.onMainProcessExtensionLoaded?.(logResult);
    return () => unsub?.();
  }, [isInitialized]);

  const prevReloadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (extLoading) return;

    // Only reload when the set of enabled/installed plugins actually changes.
    // Metadata-only updates (OTA manifest sync, remote registry fetch) share
    // the same id:enabled fingerprint — skip those to avoid a second loading screen.
    const reloadKey = (extensions ?? [])
      .map((e: any) => `${e.id}:${e.enabled ? '1' : '0'}`)
      .sort()
      .join('|');

    if (prevReloadKeyRef.current === reloadKey) return;
    prevReloadKeyRef.current = reloadKey;

    const timeoutId = setTimeout(() => {
      reloadPlugins();
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [extensions, extLoading]);
  if (!hasEverInitialized && (extLoading || !isInitialized)) {
    return <PluginLoadingScreen />;
  }

  return (
    <PluginErrorBoundary>
      {children}
    </PluginErrorBoundary>
  );
};
