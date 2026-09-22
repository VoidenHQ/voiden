import { create } from "zustand";

/**
 * Explicit "the user just navigated to this file, reveal it in the explorer"
 * signal — set by an actual navigation action (Quick Open, a full-text
 * search result, ...), consumed once by FileSystemList's expand/scroll
 * effect, then cleared.
 *
 * This exists because the file tree used to force-expand every ancestor
 * folder and force-scroll to whatever the main panel's active tab happened
 * to be, on every change to that value — with no way to tell a deliberate
 * "user opened this file" from an incidental one (a tab closing as a side
 * effect of deleting a different file and some other tab becoming active,
 * an unrelated panel-tabs query invalidation resolving with a stale/racy
 * activeTabId, etc.). `["panel:tabs", "main"]` gets invalidated from dozens
 * of call sites across the app for reasons that have nothing to do with
 * "reveal this in the explorer", so keying the reveal off that value
 * directly meant the tree could jump/expand for no reason a user could
 * connect to anything they did. Row *selection* (highlighting the active
 * file) still tracks the active tab continuously — only the disruptive
 * expand+scroll behavior is gated on this explicit signal now.
 */
interface RevealInExplorerStore {
  pendingRevealPath: string | null;
  requestReveal: (path: string) => void;
  clearReveal: () => void;
}

export const useRevealInExplorerStore = create<RevealInExplorerStore>((set) => ({
  pendingRevealPath: null,
  requestReveal: (path) => set({ pendingRevealPath: path }),
  clearReveal: () => set({ pendingRevealPath: null }),
}));
