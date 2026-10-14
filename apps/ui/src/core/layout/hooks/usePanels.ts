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

// Whether the user is dragging the handle beside a panel right now. The
// library also reports a collapse or an expand when a layout is first laid
// out and when the app collapses a panel itself; only the ones the user causes
// by dragging should change the open/closed state in the store.
const dragging = { right: false, bottom: false };

export const setPanelDragging = (panel: keyof typeof dragging, value: boolean) => {
  dragging[panel] = value;
};

// The largest share of its group a pixel minimum may claim, so the panel next
// to it always keeps some room in a small window.
const MAX_MIN_SIZE = 70;

/**
 * A panel's smallest size is a pixel width (or height), but the resize library
 * only takes percentages of the panel group. This turns one into the other and
 * keeps it right as the group is resized. Attach `groupRef` to an element the
 * same size as the PanelGroup.
 *
 * Enforcing the pixel size with a CSS min-width instead makes the two disagree:
 * the library keeps shrinking a panel that CSS holds in place, so the handle
 * stops following the cursor and the layout jumps.
 */
export const usePixelMinSize = (minPixels: number, minPercent: number, direction: "horizontal" | "vertical") => {
  const groupRef = useRef<HTMLDivElement>(null);
  const [minSize, setMinSize] = useState(minPercent);

  useLayoutEffect(() => {
    const element = groupRef.current;
    if (!element) return;
    const update = () => {
      const total = direction === "horizontal" ? element.clientWidth : element.clientHeight;
      if (total <= 0) return;
      const percent = Math.min(MAX_MIN_SIZE, Math.max(minPercent, (minPixels / total) * 100));
      // Whole tenths, so a one-pixel change does not re-render the layout.
      setMinSize(Math.ceil(percent * 10) / 10);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minPixels, minPercent, direction]);

  return { groupRef, minSize };
};

export const BOTTOM_PANEL_MIN_PIXELS = 160;
export const RIGHT_PANEL_MIN_PIXELS = 300;

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

  const setLeftPanelRef = usePanelStore((state) => state.setLeftPanelRef);
  const openLeftPanel = usePanelStore((state) => state.openLeftPanel);
  const closeLeftPanel = usePanelStore((state) => state.closeLeftPanel);
  const leftPanelOpen = usePanelStore((state) => state.leftPanelOpen);

  // Register the ref so it can be opened imperatively from outside this component
  // (e.g. a toast action revealing the Plugins tab).
  useEffect(() => {
    setLeftPanelRef(ref);
  }, []);

  const toggle = () => {
    if (ref.current) {
      if (ref.current.isCollapsed()) {
        ref.current.expand();
        setIsCollapsed(false);
        openLeftPanel();
      } else {
        ref.current.collapse();
        setIsCollapsed(true);
        closeLeftPanel();
      }
    }
  };

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL, JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  // React to imperative opens requested via the global store (e.g. openLeftPanel()
  // called from outside this component) without fighting the toggle/keyboard-shortcut path.
  useEffect(() => {
    if (ref.current && leftPanelOpen && ref.current.isCollapsed()) {
      ref.current.expand();
      setIsCollapsed(false);
    }
  }, [leftPanelOpen]);

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
    className: cn("", !isCollapsed && "min-w-[200px]"),
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

export const useBottomPanel = ({ defaultSize = 0, minSize = 28, panelId = "bottom" }: UseBottomPanelProps = {} as UseBottomPanelProps) => {
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
    // Dragging the handle far enough collapses or re-opens the panel; keep the
    // store in step so the rest of the app knows. The pixel minimum is applied
    // by the layout through usePixelMinSize.
    onCollapse: () => {
      if (dragging.bottom) closeBottomPanel();
    },
    onExpand: () => {
      if (dragging.bottom) openBottomPanel();
    },
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
    // As for the bottom panel: see the note there.
    onCollapse: () => {
      if (dragging.right) closeRightPanel();
    },
    onExpand: () => {
      if (dragging.right) openRightPanel();
    },
  };

  return {
    ref,
    isCollapsed: !rightPanelOpen,
    toggle,
    open,
    panelProps,
  };
};
