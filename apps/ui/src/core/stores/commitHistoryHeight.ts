import { create } from "zustand";

/**
 * Height the user dragged the Commit History panel to, in px. Null means
 * "auto": fit the commits, up to the default cap. Remembered across restarts.
 */
const STORAGE_KEY = "voiden:commit-history-height";

function readFromStorage(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeToStorage(height: number | null) {
  try {
    if (height === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Storage can be unavailable; the height then only lasts for this session.
  }
}

interface CommitHistoryHeightStore {
  height: number | null;
  setHeight: (height: number | null) => void;
}

export const useCommitHistoryHeight = create<CommitHistoryHeightStore>((set) => ({
  height: readFromStorage(),
  setHeight: (height) => {
    writeToStorage(height);
    set({ height });
  },
}));
