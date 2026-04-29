import { create } from "zustand";

interface SearchStore {
    isSearching: boolean;
    openTick: number;
    setIsSearching: (searching: boolean | ((prev: boolean) => boolean)) => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
    isSearching: false,
    openTick: 0,
    setIsSearching: (searching) => set((s) => {
        const next = typeof searching === "function" ? searching(s.isSearching) : searching;
        return { isSearching: next, openTick: next ? s.openTick + 1 : s.openTick };
    }),
}));
