import { create } from "zustand";
import { EditorView } from "@codemirror/view";

interface CodeEditorState {
  activeEditor: {
    tabId: string | null;
    content: string;
    source: string | null;
    panelId: string | null;
    editor: EditorView | null;
  };
  // Per-tab content snapshots for streamable files so predicates (e.g. OpenAPI /
  // Postman buttons) survive tab switches without relying on activeEditor.tabId.
  streamSnapshots: Map<string, string>;
  setActiveEditor: (tabId: string, content: string, source: string, panelId: string) => void;
  clearActiveEditor: () => void;
  updateContent: (content: string) => void;
  setEditor: (editor: EditorView) => void;
  setStreamSnapshot: (tabId: string, content: string) => void;
}

export const useCodeEditorStore = create<CodeEditorState>((set) => ({
  activeEditor: {
    tabId: null,
    content: "",
    source: null,
    panelId: null,
    editor: null,
  },
  streamSnapshots: new Map(),
  setActiveEditor: (tabId, content, source, panelId) =>
    set((state) => ({
      activeEditor: {
        ...state.activeEditor,
        tabId,
        content,
        source,
        panelId,
      },
    })),
  clearActiveEditor: () => set({ activeEditor: { tabId: null, content: "", source: null, panelId: null, editor: null } }),
  updateContent: (content) =>
    set((state) => ({
      activeEditor: { ...state.activeEditor, content },
    })),
  setEditor: (editor) =>
    set((state) => ({
      activeEditor: { ...state.activeEditor, editor },
    })),
  setStreamSnapshot: (tabId, content) =>
    set((state) => {
      const next = new Map(state.streamSnapshots);
      next.set(tabId, content);
      return { streamSnapshots: next };
    }),
}));

// Export globally for extensions to access
if (typeof window !== 'undefined') {
  (window as any).__codeEditorStore = useCodeEditorStore;
}
