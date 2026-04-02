// blockContentStore.ts
import { create } from "zustand";

export interface BlockContentStore {
  blocks: Record<string, any>;
  setBlock: (uid: string, block: any) => void;
  getBlock: (uid: string) => any;
  removeBlock: (uid: string) => void;
  clearBlocks: () => void;
}

export const useBlockContentStore = create<BlockContentStore>((set, get) => ({
  blocks: {},
  setBlock: (uid, block) => set((state) => ({ blocks: { ...state.blocks, [uid]: block } })),
  getBlock: (uid) => get().blocks[uid],
  removeBlock: (uid: string) =>
    set((state) => {
      const newBlocks = { ...state.blocks };
      delete newBlocks[uid];
      return { blocks: newBlocks };
    }),
  clearBlocks: () => set({ blocks: {} }),
}));
