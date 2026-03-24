import { create } from "zustand";
import { ImperativePanelHandle } from "react-resizable-panels";

export type ResponsePanelPosition = "right" | "bottom";
export type BottomActiveView = "terminal" | "sidebar";

const RESPONSE_PANEL_POSITION_KEY = "voiden:response-panel-position";

type PanelStore = {
  rightPanelOpen: boolean;
  openRightPanel: () => void;
  closeRightPanel: () => void;
  bottomPanelOpen: boolean;
  openBottomPanel: () => void;
  closeBottomPanel: () => void;
  bottomPanelRef: React.RefObject<ImperativePanelHandle> | null;
  setBottomPanelRef: (ref: React.RefObject<ImperativePanelHandle>) => void;
  responsePanelPosition: ResponsePanelPosition;
  setResponsePanelPosition: (position: ResponsePanelPosition) => void;
  toggleResponsePanelPosition: () => void;
  bottomActiveView: BottomActiveView;
  setBottomActiveView: (view: BottomActiveView) => void;
};

const getStoredPosition = (): ResponsePanelPosition => {
  try {
    const stored = localStorage.getItem(RESPONSE_PANEL_POSITION_KEY);
    if (stored === "right" || stored === "bottom") return stored;
  } catch {}
  return "right";
};

export const usePanelStore = create<PanelStore>((set, get) => ({
  rightPanelOpen: false,
  openRightPanel: () => set({ rightPanelOpen: true }),
  closeRightPanel: () => set({ rightPanelOpen: false }),
  bottomPanelOpen: false,
  openBottomPanel: () => set({ bottomPanelOpen: true }),
  closeBottomPanel: () => set({ bottomPanelOpen: false }),
  bottomPanelRef: null,
  setBottomPanelRef: (ref) => set({ bottomPanelRef: ref }),
  responsePanelPosition: getStoredPosition(),
  setResponsePanelPosition: (position) => {
    localStorage.setItem(RESPONSE_PANEL_POSITION_KEY, position);
    set({ responsePanelPosition: position });
  },
  toggleResponsePanelPosition: () => {
    const next = get().responsePanelPosition === "right" ? "bottom" : "right";
    localStorage.setItem(RESPONSE_PANEL_POSITION_KEY, next);
    set({ responsePanelPosition: next });
  },
  bottomActiveView: "terminal",
  setBottomActiveView: (view) => set({ bottomActiveView: view }),
}));
