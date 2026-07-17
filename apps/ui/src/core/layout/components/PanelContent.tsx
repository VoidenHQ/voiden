import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useGetPanelTabs, useGetTabContent, useAddPanelTab, useActivateTab, useClosePanelTab } from "@/core/layout/hooks";
import { toast } from "@/core/components/ui/sonner";
import { CodeEditor } from "@/core/editors/code/CodeEditor";
import { ExtensionDetails } from "@/core/extensions/components/ExtensionDetails";
import { VoidenEditor } from "@/core/editors/voiden/VoidenEditor";
import { SettingsContent } from "@/core/settings/components/SettingsContent";
import { usePluginStore, useEditorEnhancementStore } from "@/plugins";
import { TerminalManager } from "@/core/terminal/components/TerminalManager";
import WelcomeScreen from "@/core/screens/WelcomeScreen";
import SettingsScreen from "@/core/screens/SettingsScreen";
import logo from "@/assets/logo-dark.png";
import ChangeLogScreen from "@/core/screens/ChangeLogScreen";
import { LogsPanel } from "@/core/request-engine/components/LogsPanel";
import { useCodeEditorStore } from "@/core/editors/code/CodeEditorStore";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { Settings, Menu, Play, PlayCircle, Folder, ChevronRight } from "lucide-react";
import { useGetAppState } from "@/core/state/hooks";
import { useSendRequest } from "@/core/request-engine";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { Kbd } from "@/core/components/ui/kbd";
import { ErrorBoundary } from "@/core/components/ErrorBoundary";
import { DiffViewer } from "@/core/git/components/DiffViewer";
import { ConflictEditorTab } from "@/core/git/components/ConflictEditorTab";
import { EnvironmentEditor } from "@/core/environment/components/EnvironmentEditor";
import { useNewTerminalTab } from "@/core/terminal/hooks/useTerminal";
import { usePanelStore } from "@/core/stores/panelStore";
import { Tip } from "@/core/components/ui/Tip";
import { useSettings } from "@/core/settings/hooks";
import { PersistentSearchPanel } from "./PersistentSearchPanel";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/core/components/ui/resizable";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { getFileIcon } from "@/core/file-system/components/FileSystemList/fileIcon";
import type { FileTree } from "@/types";
import { getSchema } from "@tiptap/core";
import { voidenExtensions } from "@/core/editors/voiden/extensions";
import { prosemirrorToMarkdown } from "@/core/file-system/hooks";
import { confirmAndSaveTab } from "@/core/stores/unsavedChangesDialogStore";

// Stable fallback so the `activeEditor` selector below can bail out to a
// reference-equal value (see its useCallback) instead of a fresh object,
// which would defeat the whole point of narrowing the subscription.
const EMPTY_ACTIVE_EDITOR = { tabId: null, content: "", source: null, panelId: null, editor: null };

// Extensions that cannot be displayed as text — show a "not supported" message
const BINARY_EXTENSIONS = new Set([
  "zip", "rar", "tar", "gz", "bz2", "7z", "xz", "tgz",
  "exe", "dll", "so", "dylib", "app", "dmg", "pkg", "deb", "rpm", "msi", "apk",
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tiff", "tif", "psd", "heic", "avif",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm", "m4a", "m4v",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "class", "pyc", "o", "a", "lib",
  "woff", "woff2", "ttf", "otf", "eot",
  "db", "sqlite", "sqlite3",
]);

function isBinaryFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

const UnsupportedFile = ({ title }: { title: string }) => (
  <div className="flex flex-col items-center justify-center h-full gap-2 text-comment select-none">
    <span className="text-sm font-medium">{title}</span>
    <span className="text-xs">This file type cannot be opened in the editor.</span>
  </div>
);

// TypeScript interface for md-preview plugin helpers
interface MdPreviewHelpers {
  useMdViewStore: (selector: (state: any) => any) => any;
  Preview: React.ComponentType<{ tab: any; className?: string }>;
}

// Helper to access md-preview plugin helpers dynamically
const getMdPreviewHelpers = (): MdPreviewHelpers | undefined => {
  if (typeof window !== 'undefined' && window.__voidenHelpers__) {
    return window.__voidenHelpers__['md-preview'] as MdPreviewHelpers;
  }
  return undefined;
};

// Finds the rendered preview element whose source line is the closest one at-or-before
// `line`. Elements come out of querySelectorAll in document order, so data-line values
// are already ascending — first element past the target is where we stop.
const findPreviewElementForLine = (previewScroller: HTMLElement, line: number): HTMLElement | null => {
  const elements = Array.from(previewScroller.querySelectorAll<HTMLElement>("[data-line]"));
  if (elements.length === 0) return null;
  let target: HTMLElement | null = null;
  for (const el of elements) {
    const elLine = Number(el.getAttribute("data-line"));
    if (elLine <= line) target = el;
    else break;
  }
  return target ?? elements[0];
};

// Finds the source line of whichever rendered element currently sits at (or just
// above) the top edge of the preview's visible area.
const findTopVisibleLine = (previewScroller: HTMLElement): number | null => {
  const elements = Array.from(previewScroller.querySelectorAll<HTMLElement>("[data-line]"));
  if (elements.length === 0) return null;
  const scrollerTop = previewScroller.getBoundingClientRect().top;
  let topmost: HTMLElement | null = null;
  for (const el of elements) {
    if (el.getBoundingClientRect().top - scrollerTop <= 1) topmost = el;
    else break;
  }
  topmost = topmost ?? elements[0];
  const line = Number(topmost.getAttribute("data-line"));
  return Number.isFinite(line) ? line : null;
};

// Run script button for .sh files
const RunScriptButton = ({ source }: { source: string }) => {
  const { mutateAsync: newTerminalTab } = useNewTerminalTab();
  const { bottomPanelRef, openBottomPanel } = usePanelStore();

  const handleRun = async () => {
    // Ensure bottom panel is open
    if (bottomPanelRef?.current) {
      bottomPanelRef.current.expand();
    }
    openBottomPanel();

    // Create a new terminal tab and send the run command
    const result = await newTerminalTab("bottom");
    if (result?.tabId) {
      // Small delay to let the terminal initialize
      setTimeout(() => {
        window.electron?.terminal.sendInput({
          id: result.tabId,
          data: `bash ${source}\n`,
        });
      }, 500);
    }
  };

  return (
    <Tip label="Run script" side="bottom">
      <button
        onClick={handleRun}
        className="p-1 hover:bg-active rounded-sm"
      >
        <Play size={14} className="text-comment hover:text-fg" />
      </button>
    </Tip>
  );
};

// Lists a folder's contents inside a breadcrumb dropdown, lazily fetched on open.
// Subfolders nest as submenus so the whole tree below the clicked segment is browsable.
const BreadcrumbFolderEntries = ({ folderPath, onOpenFile }: { folderPath: string; onOpenFile: (entry: FileTree) => void }) => {
  const [entries, setEntries] = useState<FileTree[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    window.electron?.files.expandDir(folderPath).then((children) => {
      if (!cancelled) setEntries(children ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  if (entries === null) {
    return <div className="px-2 py-1.5 text-xs text-comment">Loading…</div>;
  }
  if (entries.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-comment">Empty folder</div>;
  }

  return (
    <>
      {entries.map((entry) =>
        entry.type === "folder" ? (
          <DropdownMenu.Sub key={entry.path}>
            <DropdownMenu.SubTrigger className="flex items-center gap-2 px-2 py-1.5 text-xs text-text rounded-sm outline-none cursor-default data-[state=open]:bg-hover hover:bg-hover">
              <Folder size={14} className="flex-shrink-0 opacity-70" />
              <span className="truncate flex-1">{entry.name}</span>
              <ChevronRight size={12} className="flex-shrink-0 opacity-50" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                sideOffset={2}
                alignOffset={-4}
                className="z-[9999] min-w-[180px] max-h-72 overflow-y-auto bg-editor border border-border rounded-md shadow-lg p-1"
              >
                <BreadcrumbFolderEntries folderPath={entry.path} onOpenFile={onOpenFile} />
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        ) : (
          <DropdownMenu.Item
            key={entry.path}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text rounded-sm outline-none cursor-default hover:bg-hover"
            onSelect={() => onOpenFile(entry)}
          >
            {getFileIcon(entry.name, entry.path)}
            <span className="truncate">{entry.name}</span>
          </DropdownMenu.Item>
        ),
      )}
    </>
  );
};

// Clickable breadcrumb segment — opens a dropdown browsing that folder's contents.
const BreadcrumbSegment = ({
  label,
  folderPath,
  onOpenFile,
}: {
  label: string;
  folderPath: string;
  onOpenFile: (entry: FileTree) => void;
}) => (
  <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button className="truncate rounded-sm px-0.5 text-comment hover:bg-hover hover:text-text outline-none">
        {label}
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="start"
        sideOffset={4}
        className="z-[9999] min-w-[180px] max-h-72 overflow-y-auto bg-editor border border-border rounded-md shadow-lg p-1"
      >
        <BreadcrumbFolderEntries folderPath={folderPath} onOpenFile={onOpenFile} />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

// "Run All" button — only visible when document has multiple request sections
const RunAllButton = () => {
  const editor = useVoidenEditorStore((state) => state.editor);
  // @ts-ignore
  const { runAll, isFetching, cancelRequest } = useSendRequest(editor);

  if (!editor) return null;

  // Check if document has multiple sections
  let hasMultipleSections = false;
  editor.state.doc.forEach((child: any) => {
    if (child.type.name === "request-separator") hasMultipleSections = true;
  });

  if (!hasMultipleSections) return null;

  return (
    <button
      onClick={() => isFetching ? cancelRequest() : runAll()}
      className="flex items-center gap-1 px-2 py-1 rounded hover:bg-active transition-colors text-xs"
      title="Run all requests (⌘⇧↵)"
      style={{ color: 'var(--icon-success)' }}
    >
      <PlayCircle size={14} />
      <span className="font-medium">Run All</span>
    </button>
  );
};

// Action menu component for .void files
const ActionMenu = ({ actionsToDisplay, tab, voidenEditorRef }: { actionsToDisplay: any[]; tab: any; voidenEditorRef?: React.MutableRefObject<any> }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);
  if (actionsToDisplay.length === 0) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 hover:bg-active rounded transition-colors"
        title="Actions"
      >
        <Menu className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-panel border border-border shadow-lg z-50 overflow-hidden">
          {actionsToDisplay.map((action) => {
            const ActionComponent = action.component;
            if (!ActionComponent || typeof ActionComponent !== 'function') {
              return null;
            }
            return (
              <div
                key={action.id}
                className="px-2 py-1 hover:bg-active text-text cursor-pointer flex items-center gap-2 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <ActionComponent tab={tab} voidenEditorRef={voidenEditorRef} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const EmptyPanel = () => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: mainTabs } = useGetPanelTabs("main");
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>(0);

  // Measure available height
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setAvailableHeight(containerRef.current.clientHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const handleOpenSettings = () => {
    const existing = mainTabs?.tabs?.find((t: any) => t.type === "settings");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
      return;
    }

    addPanelTab({
      panelId: "main",
      tab: { id: crypto.randomUUID(), type: "settings", title: "Settings", source: null },
    });
  };

  const shortcuts = [
    {
      title: "New Voiden file",
      shortcut: "⌘N",
      priority: 1,
    },
    {
      title: "Open folder",
      shortcut: "⌘O",
      priority: 1,
    },
    {
      title: "Quick open file",
      shortcut: "⌘P",
      priority: 1,
    },
    {
      title: "Open recent",
      shortcut: "⌥⌘O",
      priority: 2,
    },
    {
      title: "Command palette",
      shortcut: "⌘⇧P",
      priority: 2,
    },
    {
      title: "Toggle File Explorer",
      shortcut: "⌘⇧E",
      priority: 3,
    },
    {
      title: "Toggle Terminal",
      shortcut: "⌘J",
      priority: 3,
    },
    {
      title: "Open Search",
      shortcut: "⇧⌘F",
      priority: 3,
    },
  ];

  // Determine what to show based on height
  // Logo alone needs ~180px
  // Logo + priority 1 (3 items) needs ~350px
  // Logo + priority 1-2 (5 items) needs ~450px
  // Logo + all shortcuts (8 items) needs ~550px
  // Everything needs ~750px
  const showPriority1 = availableHeight >= 350;
  const showPriority2 = availableHeight >= 450;
  const showPriority3 = availableHeight >= 550;
  const showCustomization = availableHeight >= 750;

  return (
    <div ref={containerRef} className="flex items-center justify-center h-full w-full text-comment overflow-auto">
      <div className="w-full flex flex-col items-center max-w-md p-4 sm:p-6">
        {/* Logo - Always visible */}
        <div className="mb-4 sm:mb-8 text-center">
          <h1 className="text-2xl font-light mb-2 w-full flex items-center justify-center">
            <img src={logo} className="w-32 sm:w-40 h-fit" alt="Voiden Logo" />
          </h1>
        </div>

        {/* Shortcuts - Progressive rendering based on height */}
        {showPriority1 && (
          <div className="space-y-1.5 w-80">
            {/* Priority 1 shortcuts */}
            {shortcuts
              .filter((item) => item.priority === 1)
              .map((item, index) => (
                <div key={index} className="w-full flex items-center justify-between">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm sm:text-base">{item.title}</span>
                    <Kbd keys={item.shortcut} size="md" />
                  </div>
                </div>
              ))}

            {/* Priority 2 shortcuts */}
            {showPriority2 && shortcuts
              .filter((item) => item.priority === 2)
              .map((item, index) => (
                <div key={index} className="w-full flex items-center justify-between">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm sm:text-base">{item.title}</span>
                    <Kbd keys={item.shortcut} size="md" />
                  </div>
                </div>
              ))}

            {/* Priority 3 shortcuts */}
            {showPriority3 && shortcuts
              .filter((item) => item.priority === 3)
              .map((item, index) => (
                <div key={index} className="w-full flex items-center justify-between">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm sm:text-base">{item.title}</span>
                    <Kbd keys={item.shortcut} size="md" />
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Customization Section */}
        {/* {showCustomization && (
          <div className="mt-4 sm:mt-6 border border-border rounded-lg p-3 sm:p-4 bg-bg/30">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                  <h3 className="font-semibold text-sm m-0">Customize Your Experience</h3>
                </div>
                <p className="text-comment text-xs mb-3">
                  Adjust font size, choose your preferred theme, and personalize your workspace.
                  <button
                    onClick={handleOpenSettings}
                    className="text-accent hover:underline ml-1 font-medium"
                  >
                    Open Settings
                  </button>
                </p>
                <div className="space-y-1 text-xs text-comment">
                  <div className="flex items-start gap-2">
                    <span className="text-accent text-xs">•</span>
                    <span><span className="font-medium">Font Size:</span> Increase or decrease base font size (14-16px)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-accent text-xs">•</span>
                    <span><span className="font-medium">Font Family:</span> Inconsolata, JetBrains Mono, Fira Code, Geist Mono</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-accent text-xs">•</span>
                    <span><span className="font-medium">Theme:</span> Switch between different color schemes</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )} */}
      </div>
    </div>
  );
};

const PanelContentInner = ({ panelId }: { panelId: string }) => {
  const MAX_CACHED_DOCUMENT_EDITORS = 8;
  const { data: tabContent, error: tabContentError } = useGetTabContent(panelId);
  const panel = usePluginStore((state) => state.panels[panelId]);
  const { data: tabs } = useGetPanelTabs(panelId);
  const { mutate: closePanelTab } = useClosePanelTab();
  const editorActions = usePluginStore((state) => state.editorActions);
  const { settings } = useSettings();
  // `activeEditor` is a single global "last-typed-in editor" slot shared by the
  // whole app — subscribing to it unnarrowed means every keystroke in ANY tab,
  // in ANY panel, re-renders this panel too, even when its own tab is untouched
  // (this is what made an unrelated tab's typing lag a panel showing a huge
  // file). Only this panel's own active tab ever reads `activeEditor` below
  // (always gated behind a `tabId` match), so bail out to a stable empty value
  // whenever the update isn't for this panel's active tab.
  const activeEditor = useCodeEditorStore(
    useCallback(
      (state) => (state.activeEditor.tabId === tabs?.activeTabId ? state.activeEditor : EMPTY_ACTIVE_EDITOR),
      [tabs?.activeTabId],
    ),
  );
  const streamSnapshots = useCodeEditorStore((state) => state.streamSnapshots);
  const isSearchOpen = useSearchStore((s) => s.isOpen);
  const { data: appState } = useGetAppState();
  const { mutate: activateTab } = useActivateTab();

  // Markdown split view: keep the raw-source pane and the rendered-preview pane
  // scrolled to the same relative position in either direction.
  const mdEditorPaneRef = useRef<HTMLDivElement>(null);
  const mdPreviewPaneRef = useRef<HTMLDivElement>(null);

  // Markdown split view: keep the raw-source pane and the rendered-preview pane
  // scrolled to the same relative position in either direction.
  const mdEditorPaneRef = useRef<HTMLDivElement>(null);
  const mdPreviewPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabContentError) return;
    const err = tabContentError as Error;
    if (err.message !== "TAB_LOAD_TIMEOUT") return;
    const activeTabId = tabs?.activeTabId;
    if (!activeTabId) return;
    closePanelTab({ panelId, tabId: activeTabId });
    toast.warning("File too large to render", {
      description: "Removed the tab for better performance.",
    });
  }, [tabContentError, tabs?.activeTabId, panelId, closePanelTab]);

  useEffect(() => {
    if (!tabContentError) return;
    const err = tabContentError as Error;
    if (err.message !== "TAB_LOAD_TIMEOUT") return;
    const activeTabId = tabs?.activeTabId;
    if (!activeTabId) return;
    closePanelTab({ panelId, tabId: activeTabId });
    toast.warning("File too large to render", {
      description: "Removed the tab for better performance.",
    });
  }, [tabContentError, tabs?.activeTabId, panelId, closePanelTab]);


  const activeTabId = tabContent?.tabId;
  useEditorStore((state) => activeTabId ? state.unsaved[activeTabId] : undefined);


  useLayoutEffect(() => {
    if (!activeTabId) return;
    const scrollContainer = document.getElementById("code-editor-container");
    if (!scrollContainer) return;
    const savedScroll = useEditorStore.getState().getScrollPosition(activeTabId);
    if (savedScroll > 0) {
      scrollContainer.style.scrollBehavior = "auto";
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      scrollContainer.scrollTop = Math.min(savedScroll, maxScrollTop);
    }
  }, [activeTabId]);

  const [cachedDocumentTabs, setCachedDocumentTabs] = useState<Record<string, any>>({});
  const cachedDocumentOrderRef = useRef<string[]>([]);

  useEffect(() => {
    if (tabContent?.type !== "document" || !tabContent?.tabId) return;
    setCachedDocumentTabs((prev) => {
      let next = prev;
      const previous = prev[tabContent.tabId];
      if (
        !previous ||
        previous.title !== tabContent.title ||
        previous.source !== tabContent.source ||
        previous.content !== tabContent.content
      ) {
        next = { ...prev, [tabContent.tabId]: tabContent };
      }

      let nextOrder = [...cachedDocumentOrderRef.current.filter((id) => id !== tabContent.tabId), tabContent.tabId];
      if (nextOrder.length > MAX_CACHED_DOCUMENT_EDITORS) {
        const evicted = nextOrder.slice(0, nextOrder.length - MAX_CACHED_DOCUMENT_EDITORS);
        nextOrder = nextOrder.slice(nextOrder.length - MAX_CACHED_DOCUMENT_EDITORS);
        if (evicted.length > 0) {
          next = { ...next };
          evicted.forEach((id) => {
            delete next[id];
          });
        }
      }
      cachedDocumentOrderRef.current = nextOrder;
      return next;
    });
  }, [tabContent, MAX_CACHED_DOCUMENT_EDITORS]);

  useEffect(() => {
    const openTabIds = new Set((tabs?.tabs || []).map((tab: any) => tab.id));
    cachedDocumentOrderRef.current = cachedDocumentOrderRef.current.filter((tabId) => openTabIds.has(tabId));
    setCachedDocumentTabs((prev) => {
      const next: Record<string, any> = {};
      let changed = false;
      Object.keys(prev).forEach((tabId) => {
        if (openTabIds.has(tabId)) {
          next[tabId] = prev[tabId];
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tabs?.tabs]);


  const mdPreviewHelpers = getMdPreviewHelpers();

  let viewMode = "edit";

  if (mdPreviewHelpers?.useMdViewStore) {
    try {
      viewMode = mdPreviewHelpers.useMdViewStore((state: any) => state?.viewMode) || "edit";
    } catch (error) {
      console.warn('[PanelContent] md-preview hook unavailable, defaulting to edit mode');
    }
  }

  // Resolves the live (possibly-unsaved) content for a specific tab, rather than
  // trusting the module-level `tabContent`/`activeEditor` — both can still refer
  // to a previously active tab for a moment after switching (see
  // `activeDocTabContent` below), which would otherwise leak stale content into
  // the markdown preview under the correct tab's title.
  const getLiveContent = (forTab: { tabId: string; content?: string } | null) => {
    if (!forTab) return "";
    if (forTab.tabId === activeEditor.tabId && activeEditor.content) {
      return activeEditor.content;
    }
    return forTab.content || "";
  };

  const isMarkdownSplitActive = !!(tabContent?.title?.endsWith(".md") && viewMode === "split" && mdPreviewHelpers?.Preview);
  useEffect(() => {
    if (!isMarkdownSplitActive || !tabContent?.tabId) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    // CodeMirror attaches .cm-scroller (and registers its EditorView) in its own
    // mount effect, which can land a tick after split mode first renders — retry
    // briefly instead of giving up.
    const tryAttach = (attempt: number) => {
      if (cancelled) return;
      // Scope to this tab's wrapper — the editor pane can have several cached tabs
      // mounted (just hidden) at once, so an unscoped query could grab the wrong one.
      const editorScroller = mdEditorPaneRef.current
        ?.querySelector(`[data-tab-id="${tabContent.tabId}"] .cm-scroller`) as HTMLElement | null;
      const previewScroller = mdPreviewPaneRef.current?.querySelector(".overflow-y-auto") as HTMLElement | null;
      const view = useCodeEditorStore.getState().editorViews.get(tabContent.tabId);

      if (!editorScroller || !previewScroller || !view) {
        if (attempt < 10) setTimeout(() => tryAttach(attempt + 1), 100);
        return;
      }

      let syncing = false;
      // Release on the NEXT animation frame, not via setTimeout(0). Setting
      // scrollTop here triggers a native 'scroll' event on the other pane that
      // this flag is meant to swallow (so editor->preview sync doesn't bounce
      // back into preview->editor sync and fight itself) — but that induced
      // event is dispatched as part of this same frame's rendering update,
      // while setTimeout(0) can fire and clear `syncing` before the browser
      // gets around to dispatching it. When that race lost, the echo handler
      // ran unguarded, read the just-adjusted scroll position, and snapped the
      // origin pane to a slightly different (often earlier) line — visible as
      // scrolling down and immediately jumping back up.
      const release = () => requestAnimationFrame(() => { syncing = false; });

      // querySelectorAll("[data-line]") scans every rendered preview block, which
      // gets expensive on huge docs. Coalesce bursts of native scroll events (fired
      // many times per frame during momentum scroll) down to one scan per animation
      // frame instead of running the full lookup on every single event.
      let editorRafId: number | null = null;
      let previewRafId: number | null = null;

      // Editor -> preview: find the source line currently at the top of the
      // editor's viewport, then scroll the matching rendered element to the top
      // of the preview. Matches by content (line), not raw scroll percentage,
      // since rendered block heights (headings, code blocks, images) don't track
      // source line heights 1:1.
      const onEditorScroll = () => {
        if (syncing || editorRafId !== null) return;
        editorRafId = requestAnimationFrame(() => {
          editorRafId = null;
          syncing = true;
          const block = view.lineBlockAtHeight(Math.max(0, editorScroller.scrollTop));
          const line = view.state.doc.lineAt(block.from).number;
          const target = findPreviewElementForLine(previewScroller, line);
          if (target) {
            const rect = target.getBoundingClientRect();
            const scrollerRect = previewScroller.getBoundingClientRect();
            previewScroller.scrollTop += rect.top - scrollerRect.top;
          }
          release();
        });
      };

      // Preview -> editor: find which rendered element sits at the top of the
      // preview's viewport, read its source line, and scroll the editor to that
      // line's actual height in the document.
      const onPreviewScroll = () => {
        if (syncing || previewRafId !== null) return;
        previewRafId = requestAnimationFrame(() => {
          previewRafId = null;
          syncing = true;
          const line = findTopVisibleLine(previewScroller);
          if (line !== null) {
            const docLine = Math.min(Math.max(line, 1), view.state.doc.lines);
            const pos = view.state.doc.line(docLine).from;
            editorScroller.scrollTop = view.lineBlockAt(pos).top;
          }
          release();
        });
      };

      editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
      previewScroller.addEventListener("scroll", onPreviewScroll, { passive: true });
      cleanup = () => {
        if (editorRafId !== null) cancelAnimationFrame(editorRafId);
        if (previewRafId !== null) cancelAnimationFrame(previewRafId);
        editorScroller.removeEventListener("scroll", onEditorScroll);
        previewScroller.removeEventListener("scroll", onPreviewScroll);
      };
    };
    tryAttach(0);

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [isMarkdownSplitActive, tabContent?.tabId]);

  if (panelId === "main" && !tabContent && !tabs?.activeTabId && tabs?.tabs?.length === 0) {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    })
    return <EmptyPanel />;
  }
  if (!tabContent) return null;

  const panelActiveTabId = tabs?.activeTabId;

  const isDocumentActive = tabContent.type === "document";
  const rawActiveDocTabContent = isDocumentActive ? tabContent : null;
  const visibleDocumentTabs = rawActiveDocTabContent
    ? { ...cachedDocumentTabs, [rawActiveDocTabContent.tabId]: rawActiveDocTabContent }
    : { ...cachedDocumentTabs };
  const visibleDocumentTabIds = [...cachedDocumentOrderRef.current.filter((id) => visibleDocumentTabs[id])];
  if (rawActiveDocTabContent && !visibleDocumentTabIds.includes(rawActiveDocTabContent.tabId)) {
    visibleDocumentTabIds.push(rawActiveDocTabContent.tabId);
  }

  // tabContent can still hold the previous tab's data for a moment after switching
  // tabs — React Query's placeholderData keeps the old cache entry alive while the
  // new tab's content loads (see useGetTabContent). Resolve against the tab that's
  // actually active in the panel so toolbar actions and the markdown preview never
  // render another tab's content mid-transition.
  const activeDocTabContent = isDocumentActive ? (visibleDocumentTabs[panelActiveTabId] ?? null) : null;

  const liveContentForPredicate = (() => {
    if (!activeDocTabContent) return null;
    const { tabId, title } = activeDocTabContent;
    if (title.endsWith(".void") || activeDocTabContent.source?.endsWith(".void")) {
      return useEditorStore.getState().unsaved[tabId] ?? activeDocTabContent.content;
    }
    if (activeEditor.tabId === tabId && activeEditor.content) {
      return activeEditor.content || activeDocTabContent.content;
    }
    return streamSnapshots.get(tabId) ?? activeDocTabContent.content;
  })();

  const tabDataForPredicate = activeDocTabContent
    ? { ...activeDocTabContent, content: liveContentForPredicate }
    : null;
  const actionsToDisplay = tabDataForPredicate
    ? editorActions.filter((action) => !action.predicate || action.predicate(tabDataForPredicate))
    : [];

  // Active file's path relative to the open project root, VS Code
  // breadcrumb-style — null when there's no project root open, no source
  // path, or the file lives outside the root (nothing sensible to show).
  const breadcrumb = (() => {
    const projectRoot = appState?.activeDirectory;
    const source = activeDocTabContent?.source;
    if (!projectRoot || !source) return null;
    const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const root = normalize(projectRoot);
    const normalizedSource = normalize(source);
    if (!normalizedSource.startsWith(root + "/")) return null;
    const projectName = root.split("/").filter(Boolean).pop() ?? root;
    const segments = normalizedSource.slice(root.length + 1).split("/").filter(Boolean);
    return { projectName, segments, root };
  })();

  const openBreadcrumbEntry = async (entry: FileTree) => {
    if (entry.type !== "file") return;

    const pendingTabsEnabled = settings?.editor?.pending_tabs ?? false;
    if (pendingTabsEnabled) {
      const existingPendingTab = tabs?.tabs?.find((t: any) => t.pending);
      if (existingPendingTab && existingPendingTab.source !== entry.path) {
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
      title: entry.name,
      source: entry.path,
      directory: null,
      pending: pendingTabsEnabled ? true : undefined,
    };
    try {
      const { tabId = null } = (await window.electron?.state.addPanelTab(panelId, newTab)) ?? {};
      if (tabId) {
        activateTab({ panelId, tabId });
      }
    } catch {
      // ignore
    }
  };

  const isShFile = !!(activeDocTabContent?.title.endsWith(".sh") && activeDocTabContent.source);
  const isVoidFile = !!(activeDocTabContent?.title.endsWith(".void") || activeDocTabContent?.source?.endsWith(".void"));
  const hasActions = isShFile || isVoidFile || actionsToDisplay.length > 0;
  const showToolbar = hasActions || isSearchOpen;

  const cachedEditorsBlock = visibleDocumentTabIds.length > 0 && (
    <div className="h-full flex flex-col" style={{ display: isDocumentActive ? "flex" : "none" }}>
      {breadcrumb && (
        <div className="flex-shrink-0 flex items-center justify-start gap-1 px-2 py-1 border-b border-border text-comment text-xs min-w-0 overflow-hidden">
          <Folder size={12} className="flex-shrink-0 opacity-70" />
          <BreadcrumbSegment label={breadcrumb.projectName} folderPath={breadcrumb.root} onOpenFile={openBreadcrumbEntry} />
          {breadcrumb.segments.map((segment, i) => {
            const isLastSegment = i === breadcrumb.segments.length - 1;
            const segmentPath = [breadcrumb.root, ...breadcrumb.segments.slice(0, i + 1)].join("/");
            return (
              <span key={i} className="flex items-center gap-1 min-w-0 last:text-text">
                <ChevronRight size={10} className="flex-shrink-0 opacity-50" />
                {isLastSegment ? (
                  <span className="truncate">{segment}</span>
                ) : (
                  <BreadcrumbSegment label={segment} folderPath={segmentPath} onOpenFile={openBreadcrumbEntry} />
                )}
              </span>
            );
          })}
        </div>
      )}
      {showToolbar && <div className="flex-shrink-0 flex flex-col w-full z-10 relative">
        {hasActions && <div className="flex items-center justify-end gap-2 px-2 py-0.5 min-h-7">
          {isShFile && (
            <RunScriptButton source={activeDocTabContent!.source} />
          )}
          {isVoidFile ? (
            <>
              <RunAllButton />
              <ActionMenu actionsToDisplay={actionsToDisplay} tab={activeDocTabContent} />
            </>
          ) : (
            actionsToDisplay.map((action) => {
              const ActionComponent = action.component;
              if (!ActionComponent || typeof ActionComponent !== 'function') {
                console.warn(`[PanelContent] Invalid editor action component for action: ${action.id}`);
                return null;
              }
              return <ActionComponent key={action.id} tab={activeDocTabContent} />;
            })
          )}
        </div>}
        {isSearchOpen && (
          <div className="pb-1"><PersistentSearchPanel /></div>
        )}
      </div>}
      <div className="flex-1 bg-editor relative" id="code-editor-container" data-editor-scroll-container="true">
        {(() => {
          const editorBlock = visibleDocumentTabIds.map((docTabId: string) => {
            const docTab = visibleDocumentTabs[docTabId];
            const isTabActive = docTab.tabId === panelActiveTabId;
            return (
              <div
                key={docTab.tabId}
                data-tab-id={docTab.tabId}
                // Use visibility:hidden instead of display:none for inactive tabs.
                // This keeps DOM nodes in the layout tree so switching back avoids
                // a full layout recalculation for large files (10k+ nodes).
                style={
                  isTabActive
                    ? { width: '100%', height: '100%' }
                    : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden' }
                }
                onContextMenu={(e) => {
                  if (docTab.tabId !== activeDocTabContent?.tabId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (window.electron?.editor?.showContextMenu) {
                    window.electron.editor.showContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      selectedText: window.getSelection()?.toString(),
                    });
                  }
                }}
              >
                {(docTab.title.endsWith(".void") || docTab.source?.endsWith(".void")) ? (
                  <VoidenEditor
                    tabId={docTab.tabId}
                    content={docTab.content ?? ""}
                    source={docTab.source}
                    panelId={panelId}
                    hasSearch
                    isActive={docTab.tabId === panelActiveTabId}
                  />
                ) : isBinaryFile(docTab.source || docTab.title) ? (
                  <UnsupportedFile title={docTab.title} />
                ) : (
                  <CodeEditor
                    tabId={docTab.tabId}
                    content={docTab.content ?? ""}
                    source={docTab.source}
                    panelId={panelId}
                    isActive={docTab.tabId === panelActiveTabId}
                    streamable={docTab.streamable}
                    fullSize={docTab.fullSize}
                  />
                )}
              </div>
            );
          });

          const isMarkdownTab = activeDocTabContent?.title.endsWith(".md") && !!mdPreviewHelpers?.Preview;
          const previewBlock = isMarkdownTab ? (() => {
            const PreviewComponent = mdPreviewHelpers.Preview;
            return <PreviewComponent tab={{ ...activeDocTabContent, content: getLiveContent(activeDocTabContent) }} />;
          })() : null;

          if (isMarkdownTab && viewMode === "split") {
            return (
              <ResizablePanelGroup direction="horizontal" className="h-full w-full">
                <ResizablePanel defaultSize={50} minSize={20} className="h-full overflow-hidden">
                  <div ref={mdEditorPaneRef} className="h-full w-full px-2 py-2">{editorBlock}</div>
                </ResizablePanel>
                <ResizableHandle className="bg-panel hover:bg-panel" />
                <ResizablePanel defaultSize={50} minSize={20} className="h-full overflow-hidden">
                  <div ref={mdPreviewPaneRef} className="h-full w-full px-4 py-2">{previewBlock}</div>
                </ResizablePanel>
              </ResizablePanelGroup>
            );
          }

          if (isMarkdownTab && viewMode === "preview") {
            return (
              <div className="h-full w-full relative">
                <div className="h-full w-full px-4 py-2 overflow-hidden">{previewBlock}</div>
                {/* Editor stays mounted (just hidden) so CodeMirror keeps its
                    undo history/cursor/scroll position when switching back to
                    "Markdown" or "Both" — unmounting would lose that state. */}
                <div className="absolute inset-0" style={{ visibility: "hidden", pointerEvents: "none" }}>
                  {editorBlock}
                </div>
              </div>
            );
          }

          return editorBlock;
        })()}
      </div>
    </div>
  );


  if (tabContent.tabId !== panelActiveTabId && tabContent.type !== "terminal" && tabContent.type !== "document") {
    return <>{cachedEditorsBlock}</>;
  }

  if (tabContent.type === "welcome") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    })
    return <>{cachedEditorsBlock}<WelcomeScreen /></>;
  }

  if (tabContent.type === "settings") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate(tabContent);
      }
    })
    return <>{cachedEditorsBlock}<SettingsScreen /></>;
  }

  if (tabContent.type === "changelog") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    })
    return <>{cachedEditorsBlock}<ChangeLogScreen /></>;
  }

  if (tabContent.type === "logs") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    })
    if (!settings?.developer?.system_log) return <>{cachedEditorsBlock}</>;
    return <>{cachedEditorsBlock}<LogsPanel /></>;
  }

  if (tabContent.type === "document") {
    if (tabContent.content === null && !tabContent.streamable) {
      if (isBinaryFile(tabContent.source || tabContent.title)) {
        return <UnsupportedFile title={tabContent.title} />;
      }
      return <div>This file is not available</div>;
    }
    return <>{cachedEditorsBlock}</>;
  }

  if (tabContent.type === "terminal") {
    // Get all terminal tabs for this panel.
    if (!panel) return null;
    const terminalTabs = tabs?.tabs?.filter((tab: any) => tab.type === "terminal") || [];

    // Map each terminal tab to the shape expected by TerminalManager.
    const terminals = terminalTabs.map((tab: any) => ({
      tabId: tab.id,
      cwd: tab.source,
    }));
    return <TerminalManager terminalTabs={terminals} activeTabId={tabContent.tabId} />;
  }

  if (tabContent.type === "settings") {
    return <SettingsContent />;
  }

  if (tabContent.type === "environmentEditor") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    });
    return <EnvironmentEditor tabId={tabContent.tabId} />;
  }

  if (tabContent.type === "extensionDetails") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    })
    return <ExtensionDetails extensionData={tabContent.extensionData} content={tabContent.content} />;
  }

  if (tabContent.type === "diff") {
    return <DiffViewer tab={tabContent} />;
  }

  if (tabContent.type === "conflict") {
    return <ConflictEditorTab tab={tabContent} />;
  }

  if (tabContent.type === "custom") {
    editorActions.forEach((action) => {
      if (action && action.predicate) {
        action.predicate({ title: '' });
      }
    });
    const tab = panel?.find((tab) => tab.id === tabContent.customTabKey);
    const Component = tab?.content || tab?.component;

    // Validate component before rendering
    if (!Component || typeof Component !== 'function') {
      console.warn(`[PanelContent] Invalid custom panel component for tab: ${tabContent.customTabKey}`);
      return <div className="h-full flex items-center justify-center text-comment">Panel component not available</div>;
    }

    return <div className="h-full"><Component /></div>;
  }

  return <div>Unsupported content</div>;
};

export const PanelContent = ({ panelId }: { panelId: string }) => {
  // Force remount when plugin state changes to prevent stale hook references
  const isInitialized = usePluginStore((state) => state.isInitialized);
  const hasEverInitialized = usePluginStore((state) => state.hasEverInitialized);
  const { data: tabs, dataUpdatedAt } = useGetPanelTabs(panelId);

  // Track re-clicks on the already-active tab so we can reset the ErrorBoundary.
  // When useActivateTab fires for the same tab, panel:tabs refetches (dataUpdatedAt
  // changes) while activeTabId stays the same — increment resetCounter to force reset.
  const [resetCounter, setResetCounter] = useState(0);
  const prevDataUpdatedAtRef = useRef(0);
  const prevActiveTabIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (
      dataUpdatedAt > prevDataUpdatedAtRef.current &&
      prevActiveTabIdRef.current === tabs?.activeTabId &&
      tabs?.activeTabId !== undefined
    ) {
      setResetCounter((c) => c + 1);
    }
    prevDataUpdatedAtRef.current = dataUpdatedAt;
    prevActiveTabIdRef.current = tabs?.activeTabId;
  }, [dataUpdatedAt, tabs?.activeTabId]);

  // First boot: return null until plugins are ready (PluginProvider shows PluginLoadingScreen).
  // Hot-reload: return a blank hold state — editor has already unmounted cleanly, and the
  // reload completes in <300ms. This avoids the jarring full-panel blank seen previously.
  if (!isInitialized) {
    if (!hasEverInitialized) return null;
    return <div className="flex-1 bg-panel" />;
  }

  return (
    <ErrorBoundary level="component" resetKey={`${tabs?.activeTabId}-${resetCounter}`} key={`panel-${panelId}-${isInitialized}`}>
      <PanelContentInner panelId={panelId} />
    </ErrorBoundary>
  );
};
