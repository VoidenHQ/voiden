import { Panel, PanelGroup } from "react-resizable-panels";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { hideSlashMenu } from "@/core/editors/voiden/SlashCommand";
import type { Tab } from "../../../../electron/src/shared/types";
import { MainEditor } from "./components/MainEditor";
import { savePanelStateForTab } from "./components/PanelTabs";
import { useElectronEvent } from "@/core/providers/ElectronEventProvider";
import { useGetPanelTabs, useAddPanelTab, useActivateTab, useClosePanelTab } from "./hooks";
import { setEnvJumpTarget } from "@/core/environment/components/EnvironmentEditor";
import { useEnvironments } from "@/core/environment/hooks";
import { mountVariableValueTooltip, unmountVariableValueTooltip } from "@/core/editors/variableValueTooltip";
import { usePanelStore } from "@/core/stores/panelStore";

export const AppLayout = () => {
  const { toggle: toggleLeft, panelProps: leftPanelProps, isCollapsed: isLeftCollapsed } = useLeftPanel();
  const { toggle: toggleBottom, panelProps: bottomPanelProps, isCollapsed: isBottomCollapsed } = useBottomPanel();
  const { toggle: toggleRight, panelProps: rightPanelProps, isCollapsed: isRightCollapsed } = useRightPanel();
  const openRightPanel = usePanelStore((state) => state.openRightPanel);
  const closeRightPanel = usePanelStore((state) => state.closeRightPanel);

  const { data: appState } = useGetAppState();
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>("");
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  let { settings, onChange, setSettings } = useSettings();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { mutate: closePanelTab } = useClosePanelTab();
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
  const knownTabIdsRef = useRef<Set<string> | null>(null);
  const prevActiveTabIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!activeTabId) return;
    const queryClient = getQueryClient();

    // Save panel state for the tab we're leaving so it can be restored later.
    // This covers the case where the user opens a new file from the left panel
    // (which bypasses the tab-click handler in PanelTabs that normally saves state).
    if (prevActiveTabIdRef.current && prevActiveTabIdRef.current !== activeTabId) {
      savePanelStateForTab(prevActiveTabIdRef.current);
    }
    prevActiveTabIdRef.current = activeTabId;
    const currentPanelData = queryClient.getQueryData<{ tabs?: Tab[]; activeTabId?: string }>(["panel:tabs", "main"]);
    const targetTab = currentPanelData?.tabs?.find((tab) => tab.id === activeTabId);
    const currentTabIds = new Set((currentPanelData?.tabs || []).map((tab) => tab.id));

    let isNewlyOpenedTab = false;
    if (knownTabIdsRef.current === null) {
      // Initialize on first run; do not treat existing restored tabs as newly opened.
      knownTabIdsRef.current = new Set(currentTabIds);
    } else {
      isNewlyOpenedTab = !knownTabIdsRef.current.has(activeTabId);
      knownTabIdsRef.current = new Set(currentTabIds);
    }

    let panelStateForTab: { rightPanelOpen?: boolean; activeSidebarTabId?: string } | undefined;
    const storedStates = localStorage.getItem("panelStates");
    if (storedStates) {
      try {
        const panelStates = JSON.parse(storedStates) as Array<{ tabId: string; rightPanelOpen: boolean; activeSidebarTabId?: string }>;
        panelStateForTab = panelStates.find((state) => state.tabId === activeTabId);
      } catch {
        panelStateForTab = undefined;
      }
    }

    if (panelStateForTab) {
      // Restore exactly what was open/closed and which sidebar tab was active for this doc tab
      panelStateForTab.rightPanelOpen ? openRightPanel() : closeRightPanel();
      if (panelStateForTab.activeSidebarTabId) {
        const targetSidebarTabId = panelStateForTab.activeSidebarTabId;
        window.electron?.sidebar.activateTab('right', targetSidebarTabId);
        // Optimistically update cache so sidebar switches instantly with no refetch flash
        queryClient.setQueryData(['sidebar:tabs', 'right'], (old: any) =>
          old ? { ...old, activeTabId: targetSidebarTabId } : old
        );
      }
    } else if (targetTab?.type === "document") {
      // No saved state: close the right panel so tabs that never had it open
      // don't inherit the previous tab's open panel (and its response history).
      closeRightPanel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, panelTabs?.tabs]);

  // Get app version
  useEffect(() => {
    window.electron?.getVersion().then(setVersion);
  }, []);

  // Read onboarding status directly from onboarding.json
  useEffect(() => {
    window.electron?.state.getOnboarding().then(setOnboarding);
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

  // Expose settings to window for ProseMirror plugins (which can't use React hooks)
  useEffect(() => {
    if (settings) {
      (window as any).__voidenSettings = settings;
    }
  }, [settings]);



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
    // Dispatch on body (not document) so e.target has .closest()
    const target = (document.activeElement as HTMLElement) || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
    }));
  });

  useElectronEvent("menu:show-about", () => {
    hideSlashMenu();
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

  useElectronEvent("menu:open-logs", () => {
    const existing = panelTabs?.tabs?.find((t: any) => t.type === "logs");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
    } else {
      addPanelTab({
        panelId: "main",
        tab: { id: crypto.randomUUID(), type: "logs", title: "System Logs", source: null },
      });
    }
  });

  useEffect(() => {
    if (settings?.developer?.system_log === false) {
      const logsTab = panelTabs?.tabs?.find((t: any) => t.type === "logs");
      if (logsTab) {
        closePanelTab({ panelId: "main", tabId: logsTab.id });
      }
    }
  }, [settings?.developer?.system_log]);

  return (
    <div className="h-screen w-screen bg-bg font-sans text-text text-base flex flex-col overflow-hidden select-none">
      {/* Top Navigation Bar */}
      <TopNavBar onShowAbout={() => { hideSlashMenu(); setIsAboutModalOpen(true); }} />

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

      {/* Onboarding Modal — shown only on a fresh install (driven by onboarding.json) */}
      {onboarding === false && <OnboardingModal />}

      {/* About Modal */}
      <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />
    </div>
  );
};
