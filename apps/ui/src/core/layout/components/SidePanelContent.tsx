import { FileSystemList } from "@/core/file-system/components";
import { useGetSidebarTabs } from "@/core/layout/hooks";
import { ExtensionBrowser } from "@/core/extensions/components/ExtensionBrowser";
import { usePluginStore } from "@/plugins";
import { ResponsePanelContainer } from "@/core/request-engine/components/ResponsePanelContainer";
import { GitSourceControl } from "@/core/git/components/GitSourceControl";
import { HistorySidebar } from "@/core/history/components/HistorySidebar";
import { GlobalHistorySidebar } from "@/core/history/components/GlobalHistorySidebar";

const sidebarComponentMap: Record<string, React.ReactNode> = {
  fileExplorer: <FileSystemList />,
  extensionBrowser: <ExtensionBrowser />,
  responsePanel: <ResponsePanelContainer />,
  gitSourceControl: <GitSourceControl />,
  history: <HistorySidebar />,
  globalHistory: <GlobalHistorySidebar />,
};

export const SidePanelContent = ({ side }: { side: "left" | "right" }) => {
  const { data: sidebarTabs } = useGetSidebarTabs(side);
  const pluginTabs = usePluginStore((state) => state.sidebar[side]);

  const activeTabId = sidebarTabs?.activeTabId;
  const activeTab = sidebarTabs?.tabs?.find((t: any) => t.id === activeTabId);
  const activeType = activeTab?.type;

  return (
    <>
      {/* Built-in tabs: always mounted, shown/hidden via CSS to preserve state */}
      {Object.entries(sidebarComponentMap).map(([type, node]) => (
        <div key={type} className="h-full bg-bg" style={{ display: activeType === type ? undefined : 'none' }}>
          {node}
        </div>
      ))}

      {/* Custom (plugin) tabs: always mounted once registered, shown/hidden via CSS */}
      {(pluginTabs || []).map((extensionTab: any) => {
        const matchingTab = sidebarTabs?.tabs?.find(
          (t: any) => t.type === 'custom' && t.meta?.customTabKey === extensionTab.id
        );
        if (!matchingTab) return null;
        const isActive = matchingTab.id === activeTabId;
        const Component = extensionTab.content || extensionTab.component;
        if (!Component) return null;
        return (
          <div key={extensionTab.id} className="h-full" style={{ display: isActive ? undefined : 'none' }}>
            <Component />
          </div>
        );
      })}
    </>
  );
};
