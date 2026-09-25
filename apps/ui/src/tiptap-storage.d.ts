import "@tiptap/core";

// Tiptap 3 types `editor.storage` as an open `Storage` interface; declare the
// fields Voiden attaches to it (editor identity + slash-command storage).
declare module "@tiptap/core" {
  interface Storage {
    panelId: string;
    tabId: string;
    source: string;
    instanceId: string;
    scrollCleanup?: () => void;
    slashCommand: any;
  }
}
