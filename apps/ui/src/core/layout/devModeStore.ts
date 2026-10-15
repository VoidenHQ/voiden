import { create } from "zustand";

interface DevModeStore {
  isDevMode: boolean;
  setDevMode: (on: boolean) => void;
  /** Toolbar sits under the top-bar plugin button when docked; floats and can be dragged when not. */
  isToolbarDocked: boolean;
  setToolbarDocked: (docked: boolean) => void;
  /** Rebuild and reload the running plugin whenever its source changes. */
  isLiveReload: boolean;
  setLiveReload: (on: boolean) => void;
}

export const useDevModeStore = create<DevModeStore>((set) => ({
  isDevMode: false,
  setDevMode: (on) => set({ isDevMode: on }),
  isToolbarDocked: true,
  setToolbarDocked: (docked) => set({ isToolbarDocked: docked }),
  isLiveReload: true,
  setLiveReload: (on) => set({ isLiveReload: on }),
}));
