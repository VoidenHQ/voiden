import { create } from "zustand";

/** Where the left panel's tabs sit: a row above its content, or a vertical bar beside it (like VS Code's Activity Bar). */
export type SidebarTabsPosition = "top" | "side";

const STORAGE_KEY = "voiden:sidebar-tabs-position";

function readFromStorage(): SidebarTabsPosition {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "side") return "side";
  } catch {}
  return "top";
}

interface SidebarTabsPositionStore {
  position: SidebarTabsPosition;
  setPosition: (position: SidebarTabsPosition) => void;
  togglePosition: () => void;
}

export const useSidebarTabsPosition = create<SidebarTabsPositionStore>((set, get) => ({
  position: readFromStorage(),
  setPosition: (position) => {
    localStorage.setItem(STORAGE_KEY, position);
    set({ position });
  },
  togglePosition: () => get().setPosition(get().position === "top" ? "side" : "top"),
}));
