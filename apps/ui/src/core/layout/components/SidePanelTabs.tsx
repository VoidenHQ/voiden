import React, { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Files, ArrowDownUp, Blocks, Search, GitBranch, History, icons, Loader2, PanelRight, PanelBottom } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useGetSidebarTabs, useActivateSidebarTab } from "@/core/layout/hooks";
import { usePluginStore } from "@/plugins";
import { useSearchStore } from "@/core/stores/searchStore";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { useResponseStore } from "@/core/request-engine/stores/responseStore";
import { useResponsePanelPosition } from "@/core/stores/responsePanelPosition";
import { useSidebarTabsPosition } from "@/core/stores/sidebarTabsPosition";

/** Right-click menu on the left panel's tabs: move them between the top row and the side bar. */
function TabsPositionMenu({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const { position, togglePosition } = useSidebarTabsPosition();
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      role="menu"
      style={{ top: at.y, left: at.x }}
      className="fixed z-[100] min-w-44 py-1 rounded-md border border-border bg-panel text-text text-sm shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="w-full text-left px-3 py-1 hover:bg-active"
        onClick={() => {
          togglePosition();
          onClose();
        }}
      >
        {position === "top" ? "Move tabs to the side" : "Move tabs to the top"}
      </button>
    </div>
  );
}

const sidebarTabIconMap = {
  fileExplorer: Files,
  responsePanel: ArrowDownUp,
  extensionBrowser: Blocks,
  gitSourceControl: GitBranch,
  history: History,
  globalHistory: History,
};

const sidebarTabLabelMap: Record<string, string> = {
  fileExplorer: "File Explorer",
  responsePanel: "Response Panel",
  extensionBrowser: "Extensions",
  gitSourceControl: "Source Control",
  history: "History",
  globalHistory: "Global History",
};

// Helper to safely render lucide icons
const renderLucideIcon = (iconName: string | undefined, size: number = 14) => {
  if (!iconName) {
    return <Blocks size={size} />;
  }

  // @ts-expect-error - Dynamic icon access
  const IconComponent = icons[iconName];

  if (!IconComponent) {
    return <Blocks size={size} />;
  }

  return <IconComponent size={size} />;
};

export const SidePanelTabs = ({
  side,
  wrapperClassName,
  onTabClick,
  forceInactive,
  vertical,
  panel,
}: {
  side: "left" | "right";
  wrapperClassName?: string;
  onTabClick?: () => void;
  forceInactive?: boolean;
  /** Stack the tabs in a vertical bar beside the panel instead of a row above it. */
  vertical?: boolean;
  /** The panel these tabs drive, for the vertical bar: a tab opens it, the active tab closes it again. */
  panel?: { collapsed: boolean; toggle: () => void };
}) => {
  const { data: sidebarTabs } = useGetSidebarTabs(side);
  const pluginTabs = usePluginStore((state) => state.sidebar[side]);
  const activateTab = useActivateSidebarTab();
  const isRequestLoading = useResponseStore((s) => s.isLoading);
  const { position: responsePanelPosition, togglePosition } = useResponsePanelPosition();

  const storeIsSearching = useSearchStore((state) => state.isSearching);
  const setStoreIsSearching = useSearchStore((state) => state.setIsSearching);
  const openWithReplace = useSearchStore((state) => state.openWithReplace);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // The vertical bar has room for bigger icons, as in VS Code's Activity Bar.
  const iconSize = vertical ? 20 : 14;

  /**
   * In the vertical bar the tabs also show and hide the panel, as in VS Code: clicking a tab
   * opens a collapsed panel, clicking the tab that's already showing collapses it.
   * Returns true when the click only collapsed the panel.
   */
  const collapsedByClick = (isShowing: boolean) => {
    if (!panel) return false;
    if (panel.collapsed) {
      panel.toggle();
      return false;
    }
    if (isShowing) {
      panel.toggle();
      return true;
    }
    return false;
  };

  const openSearch = () => {
    setStoreIsSearching(true);
    if (sidebarTabs?.tabs?.length) {
      activateTab.mutate({ sidebarId: side, tabId: sidebarTabs.tabs[0].id });
    }
  };

  useHotkeys("mod+shift+f", (e) => {
    e.preventDefault();
    openSearch();
  }, { enabled: side === "left", enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("mod+shift+r", (e) => {
    e.preventDefault();
    openWithReplace();
    if (sidebarTabs?.tabs?.length) {
      activateTab.mutate({ sidebarId: side, tabId: sidebarTabs.tabs[0].id });
    }
  }, { enabled: side === "left", enableOnFormTags: true, enableOnContentEditable: true });

  // Return null if no tabs exist or sidebarTabs is undefined
  if (!sidebarTabs?.tabs?.length) {
    return null;
  }

  return (
    <div
      className={wrapperClassName ?? (vertical ? "w-10 h-full border-r border-border flex flex-col items-stretch bg-bg" : "h-8 border-b border-border flex items-center bg-bg")}
      onContextMenu={
        side === "left"
          ? (e) => {
              e.preventDefault();
              setMenuAt({ x: e.clientX, y: e.clientY });
            }
          : undefined
      }
    >
      {menuAt && <TabsPositionMenu at={menuAt} onClose={() => setMenuAt(null)} />}
      {sidebarTabs.tabs.map((tab: { id: string; type: string; meta?: any }, idx: number) => {
        const extensionTab = tab.type === "custom" ? pluginTabs?.find((t) => t.id === tab.meta.customTabKey) : null;
        // Skip rendering if it's an extension tab but no matching plugin tab is found
        if (tab.type === "custom" && !extensionTab) {
          return null;
        }

        const tabLabel = tab.type === "custom" && extensionTab
          ? extensionTab.title || extensionTab.id
          : sidebarTabLabelMap[tab.type] || tab.type;

        return (
          <React.Fragment key={tab.id}>
            <Tip label={tabLabel} side={vertical ? "right" : "bottom"}>
              <button
                onClick={() => {
                  if (collapsedByClick(!forceInactive && sidebarTabs.activeTabId === tab.id && !storeIsSearching)) return;
                  onTabClick?.();
                  activateTab.mutate({ sidebarId: side, tabId: tab.id });
                  setStoreIsSearching(false);
                }}
                className={cn(
                  "flex items-center justify-center hover:bg-active",
                  vertical ? "h-10 w-full" : "px-2 h-full",
                  !forceInactive && sidebarTabs.activeTabId === tab.id && !storeIsSearching && "bg-active",
                )}
              >
                <span className="relative flex items-center justify-center">
                {tab.type === "custom" && extensionTab
                  ? renderLucideIcon(extensionTab.icon, iconSize)
                  : (() => {
                      const Icon = sidebarTabIconMap[tab.type as keyof typeof sidebarTabIconMap];
                      return Icon ? <Icon size={iconSize} /> : null;
                    })()}
                {tab.type === "responsePanel" && isRequestLoading && (
                  <Loader2 size={8} className="animate-spin text-accent absolute -top-1.5 -right-1.5" />
                )}
              </span>
              </button>
            </Tip>
            {idx === 0 && side === "left" && (
              <Tip label={<span className="flex items-center gap-2"><span>Search</span><Kbd keys="⇧⌘F" size="sm" /></span>} side={vertical ? "right" : "bottom"}>
                <button
                  onClick={() => {
                    const showing = !forceInactive && sidebarTabs.activeTabId === tab.id && storeIsSearching;
                    if (collapsedByClick(showing)) return;
                    // Opening a collapsed panel on Search should show Search, not toggle it off.
                    setStoreIsSearching(panel?.collapsed ? true : !storeIsSearching);
                    activateTab.mutate({ sidebarId: side, tabId: tab.id });
                  }}
                  className={cn(
                    "flex items-center justify-center hover:bg-active",
                    vertical ? "h-10 w-full" : "px-2 h-full",
                    !forceInactive && sidebarTabs.activeTabId === tab.id && storeIsSearching && "bg-active",
                  )}
                >
                  <Search size={iconSize} />
                </button>
              </Tip>
            )}
          </React.Fragment>
        );
      })}

      {/* Layout toggle — only shown in the right panel tab bar */}
      {side === "right" && !wrapperClassName && (
        <>
          <div className="flex-1" />
          <Tip label={responsePanelPosition === "right" ? "Move to bottom" : "Move to right"} side="bottom">
            <button
              className="px-2 h-full flex items-center justify-center hover:bg-active text-comment border-l border-border"
              onClick={togglePosition}
            >
              {responsePanelPosition === "right" ? <PanelBottom size={14} /> : <PanelRight size={14} />}
            </button>
          </Tip>
        </>
      )}
    </div>
  );
};

/**
 * Title bar for a side panel whose tabs sit in the vertical bar: the open tab's name, since
 * there's no tab row above the content to say what it is.
 */
export const SidePanelTitle = ({ side }: { side: "left" | "right" }) => {
  const { data: sidebarTabs } = useGetSidebarTabs(side);
  const pluginTabs = usePluginStore((state) => state.sidebar[side]);
  const isSearching = useSearchStore((state) => state.isSearching);

  const active = sidebarTabs?.tabs?.find((t: { id: string }) => t.id === sidebarTabs.activeTabId);
  if (!active) return null;
  // Search shows inside the first tab (the file explorer), so it takes the title while open.
  const isSearch = side === "left" && isSearching && active.id === sidebarTabs.tabs[0]?.id;
  const title = isSearch
    ? "Search"
    : active.type === "custom"
      ? (() => {
          const ext = pluginTabs?.find((t) => t.id === active.meta?.customTabKey);
          return ext?.title || ext?.id || "";
        })()
      : sidebarTabLabelMap[active.type] || active.type;

  return (
    <div className="h-8 px-3 border-b border-border flex items-center bg-bg">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-comment truncate">{title}</span>
    </div>
  );
};

export default SidePanelTabs;
