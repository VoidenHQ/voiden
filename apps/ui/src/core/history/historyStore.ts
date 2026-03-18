import { create } from 'zustand';
import { HistoryEntry, HistoryEntryWithFile } from './types';

interface HistoryState {
  /** Entries currently displayed in the per-file sidebar */
  entries: HistoryEntry[];
  /** File path whose entries are loaded */
  currentFilePath: string | null;
  /** Set entries for a file */
  setEntries: (filePath: string, entries: HistoryEntry[]) => void;
  /** Clear the loaded entries */
  clearEntries: () => void;

  /** All entries across all files — used by the global history sidebar */
  allEntries: HistoryEntryWithFile[];
  /** Whether global entries are currently being loaded */
  allEntriesLoading: boolean;
  /** Set all entries (global) */
  setAllEntries: (entries: HistoryEntryWithFile[]) => void;
  /** Mark global entries as loading */
  setAllEntriesLoading: (loading: boolean) => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  currentFilePath: null,
  setEntries: (filePath, entries) => set({ entries, currentFilePath: filePath }),
  clearEntries: () => set({ entries: [], currentFilePath: null }),

  allEntries: [],
  allEntriesLoading: false,
  setAllEntries: (entries) => set({ allEntries: entries, allEntriesLoading: false }),
  setAllEntriesLoading: (loading) => set({ allEntriesLoading: loading }),
}));
