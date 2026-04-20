import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useGetPanelTabs, useGetTabContent, useAddPanelTab, useActivateTab, useClosePanelTab } from "@/core/layout/hooks";
import { toast } from "@/core/components/ui/sonner";
import { CodeEditor } from "@/core/editors/code/CodeEditor";
import { ExtensionDetails } from "@/core/extensions/components/ExtensionDetails";
import { VoidenEditor } from "@/core/editors/voiden/VoidenEditor";
import { SettingsContent } from "@/core/settings/components/SettingsContent";
import { usePluginStore } from "@/plugins";
import { TerminalManager } from "@/core/terminal/components/TerminalManager";
import WelcomeScreen from "@/core/screens/WelcomeScreen";
import SettingsScreen from "@/core/screens/SettingsScreen";
import logo from "@/assets/logo-dark.png";
import ChangeLogScreen from "@/core/screens/ChangeLogScreen";
import { LogsPanel } from "@/core/request-engine/components/LogsPanel";
import { useCodeEditorStore } from "@/core/editors/code/CodeEditorStore";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { Settings, Menu, Play, PlayCircle } from "lucide-react";
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
      <div className="w-full max-w-md p-4 sm:p-6">
        {/* Logo - Always visible */}
        <div className="mb-4 sm:mb-8 text-center">
          <h1 className="text-2xl font-light mb-2 w-full flex items-center justify-center">
            <img src={logo} className="w-32 sm:w-40 h-fit" alt="Voiden Logo" />
          </h1>
        </div>

        {/* Shortcuts - Progressive rendering based on height */}
        {showPriority1 && (
          <div className="space-y-2 sm:space-y-3">
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
        {showCustomization && (
          <div className="mt-4 sm:mt-6 border border-border rounded-lg p-3 sm:p-4 bg-bg/30">
            <div className="flex items-start gap-3">
              <Settings className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-sm mb-2">Customize Your Experience</h3>
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
        )}
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
  const activeEditor = useCodeEditorStore((state) => state.activeEditor);
  const streamSnapshots = useCodeEditorStore((state) => state.streamSnapshots);

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

  const getLiveContent = () => {
    if (tabContent?.tabId === activeEditor.tabId && activeEditor.content) {
      return activeEditor.content;
    }
    return tabContent?.content || "";
  };

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
  const activeDocTabContent = isDocumentActive ? tabContent : null;
  const visibleDocumentTabs = activeDocTabContent
    ? { ...cachedDocumentTabs, [activeDocTabContent.tabId]: activeDocTabContent }
    : { ...cachedDocumentTabs };
  const visibleDocumentTabIds = [...cachedDocumentOrderRef.current.filter((id) => visibleDocumentTabs[id])];
  if (activeDocTabContent && !visibleDocumentTabIds.includes(activeDocTabContent.tabId)) {
    visibleDocumentTabIds.push(activeDocTabContent.tabId);
  }
 
  const liveContentForPredicate = (() => {
    if (!activeDocTabContent) return null;
    const { tabId, title } = activeDocTabContent;
    if (title.endsWith(".void")) {
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

  const cachedEditorsBlock = visibleDocumentTabIds.length > 0 && (
    <div className="h-full flex flex-col" style={{ display: isDocumentActive ? "flex" : "none" }}>
      <div className="h-8 px-5 flex items-center justify-between w-full flex-shrink-0">
        <div className="flex items-center justify-between space-x-2 w-full">
          <div className="flex-1">{/* todo things go here */}</div>
          <div className="flex space-x-2">
            {activeDocTabContent?.title.endsWith(".sh") && activeDocTabContent.source && (
              <RunScriptButton source={activeDocTabContent.source} />
            )}
            {activeDocTabContent?.title.endsWith(".void") ? (
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
          </div>
        </div>
      </div>
      <div className="flex-1 bg-editor relative" id="code-editor-container" data-editor-scroll-container="true">
        {activeDocTabContent?.title.endsWith(".md") && viewMode === "preview" && mdPreviewHelpers?.Preview ? (
          (() => {
            const PreviewComponent = mdPreviewHelpers.Preview;
            return <PreviewComponent tab={{ ...activeDocTabContent, content: getLiveContent() }} />;
          })()
        ) : (
          visibleDocumentTabIds.map((docTabId: string) => {
            const docTab = visibleDocumentTabs[docTabId];
            const isTabActive = docTab.tabId === panelActiveTabId;
            return (
              <div
                key={docTab.tabId}
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
                {docTab.title.endsWith(".void") ? (
                  <VoidenEditor
                    tabId={docTab.tabId}
                    content={docTab.content}
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
          })
        )}
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
    return <EnvironmentEditor />;
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

  // Don't render content while plugins are reloading to prevent accessing stale references
  if (!isInitialized) {
    return (
      <div className="h-full w-full flex items-center justify-center text-comment">
        <div className="text-sm">Loading plugins...</div>
      </div>
    );
  }

  return (
    <ErrorBoundary level="component" resetKey={`${tabs?.activeTabId}-${resetCounter}`} key={`panel-${panelId}-${isInitialized}`}>
      <PanelContentInner panelId={panelId} />
    </ErrorBoundary>
  );
};
