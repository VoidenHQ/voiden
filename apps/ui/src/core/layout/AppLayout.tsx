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
import { saveTabById } from "@/core/file-system/hooks";
import { getQueryClient } from "@/main";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import type { Tab } from "../../../../electron/src/shared/types";
import { MainEditor } from "./components/MainEditor";
import { useElectronEvent } from "@/core/providers/ElectronEventProvider";
import { useGetPanelTabs, useAddPanelTab, useActivateTab } from "./hooks";
import { setEnvJumpTarget } from "@/core/environment/components/EnvironmentEditor";
import { useEnvironments } from "@/core/environment/hooks";
import { mountVariableValueTooltip, unmountVariableValueTooltip } from "@/core/editors/variableValueTooltip";
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
  const { data: envData } = useEnvironments();

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

  // Apply font size settings
  useEffect(() => {
    if (settings?.appearance?.font_size) {
      document.documentElement.style.setProperty("--font-size-base", `${settings.appearance.font_size}px`);
    }
  }, [settings?.appearance?.font_size]);

  useEffect(() => {
    if (settings?.appearance?.ui_font_size) {
      document.documentElement.style.setProperty("--font-size-ui", `${settings.appearance.ui_font_size}px`);
    }
  }, [settings?.appearance?.ui_font_size]);

  

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
    const delaySeconds = settings?.editor?.auto_save_delay ?? 5;
    const delayMs = delaySeconds * 1000;
    const isInstantAutoSave = delaySeconds === 0;
    const backgroundBatchDelayMs = 1500;

    if (!on) return;

    let backgroundSaveTimeout: NodeJS.Timeout | null = null;
    const perTabTimeouts = new Map<string, NodeJS.Timeout>();
    let isAutoSaving = false;
    let hasQueuedRun = false;
    const queuedTabIds = new Set<string>();
    let prevUnsaved = useEditorStore.getState().unsaved;

    const runAutoSave = async (tabIds?: string[]) => {
      if (tabIds && tabIds.length > 0) {
        tabIds.forEach((id) => queuedTabIds.add(id));
      }

      if (isAutoSaving) {
        hasQueuedRun = true;
        return;
      }

      isAutoSaving = true;
      try {
        while (true) {
          hasQueuedRun = false;
          const unsavedNow = useEditorStore.getState().unsaved;
          const unsavedSet = new Set(Object.keys(unsavedNow));
          const candidateTabIds = queuedTabIds.size > 0 ? [...queuedTabIds] : [...unsavedSet];

          // Clear queue now; new incoming changes during save will re-queue.
          queuedTabIds.clear();

          const tabIdsToSave = candidateTabIds.filter((id) => unsavedSet.has(id));
          if (tabIdsToSave.length > 0) {
            // saveTabById skips tabs that are not persisted on filesystem.
            for (const tabId of tabIdsToSave) {
              await saveTabById(tabId, { silent: true });
            }
          }

          if (!hasQueuedRun && queuedTabIds.size === 0) break;
        }
      } finally {
        isAutoSaving = false;
      }
    };

    const scheduleAutoSave = () => {
      if (isInstantAutoSave) {
        // Save active tab immediately on each edit burst.
        const queryClient = getQueryClient();
        const panelTabs = queryClient.getQueryData(["panel:tabs", "main"]) as { tabs: Tab[]; activeTabId: string } | undefined;
        const activeTabId = panelTabs?.activeTabId;
        const unsavedNow = useEditorStore.getState().unsaved;
        if (activeTabId && unsavedNow[activeTabId]) {
          void runAutoSave([activeTabId]);
        }

        // Batch-save all other dirty tabs shortly after.
        if (backgroundSaveTimeout) clearTimeout(backgroundSaveTimeout);
        backgroundSaveTimeout = setTimeout(() => {
          const latestUnsaved = useEditorStore.getState().unsaved;
          const latestPanelTabs = queryClient.getQueryData(["panel:tabs", "main"]) as { tabs: Tab[]; activeTabId: string } | undefined;
          const latestActiveTabId = latestPanelTabs?.activeTabId;
          const backgroundTabIds = Object.keys(latestUnsaved).filter((id) => id !== latestActiveTabId);
          if (backgroundTabIds.length > 0) {
            void runAutoSave(backgroundTabIds);
          }
        }, backgroundBatchDelayMs);
        return;
      }
    };

    const schedulePerTabAutoSave = (tabId: string) => {
      const existing = perTabTimeouts.get(tabId);
      if (existing) clearTimeout(existing);
      const timeout = setTimeout(() => {
        perTabTimeouts.delete(tabId);
        void runAutoSave([tabId]);
      }, delayMs);
      perTabTimeouts.set(tabId, timeout);
    };

    // Listen for changes in the editor store
    const unsubscribe = useEditorStore.subscribe((state) => {
      const unsaved = state.unsaved;
      const unsavedTabIds = Object.keys(unsaved);
      const hasUnsavedChanges = unsavedTabIds.length > 0;
      if (hasUnsavedChanges) {
        if (isInstantAutoSave) {
          scheduleAutoSave();
        } else {
          // VS Code-style behavior: each tab gets its own autosave timer.
          const changedTabIds = unsavedTabIds.filter((tabId) => prevUnsaved[tabId] !== unsaved[tabId]);
          changedTabIds.forEach((tabId) => schedulePerTabAutoSave(tabId));
        }
      }

      // Clear stale timers for tabs that are no longer unsaved.
      const unsavedSet = new Set(unsavedTabIds);
      for (const [tabId, timeout] of perTabTimeouts.entries()) {
        if (!unsavedSet.has(tabId)) {
          clearTimeout(timeout);
          perTabTimeouts.delete(tabId);
        }
      }

      prevUnsaved = unsaved;
    });

    // If unsaved changes already exist, schedule saves immediately with current mode.
    const initialUnsaved = useEditorStore.getState().unsaved;
    const initialUnsavedTabIds = Object.keys(initialUnsaved);
    if (initialUnsavedTabIds.length > 0) {
      if (isInstantAutoSave) {
        scheduleAutoSave();
      } else {
        initialUnsavedTabIds.forEach((tabId) => schedulePerTabAutoSave(tabId));
      }
    }

    return () => {
      if (backgroundSaveTimeout) {
        clearTimeout(backgroundSaveTimeout);
      }
      for (const timeout of perTabTimeouts.values()) {
        clearTimeout(timeout);
      }
      perTabTimeouts.clear();
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

  // Mount variable-value hover tooltip (shows resolved value on hover)
  useEffect(() => {
    mountVariableValueTooltip();
    return () => unmountVariableValueTooltip();
  }, []);

  // Navigate to EnvironmentEditor when a variable is Cmd+clicked in any editor
  useEffect(() => {
    const handler = (e: Event) => {
      const { variableName, variableType } = (e as CustomEvent).detail;
      // Only env variables are navigable to the environment editor
      if (variableType !== "env") return;

      setEnvJumpTarget({
        envPath: envData?.activeEnv ?? "",
        varKey: variableName,
        profile: envData?.activeProfile ?? "default",
      });

      const existing = panelTabs?.tabs?.find((t: Tab) => t.type === "environmentEditor");
      if (existing) {
        activateTab({ panelId: "main", tabId: existing.id });
        // Give the tab time to render, then notify the already-mounted editor
        setTimeout(() => window.dispatchEvent(new Event("voiden:env-editor-focus")), 100);
      } else {
        addPanelTab({
          panelId: "main",
          tab: { id: crypto.randomUUID(), type: "environmentEditor", title: "Environments", source: null },
        });
      }
    };
    window.addEventListener("variable-click", handler);
    return () => window.removeEventListener("variable-click", handler);
  }, [panelTabs, activateTab, addPanelTab, envData]);

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
