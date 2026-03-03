import { Panel, PanelGroup } from "react-resizable-panels";
import { useEffect, useLayoutEffect, useState } from "react";
import { useSettings } from "@/core/settings/hooks/useSettings";
import { useLeftPanel, useBottomPanel, useRightPanel } from "./hooks/usePanels";
import { SidePanelTabs } from "./components/SidePanelTabs";
import { SidePanelContent } from "./components/SidePanelContent";
import { ResizeHandle } from "./components/ResizeHandle";
import { TopNavBar } from "./components/TopNavBar";
import { StatusBar } from "./components/StatusBar";
import OnboardingModal from "@/core/screens/OnboardingModal";
import AboutModal from "@/core/screens/AboutModal";
import { useGetAppState } from "@/core/state/hooks";
import { globalSaveFile } from "@/core/file-system/hooks";
import { getQueryClient } from "@/main";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import type { Tab } from "../../../../electron/src/shared/types";
import { MainEditor } from "./components/MainEditor";
import { useElectronEvent } from "@/core/providers/ElectronEventProvider";
import { useGetPanelTabs, useAddPanelTab, useActivateTab } from "./hooks";
import { usePanelStore } from "@/core/stores/panelStore";
import { useResponseStore } from "@/core/request-engine/stores/responseStore";

export const AppLayout = () => {
  const { toggle: toggleLeft, panelProps: leftPanelProps, isCollapsed: isLeftCollapsed } = useLeftPanel();
  const { toggle: toggleBottom, panelProps: bottomPanelProps, isCollapsed: isBottomCollapsed } = useBottomPanel();
  const { toggle: toggleRight, panelProps: rightPanelProps, isCollapsed: isRightCollapsed } = useRightPanel();
  const openRightPanel = usePanelStore((state) => state.openRightPanel);
  const closeRightPanel = usePanelStore((state) => state.closeRightPanel);

  const { data: appState } = useGetAppState();
  const [version, setVersion] = useState<string>("");
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  let { settings, onChange, setSettings } = useSettings();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: panelTabs } = useGetPanelTabs("main");

  // Apply per-tab right-panel open/close state AFTER the panel:tabs query has
  // settled. Running here (rather than in useActivateTab.onSuccess) ensures the
  // editor has already switched to the correct tab before the panel expands,
  // eliminating the glitch where the response panel opened with the wrong
  // editor content still visible.
  // Use useLayoutEffect so panel open/close is applied before the browser paints,
  // preventing a visible flash where the old tab's panel state bleeds into the new tab.
  const activeTabId = panelTabs?.activeTabId;
  useLayoutEffect(() => {
    if (!activeTabId) return;
    const queryClient = getQueryClient();
    const currentPanelData = queryClient.getQueryData<{ tabs?: Tab[]; activeTabId?: string }>(["panel:tabs", "main"]);
    const targetTab = currentPanelData?.tabs?.find((tab) => tab.id === activeTabId);

    let panelStateForTab: { rightPanelOpen?: boolean } | undefined;
    const storedStates = localStorage.getItem("panelStates");
    if (storedStates) {
      try {
        const panelStates = JSON.parse(storedStates) as Array<{ tabId: string; rightPanelOpen: boolean }>;
        panelStateForTab = panelStates.find((state) => state.tabId === activeTabId);
      } catch {
        panelStateForTab = undefined;
      }
    }

    const hasResponse = !!useResponseStore.getState().responses[activeTabId]?.responseDoc;

    if (!hasResponse) {
      // No cached response: always close regardless of saved state
      closeRightPanel();
    } else if (panelStateForTab) {
      // Has response + saved state: restore it
      panelStateForTab.rightPanelOpen ? openRightPanel() : closeRightPanel();
    }
    // Has response + no saved state: leave panel as-is
    // (e.g. a response just arrived and opened the panel automatically)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Get app version
  useEffect(() => {
    window.electron?.getVersion().then(setVersion);
  }, []);

  // Apply font size setting
  useEffect(() => {
    if (settings?.appearance?.font_size) {
      document.documentElement.style.setProperty("--font-size-base", `${settings.appearance.font_size}px`);
    }
  }, [settings?.appearance?.font_size]);

  

  // Apply code wrap
  useEffect(() => {
    if (settings?.appearance?.code_wrap) {
      document.documentElement.style.setProperty("--cm-whitespace", `pre-wrap`);
      document.documentElement.style.setProperty("--cm-wordbreak", `break-word`);
      document.documentElement.style.setProperty("--cm-wrapwidth", `calc(100% - 35px)`);
    } else {
      document.documentElement.style.setProperty("--cm-whitespace", ``);
      document.documentElement.style.setProperty("--cm-wordbreak", ``);
      document.documentElement.style.setProperty("--cm-wrapwidth", ``);
    }
  }, [settings?.appearance?.code_wrap]);

  // Apply font family setting
  useEffect(() => {
    if (settings?.appearance?.font_family) {
      document.documentElement.style.setProperty("--font-family-base", `${settings.appearance.font_family}`);
    }
  }, [settings?.appearance?.font_family]);

  // Auto-save functionality
  useEffect(() => {
    const on = settings?.editor?.auto_save;
    const delay = (settings?.editor?.auto_save_delay ?? 5) * 1000;

    if (!on) return;

    let autoSaveTimeout: NodeJS.Timeout | null = null;

    const scheduleAutoSave = () => {
      // Clear existing timeout
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }

      // Set new timeout
      autoSaveTimeout = setTimeout(() => {
        // Check if there are any unsaved changes before triggering auto-save
        const unsavedChanges = useEditorStore.getState().unsaved;
        const hasUnsavedChanges = Object.keys(unsavedChanges).length > 0;

        if (hasUnsavedChanges) {
          // Get the active tab to check if it's persisted on filesystem
          const queryClient = getQueryClient();
          const panelTabs = queryClient.getQueryData(["panel:tabs", "main"]) as { tabs: Tab[]; activeTabId: string } | undefined;
          const activeTabId = panelTabs?.activeTabId;
          const activeTab = panelTabs?.tabs?.find((tab: Tab) => tab.id === activeTabId);

          // Only auto-save if the active tab has a source (is persisted on filesystem)
          if (activeTab && activeTab.source) {
            globalSaveFile();
          }
        }
      }, delay);
    };

    // Listen for changes in the editor store
    const unsubscribe = useEditorStore.subscribe((state) => {
      const hasUnsavedChanges = Object.keys(state.unsaved).length > 0;
      if (hasUnsavedChanges) {
        scheduleAutoSave();
      }
    });

    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
      unsubscribe();
    };
  }, [settings?.editor?.auto_save, settings?.editor?.auto_save_delay]);

  // subscribe to external changes (other windows, etc.)
  useEffect(() => {
    const off = onChange((next) => {
      setSettings(next);
    });
    return off;
  }, [onChange]);

  // Handle menu events
  useElectronEvent("menu:open-settings", () => {
    // Check if settings tab is already open
    const settingsTab = panelTabs?.tabs?.find((tab: Tab) => tab.type === "settings");

    if (settingsTab) {
      // Tab already exists - just activate it
      activateTab({
        panelId: "main",
        tabId: settingsTab.id,
      });
      return;
    }

    // Tab not open - open it now
    addPanelTab({
      panelId: "main",
      tab: { id: crypto.randomUUID(), type: "settings", title: "Settings", source: null },
    });
  });

  useElectronEvent("menu:check-updates", async () => {
    const channel = settings?.updates?.channel || "stable";
    await window.electron?.checkForUpdates(channel);
  });

  useElectronEvent("menu:toggle-explorer", () => {
    toggleLeft();
  });

  useElectronEvent("menu:toggle-terminal", () => {
    toggleBottom();
  });

  useElectronEvent("menu:find", () => {
    // Trigger find in the active editor
    // This could be enhanced to focus find input if it exists
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      ctrlKey: true
    }));
  });

  useElectronEvent("menu:show-about", () => {
    setIsAboutModalOpen(true);
  });

  useElectronEvent("menu:open-welcome", () => {
    const existing = panelTabs?.tabs?.find((t: any) => t.type === "welcome");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
    } else {
      addPanelTab({
        panelId: "main",
        tab: { id: crypto.randomUUID(), type: "welcome", title: "Welcome", source: null },
      });
    }
  });

  useElectronEvent("menu:open-changelog", () => {
    const existing = panelTabs?.tabs?.find((t: any) => t.type === "changelog");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
    } else {
      addPanelTab({
        panelId: "main",
        tab: { id: crypto.randomUUID(), type: "changelog", title: "Changelog", source: null },
      });
    }
  });

  return (
    <div className="h-screen w-screen bg-bg font-sans text-text text-base flex flex-col overflow-hidden select-none">
      {/* Top Navigation Bar */}
      <TopNavBar onShowAbout={() => setIsAboutModalOpen(true)} />

      {/* Main Content Area with Resizable Panels */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" autoSaveId="persist-1">
          {/* Left Sidebar - File Browser */}
          <Panel {...leftPanelProps}>
            <div className="h-full border-border bg-bg">
              <SidePanelTabs side="left" />
              <div className="h-[calc(100%-2rem)]">
                <SidePanelContent side="left" />
              </div>
            </div>
          </Panel>

          <ResizeHandle orientation="vertical" />

          {/* Main Editor and Right Panel */}
          <MainEditor bottomPanelProps={bottomPanelProps} rightPanelProps={rightPanelProps} />
        </PanelGroup>
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        version={version}
        isLeftCollapsed={isLeftCollapsed}
        isBottomCollapsed={isBottomCollapsed}
        isRightCollapsed={isRightCollapsed}
        toggleLeft={toggleLeft}
        toggleBottom={toggleBottom}
        toggleRight={toggleRight}
      />

      {/* Onboarding Modal */}
      {!appState?.onboarding && <OnboardingModal />}

      {/* About Modal */}
      <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />
    </div>
  );
};
