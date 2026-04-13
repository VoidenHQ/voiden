import { ImperativePanelHandle } from "react-resizable-panels";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/core/lib/utils";
import { usePanelStore } from "@/core/stores/panelStore";
import { getResponsePanelPosition } from "@/core/stores/responsePanelPosition";
import { useGetPanelTabs } from "./usePanelTabs";
import { useNewTerminalTab } from "@/core/terminal/hooks";
import { useGetAppState } from "@/core/state/hooks";
import { matchesShortcut } from "@/core/shortcuts";

const STORAGE_KEYS = {
  LEFT_PANEL: "novus:left-panel-collapsed",
  BOTTOM_PANEL: "novus:bottom-panel-collapsed",
  RIGHT_PANEL: "novus:right-panel-collapsed",
} as const;

interface UseLeftPanelProps {
  defaultSize?: number;
  minSize?: number;
}

export const useLeftPanel = ({ defaultSize = 20, minSize = 0 }: UseLeftPanelProps = {}) => {
  const ref = useRef<ImperativePanelHandle>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.LEFT_PANEL);
    return stored ? JSON.parse(stored) : false;
  });

  const toggle = () => {
    if (ref.current) {
      if (ref.current.isCollapsed()) {
        ref.current.expand();
        setIsCollapsed(false);
      } else {
        ref.current.collapse();
        setIsCollapsed(true);
      }
    }
  };

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL, JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  // Keyboard shortcut: Cmd+Shift+E
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      const isSidebarShortcut = matchesShortcut("ToggleExplorer", e);
      if (isSidebarShortcut) {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const panelProps = {
    ref,
    collapsible: true,
    collapsedSize: 0,
    defaultSize,
    minSize,
    className: cn("", !isCollapsed && "min-w-40"),
  };

  return {
    ref,
    isCollapsed,
    toggle,
    panelProps,
  };
};

interface UseBottomPanelProps {
  defaultSize?: number;
  minSize?: number;
  panelId: string;
}

export const useBottomPanel = ({ defaultSize = 0, minSize = 20, panelId = "bottom" }: UseBottomPanelProps = {} as UseBottomPanelProps) => {
  if (!panelId) {
    throw new Error("useBottomPanel requires a valid panelId");
  }

  const ref = useRef<ImperativePanelHandle>(null);
  const { bottomPanelOpen, openBottomPanel, closeBottomPanel, setBottomPanelRef } = usePanelStore();

  // Set the ref in the global store
  useEffect(() => {
    setBottomPanelRef(ref);
  }, [ref, setBottomPanelRef]);

  const { data: tabs } = useGetPanelTabs(panelId);
  const { mutate: createTerminalTab } = useNewTerminalTab();
  const { data: appState } = useGetAppState();

  // Per-project localStorage key for the user's explicit open/close choice.
  const bottomPanelStateKey = (dir: string) => `voiden:bottom-panel-open:${dir}`;

  const saveBottomPanelState = (dir: string | null | undefined, open: boolean) => {
    if (!dir) return;
    localStorage.setItem(bottomPanelStateKey(dir), JSON.stringify(open));
  };

  const dirChangedRef = useRef(false);

  const handleToggleBottomPanel = useCallback(() => {
    if (ref.current) {
      if (ref.current.isCollapsed()) {
        ref.current.expand();
        openBottomPanel();
        saveBottomPanelState(appState?.activeDirectory, true);

        // Only auto-create terminal in right mode.
        // In bottom mode the panel is shared with the response panel,
        // so terminal creation is handled explicitly by handleSwitchToTerminal.
        if (getResponsePanelPosition() === "right" && tabs?.tabs) {
          const tabCount = tabs.tabs.length;
          if (tabCount === 0) {
            createTerminalTab(panelId);
          }
        }
      } else {
        ref.current.collapse();
        closeBottomPanel();
        saveBottomPanelState(appState?.activeDirectory, false);
      }
    }
  }, [tabs, panelId, appState?.activeDirectory, createTerminalTab, openBottomPanel, closeBottomPanel]);

  // Listen for changes in the global state and sync the panel
  useEffect(() => {
    if (ref.current) {
      if (bottomPanelOpen && ref.current.isCollapsed()) {
        ref.current.expand();
      } else if (!bottomPanelOpen && !ref.current.isCollapsed()) {
        ref.current.collapse();
      }
    }
    // Persist the change for the current project (covers all close paths,
    // e.g. closing the last tab from PanelTabs, not just the toggle button).
    if (!dirChangedRef.current) {
      saveBottomPanelState(appState?.activeDirectory, bottomPanelOpen);
    }
  }, [bottomPanelOpen]);

  // Restore per-project bottom panel state when the active directory changes.
  // Wait for the new project's tabs to load, then apply the stored open/closed state.
  // Falls back to activeTabId for projects never explicitly toggled.
  useEffect(() => {
    dirChangedRef.current = true;
  }, [appState?.activeDirectory]);

  useEffect(() => {
    if (!dirChangedRef.current) return;
    if (tabs === undefined) return;

    dirChangedRef.current = false;

    const dir = appState?.activeDirectory;
    let shouldBeOpen: boolean;

    if (dir) {
      const stored = localStorage.getItem(bottomPanelStateKey(dir));
      shouldBeOpen = stored !== null ? JSON.parse(stored) : !!tabs.activeTabId;
    } else {
      shouldBeOpen = !!tabs.activeTabId;
    }

    if (shouldBeOpen && !bottomPanelOpen) {
      openBottomPanel();
    } else if (!shouldBeOpen && bottomPanelOpen) {
      closeBottomPanel();
      ref.current?.collapse();
    }
  }, [tabs]);

  // Keyboard shortcut: Cmd+J
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      if (matchesShortcut("ToggleTerminal", e)) {
        e.preventDefault();
        handleToggleBottomPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleBottomPanel]);

  const panelProps = {
    ref,
    collapsible: true,
    collapsedSize: 0,
    defaultSize,
    minSize,
    className: cn("", bottomPanelOpen && "min-h-[100px]"),
  };

  return {
    ref,
    isCollapsed: !bottomPanelOpen,
    toggle: handleToggleBottomPanel,
    panelProps,
  };
};

interface UseRightPanelProps {
  defaultSize?: number;
  minSize?: number;
}

export const useRightPanel = ({ defaultSize = 0, minSize = 30 }: UseRightPanelProps = {}) => {
  const ref = useRef<ImperativePanelHandle>(null);

  // Subscribe to the global state
  const rightPanelOpen = usePanelStore((state) => state.rightPanelOpen);
  const openRightPanel = usePanelStore((state) => state.openRightPanel);
  const closeRightPanel = usePanelStore((state) => state.closeRightPanel);
  const setRightPanelRef = usePanelStore((state) => state.setRightPanelRef);

  // Register the ref so it can be accessed imperatively (e.g. from position toggle)
  useEffect(() => {
    setRightPanelRef(ref);
  }, []);

  const toggle = () => {
    if (ref.current) {
      if (ref.current.isCollapsed()) {
        ref.current.expand();
        openRightPanel();
      } else {
        ref.current.collapse();
        closeRightPanel();
      }
    }
  };

  // Helper to open the panel imperatively
  const open = () => {
    if (ref.current && ref.current.isCollapsed()) {
      ref.current.expand();
      openRightPanel();
    }
  };

  // Sync the imperative panel ref to global state before the browser paints,
  // preventing a flash where the panel is visually open on a tab that has no response.
  useLayoutEffect(() => {
    if (ref.current) {
      if (rightPanelOpen && ref.current.isCollapsed()) {
        ref.current.expand();
      } else if (!rightPanelOpen && !ref.current.isCollapsed()) {
        ref.current.collapse();
      }
    }
  }, [rightPanelOpen]);

  // Keyboard shortcut: Cmd+Y — toggle response panel
  // In bottom mode: open the bottom panel and switch to sidebar (response) view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      if (matchesShortcut("ToggleResponsePanel", e)) {
        e.preventDefault();
        const { setBottomActiveView, openBottomPanel, bottomPanelRef, bottomActiveView } = usePanelStore.getState();
        const responsePanelPosition = getResponsePanelPosition();
        if (responsePanelPosition === "bottom") {
          if (bottomActiveView === "sidebar" && bottomPanelRef?.current && !bottomPanelRef.current.isCollapsed()) {
            // Already showing sidebar in open panel — collapse
            bottomPanelRef.current.collapse();
            usePanelStore.getState().closeBottomPanel();
          } else {
            setBottomActiveView("sidebar");
            if (bottomPanelRef?.current?.isCollapsed()) {
              bottomPanelRef.current.expand();
              openBottomPanel();
            }
          }
        } else {
          toggle();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const panelProps = {
    ref,
    collapsible: true,
    collapsedSize: 0,
    defaultSize,
    minSize,
    className: cn("", rightPanelOpen && "min-w-[200px]"),
  };

  return {
    ref,
    isCollapsed: !rightPanelOpen,
    toggle,
    open,
    panelProps,
  };
};
