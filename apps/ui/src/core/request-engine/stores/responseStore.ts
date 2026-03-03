import { create } from 'zustand';
import { persist } from "zustand/middleware";

export type ResponseNodeType =
  | "response-body"
  | "response-headers"
  | "request-headers"
  | "request-headers-security"
  | "assertion-results"
  | "openapi-validation-results"
  | "script-assertion-results"
  | "";

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

  /** Last active response node per request tab */
  activeResponseNodeByTab: Record<string, ResponseNodeType>;

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

  /** Persist currently expanded response node per tab */
  setActiveResponseNodeForTab: (tabId: string, nodeType: ResponseNodeType) => void;

  /** Read persisted response node for a tab */
  getActiveResponseNodeForTab: (tabId: string) => ResponseNodeType | null;
}

export const useResponseStore = create<ResponseStore>()(
  persist(
    (set, get) => ({
      responses: {},
      activeTabId: null,
      currentRequestTabId: null,
      isLoading: false,
      activeResponseNodeByTab: {},

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

      setActiveResponseNodeForTab: (tabId, nodeType) =>
        set((state) => ({
          activeResponseNodeByTab: {
            ...state.activeResponseNodeByTab,
            [tabId]: nodeType,
          },
        })),

      getActiveResponseNodeForTab: (tabId) => {
        const state = get();
        return state.activeResponseNodeByTab[tabId] ?? null;
      },
    }),
    {
      name: "response-store-v2",
      partialize: (state) => ({
        activeResponseNodeByTab: state.activeResponseNodeByTab,
      }),
    },
  ),
);
