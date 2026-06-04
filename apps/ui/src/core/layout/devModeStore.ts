import { create } from "zustand";

interface DevModeStore {
  isDevMode: boolean;
  setDevMode: (on: boolean) => void;
}

export const useDevModeStore = create<DevModeStore>((set) => ({
  isDevMode: false,
  setDevMode: (on) => set({ isDevMode: on }),
}));
