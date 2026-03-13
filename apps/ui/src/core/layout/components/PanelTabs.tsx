import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Infinity,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Braces,
  Container,
  GitBranch,
  ArrowBigDown,
  Info,
  File,
  Settings2,
  FileCode,
  Settings,
  ScrollText,
  BookOpen,
  Server,
  Blocks,
  Terminal,
} from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useActivateTab, useGetPanelTabs, useClosePanelTab, useDuplicatePanelTab, useReloadPanelTab, useSetTabsOrder, useClosePanelTabs } from "@/core/layout/hooks";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { getSchema } from "@tiptap/core";
import { voidenExtensions } from "@/core/editors/voiden/extensions";
import { prosemirrorToMarkdown } from "@/core/file-system/hooks";
import { useEditorEnhancementStore } from "@/plugins";
import { usePanelStore } from "@/core/stores/panelStore";
import { getQueryClient } from "@/main";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { useSettings } from "@/core/settings/hooks/useSettings";

const PANEL_STATES_KEY = "panelStates";

interface PanelState {
  tabId: string;
  rightPanelOpen: boolean;
  activeSidebarTabId?: string;
}

export const savePanelStateForTab = (tabId: string) => {
  const { rightPanelOpen } = usePanelStore.getState();
  // Capture which right sidebar tab is currently active
  let activeSidebarTabId: string | undefined;
  try {
    const rightData = getQueryClient().getQueryData<{ tabs?: any[]; activeTabId?: string }>(['sidebar:tabs', 'right']);
    activeSidebarTabId = rightData?.activeTabId ?? undefined;
  } catch { /* best-effort */ }
  const newState: PanelState = { tabId, rightPanelOpen, activeSidebarTabId };

  const storedString = localStorage.getItem(PANEL_STATES_KEY);
  const panelStates: PanelState[] = storedString ? JSON.parse(storedString) : [];
  const index = panelStates.findIndex((state: PanelState) => state.tabId === tabId);
  if (index !== -1) {
    panelStates[index] = newState;
  } else {
    panelStates.push(newState);
  }
  localStorage.setItem(PANEL_STATES_KEY, JSON.stringify(panelStates));
};


interface Tab {
  id: string;
  type: string;
  title: string;
  source: string | null;
}

// Icon map for known extensions
const iconMap: Record<string, JSX.Element> = {
  pdf: <FileText size={14} />,
  csv: <FileSpreadsheet size={14} />,
  jpeg: <ImageIcon size={14} />,
  jpg: <ImageIcon size={14} />,
  png: <ImageIcon size={14} />,
  md: <ArrowBigDown size={14} />,
  json: <Braces size={14} />,
  yml: <Braces size={14} />,
  yaml: <Braces size={14} />,
  js: <FileCode size={14} />,
  py: <FileCode size={14} />,
  go: <FileCode size={14} />,
  sh: <Terminal size={14} />,
  void: <Infinity size={14} className="text-accent" />,
};

const getTabIcon = (tab: Tab): JSX.Element => {
  // Special tab types
  if (tab.type === "settings") return <Settings size={14} />;
  if (tab.type === "welcome") return <BookOpen size={14} />;
  if (tab.type === "changelog") return <ScrollText size={14} />;
  if (tab.type === "grpc") return <Server size={14} />;
  if (tab.type === "environmentEditor") return <Settings2 size={14} />;

  // For document tabs, check file name and extension
  if (tab.type === "document" && tab.source) {
    const fileName = tab.source.split('/').pop() || tab.title;
    
    // Special file name checks (similar to FileSystemList)
    if (fileName.startsWith(".env")) return <Settings2 size={14} />;
    if (fileName.startsWith(".gitignore")) return <GitBranch size={14} />;
    if (fileName.startsWith("Dockerfile")) return <Container size={14} />;
    if (fileName.startsWith("docker-compose.yml")) return <Container size={14} />;
    if (fileName.toLowerCase() === "readme.md") return <Info size={14} />;

    // Extension-based icons
    const extMatch = fileName.match(/\.([0-9a-z]+)$/i);
    const ext = extMatch?.[1]?.toLowerCase();

    return iconMap[ext || ""] || <File size={14} />;
  }
  if(tab.type==='extensionDetails'){
    return <Blocks size={14} />;
  }

  return <File size={14} />;
};

const TabComponent = ({
  tab,
  activateTab,
  closeTab,
  closeTabs,
  isActive,
  panel,
  isLastTerminalTab,
  currentActiveTabId,
  duplicateTab,
  reloadTab,
  tabs,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragLeave,
  isDragging,
  dragOverPosition,
  onDrag,
  hideUnsavedIndicator
}: {
  tab: Tab;
  activateTab: (tabId: string) => void;
  closeTab: (panelId: string, tabId: string, unsavedContent?: string) => void;
  closeTabs: (panelId: string, tabs: Array<{ tabId: string, unsavedContent?: string }>) => void;
  isActive: boolean;
  panel: string;
  isLastTerminalTab: boolean;
  currentActiveTabId: string;
  duplicateTab: (tabId: string) => void;
  reloadTab: (tabId: string) => void;
  tabs: Tab[];
  onDragStart: (e: React.DragEvent, tabId: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, tabId: string) => void;
  onDrop: (e: React.DragEvent, tabId: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  isDragging: boolean;
  dragOverPosition: 'left' | 'right' | null;
  onDrag: (e: React.DragEvent) => void;
  hideUnsavedIndicator: boolean;
}) => {
  const unsavedContent = tab.type === "document" ? useEditorStore((state) => state.unsaved[tab.id]) : undefined;
  const { bottomPanelRef, closeBottomPanel } = usePanelStore();

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    let contentToSend = unsavedContent;
    if (tab.source && tab.source.endsWith(".void") && unsavedContent) {
      const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
      contentToSend = prosemirrorToMarkdown(unsavedContent, schema);
    }
    closeTab(panel, tab.id, contentToSend);

    const storedString = localStorage.getItem(PANEL_STATES_KEY);
    if (storedString) {
      const panelStates: PanelState[] = JSON.parse(storedString);
      const newPanelStates = panelStates.filter((state: PanelState) => state.tabId !== tab.id);
      localStorage.setItem(PANEL_STATES_KEY, JSON.stringify(newPanelStates));
    }

    if (isLastTerminalTab && bottomPanelRef?.current) {
      bottomPanelRef.current.collapse();
      closeBottomPanel();
    }
  };

  const handleDuplicate = () => duplicateTab(tab.id);
  const handleReload = () => reloadTab(tab.id);
  const handleCloseOtherTabs = () => {
    const currentIndex = tabs.findIndex((t) => t.id === tab.id);
    const tabsClosed: Array<{ tabId: string; unsavedContent?: string }> = [];
    [...tabs.slice(0, currentIndex), ...tabs.slice(currentIndex + 1)].forEach((t) => {
      let contentToSend = t.type === "document" ? useEditorStore.getState().unsaved[t.id] : '';
      if (t.source && t.source.endsWith(".void") && contentToSend) {
        const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
        contentToSend = prosemirrorToMarkdown(contentToSend, schema);
      }
      tabsClosed.push({ tabId: t.id, unsavedContent: contentToSend });
    });
    closeTabs(panel, tabsClosed);
  };
  const handleCloseTabsToLeft = () => {
    const currentIndex = tabs.findIndex((t) => t.id === tab.id);
    const tabsClosed: Array<{ tabId: string; unsavedContent?: string }> = [];
    tabs.slice(0, currentIndex).forEach((t) => {
      let contentToSend = t.type === "document" ? useEditorStore.getState().unsaved[t.id] : undefined;
      if (t.source && t.source.endsWith(".void") && contentToSend) {
        const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
        contentToSend = prosemirrorToMarkdown(contentToSend, schema);
      }
      tabsClosed.push({ tabId: t.id, unsavedContent: contentToSend });
    });
    closeTabs(panel, tabsClosed);
  };
  const handleCloseTabsToRight = () => {
    const currentIndex = tabs.findIndex((t) => t.id === tab.id);
    const tabsClosed: Array<{ tabId: string; unsavedContent?: string }> = [];
    tabs.slice(currentIndex + 1).forEach((t) => {
      let contentToSend = t.type === "document" ? useEditorStore.getState().unsaved[t.id] : undefined;
      if (t.source && t.source.endsWith(".void") && contentToSend) {
        const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
        contentToSend = prosemirrorToMarkdown(contentToSend, schema);
      }
      tabsClosed.push({ tabId: t.id, unsavedContent: contentToSend });
    });
    closeTabs(panel, tabsClosed);
  };
  const handleCloseAllTabs = () => {
    const tabsClosed: Array<{ tabId: string; unsavedContent?: string }> = [];
    tabs.forEach((t) => {
      let contentToSend = t.type === "document" ? useEditorStore.getState().unsaved[t.id] : undefined;
      if (t.source && t.source.endsWith(".void") && contentToSend) {
        const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
        contentToSend = prosemirrorToMarkdown(contentToSend, schema);
      }
      tabsClosed.push({ tabId: t.id, unsavedContent: contentToSend });
    });
    closeTabs(panel, tabsClosed);
  };
  const isMac = navigator.platform ? navigator.platform.toLowerCase().includes("mac") : false;

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle click
    if (e.button === 1) {
      handleClose(e)
      return;
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-tab-id={tab.id}
          key={tab.id}
          draggable={true}
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(e, tab.id);
          }}
          onDragEnd={(e) => {
            e.stopPropagation();
            onDragEnd();
          }}
          onDrag={onDrag}
          onDragOver={(e) => {
            e.stopPropagation();
            onDragOver(e, tab.id);
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            onDragLeave(e);
          }}
          onDrop={(e) => {
            e.stopPropagation();
            onDrop(e, tab.id);
          }}
          onMouseDown={handleMouseDown}
          className={cn(
            "group flex items-center justify-between h-full px-2 border-r border-border flex-none gap-x-2 border-b text-comment relative transition-opacity select-none",
            isActive && [
              "relative border-b-0 pb-px bg-editor text-fg",
              "before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:bg-accent",
            ],
            isDragging && "opacity-40 cursor-grabbing"
          )}
          style={{
            cursor: isDragging ? 'grabbing' : 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none'
          }}
          onClick={(e) => {
            // Don't activate if we're dragging
            if (isDragging) return;

            if (currentActiveTabId && currentActiveTabId !== tab.id) {
              savePanelStateForTab(currentActiveTabId);
            }
            activateTab(tab.id);
            // Panel state (open/close) is applied by AppLayout's activeTabId effect
            // after the panel:tabs query settles, so the editor switches first.
          }}
        >
          {/* Drop indicator - left side */}
          {dragOverPosition === 'left' && (
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent z-10" />
          )}
          {/* Drop indicator - right side */}
          {dragOverPosition === 'right' && (
            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-accent z-10" />
          )}

          <div className="w-2 h-2">{!hideUnsavedIndicator && unsavedContent && <div className="w-2 h-2 rounded-full bg-accent" />}</div>
          <div className="flex items-center gap-1.5">
            {getTabIcon(tab)}
            <span className="truncate">{tab.title}</span>
          </div>
          <Tip label={<><span>Close tab</span>{isActive && <span className="ml-4">{isMac ? "⌘W" : "Ctrl+W"}</span>}</>} side="bottom">
            <button className="p-0.5 hover:bg-active rounded-sm opacity-0 group-hover:opacity-100" onClick={handleClose}>
              <X size={14} className="text-comment" strokeWidth={2.5} />
            </button>
          </Tip>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content align="end" sideOffset={5} className="bg-bg border border-border rounded-sm shadow-lg py-1 text-sm text-text">
          <ContextMenu.Item
            onSelect={handleClose}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Close Tab</span>
            <Kbd keys="⌘W" size="sm"></Kbd>
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={handleDuplicate}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Duplicate Tab</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={handleCloseAllTabs}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Close All</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={handleCloseOtherTabs}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Close Others</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={handleCloseTabsToLeft}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Close Tabs to Left</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={handleCloseTabsToRight}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Close Tabs to Right</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            onSelect={handleReload}
            className="flex items-center justify-between px-3 py-1 hover:bg-active cursor-pointer focus:outline-none"
          >
            <span>Reload Tab</span>
            <Kbd keys="⌘R" size="sm"></Kbd>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};

export const PanelTabs = ({ panel }: { panel: string }) => {
  const { settings } = useSettings();
  const { data: tabs } = useGetPanelTabs(panel);
  const { mutate: activateTab } = useActivateTab();
  const { mutate: reorderTabs } = useSetTabsOrder();
  const { mutate: closeTab } = useClosePanelTab();
  const { mutate: closeTabs } = useClosePanelTabs();
  const { mutate: duplicatePanelTab } = useDuplicatePanelTab();
  const { mutate: reloadPanelTab } = useReloadPanelTab();
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const { bottomPanelRef, closeBottomPanel } = usePanelStore();

  // Drag and drop state
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'left' | 'right' | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const hideUnsavedIndicator = !!settings?.editor?.auto_save && settings?.editor?.auto_save_delay === 0;

  // Track if the "r" key is currently pressed.
  const rPressed = useRef(false);

  // Helper to extract unsaved content (including .void conversion)
  const getUnsaved = (tab: Tab) => {
    let unsaved = tab.type === "document" ? useEditorStore.getState().unsaved[tab.id] : undefined;
    if (tab.source && tab.source.endsWith(".void") && unsaved) {
      const schema = getSchema([...voidenExtensions, ...useEditorEnhancementStore.getState().voidenExtensions]);
      unsaved = prosemirrorToMarkdown(unsaved, schema);
    }
    return unsaved;
  };
  const isMac = navigator.platform ? navigator.platform.toLowerCase().includes("mac") : false;

  const transparentImage = new Image();
  transparentImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  // Drag handlers
  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    e.stopPropagation();
    setDraggedTabId(tabId);

    // Set initial position for the preview
    setDragPreviewPosition({ x: e.clientX, y: e.clientY });

    // Create a transparent drag image (we'll use our custom overlay instead)
    e.dataTransfer.setDragImage(transparentImage, -500, -500);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTabId(null);
    setDragOverTabId(null);
    setDragOverPosition(null);
    setDragPreviewPosition(null);
  };

  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault(); // CRITICAL: allows drop
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    if (draggedTabId === tabId) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const position = e.clientX < midpoint ? 'left' : 'right';

    setDragOverTabId(tabId);
    setDragOverPosition(position);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverTabId(null);
      setDragOverPosition(null);
    }
  };

  // Track mouse position during drag for the overlay
  const handleDrag = (e: React.MouseEvent) => {
    setDragPreviewPosition({ x: e.clientX, y: e.clientY });
  }

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedTabId || draggedTabId === targetTabId) {
      handleDragEnd();
      return;
    }

    const draggedIndex = tabs.tabs.findIndex(t => t.id === draggedTabId);
    const targetIndex = tabs.tabs.findIndex(t => t.id === targetTabId);

    if (draggedIndex === -1 || targetIndex === -1) {
      handleDragEnd();
      return;
    }

    const newTabs = [...tabs.tabs];
    const [draggedTab] = newTabs.splice(draggedIndex, 1);

    // Determine insertion index based on position
    let insertIndex = targetIndex;
    if (dragOverPosition === 'right') {
      insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    } else {
      insertIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    }

    newTabs.splice(insertIndex, 0, draggedTab);
    activateTab({ panelId: panel, tabId: draggedTab.id });

    reorderTabs({ panelId: panel, tabs: newTabs })
    handleDragEnd();
  };

  // Mouse wheel scrolling
  useEffect(() => {
    if (!isMac) {
      const tabContainer = tabContainerRef.current;
      if (tabContainer) {
        const handleWheel = (e: WheelEvent) => {
          // Prevent default only when intending to override
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            tabContainer.scrollLeft += e.deltaY * 2; // vertical to horizontal
          } else {
            // Let native horizontal scroll happen
            tabContainer.scrollLeft += e.deltaX;
          }
        };
        tabContainer.addEventListener("wheel", handleWheel, { passive: false });
        return () => tabContainer.removeEventListener("wheel", handleWheel);
      }
    }
  }, []);
  useEffect(() => {
    if (tabs?.activeTabId && tabContainerRef.current) {
      const tabContainer = tabContainerRef.current;
      const activeTab = tabContainer.querySelector(
        `[data-tab-id="${tabs.activeTabId}"]`
      );
      if (activeTab) {
        const containerRect = tabContainer.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();
        const isOutOfView =
          tabRect.left < containerRect.left || tabRect.right > containerRect.right;
        if (isOutOfView) {
          activeTab.scrollIntoView();
        }
      }
    }
  }, [tabs?.activeTabId]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      const target = e.target as HTMLElement;
      const isInCodeEditor = target?.closest('.cm-editor, .txt-editor');

      // Allow Cmd+W to work even in CodeMirror/txt editors
      // But block other shortcuts when in code editors
      const isCloseTabShortcut = ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) && e.key.toLowerCase() === "w";

      if (isInCodeEditor && !isCloseTabShortcut) {
        return;
      }

      // Only handle shortcuts for main and bottom panels
      if (panel !== "main" && panel !== "bottom") return;

      // Handle Reload Tab shortcut (Cmd/Ctrl + R)
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (tabs && tabs.activeTabId) {
          const activeTab = tabs.tabs.find((t: Tab) => t.id === tabs.activeTabId);
          reloadPanelTab({
            panelId: panel,
            tabId: tabs.activeTabId,
            source: activeTab?.source ?? undefined,
          });
        }
        return;
      }

      const wPressedWithModifier = (isMac && e.metaKey) || (!isMac && e.ctrlKey);

      if (wPressedWithModifier && e.key.toLowerCase() === "w") {
        const hasOtherModifiers = (!isMac && e.metaKey) || (isMac && e.ctrlKey) || e.altKey || e.shiftKey;

        if (hasOtherModifiers) {
          return;
        }

        e.preventDefault();

        if (rPressed.current) {
          if (tabs && tabs.tabs) {
            tabs.tabs.forEach((tab: Tab) => {
              closeTab({ panelId: panel, tabId: tab.id, unsavedContent: getUnsaved(tab) });
            });
            // If closing all tabs in bottom panel, collapse it
            if (panel === "bottom" && bottomPanelRef?.current) {
              bottomPanelRef.current.collapse();
              closeBottomPanel();
            }
          }
        } else {
          if (tabs && tabs.activeTabId) {
            const activeTab = tabs.tabs.find((t: Tab) => t.id === tabs.activeTabId);
            const isLastTab = tabs.tabs.length === 1;

            closeTab({
              panelId: panel,
              tabId: tabs.activeTabId,
              unsavedContent: activeTab ? getUnsaved(activeTab) : undefined,
            });

            // If closing the last tab in bottom panel, collapse it
            if (panel === "bottom" && isLastTab && bottomPanelRef?.current) {
              bottomPanelRef.current.collapse();
              closeBottomPanel();
            }
          }
        }

        rPressed.current = false;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "r") {
        rPressed.current = false;
      }
    };

    const handleBlur = () => {
      rPressed.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [tabs, panel, closeTab]);

  return (
    <div
      ref={tabContainerRef}
      className="flex items-center h-full flex-1 overflow-x-auto relative"
      style={{
        scrollbarWidth: "none", // Firefox
        msOverflowStyle: "none", // IE and Edge
      }}
    >
      {/* Inline style to hide scrollbar in Webkit browsers */}
      <style>
        {`
          div::-webkit-scrollbar {
            display: none;
          }
        `}
      </style>

      {/* Drag Overlay Preview */}
      {draggedTabId && dragPreviewPosition && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: `${dragPreviewPosition.x || "-500"}px`,
            top: `${dragPreviewPosition.y || "-500"}px`,
          }}
        >
          <div className="flex items-center gap-x-2 px-3 py-1.5 bg-editor border border-accent rounded shadow-lg opacity-90">
            <div className="w-2 h-2">
              {!hideUnsavedIndicator &&
                tabs.tabs.find(t => t.id === draggedTabId)?.type === "document" &&
                useEditorStore.getState().unsaved[draggedTabId] && (
                  <div className="w-2 h-2 rounded-full bg-accent" />
                )}
            </div>
            <span className="text-fg text-sm font-medium whitespace-nowrap">
              {tabs.tabs.find(t => t.id === draggedTabId)?.title}
            </span>
          </div>
        </div>
      )}

      {tabs?.tabs?.map((tab: Tab) => (
        <TabComponent
          key={tab.id}
          tab={tab}
          panel={panel}
          activateTab={(tabId) => activateTab({ panelId: panel, tabId })}
          closeTabs={(panelId, tabs) => closeTabs({ panelId, tabs })}
          closeTab={(panelId, tabId, unsavedContent) => closeTab({ panelId, tabId, unsavedContent })}
          duplicateTab={(tabId) => duplicatePanelTab({ panelId: panel, tabId })}
          reloadTab={(tabId) => reloadPanelTab({ panelId: panel, tabId, source: tab.source ?? undefined })}
          tabs={tabs.tabs}
          isActive={tab.id === tabs?.activeTabId}
          isLastTerminalTab={tabs.tabs?.length === 1 && tab.type === "terminal"}
          currentActiveTabId={tabs?.activeTabId || ''}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrag={handleDrag}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          isDragging={draggedTabId === tab.id}
          dragOverPosition={dragOverTabId === tab.id ? dragOverPosition : null}
          hideUnsavedIndicator={hideUnsavedIndicator}
        />
      ))}
      <div className="flex-1 border-b border-border h-full"></div>
    </div>
  );
};
