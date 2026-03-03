import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { AnyExtension, Editor, EditorContent, Extension, getSchema, useEditor } from "@tiptap/react";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
// Escape user input for literal searches
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Plugin to highlight all findTerm matches, with special highlight for current match
const findHighlightPluginKey = new PluginKey("findHighlight");
const findHighlightPlugin = new Plugin({
  key: findHighlightPluginKey,
  state: {
    init() {
      return DecorationSet.empty;
    },
    apply(tr, old, _oldState, newState) {
      const meta = tr.getMeta(findHighlightPluginKey);
      if (!meta || typeof meta !== "object") {
        return old.map(tr.mapping, newState.doc);
      }
      // Accept currentMatch in meta, default to -1 if not present
      const { term, matchCase, matchWholeWord, useRegex, currentMatch = -1 } = meta;
      if (!term) {
        return DecorationSet.empty;
      }
      // Build regex for finding all matches
      const rawPattern = useRegex ? term : escapeRegExp(term);
      const flags = matchCase ? "g" : "gi";
      let regex: RegExp;
      try {
        regex = new RegExp(rawPattern, flags);
      } catch {
        return DecorationSet.empty;
      }
      const decorations: Decoration[] = [];
      let matchIndex = 0;
      // Scan each text node for matches
      newState.doc.descendants((node, pos) => {
        if (node.isText && node.text) {
          let m: RegExpExecArray | null;
          while ((m = regex.exec(node.text)) !== null) {
            const start = pos + m.index;
            const end = start + m[0].length;
            let valid = true;
            if (matchWholeWord) {
              // Check left boundary
              const before = start > 0 ? newState.doc.textBetween(start - 1, start) : "";
              const after = end < newState.doc.content.size ? newState.doc.textBetween(end, end + 1) : "";
              const wordChar = /\w/;
              if ((before && wordChar.test(before)) || (after && wordChar.test(after))) {
                valid = false;
              }
            }
            if (valid) {
              decorations.push(
                Decoration.inline(start, end, {
                  style: matchIndex === currentMatch ? "background-color: rgba(255, 165, 0, 0.7);" : "background-color: rgba(255, 255, 0, 0.4);",
                }),
              );
              matchIndex++;
            }
            if (m.index === regex.lastIndex) regex.lastIndex++;
          }
        }
        return true;
      });
      return DecorationSet.create(newState.doc, decorations);
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

// Tiptap extension that adds our highlight plugin
const FindHighlightExtension = Extension.create({
  name: "findHighlight",
  addProseMirrorPlugins() {
    return [findHighlightPlugin];
  },
});
import { voidenExtensions } from "./extensions";
import Code from "@tiptap/extension-code";
import { InputRule } from "@tiptap/core";
import { preserveUnknownNodesInJSON, DocumentPreserver } from "./extensions/DocumentPreserver";

// Trigger code mark on typing two backticks
const CustomCode = Code.extend({
  name: "customCode",
  addInputRules() {
    return [
      new InputRule({
        find: /``$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          const markType = state.schema.marks.code;
          // Remove the two backticks
          tr.delete(range.from, range.to);
          // Activate code mark for new input
          tr.setStoredMarks([markType.create()]);
        },
      }),
    ];
  },
});
import { create } from "zustand";
import { useEditorEnhancementStore } from "@/plugins";
import { parseMarkdown } from "./markdownConverter";
import UniqueID from "./extensions/uniqueId";
import { VoidenDragMenu } from "./components/VoidenDragMenu";
import { useEnvironments, useActiveEnvironment } from "@/core/environment/hooks";
import { environmentHighlighter, updateEnvironmentData } from "./extensions/environmentHighlighter";
import { ReqSuggestion } from "./extensions/VariableReqSuggesion";
import { ResSuggestion } from "./extensions/VariableResSuggestion";
import { useContentStore } from "@/core/stores/ContentStore";
import { saveFileUtil } from "@/core/file-system/hooks";
import { ArrowDownIcon, ArrowUpIcon, X } from "lucide-react";
import { Input } from "@/core/components/ui/input";
import { cn } from "@/core/lib/utils";
import { variableHighlighter, updateVariableData } from "./extensions/variableHighlighter";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { usePanelStore } from "@/core/stores/panelStore";
import { useGetActiveDocument } from "@/core/documents/hooks";
import { useVoidVariableData } from "@/core/runtimeVariables/hook/useVariableCapture";

interface VoidenEditorStore {
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
  extensions: AnyExtension[];
  registerExtension: (extension: Extension) => void;
  filePath: string | null;
  setFilePath: (filePath: string) => void;
}

export const useVoidenEditorStore = create<VoidenEditorStore>((set) => ({
  editor: null,
  setEditor: (editor: Editor | null) => set({ editor }),
  filePath: null,
  setFilePath: (filePath: string) => set({ filePath }),
  extensions: [...voidenExtensions],
  registerExtension: (extension: Extension) => set((state) => ({ extensions: [...state.extensions, extension] })),
}));

export const useVoidenExtensionsAndSchema = () => {
  // Get voiden-wrapper extensions from your enhancements store.
  const voidenExtensionsFromStore = useEditorEnhancementStore((state) => state.voidenExtensions);

  // Build the "base" extensions list (without UniqueID yet).
  const memoizedExtensions = useMemo(() => [...voidenExtensions, ...voidenExtensionsFromStore], [voidenExtensionsFromStore]);

  // Compute the schema based on your current extensions.
  const memoizedSchema = useMemo(() => getSchema(memoizedExtensions), [memoizedExtensions]);

  const { data: voidVariableData = {} } = useVoidVariableData();
  const envData = useActiveEnvironment() ?? {};
  const defaultNodeTypes = useMemo(
    () => [
      "doc",
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "codeBlock",
      "horizontalRule",
      "text",
      "image",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
    ],
    [],
  );

  const customNodeTypes = useMemo(() => {
    return Object.keys(memoizedSchema.nodes).filter((nodeName) => !defaultNodeTypes.includes(nodeName));
  }, [memoizedSchema, defaultNodeTypes]);

  const uniqueIdExtension = useMemo(
    () =>
      UniqueID.configure({
        attributeName: "uid", // (optional) defaults to "id"
        types: customNodeTypes,
      }),
    [customNodeTypes],
  );

  // Now, instead of mutating the array, create a new array that conditionally includes the environment extension.
  const finalExtensions = useMemo(() => {
    const baseExtensions = [
      ...memoizedExtensions,
      uniqueIdExtension,
      CustomCode,
      ReqSuggestion,
      ResSuggestion,
      environmentHighlighter(envData),
      variableHighlighter(voidVariableData),
      DocumentPreserver, // Preserves unknown nodes from disabled plugins
    ];
    return baseExtensions;
  }, [memoizedExtensions, uniqueIdExtension, envData, voidVariableData]);

  return { finalExtensions, memoizedSchema };
};

export const proseClasses = [
  // Base styles
  "space-y-4",

  // Headings - using centralized typography from styles.css
  "prose-h1:text-4xl prose-h1:font-semibold prose-h1:tracking-tight prose-h1:mt-0 prose-h1:mb-1",
  "prose-h2:text-3xl prose-h2:font-semibold prose-h2:tracking-tight prose-h2:mt-0 prose-h2:mb-1",
  "prose-h3:text-2xl prose-h3:font-semibold prose-h3:tracking-tight prose-h3:mt-0 prose-h3:mb-1",
  "prose-h4:text-xl prose-h4:font-semibold prose-h4:tracking-tight prose-h4:mt-0 prose-h4:mb-1",

  // Text elements - using centralized typography
  "prose-p:text-text text-base prose-p:mb-1",
  "prose-strong:font-semibold",
  "prose-em:italic",

  // Lists
  "prose-ul:text-comment prose-ul:mb-1 prose-ul:list-disc prose-ul:pl-4",
  "prose-ol:text-comment prose-ol:mb-1 prose-ol:list-decimal prose-ol:pl-4",
  "prose-li:my-0.5 prose-li:text-text",

  // Code
  "prose-pre:bg-bg prose-pre:border prose-pre:border-border prose-pre:mb-1 prose-pre:px-1 prose-pre:py-0.5",
  "prose-code:text-accent prose-code:font-mono",

  // Links
  "prose-a:text-accent prose-a:no-underline hover:prose-a:text-orange-400 prose-a:cursor-pointer",

  // Blockquotes
  "prose-blockquote:border-accent/30 prose-blockquote:bg-bg prose-blockquote:mb-1 prose-blockquote:text-comment",

  // Tables
  "prose-table:border-border",
  "prose-th:text-white prose-th:font-semibold prose-th:p-2 prose-th:border prose-th:border-light prose-th:bg-bg",
  "prose-td:text-comment prose-td:p-2 prose-td:border prose-td:border-light",
  "[&_table]:w-full [&_table]:w-full",
  "[&_table]:border-collapse",
  "[&_table]:border [&_table]:border-light", // Add border to table
  "[&_th]:border [&_th]:border-light [&_th]:p-2 [&_th]:text-text",
  "[&_td]:border [&_td]:border-light [&_td]:p-2 [&_td]:text-text",
  "[&_td]:text-base",

  // Horizontal rules
  "prose-hr:border-border",

  // Figures
  "prose-figure:my-4",
  "prose-figcaption:text-comment prose-figcaption:text-sm",

  // Description lists
  "prose-dt:text-text prose-dt:font-semibold prose-dt:mb-1",
  "prose-dd:text-comment prose-dd:ml-4 prose-dd:mb-1",

  // Images
  "prose-img:rounded prose-img:border prose-img:border-border",

  // Custom elements
  "prose-kbd:bg-bg prose-kbd:text-comment prose-kbd:px-1 prose-kbd:border prose-kbd:border-border prose-kbd:rounded",
  "prose-mark:bg-accent/20",

  // Small text
  "prose-small:text-comment",
].join(" ");

interface EditorStore {
  unsaved: Record<string, string>;
  setUnsaved: (tabId: string, content: string) => void;
  clearUnsaved: (tabId: string) => void;
  // Store reload functions for each tab
  reloadFunctions: Record<string, () => Promise<void>>;
  registerReload: (tabId: string, reloadFn: () => Promise<void>) => void;
  unregisterReload: (tabId: string) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  unsaved: {},
  setUnsaved: (tabId, content) => set((state) => ({ unsaved: { ...state.unsaved, [tabId]: content } })),
  clearUnsaved: (tabId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [tabId]: _, ...rest } = state.unsaved;
      return { unsaved: rest };
    }),
  reloadFunctions: {},
  registerReload: (tabId, reloadFn) =>
    set((state) => ({ reloadFunctions: { ...state.reloadFunctions, [tabId]: reloadFn } })),
  unregisterReload: (tabId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [tabId]: _, ...rest } = state.reloadFunctions;
      return { reloadFunctions: rest };
    }),
}));

// Helper function to reload a specific tab
export const reloadVoidenEditor = async (tabId: string) => {
  const reloadFn = useEditorStore.getState().reloadFunctions[tabId];
  if (reloadFn) {
    await reloadFn();
  }
};

export const VoidenEditor = ({
  tabId,
  content,
  source,
  panelId,
  hasSearch,
}: {
  tabId: string;
  content: string;
  source: string;
  panelId: string;
  hasSearch: boolean;
}) => {

  const editorRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionRef = useRef<number>(0);
  const setUnsaved = useEditorStore((state) => state.setUnsaved);
  const clearUnsaved = useEditorStore((state) => state.clearUnsaved);
  const { finalExtensions, memoizedSchema } = useVoidenExtensionsAndSchema();
  const { data: envData } = useEnvironments();
  const activeEnvKey = envData?.activeEnv ?? "default";
  const extensionsKey = useMemo(() => finalExtensions.map((ext) => ext.name).join(","), [finalExtensions]);
  const { data: activeDocument } = useGetActiveDocument();
  const { openRightPanel } = usePanelStore();

  // Track previous extensionsKey to detect when plugins change
  const prevExtensionsKeyRef = useRef<string | null>(null);

  // When plugins change, clear unsaved state to force reload from file
  const initialUnsaved = useMemo(() => {
    const currentExtensionsKey = extensionsKey;
    const prevExtensionsKey = prevExtensionsKeyRef.current;

    // If extensions changed, clear unsaved and force reload from file
    if (prevExtensionsKey !== null && prevExtensionsKey !== currentExtensionsKey) {
      // Clear from store
      clearUnsaved(tabId);
      // Update ref for next check
      prevExtensionsKeyRef.current = currentExtensionsKey;
      // Return undefined to force reload from file
      return undefined;
    }

    // First render or no change - use normal unsaved state
    if (prevExtensionsKey === null) {
      prevExtensionsKeyRef.current = currentExtensionsKey;
    }

    return useEditorStore.getState().unsaved[tabId];
  }, [tabId, extensionsKey, clearUnsaved]);

  useEffect(() => {
    // Always update the store with the new content, or an empty string if undefined.
    useContentStore.getState().updateContent(content || "");
  }, [content]);

  // Find & Replace state
  const [showFind, setShowFind] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [matchPositions, setMatchPositions] = useState<{ from: number; to: number }[]>([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [matchCase, setMatchCase] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const [useRegex] = useState(false);
  const [showReplaceSection, setShowReplaceSection] = useState(true);

  // Sync search state to global store
  const setGlobalTerm = useSearchStore((state) => state.setTerm);
  const setGlobalMatchCase = useSearchStore((state) => state.setMatchCase);
  useEffect(() => {
    setGlobalTerm(findTerm);
  }, [findTerm]);
  useEffect(() => {
    setGlobalMatchCase(matchCase);
  }, [matchCase]);
  // Sync matchWholeWord to global store
  const setGlobalMatchWholeWord = useSearchStore((state) => state.setMatchWholeWord);
  useEffect(() => {
    setGlobalMatchWholeWord(matchWholeWord);
  }, [matchWholeWord]);
  // Sync useRegex to global store (if you need it)
  const setGlobalUseRegex = useSearchStore((state) => state.setUseRegex);
  useEffect(() => {
    setGlobalUseRegex(useRegex);
  }, [useRegex]);

  // Platform-aware shortcuts for find and replace
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor (it has its own search)
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      const key = e.key.toLowerCase();
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+F: Open find (without replace)
      if (mod && key === "f" && hasSearch && !e.shiftKey) {
        e.preventDefault();
        setShowFind(true);
        setShowReplaceSection(false);
        return;
      }

      // Cmd/Ctrl+H: Open find and replace
      if (mod && key === "h" && hasSearch) {
        e.preventDefault();
        setShowFind(true);
        setShowReplaceSection(true);
        return;
      }

      // Cmd/Ctrl+G: Find next (only when find panel is open)
      if (mod && key === "g" && showFind && !e.shiftKey) {
        e.preventDefault();
        // Find next logic inline - editor will be accessed from closure
        const currentEditor = useVoidenEditorStore.getState().editor;
        if (matchPositions.length > 0 && currentEditor) {
          const nextIndex = (currentMatch + 1) % matchPositions.length;
          const { from, to } = matchPositions[nextIndex];
          currentEditor.commands.setTextSelection({ from, to });
          currentEditor.commands.focus();
          setCurrentMatch(nextIndex);
          const meta = { term: findTerm, matchCase, matchWholeWord, useRegex, currentMatch: nextIndex };
          currentEditor.view.dispatch(currentEditor.state.tr.setMeta(findHighlightPluginKey, meta));
        }
        return;
      }

      // Shift+Cmd/Ctrl+G: Find previous (only when find panel is open)
      if (mod && key === "g" && showFind && e.shiftKey) {
        e.preventDefault();
        // Find previous logic inline - editor will be accessed from closure
        const currentEditor = useVoidenEditorStore.getState().editor;
        if (matchPositions.length > 0 && currentEditor) {
          const prevIndex = (currentMatch - 1 + matchPositions.length) % matchPositions.length;
          const { from, to } = matchPositions[prevIndex];
          currentEditor.commands.setTextSelection({ from, to });
          currentEditor.commands.focus();
          setCurrentMatch(prevIndex);
          const meta = { term: findTerm, matchCase, matchWholeWord, useRegex, currentMatch: prevIndex };
          currentEditor.view.dispatch(currentEditor.state.tr.setMeta(findHighlightPluginKey, meta));
        }
        return;
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isMac, hasSearch, showFind, matchPositions, currentMatch, findTerm, matchCase, matchWholeWord, useRegex]);

  // Cmd+Enter to execute request is now handled by SendRequestButton component via useHotkeys
  // Removed duplicate keyboard handler to prevent double request execution

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showFind) {
        setShowFind(false);
        setShowReplaceSection(false);
        setFindTerm(""); // Clear search term
        setReplaceTerm(""); // Clear replace term
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showFind]);

  // Handle Cmd+S to save file and prevent duplicate saves
  useEffect(() => {
    const handleSave = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      const key = e.key.toLowerCase();
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && key === "s") {
        // Prevent the event from reaching the Electron menu system
        e.preventDefault();
        e.stopPropagation();

        // Trigger the save directly
        const currentEditor = useVoidenEditorStore.getState().editor;
        if (currentEditor) {
          const content = JSON.stringify(currentEditor.getJSON());
          const path = useVoidenEditorStore.getState().filePath;
          const panelId = currentEditor.storage.panelId;
          const tabId = currentEditor.storage.tabId;
          saveFileUtil(path, content, panelId, tabId, currentEditor.schema).catch(console.error);
        }
      }
    };
    window.addEventListener("keydown", handleSave, true); // Use capture phase
    return () => {
      window.removeEventListener("keydown", handleSave, true);
    };
  }, [isMac]);

  // Focus input when toolbar opens or search term changes
  useEffect(() => {
    if (showFind && findInputRef.current) {
      findInputRef.current.focus();
    }
  }, [showFind, findTerm]);


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeDoc(node: any): any {
    if (!node || typeof node !== "object") return node;

    // Fix invalid paragraph content set as number
    if (
      node.type === "paragraph" &&
      typeof node.content === "number"
    ) {
      node.content = [
        {
          type: "text",
          text: String(node.content)
        }
      ];
    }

    // Remove invalid text nodes
    if (node.type === "text" && (!node.text || (typeof node.text==='string' && node.text.trim() === "") )) {
      return null;
    }

    // Recursively sanitize child nodes
    if (Array.isArray(node.content)) {
      node.content = node.content
        .map(sanitizeDoc)
        .filter(Boolean);
    }

    return node;
  }

  // Only initialize the editor if we have valid initial content.
  // (editor is used below in useEffect, so we want it defined before)
  // Move validation logic into a pure function
  const validateAndParseContent = useCallback(
    (content: string, unsavedContent: string | undefined) => {
      // If there is no unsaved content and the provided content is empty, return empty doc
      if (!unsavedContent && content.trim() === "") {
        return { type: "doc", content: [] };
      }

      try {
        const parsed = unsavedContent ? JSON.parse(unsavedContent) : parseMarkdown(content, memoizedSchema);
        // Validate the parsed content
        try {
            const cleaned = sanitizeDoc(parsed); // 🧼 clean it

            // CRITICAL: Preserve unknown nodes before validation
            // This wraps data from disabled plugins so it's not lost
            const preserved = preserveUnknownNodesInJSON(cleaned, memoizedSchema);

            memoizedSchema.nodeFromJSON(preserved);
            return preserved;
          } catch (e) {
            // Instead of crashing, return a safe fallback document
            return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] };
          }
      } catch (err) {
        // Instead of crashing, return a safe fallback document
        return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] };
      }
    },
    [memoizedSchema],
  );

  const initialContent = useMemo(() => validateAndParseContent(content, initialUnsaved), [content, initialUnsaved, validateAndParseContent]);

  // Stores the JSON string of the document as it exists on disk, so we can
  // detect when edits restore the document back to its saved state.
  // Updated whenever the `content` prop changes (e.g. after save + query re-fetch).
  const savedContentJSONRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      console.error("expensive operation")
      const parsed = parseMarkdown(content, memoizedSchema);
      const sanitized = sanitizeDoc(parsed);
      const node = memoizedSchema.nodeFromJSON(sanitized);
      savedContentJSONRef.current = JSON.stringify(node.toJSON());
    } catch {
      savedContentJSONRef.current = null;
    }
  }, [content, memoizedSchema]);

  const handleEditorCreate = useCallback(
    ({ editor }: { editor: Editor }) => {
      try {
        useVoidenEditorStore.getState().setEditor(editor);
        useVoidenEditorStore.getState().setFilePath(source);

        // Set the editor in the store
        editor.storage.panelId = panelId;
        editor.storage.tabId = tabId;
        editor.storage.instanceId = crypto.randomUUID();

        const unsaved = useEditorStore.getState().unsaved[tabId];
        
        try {
          const savedContent = parseMarkdown(content, memoizedSchema);
          const santizedContent = sanitizeDoc(savedContent);

          if (unsaved) {
            const parsedUnsaved = JSON.parse(unsaved);
            if (JSON.stringify(parsedUnsaved) !== JSON.stringify(savedContent)) {
              editor.commands.setContent(parsedUnsaved, false);
            }
          } else {
            editor.commands.setContent(santizedContent, false);
          }
        } catch (parseError) {
          // Set a safe fallback content instead of destroying the editor
          const fallbackContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] };
          editor.commands.setContent(fallbackContent, false);
        }

        // After setContent, ProseMirror leaves the selection at position 0 (before
        // the first block node), which visually selects the first character.
        // Explicitly collapse the cursor to the start of the document.
        requestAnimationFrame(() => {
          if (!editor.isDestroyed) {
            editor.commands.setTextSelection(1);
          }
        });
      } catch (e) {
        // Set a safe fallback content instead of destroying the editor
        const fallbackContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] };
        editor.commands.setContent(fallbackContent, false);
      }

    },
    [source, panelId, tabId, content, memoizedSchema],
  );

  const handleEditorUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      const updatedContent = editor.getJSON();
      const contentString = JSON.stringify(updatedContent);

      // Compare against saved content to detect when edits restore the original
      if (savedContentJSONRef.current && contentString === savedContentJSONRef.current) {
        clearUnsaved(tabId);
      } else {
        setUnsaved(tabId, contentString);
      }

      // Auto-save to AppData for unsaved files (source is null)
      if (!source) {
        // Debounce the auto-save to avoid excessive writes
        if (window.electron?.autosave?.save) {
          window.electron.autosave.save(tabId, contentString).catch(console.error);
        }
      }
    },
    [setUnsaved, clearUnsaved, tabId, source],
  );

  const editor = useEditor(
    {
      autofocus: content.length === 0 ? 'end' : false,
      content: initialContent,
      editorProps: {
        attributes: {
          class: `${proseClasses} outline-none px-5`,
        },
      },
      onCreate: handleEditorCreate,
      onUpdate: handleEditorUpdate,
      onDestroy: () => {
        const currentEditor = useVoidenEditorStore.getState().editor;
        if (currentEditor && currentEditor.storage.instanceId === editor.storage.instanceId) {
          useVoidenEditorStore.getState().setEditor(null);
        }
      },
      extensions: [...finalExtensions, FindHighlightExtension],
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [extensionsKey],
  );

  // Separate effect for environment changes - debounced to avoid conflicts during modal unmount
  const [debouncedActiveEnvKey, setDebouncedActiveEnvKey] = useState(activeEnvKey);
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedActiveEnvKey(activeEnvKey);
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [activeEnvKey]);

  // Force highlight update when environment keys change - using debounced env key
  useEffect(() => {
    if (!editor) return;
    // Dispatch a transaction with forceHighlightUpdate meta
    editor.view.dispatch(editor.state.tr.setMeta("forceHighlightUpdate", true));
  }, [editor, debouncedActiveEnvKey]);

  // Register reload function for this tab
  useEffect(() => {
    if (!editor || !source) return;

    const reloadFromFile = async () => {
      try {
        // If the user has unsaved changes, skip the external reload to preserve their work.
        // This prevents git:changed events (triggered by saveRuntimeVariables writing
        // .voiden/.process.env.json / .gitignore) from wiping the editor mid-session.
        if (useEditorStore.getState().unsaved[tabId]) return;

        // Read fresh content from disk
        const freshContent = await window.electron?.files.read(source);
        if (!freshContent) {
          return;
        }

        // Clear unsaved state
        clearUnsaved(tabId);

        // Parse the markdown
        const parsed = parseMarkdown(freshContent, memoizedSchema);
        const sanitized = sanitizeDoc(parsed);
        const preserved = preserveUnknownNodesInJSON(sanitized, memoizedSchema);

        // Update the editor content
        editor.commands.setContent(preserved, false);
      } catch (error) {
        console.error(`[VoidenEditor] Error reloading from file:`, error);
      }
    };

    // Register the reload function
    useEditorStore.getState().registerReload(tabId, reloadFromFile);

    return () => {
      // Unregister on unmount
      useEditorStore.getState().unregisterReload(tabId);
    };
  }, [editor, source, tabId, clearUnsaved, memoizedSchema]);

  // Force update when env / variable data changes (covers initial load)
  const envDataEffect = useActiveEnvironment();
  const { data: voidVariableDataEffect } = useVoidVariableData();
  useEffect(() => {
    if (!editor) return;
    if (envDataEffect) updateEnvironmentData(envDataEffect);
    if (voidVariableDataEffect) updateVariableData(voidVariableDataEffect);
    setTimeout(() => {
      const tr = editor.state.tr;
      tr.setMeta("forceHighlightUpdate", true);
      tr.setMeta("forceVariableHighlightUpdate", true);
      editor.view.dispatch(tr);
    }, 100);
  }, [editor, envDataEffect, voidVariableDataEffect]);

  // Restore scroll position and set up scroll tracking after editor is ready
  useEffect(() => {
    if (!editor) return;

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        const editorElement = editorRef.current?.querySelector('.ProseMirror') as HTMLElement;
        if (!editorElement) return;

        // Restore saved scroll position
        if (scrollPositionRef.current > 0) {
          editorElement.scrollTop = scrollPositionRef.current;
        }

        // Set up scroll listener to continuously track position
        const handleScroll = () => {
          scrollPositionRef.current = editorElement.scrollTop;
        };

        editorElement.addEventListener('scroll', handleScroll, { passive: true });

        // Store cleanup function
        editor.storage.scrollCleanup = () => {
          editorElement.removeEventListener('scroll', handleScroll);
        };
      });
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [editor, debouncedActiveEnvKey]);

  // Helper to recalculate matchPositions and reapply highlights
  const recalcFindMatches = () => {
    if (!editor) return;
    // If search term is empty, clear highlights and matches
    if (!findTerm) {
      setMatchPositions([]);
      setCurrentMatch(-1);
      const clearTr = editor.state.tr.setMeta(findHighlightPluginKey, {
        term: "",
        matchCase,
        matchWholeWord,
        useRegex,
        currentMatch: -1,
      });
      editor.view.dispatch(clearTr);
      return;
    }
    // Dispatch plugin meta with options, always include currentMatch
    const tr = editor.state.tr.setMeta(findHighlightPluginKey, {
      term: findTerm,
      matchCase,
      matchWholeWord,
      useRegex,
      currentMatch,
    });
    editor.view.dispatch(tr);

    // Compute matchPositions using same regex
    const matches: { from: number; to: number }[] = [];
    // build RegExp
    let pattern = useRegex ? findTerm : escapeRegExp(findTerm);
    if (!useRegex && matchWholeWord) pattern = `\\b${pattern}\\b`;
    const flags = matchCase ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      setMatchPositions([]);
      setCurrentMatch(-1);
      return;
    }
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        let m: RegExpExecArray | null;
        while ((m = regex.exec(node.text)) !== null) {
          matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
          if (m.index === regex.lastIndex) regex.lastIndex++;
        }
      }
      return true;
    });
    setMatchPositions(matches);
    setCurrentMatch(-1);
  };

  // Unified effect to recalc as needed
  useEffect(() => {
    recalcFindMatches();
  }, [editor, findTerm, matchCase, matchWholeWord, useRegex]);

  // Reapply highlights on document edits while search is active (without resetting selection)
  useEffect(() => {
    if (!editor || !findTerm) return;
    const onUpdate = () => {
      const tr = editor.state.tr.setMeta(findHighlightPluginKey, {
        term: findTerm,
        matchCase,
        matchWholeWord,
        useRegex,
        currentMatch,
      });
      editor.view.dispatch(tr);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, findTerm, matchCase, matchWholeWord, useRegex, currentMatch]);

  // Auto-select first match on new search term, without focusing editor
  useEffect(() => {
    if (showFind && editor && findTerm && matchPositions.length > 0 && currentMatch < 0) {
      const { from, to } = matchPositions[0];
      editor.commands.setTextSelection({ from, to });
      setCurrentMatch(0);
    }
  }, [editor, showFind, findTerm, matchPositions]);

  // Select first match by default when opening the find toolbar
  useEffect(() => {
    if (!showFind || !editor || matchPositions.length === 0) return;
    const { from, to } = matchPositions[0];
    editor.commands.setTextSelection({ from, to });
    editor.commands.focus();
    setCurrentMatch(0);
  }, [showFind, editor]);

  const handleFindPrevious = () => {
    if (matchPositions.length === 0 || !editor) return;
    const prevIndex = (currentMatch - 1 + matchPositions.length) % matchPositions.length;
    const { from, to } = matchPositions[prevIndex];
    editor.commands.setTextSelection({ from, to });
    editor.commands.focus();
    setCurrentMatch(prevIndex);
    // Re-dispatch plugin meta with updated currentMatch
    const meta = { term: findTerm, matchCase, matchWholeWord, useRegex, currentMatch: prevIndex };
    editor.view.dispatch(editor.state.tr.setMeta(findHighlightPluginKey, meta));
  };

  const handleFindNext = () => {
    if (matchPositions.length === 0 || !editor) return;
    const nextIndex = (currentMatch + 1) % matchPositions.length;
    const { from, to } = matchPositions[nextIndex];
    editor.commands.setTextSelection({ from, to });
    editor.commands.focus();
    setCurrentMatch(nextIndex);
    // Re-dispatch plugin meta with updated currentMatch
    const meta = { term: findTerm, matchCase, matchWholeWord, useRegex, currentMatch: nextIndex };
    editor.view.dispatch(editor.state.tr.setMeta(findHighlightPluginKey, meta));
  };

  const handleReplace = () => {
    if (matchPositions.length === 0 || currentMatch < 0 || !editor) return;
    const replaceIndex = currentMatch;
    const { from, to } = matchPositions[replaceIndex];
    // Perform replacement
    editor.commands.insertContentAt({ from, to }, replaceTerm);

    // Compute updated match positions
    const newMatches: { from: number; to: number }[] = [];
    // Build regex
    let pattern = useRegex ? findTerm : escapeRegExp(findTerm);
    if (!useRegex && matchWholeWord) pattern = `\\b${pattern}\\b`;
    const flags = matchCase ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      setMatchPositions([]);
      setCurrentMatch(-1);
      return;
    }
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        let m: RegExpExecArray | null;
        while ((m = regex.exec(node.text)) !== null) {
          newMatches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
          if (m.index === regex.lastIndex) regex.lastIndex++;
        }
      }
      return true;
    });
    setMatchPositions(newMatches);

    // Select next match
    if (newMatches.length > 0) {
      const nextIndex = replaceIndex >= newMatches.length ? 0 : replaceIndex;
      const { from: nf, to: nt } = newMatches[nextIndex];
      editor.commands.setTextSelection({ from: nf, to: nt });
      editor.commands.focus();
      setCurrentMatch(nextIndex);
    } else {
      setCurrentMatch(-1);
    }

    // Refresh highlights
    const tr = editor.state.tr.setMeta(findHighlightPluginKey, {
      term: findTerm,
      matchCase,
      matchWholeWord,
      useRegex,
      currentMatch: newMatches.length > 0 ? (replaceIndex >= newMatches.length ? 0 : replaceIndex) : -1,
    });
    editor.view.dispatch(tr);
  };

  const handleReplaceAll = () => {
    if (!editor || matchPositions.length === 0) return;
    // Perform replacements in reverse order to preserve offsets
    [...matchPositions].reverse().forEach(({ from, to }) => {
      editor.commands.insertContentAt({ from, to }, replaceTerm);
    });

    // Recalculate matches using same regex logic
    const newMatches: { from: number; to: number }[] = [];
    let pattern = useRegex ? findTerm : escapeRegExp(findTerm);
    if (!useRegex && matchWholeWord) pattern = `\b${pattern}\b`;
    const flags = matchCase ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      setMatchPositions([]);
      setCurrentMatch(-1);
      return;
    }
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        let m: RegExpExecArray | null;
        while ((m = regex.exec(node.text)) !== null) {
          newMatches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
          if (m.index === regex.lastIndex) regex.lastIndex++;
        }
      }
      return true;
    });
    setMatchPositions(newMatches);
    setCurrentMatch(-1);

    // Re-dispatch highlights
    const tr = editor.state.tr.setMeta(findHighlightPluginKey, {
      term: findTerm,
      matchCase,
      matchWholeWord,
      useRegex,
      currentMatch: -1,
    });
    editor.view.dispatch(tr);

    // If no matches remain, collapse the selection at the end of replacements
    if (newMatches.length === 0) {
      const pos = editor.state.selection.to;
      editor.commands.setTextSelection({ from: pos, to: pos });
      editor.commands.focus();
    }
  };

  const handleClick = useCallback(() => {
    if (!editor) return;
    const { state } = editor;
    const lastChild = state.doc.lastChild;
    if (lastChild && lastChild.type.name !== "paragraph") {
      editor.chain().insertContentAt(state.doc.content.size, { type: "paragraph" }, { updateSelection: true }).focus("end").run();
    } else {
      editor.commands.focus("end");
    }
  }, [editor]);

  // Note: parseError state was removed as we now handle errors gracefully with fallback content
  if (!editor) return null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        editor?.commands.blur();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [editor]);

  return (
    <div ref={editorRef} className="h-full flex flex-col relative">
      {showFind && (
        <div className="absolute top-2 right-2 z-50">
          <div className="bg-panel border border-border rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.3)] overflow-hidden min-w-[550px] max-w-[550px]">
            {/* Find Section */}
            <div className="flex items-center gap-1.5 p-2.5">
              <Input
                ref={findInputRef}
                type="text"
                placeholder="Find"
                value={findTerm}
                onChange={(e) => setFindTerm(e.target.value)}
                className="flex-1 h-7 text-[13px] min-w-[150px] max-w-[250px] px-2 bg-editor border-panel-border focus-visible:ring-1 focus-visible:ring-accent focus-visible:border-accent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleFindNext();
                  } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    handleFindPrevious();
                  }
                }}
              />

              {/* Options */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMatchCase(!matchCase)}
                  className={cn(
                    "px-2 py-1.5 rounded text-[11px] font-mono font-semibold transition-all min-w-[32px] h-7 flex items-center justify-center border",
                    matchCase
                      ? "bg-accent text-bg border-accent"
                      : "bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                  )}
                  title="Match Case"
                >
                  Aa
                </button>
                <button
                  onClick={() => setMatchWholeWord(!matchWholeWord)}
                  className={cn(
                    "px-2 py-1.5 rounded text-[11px] font-mono font-semibold transition-all min-w-[32px] h-7 flex items-center justify-center border",
                    matchWholeWord
                      ? "bg-accent text-bg border-accent"
                      : "bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                  )}
                  title="Match Whole Word"
                >
                  ab|
                </button>
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-1">
                <button
                  disabled={!findTerm || matchPositions.length === 0}
                  onClick={handleFindPrevious}
                  className={cn(
                    "p-1.5 rounded transition-all w-7 h-7 flex items-center justify-center border",
                    findTerm && matchPositions.length > 0
                      ? "bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                      : "bg-active text-comment border-panel-border cursor-not-allowed opacity-50"
                  )}
                  title={`Previous ${isMac ? '(⇧⌘G)' : '(Shift+Ctrl+G)'}`}
                >
                  <ArrowUpIcon size={14} strokeWidth={2} />
                </button>
                <button
                  disabled={!findTerm || matchPositions.length === 0}
                  onClick={handleFindNext}
                  className={cn(
                    "p-1.5 rounded transition-all w-7 h-7 flex items-center justify-center border",
                    findTerm && matchPositions.length > 0
                      ? "bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                      : "bg-active text-comment border-panel-border cursor-not-allowed opacity-50"
                  )}
                  title={`Next ${isMac ? '(⌘G)' : '(Ctrl+G)'}`}
                >
                  <ArrowDownIcon size={14} strokeWidth={2} />
                </button>
                <button
                  onClick={() => {
                    setShowFind(false);
                    setShowReplaceSection(false);
                    setFindTerm(""); // Clear search term
                    setReplaceTerm(""); // Clear replace term
                  }}
                  className="p-1.5 rounded transition-all w-7 h-7 flex items-center justify-center border bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                  title="Close (Esc)"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>

              {/* Results Count */}
              <span className="text-[11px] text-comment font-normal ml-auto min-w-[70px] text-right px-1 whitespace-nowrap">
                {findTerm && matchPositions.length > 0
                  ? `${currentMatch + 1} of ${matchPositions.length}`
                  : findTerm
                  ? "No results"
                  : ""}
              </span>
            </div>

            {/* Replace Section */}
            {showReplaceSection && (
              <div className="flex items-center gap-1.5 p-2.5 pt-0">
                <Input
                  type="text"
                  placeholder="Replace"
                  value={replaceTerm}
                  onChange={(e) => setReplaceTerm(e.target.value)}
                  className="flex-1 h-7 text-[13px] min-w-[150px] max-w-[250px] px-2 bg-editor border-panel-border focus-visible:ring-1 focus-visible:ring-accent focus-visible:border-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleReplaceAll();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      handleReplace();
                    }
                  }}
                />
                <button
                  disabled={!findTerm || matchPositions.length === 0}
                  onClick={handleReplace}
                  className={cn(
                    "p-1.5 rounded transition-all w-7 h-7 flex items-center justify-center border",
                    findTerm && matchPositions.length > 0
                      ? "bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                      : "bg-active text-comment border-panel-border cursor-not-allowed opacity-50"
                  )}
                  title="Replace (Enter)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12l5 5l10 -10"/>
                  </svg>
                </button>
                <button
                  disabled={!findTerm || matchPositions.length === 0}
                  onClick={handleReplaceAll}
                  className={cn(
                    "p-1.5 rounded transition-all w-7 h-7 flex items-center justify-center border",
                    findTerm && matchPositions.length > 0
                      ? "bg-active text-comment border-panel-border hover:bg-active hover:text-text hover:border-accent active:scale-[0.96]"
                      : "bg-active text-comment border-panel-border cursor-not-allowed opacity-50"
                  )}
                  title={`Replace All ${isMac ? '(⌘Enter)' : '(Ctrl+Enter)'}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 3l5 5l10 -10M5 10l5 5l10 -10M5 17l5 5l10 -10"/>
                  </svg>
                </button>

                <div className="flex-1 flex items-center gap-1 ml-1">
                  <button
                    onClick={() => setShowReplaceSection(!showReplaceSection)}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] transition-all border flex items-center gap-1 h-7 ml-auto",
                      "bg-active border-panel-border text-comment hover:border-accent hover:text-text active:scale-[0.96]"
                    )}
                    title={`Toggle Replace ${isMac ? '(⌘H)' : '(Ctrl+H)'}`}
                  >
                    <span className="text-[10px]">{showReplaceSection ? '▼' : '▶'}</span>
                    <span className="font-medium">Replace</span>
                  </button>
                </div>
              </div>
            )}

            {/* Replace Toggle Button (when collapsed) */}
            {!showReplaceSection && (
              <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                <button
                  onClick={() => setShowReplaceSection(true)}
                  className={cn(
                    "px-2 py-1 rounded text-[11px] transition-all border flex items-center gap-1 h-7 ml-auto",
                    "bg-active border-panel-border text-comment hover:border-accent hover:text-text active:scale-[0.96]"
                  )}
                  title={`Toggle Replace ${isMac ? '(⌘H)' : '(Ctrl+H)'}`}
                >
                  <span className="text-[10px]">▶</span>
                  <span className="font-medium">Replace</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto w-full px-2  bg-editor">
        <VoidenDragMenu editor={editor} />
        <EditorContent editor={editor} />
      </div>
      <div className="h-full w-full flex-1 min-h-64 bg-editor" onClick={handleClick} />
    </div>
  );
};
