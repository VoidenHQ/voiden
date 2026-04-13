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
  editorViews: Map<string, EditorView>;
  streamSnapshots: Map<string, string>;
  setActiveEditor: (tabId: string, content: string, source: string, panelId: string) => void;
  clearActiveEditor: () => void;
  updateContent: (content: string) => void;
  setEditor: (editor: EditorView) => void;
  registerEditorView: (tabId: string, editor: EditorView) => void;
  unregisterEditorView: (tabId: string) => void;
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
  editorViews: new Map(),
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
  registerEditorView: (tabId, editor) =>
    set((state) => {
      const next = new Map(state.editorViews);
      next.set(tabId, editor);
      return { editorViews: next };
    }),
  unregisterEditorView: (tabId) =>
    set((state) => {
      const next = new Map(state.editorViews);
      next.delete(tabId);
      return { editorViews: next };
    }),
  setStreamSnapshot: (tabId, content) =>
    set((state) => {
      const next = new Map(state.streamSnapshots);
      next.set(tabId, content);
      return { streamSnapshots: next };
    }),
}));

if (typeof window !== 'undefined') {
  (window as any).__codeEditorStore = useCodeEditorStore;
}
