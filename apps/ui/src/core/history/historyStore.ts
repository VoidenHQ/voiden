import { create } from 'zustand';
import { HistoryEntry } from './types';

interface HistoryState {
  /** Entries currently displayed in the sidebar */
  entries: HistoryEntry[];
  /** File path whose entries are loaded */
  currentFilePath: string | null;
  /** Set entries for a file */
  setEntries: (filePath: string, entries: HistoryEntry[]) => void;
  /** Clear the loaded entries */
  clearEntries: () => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  currentFilePath: null,
  setEntries: (filePath, entries) => set({ entries, currentFilePath: filePath }),
  clearEntries: () => set({ entries: [], currentFilePath: null }),
}));
