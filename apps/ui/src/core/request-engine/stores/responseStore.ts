import { create } from 'zustand';
import { persist } from "zustand/middleware";

export type ResponseNodeType =
  | "response-body"
  | "response-headers"
  | "request-headers"
  | "request-headers-security"
  | "request-body-sent"
  | "assertion-results"
  | "openapi-validation-results"
  | "script-assertion-results"
  | "";

interface SectionResponse {
  /** Response document (Voiden JSON) */
  responseDoc: any;

  /** Markdown representation of response */
  responseMarkdown: string | null;

  /** Error state for this section */
  error: string | null;

  /** Timestamp when the response was received */
  timestamp: number;
}

/** Legacy single-response format (for backward compat) */
interface TabResponse {
  responseDoc: any;
  responseMarkdown: string | null;
  error: string | null;
}

/**
 * Responses are stored per tab, per section index.
 * When a request from section N completes, it's stored at responses[tabId][sectionIndex].
 * This allows all section responses to be displayed stacked in the response panel.
 */
interface ResponseStore {
  /** Map of tab ID → section index → response data */
  responses: Record<string, Record<number, SectionResponse>>;

  /** Currently active tab ID for display */
  activeTabId: string | null;

  /** Tab ID of the currently executing request (to associate response with correct tab) */
  currentRequestTabId: string | null;

  /** Section index of the currently executing request */
  currentRequestSectionIndex: number | null;

  /** Loading state (global, since only one request can run at a time) */
  isLoading: boolean;

  /** Last active response node per request tab */
  activeResponseNodeByTab: Record<string, ResponseNodeType>;

  /** Response panel outer scrollTop per tab */
  responsePanelScrollByTab: Record<string, number>;

  /** Inner code-scroller positions per response node, grouped by tab */
  responseNodeScrollByTab: Record<string, Record<string, number>>;

  /** Response body editor height per tab */
  responseBodyHeightByTab: Record<string, number>;

  /** Set response content for a specific tab and section */
  setResponse: (tabId: string, doc: any, markdown: string | null) => void;
  /** Hydrate response content for a tab without mutating loading/request state */
  hydrateResponse: (tabId: string, doc: any, markdown: string | null) => void;

  /** Get all section responses for a tab, sorted by section index */
  getResponsesForTab: (tabId: string) => Array<{ sectionIndex: number; response: SectionResponse }>;

  /** Get single response (latest or by section) — backward compat */
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

  /** Persist outer response panel scrollTop per tab */
  setResponsePanelScrollForTab: (tabId: string, scrollTop: number) => void;

  /** Read outer response panel scrollTop per tab */
  getResponsePanelScrollForTab: (tabId: string) => number;

  /** Persist inner response-node scrollTop per tab+nodeKey */
  setResponseNodeScrollForTab: (tabId: string, nodeKey: string, scrollTop: number) => void;

  /** Read inner response-node scroll map for a tab */
  getResponseNodeScrollsForTab: (tabId: string) => Record<string, number>;

  /** Persist response body editor height per tab */
  setResponseBodyHeightForTab: (tabId: string, height: number) => void;

  /** Read response body editor height for a tab */
  getResponseBodyHeightForTab: (tabId: string) => number | null;
}

/**
 * Extract section index from a response document.
 * Falls back to 0 if not found.
 */
function extractSectionIndex(doc: any): number {
  // Check doc-level attrs
  if (doc?.attrs?.sectionIndex !== undefined) {
    return doc.attrs.sectionIndex;
  }
  // Check inside content for response-doc node
  if (doc?.content) {
    for (const node of doc.content) {
      if (node.type === "response-doc" && node.attrs?.sectionIndex !== undefined) {
        return node.attrs.sectionIndex;
      }
    }
  }
  return 0;
}

/**
 * Get the "latest" response for a tab — the most recently updated section.
 * Used for backward-compat APIs that expect a single response.
 */
function getLatestResponse(sections: Record<number, SectionResponse>): SectionResponse | null {
  const keys = Object.keys(sections).map(Number);
  if (keys.length === 0) return null;
  // Return the response with the highest section index (or just the first)
  const lastKey = Math.max(...keys);
  return sections[lastKey] || null;
}

export const useResponseStore = create<ResponseStore>()(
  persist(
    (set, get) => ({
      responses: {},
      activeTabId: null,
      currentRequestTabId: null,
      currentRequestSectionIndex: null,
      isLoading: false,
      activeResponseNodeByTab: {},
      responsePanelScrollByTab: {},
      responseNodeScrollByTab: {},
      responseBodyHeightByTab: {},

      setResponse: (tabId, doc, markdown) => {
        const sectionIndex = extractSectionIndex(doc);
        set((state) => ({
          responses: {
            ...state.responses,
            [tabId]: {
              ...(state.responses[tabId] || {}),
              [sectionIndex]: {
                responseDoc: doc,
                responseMarkdown: markdown,
                error: null,
                timestamp: Date.now(),
              },
            },
          },
          isLoading: false,
          currentRequestTabId: null,
          currentRequestSectionIndex: null,
        }));
      },

      hydrateResponse: (tabId, doc, markdown) => {
        const sectionIndex = extractSectionIndex(doc);
        set((state) => ({
          responses: {
            ...state.responses,
            [tabId]: {
              ...(state.responses[tabId] || {}),
              [sectionIndex]: {
                responseDoc: doc,
                responseMarkdown: markdown,
                error: null,
                timestamp: Date.now(),
              },
            },
          },
        }));
      },

      getResponsesForTab: (tabId) => {
        const state = get();
        const sections = state.responses[tabId];
        if (!sections) return [];
        return Object.entries(sections)
          .map(([key, response]) => ({
            sectionIndex: Number(key),
            response,
          }))
          .sort((a, b) => a.sectionIndex - b.sectionIndex);
      },

      getResponse: (tabId) => {
        const state = get();
        const sections = state.responses[tabId];
        if (!sections) return null;
        return getLatestResponse(sections);
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
        currentRequestSectionIndex: null,
      }),

      setActiveTabId: (tabId) => set({ activeTabId: tabId }),

      setCurrentRequestTabId: (tabId) => set({ currentRequestTabId: tabId }),

      setLoading: (loading, tabId) => set({
        isLoading: loading,
        currentRequestTabId: loading ? (tabId ?? null) : null,
      }),

      setError: (tabId, error) => {
        if (!tabId) {
          set({ isLoading: false, currentRequestTabId: null, currentRequestSectionIndex: null });
          return;
        }

        // Store error in the currently executing section, or section 0
        const sectionIndex = get().currentRequestSectionIndex ?? 0;
        set((state) => ({
          responses: {
            ...state.responses,
            [tabId]: {
              ...(state.responses[tabId] || {}),
              [sectionIndex]: {
                ...(state.responses[tabId]?.[sectionIndex] || { responseDoc: null, responseMarkdown: null }),
                error,
              },
            },
          },
          isLoading: false,
          currentRequestTabId: null,
          currentRequestSectionIndex: null,
        }));
      },

      getCurrentResponse: () => {
        const state = get();
        if (!state.activeTabId) return null;
        const sections = state.responses[state.activeTabId];
        if (!sections) return null;
        return getLatestResponse(sections);
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

      setResponsePanelScrollForTab: (tabId, scrollTop) =>
        set((state) => ({
          responsePanelScrollByTab: {
            ...state.responsePanelScrollByTab,
            [tabId]: scrollTop,
          },
        })),

      getResponsePanelScrollForTab: (tabId) => {
        const state = get();
        return state.responsePanelScrollByTab[tabId] ?? 0;
      },

      setResponseNodeScrollForTab: (tabId, nodeKey, scrollTop) =>
        set((state) => ({
          responseNodeScrollByTab: {
            ...state.responseNodeScrollByTab,
            [tabId]: {
              ...(state.responseNodeScrollByTab[tabId] || {}),
              [nodeKey]: scrollTop,
            },
          },
        })),

      getResponseNodeScrollsForTab: (tabId) => {
        const state = get();
        return state.responseNodeScrollByTab[tabId] || {};
      },

      setResponseBodyHeightForTab: (tabId, height) =>
        set((state) => ({
          responseBodyHeightByTab: {
            ...state.responseBodyHeightByTab,
            [tabId]: height,
          },
        })),

      getResponseBodyHeightForTab: (tabId) => {
        const state = get();
        return state.responseBodyHeightByTab[tabId] ?? null;
      },
    }),
    {
      name: "response-store-v3",
      partialize: (state) => ({
        activeResponseNodeByTab: state.activeResponseNodeByTab,
        responsePanelScrollByTab: state.responsePanelScrollByTab,
        responseNodeScrollByTab: state.responseNodeScrollByTab,
        responseBodyHeightByTab: state.responseBodyHeightByTab,
      }),
    },
  ),
);
