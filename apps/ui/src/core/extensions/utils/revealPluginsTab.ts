import { getQueryClient } from "@/main";
import { usePanelStore } from "@/core/stores/panelStore";

// ExtensionBrowser is always mounted (just hidden) when another left-sidebar
// tab is active, so callers can invoke this from anywhere — a toast action, a
// block-version-mismatch card, etc. — and the panel will actually be shown.
export const revealPluginsTab = () => {
  const { leftPanelRef, openLeftPanel } = usePanelStore.getState();
  if (leftPanelRef?.current?.isCollapsed()) {
    leftPanelRef.current.expand();
  }
  openLeftPanel();

  const queryClient = getQueryClient();
  const sidebarTabs = queryClient.getQueryData<{ tabs?: Array<{ id: string; type: string }> }>(["sidebar:tabs", "left"]);
  const pluginsTab = sidebarTabs?.tabs?.find((tab) => tab.type === "extensionBrowser");
  if (pluginsTab) {
    window.electron?.sidebar.activateTab("left", pluginsTab.id);
    queryClient.setQueryData(["sidebar:tabs", "left"], (old: any) =>
      old ? { ...old, activeTabId: pluginsTab.id } : old
    );
  }
};
