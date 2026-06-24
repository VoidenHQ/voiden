import { create } from 'zustand';

interface WhatsNewStore {
  /** Bumped whenever something (e.g. the top-bar button) asks the full changelog to open. */
  openSignal: number;
  /** Whether there's a release the user hasn't acknowledged yet — drives the badge dot. */
  hasUnseen: boolean;
  /** True while the fresh-install OnboardingModal is on screen — suppresses the spotlight toast. */
  onboardingActive: boolean;
  requestOpen: () => void;
  setHasUnseen: (value: boolean) => void;
  setOnboardingActive: (value: boolean) => void;
}

export const useWhatsNewStore = create<WhatsNewStore>((set) => ({
  openSignal: 0,
  hasUnseen: false,
  onboardingActive: false,
  requestOpen: () => set((s) => ({ openSignal: s.openSignal + 1 })),
  setHasUnseen: (value) => set({ hasUnseen: value }),
  setOnboardingActive: (value) => set({ onboardingActive: value }),
}));
