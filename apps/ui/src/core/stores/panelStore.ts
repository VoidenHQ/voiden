import { create } from "zustand";
import { ImperativePanelHandle } from "react-resizable-panels";

export type BottomActiveView = "terminal" | "sidebar";

type PanelStore = {
  leftPanelOpen: boolean;
  openLeftPanel: () => void;
  closeLeftPanel: () => void;
  leftPanelRef: React.RefObject<ImperativePanelHandle> | null;
  setLeftPanelRef: (ref: React.RefObject<ImperativePanelHandle>) => void;
  rightPanelOpen: boolean;
  openRightPanel: () => void;
  closeRightPanel: () => void;
  bottomPanelOpen: boolean;
  openBottomPanel: () => void;
  closeBottomPanel: () => void;
  bottomPanelRef: React.RefObject<ImperativePanelHandle> | null;
  setBottomPanelRef: (ref: React.RefObject<ImperativePanelHandle>) => void;
  rightPanelRef: React.RefObject<ImperativePanelHandle> | null;
  setRightPanelRef: (ref: React.RefObject<ImperativePanelHandle>) => void;
  bottomActiveView: BottomActiveView;
  setBottomActiveView: (view: BottomActiveView) => void;
  /** True when the bottom panel was explicitly opened via the terminal toggle. */
  bottomOpenedByTerminal: boolean;
  setBottomOpenedByTerminal: (value: boolean) => void;
};

export const usePanelStore = create<PanelStore>((set) => ({
  leftPanelOpen: false,
  openLeftPanel: () => set({ leftPanelOpen: true }),
  closeLeftPanel: () => set({ leftPanelOpen: false }),
  leftPanelRef: null,
  setLeftPanelRef: (ref) => set({ leftPanelRef: ref }),
  rightPanelOpen: false,
  openRightPanel: () => set({ rightPanelOpen: true }),
  closeRightPanel: () => set({ rightPanelOpen: false }),
  bottomPanelOpen: false,
  openBottomPanel: () => set({ bottomPanelOpen: true }),
  closeBottomPanel: () => set({ bottomPanelOpen: false }),
  bottomPanelRef: null,
  setBottomPanelRef: (ref) => set({ bottomPanelRef: ref }),
  rightPanelRef: null,
  setRightPanelRef: (ref) => set({ rightPanelRef: ref }),
  bottomActiveView: "sidebar",
  setBottomActiveView: (view) => set({ bottomActiveView: view }),
  bottomOpenedByTerminal: false,
  setBottomOpenedByTerminal: (value) => set({ bottomOpenedByTerminal: value }),
}));
