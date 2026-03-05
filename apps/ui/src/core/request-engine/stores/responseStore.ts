import { create } from 'zustand';

interface TabResponse {
  /** Response document (Voiden JSON) */
  responseDoc: any;

  /** Markdown representation of response */
  responseMarkdown: string | null;

  /** Error state for this tab */
  error: string | null;
}

interface ResponseStore {
  /** Map of tab ID to response data */
  responses: Record<string, TabResponse>;

  /** Currently active tab ID for display */
  activeTabId: string | null;

  /** Tab ID of the currently executing request (to associate response with correct tab) */
  currentRequestTabId: string | null;

  /** Loading state (global, since only one request can run at a time) */
  isLoading: boolean;

  /** Map of tab ID to list of open node types (for persisting collapsed state across tab switches) */
  openNodesMap: Record<string, string[]>;

  /** Set response content for a specific tab */
  setResponse: (tabId: string, doc: any, markdown: string | null) => void;

  /** Get response for a specific tab */
  getResponse: (tabId: string) => TabResponse | null;

  /** Clear response for a specific tab */
  clearResponse: (tabId: string) => void;

  /** Clear all responses */
  clearAllResponses: () => void;

  /** Set active tab ID */
  setActiveTabId: (tabId: string | null) => void;

  /** Set the tab ID for the current request */
  setCurrentRequestTabId: (tabId: string | null) => void;

  /** Set loading state and optionally the requesting tab ID */
  setLoading: (loading: boolean, tabId?: string | null) => void;

  /** Set error state for a specific tab */
  setError: (tabId: string | null, error: string | null) => void;

  /** Get current active response (convenience getter) */
  getCurrentResponse: () => TabResponse | null;

  /** Get open nodes for a tab (returns null if no persisted state) */
  getOpenNodes: (tabId: string) => string[] | null;

  /** Set open nodes for a tab */
  setOpenNodes: (tabId: string, openNodes: string[]) => void;
}

export const useResponseStore = create<ResponseStore>((set, get) => ({
  responses: {},
  activeTabId: null,
  currentRequestTabId: null,
  isLoading: false,
  openNodesMap: {},

  setResponse: (tabId, doc, markdown) => set((state) => ({
    responses: {
      ...state.responses,
      [tabId]: {
        responseDoc: doc,
        responseMarkdown: markdown,
        error: null,
      },
    },
    isLoading: false,
    currentRequestTabId: null, // Clear after response is stored
  })),

  getResponse: (tabId) => {
    const state = get();
    return state.responses[tabId] || null;
  },

  clearResponse: (tabId) => set((state) => {
    const newResponses = { ...state.responses };
    delete newResponses[tabId];
    return { responses: newResponses };
  }),

  clearAllResponses: () => set({
    responses: {},
    isLoading: false,
    currentRequestTabId: null,
  }),

  setActiveTabId: (tabId) => set({ activeTabId: tabId }),

  setCurrentRequestTabId: (tabId) => set({ currentRequestTabId: tabId }),

  setLoading: (loading, tabId) => set({
    isLoading: loading,
    currentRequestTabId: loading ? (tabId ?? null) : null,
  }),

  setError: (tabId, error) => {
    if (!tabId) {
      // Global error (no specific tab context)
      set({ isLoading: false, currentRequestTabId: null });
      return;
    }

    set((state) => ({
      responses: {
        ...state.responses,
        [tabId]: {
          ...(state.responses[tabId] || { responseDoc: null, responseMarkdown: null }),
          error,
        },
      },
      isLoading: false,
      currentRequestTabId: null,
    }));
  },

  getCurrentResponse: () => {
    const state = get();
    if (!state.activeTabId) return null;
    return state.responses[state.activeTabId] || null;
  },

  getOpenNodes: (tabId) => {
    const state = get();
    return state.openNodesMap[tabId] ?? null;
  },

  setOpenNodes: (tabId, openNodes) => set((state) => ({
    openNodesMap: {
      ...state.openNodesMap,
      [tabId]: openNodes,
    },
  })),
}));
