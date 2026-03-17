import React, { useEffect } from "react";
import { Files, ArrowDownUp, Blocks, Search, GitBranch, History, icons, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useGetSidebarTabs, useActivateSidebarTab } from "@/core/layout/hooks";
import { usePluginStore } from "@/plugins";
import { useSearchStore } from "@/core/stores/searchStore";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { useResponseStore } from "@/core/request-engine/stores/responseStore";

const sidebarTabIconMap = {
  fileExplorer: <Files size={14} />,
  responsePanel: <ArrowDownUp size={14} />,
  extensionBrowser: <Blocks size={14} />,
  gitSourceControl: <GitBranch size={14} />,
  history: <History size={14} />,
  globalHistory: <History size={14} />,
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
    // console.warn(`Icon "${iconName}" not found in lucide-react, using fallback`);
    return <Blocks size={size} />;
  }

  return <IconComponent size={size} />;
};

export const SidePanelTabs = ({ side }: { side: "left" | "right" }) => {
  const { data: sidebarTabs } = useGetSidebarTabs(side);
  const pluginTabs = usePluginStore((state) => state.sidebar[side]);
  const activateTab = useActivateSidebarTab();
  const isRequestLoading = useResponseStore((s) => s.isLoading);

  const storeIsSearching = useSearchStore((state) => state.isSearching);
  const setStoreIsSearching = useSearchStore((state) => state.setIsSearching);

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      // Shift + Cmd/Ctrl + F
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        // toggle the search state
        setStoreIsSearching((prev) => !prev);
        // activate the first tab (where the search button lives)
        if (sidebarTabs?.tabs?.length) {
          activateTab.mutate({ sidebarId: side, tabId: sidebarTabs.tabs[0].id });
        }
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [activateTab, setStoreIsSearching, side, sidebarTabs]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // Return null if no tabs exist or sidebarTabs is undefined
  if (!sidebarTabs?.tabs?.length) {
    return null;
  }

  return (
    <div className="h-8 border-b border-border flex items-center bg-bg">
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
            <Tip label={tabLabel} side="bottom">
              <button
                onClick={() => {
                  activateTab.mutate({ sidebarId: side, tabId: tab.id });
                  setStoreIsSearching(false);
                }}
                className={cn(
                  "px-2 h-full flex items-center justify-center hover:bg-active",
                  sidebarTabs.activeTabId === tab.id && !storeIsSearching && "bg-active",
                )}
              >
                <span className="relative flex items-center justify-center">
                {tab.type === "custom" && extensionTab
                  ? renderLucideIcon(extensionTab.icon, 14)
                  : sidebarTabIconMap[tab.type as keyof typeof sidebarTabIconMap]}
                {tab.type === "responsePanel" && isRequestLoading && (
                  <Loader2 size={8} className="animate-spin text-accent absolute -top-1.5 -right-1.5" />
                )}
              </span>
              </button>
            </Tip>
            {idx === 0 && side === "left" && (
              <Tip label={<span className="flex items-center gap-2"><span>Search</span><Kbd keys="⇧⌘F" size="sm" /></span>} side="bottom">
                <button
                  onClick={() => {
                    setStoreIsSearching(!storeIsSearching);
                    activateTab.mutate({ sidebarId: side, tabId: tab.id });
                  }}
                  className={cn(
                    "px-2 h-full flex items-center justify-center hover:bg-active",
                    sidebarTabs.activeTabId === tab.id && storeIsSearching && "bg-active",
                  )}
                >
                  <Search size={14} />
                </button>
              </Tip>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default SidePanelTabs;
