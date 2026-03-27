import { useCallback, useMemo, useState, useEffect, useRef, useLayoutEffect, memo } from "react";
import { AnyExtension, Editor, EditorContent, Extension, getSchema, useEditor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { useVoidVariableData } from "@/core/runtimeVariables/hook/useVariableCapture.tsx";
import {
  buildUnifiedMatches,
  escapeRegExp,
  getPmMatches,
  getCmMatchesByNode,
  type UnifiedMatch,
} from "@/core/editors/voiden/search/unifiedSearch";
import { unifiedSearchHighlight } from "@/core/editors/voiden/search/cmHighlightEffect";
import { findCmViewAtPos, findAllCmViews } from "@/core/editors/voiden/search/cmViewLookup";
import { SectionIndicatorExtension } from "./extensions/sectionIndicator";
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
import { useActiveEnvironment, useEnvironmentKeys, useEnvironments } from "@/core/environment/hooks";
import { environmentHighlighter, updateEnvironmentData, updateEnvironmentKeys } from "./extensions/environmentHighlighter";
import { ReqSuggestion } from "./extensions/VariableReqSuggesion";
import { ResSuggestion } from "./extensions/VariableResSuggestion";
import { useContentStore } from "@/core/stores/ContentStore";
import { saveFileUtil } from "@/core/file-system/hooks";
import { ArrowDownIcon, ArrowUpIcon, X } from "lucide-react";
import { Input } from "@/core/components/ui/input";
import { cn } from "@/core/lib/utils";
import { variableHighlighter, updateVariableData, updateVariableKeys } from "./extensions/variableHighlighter";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { usePanelStore } from "@/core/stores/panelStore";
import { useGetActiveDocument } from "@/core/documents/hooks";
import {useVoidVariables} from "@/core/runtimeVariables/hook/useVariableCapture";
import { useQueryClient } from "@tanstack/react-query";

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

  const { data: voidVariableData } = useVoidVariableData();
  const envData = useActiveEnvironment();
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
      environmentHighlighter(envData ?? {}),
      variableHighlighter(voidVariableData ?? {}),
      DocumentPreserver, // Preserves unknown nodes from disabled plugins
    ];
    return baseExtensions;
  }, [memoizedExtensions, uniqueIdExtension, envData, voidVariableData]);

  return { finalExtensions, memoizedSchema };
};

export const proseClasses = [
  // Base styles - generous spacing between blocks (Obsidian/Notion style)
  "space-y-3",

  // Headings - bold, clear hierarchy with tight tracking
  "prose-h1:font-bold prose-h1:tracking-tight",
  "prose-h2:font-bold prose-h2:tracking-tight",
  "prose-h3:font-semibold prose-h3:tracking-tight",
  "prose-h4:font-semibold prose-h4:tracking-tight",

  // Text elements - text-base sets the editor's monospace font
  "text-base prose-p:text-text",
  "prose-strong:font-bold",
  "prose-em:italic",

  // Lists - generous spacing for readability
  "prose-ul:text-text prose-ul:mb-3 prose-ul:list-disc prose-ul:pl-6",
  "prose-ol:text-text prose-ol:mb-3 prose-ol:list-decimal prose-ol:pl-6",
  "prose-li:my-1.5 prose-li:text-text",

  // Code - mono font stays for code blocks
  "prose-pre:bg-bg prose-pre:border prose-pre:border-border prose-pre:mb-3 prose-pre:px-4 prose-pre:py-3 prose-pre:rounded-md",
  "prose-code:text-accent prose-code:font-mono prose-code:text-sm",

  // Links
  "prose-a:text-accent prose-a:no-underline hover:prose-a:text-orange-400 prose-a:cursor-pointer",

  // Blockquotes - clear visual separation
  "prose-blockquote:border-accent/30 prose-blockquote:bg-bg prose-blockquote:mb-3 prose-blockquote:text-comment",

  // Tables - minimal, clean borders
  "[&_table]:w-full",
  "[&_table]:border-collapse",

  // Horizontal rules - clear section dividers
  "prose-hr:border-border prose-hr:my-8",

  // Figures
  "prose-figure:my-8",
  "prose-figcaption:text-comment prose-figcaption:text-sm",

  // Description lists
  "prose-dt:text-text prose-dt:font-semibold prose-dt:mb-1",
  "prose-dd:text-comment prose-dd:ml-4 prose-dd:mb-3",

  // Images
  "prose-img:rounded-md prose-img:border prose-img:border-border",

  // Custom elements
  "prose-kbd:bg-bg prose-kbd:text-comment prose-kbd:px-1.5 prose-kbd:py-0.5 prose-kbd:border prose-kbd:border-border prose-kbd:rounded",
  "prose-mark:bg-accent/20",

  // Small text
  "prose-small:text-comment",
].join(" ");

interface EditorStore {
  unsaved: Record<string, string>;
  setUnsaved: (tabId: string, content: string) => void;
  clearUnsaved: (tabId: string) => void;
  scrollPositions: Record<string, number>;
  setScrollPosition: (tabId: string, position: number) => void;
  getScrollPosition: (tabId: string) => number;
  clearScrollPosition: (tabId: string) => void;
  // Store reload functions for each tab
  reloadFunctions: Record<string, () => Promise<void>>;
  registerReload: (tabId: string, reloadFn: () => Promise<void>) => void;
  unregisterReload: (tabId: string) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  unsaved: {},
  setUnsaved: (tabId, content) => set((state) => ({ unsaved: { ...state.unsaved, [tabId]: content } })),
  clearUnsaved: (tabId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [tabId]: _, ...rest } = state.unsaved;
      return { unsaved: rest };
    }),
  scrollPositions: {},
  setScrollPosition: (tabId, position) =>
    set((state) => ({ scrollPositions: { ...state.scrollPositions, [tabId]: position } })),
  getScrollPosition: (tabId) => get().scrollPositions[tabId] ?? 0,
  clearScrollPosition: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...rest } = state.scrollPositions;
      return { scrollPositions: rest };
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

const VoidenEditorInner = ({
  tabId,
  content,
  source,
  panelId,
  hasSearch,
  isActive = true,
}: {
  tabId: string;
  content: string;
  source: string;
  panelId: string;
  hasSearch: boolean;
  isActive?: boolean;
}) => {

  const editorRef = useRef<HTMLDivElement | null>(null);
  const updateTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const setUnsaved = useEditorStore((state) => state.setUnsaved);
  const clearUnsaved = useEditorStore((state) => state.clearUnsaved);
  const setScrollPosition = useEditorStore((state) => state.setScrollPosition);
  const getScrollPosition = useEditorStore((state) => state.getScrollPosition);
  const { finalExtensions, memoizedSchema } = useVoidenExtensionsAndSchema();
  const { data: envData } = useEnvironments();
  const activeEnvData = useActiveEnvironment();
  const { data: voidVariableData } = useVoidVariableData();
  const activeEnvKey = envData?.activeEnv ?? "default";
  const extensionsKey = useMemo(() => finalExtensions.map((ext) => ext.name).join(","), [finalExtensions]);
  const { data: activeDocument } = useGetActiveDocument();
  const { openRightPanel } = usePanelStore();

  // Track previous extensionsKey to detect when plugins change
  const prevExtensionsKeyRef = useRef<string | null>(null);

  // When plugins change, clear unsaved state to force reload from file.
  // Using useEffect instead of useMemo to avoid calling Zustand setState during render.
  useEffect(() => {
    const prevKey = prevExtensionsKeyRef.current;
    prevExtensionsKeyRef.current = extensionsKey;
    if (prevKey !== null && prevKey !== extensionsKey) {
      clearUnsaved(tabId);
    }
  }, [extensionsKey, tabId, clearUnsaved]);

  const initialUnsaved = useEditorStore.getState().unsaved[tabId];

  useEffect(() => {
    if (!isActive) return;
    // Always update the store with the new content, or an empty string if undefined.
    useContentStore.getState().updateContent(content || "");
  }, [content, isActive]);

  // Find & Replace state
  const [showFind, setShowFind] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [matchPositions, setMatchPositions] = useState<UnifiedMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [matchCase, setMatchCase] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const [useRegex] = useState(false);
  const [showReplaceSection, setShowReplaceSection] = useState(true);

  // Sync search state to global store
  const setGlobalTerm = useSearchStore((state) => state.setTerm);
  const setGlobalMatchCase = useSearchStore((state) => state.setMatchCase);
  const setUnifiedSearchActive = useSearchStore((state) => state.setUnifiedSearchActive);
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
    if (!isActive) return;

    const handleShortcut = (e: KeyboardEvent) => {
      // Allow unified search shortcuts even in CodeMirror editors
      // (but skip for standalone code file editors outside VoidenEditor)
      const target = e.target as HTMLElement;
      if (target?.closest('.txt-editor')) {
        return;
      }

      const key = e.key.toLowerCase();
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+F: Open find (without replace)
      if (mod && key === "f" && hasSearch && !e.shiftKey) {
        e.preventDefault();
        setShowFind(true);
        setShowReplaceSection(false);
        setUnifiedSearchActive(true);
        return;
      }

      // Cmd/Ctrl+H: Open find and replace
      if (mod && key === "h" && hasSearch) {
        e.preventDefault();
        setShowFind(true);
        setShowReplaceSection(true);
        setUnifiedSearchActive(true);
        return;
      }

      // Cmd/Ctrl+G: Find next (only when find panel is open)
      if (mod && key === "g" && showFind && !e.shiftKey) {
        e.preventDefault();
        if (matchPositions.length > 0) {
          const nextIndex = (currentMatch + 1) % matchPositions.length;
          navigateToMatch(nextIndex, false);
        }
        return;
      }

      // Shift+Cmd/Ctrl+G: Find previous (only when find panel is open)
      if (mod && key === "g" && showFind && e.shiftKey) {
        e.preventDefault();
        if (matchPositions.length > 0) {
          const prevIndex = (currentMatch - 1 + matchPositions.length) % matchPositions.length;
          navigateToMatch(prevIndex, false);
        }
        return;
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isMac, hasSearch, showFind, matchPositions, currentMatch, findTerm, matchCase, matchWholeWord, useRegex, isActive]);

  // Cmd+Enter to execute request is now handled by SendRequestButton component via useHotkeys
  // Removed duplicate keyboard handler to prevent double request execution

  useEffect(() => {
    if (!isActive) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showFind) {
        setShowFind(false);
        setShowReplaceSection(false);
        setFindTerm(""); // Clear search term
        setReplaceTerm(""); // Clear replace term
        setUnifiedSearchActive(false);
        clearCmHighlights();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showFind, isActive]);

  // Handle Cmd+S to save file and prevent duplicate saves
  useEffect(() => {
    if (!isActive) return;

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
          saveFileUtil(source, content, panelId, tabId, currentEditor.schema).catch(console.error);
        }
      }
    };
    window.addEventListener("keydown", handleSave, true); // Use capture phase
    return () => {
      window.removeEventListener("keydown", handleSave, true);
    };
  }, [isMac, isActive, source, panelId, tabId]);

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
      // with a separator so new files start with a consistent section header
      if (!unsavedContent && content.trim() === "") {
        return {
          type: "doc",
          content: [
            { type: "request-separator", attrs: { colorIndex: 0, label: "New Request" } },
            { type: "paragraph" },
          ],
        };
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
      const parsed = parseMarkdown(content, memoizedSchema);
      const sanitized = sanitizeDoc(parsed);
      savedContentJSONRef.current = JSON.stringify(sanitized);
    } catch {
      savedContentJSONRef.current = null;
    }
  }, [content, memoizedSchema]);

  const handleEditorCreate = useCallback(
    ({ editor }: { editor: Editor }) => {
      try {
        if (isActive) {
          useVoidenEditorStore.getState().setEditor(editor);
          useVoidenEditorStore.getState().setFilePath(source);
        }

        // Set the editor in the store
        editor.storage.panelId = panelId;
        editor.storage.tabId = tabId;
        editor.storage.source = source;
        editor.storage.instanceId = crypto.randomUUID();

        const unsaved = useEditorStore.getState().unsaved[tabId];
        const savedScrollTop = useEditorStore.getState().getScrollPosition(tabId);
        
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

        // For brand new files only: collapse selection to start.
        // When restoring tab scroll, forcing selection can move viewport unexpectedly.
        if (!unsaved && savedScrollTop === 0) {
          requestAnimationFrame(() => {
            if (!editor.isDestroyed) {
              // Find the first valid text position (skip atom nodes like separators)
              try {
                const $pos = editor.state.doc.resolve(1);
                if ($pos.parent.isTextblock) {
                  editor.commands.setTextSelection(1);
                } else {
                  // Find first textblock in the document
                  let found = false;
                  editor.state.doc.descendants((node, pos) => {
                    if (!found && node.isTextblock) {
                      editor.commands.setTextSelection(pos + 1);
                      found = true;
                      return false;
                    }
                  });
                }
              } catch {
                // Silently ignore — cursor will be placed by autofocus
              }
            }
          });
        }

      } catch (e) {
        // Set a safe fallback content instead of destroying the editor
        const fallbackContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] };
        editor.commands.setContent(fallbackContent, false);
      }

    },
    [source, panelId, tabId, content, memoizedSchema, isActive],
  );

  const handleEditorUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      // Debounce the expensive serialization to avoid running on every keystroke
      if (updateTimerRef.current !== null) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = window.setTimeout(() => {
        updateTimerRef.current = null;
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
          if (autoSaveTimerRef.current !== null) clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = window.setTimeout(() => {
            autoSaveTimerRef.current = null;
            if (window.electron?.autosave?.save) {
              window.electron.autosave.save(tabId, contentString).catch(console.error);
            }
          }, 1000);
        }
      }, 300);
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
      extensions: [...finalExtensions, FindHighlightExtension, SectionIndicatorExtension],
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [extensionsKey],
  );

  useEffect(() => {
    if (!editor || !isActive) return;
    useVoidenEditorStore.getState().setEditor(editor);
    useVoidenEditorStore.getState().setFilePath(source);
  }, [editor, isActive, source]);

  useEffect(() => {
    if (!editor) return;
    return () => {
      const currentEditor = useVoidenEditorStore.getState().editor;
      if (currentEditor && currentEditor.storage.instanceId === editor.storage.instanceId) {
        useVoidenEditorStore.getState().setEditor(null);
      }
    };
  }, [editor]);

  // Clean up debounce timers on unmount
  useEffect(() => {
    return () => {
      if (updateTimerRef.current !== null) clearTimeout(updateTimerRef.current);
      if (autoSaveTimerRef.current !== null) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Separate effect for environment changes - debounced to avoid conflicts during modal unmount
  const [debouncedActiveEnvKey, setDebouncedActiveEnvKey] = useState(activeEnvKey);
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedActiveEnvKey(activeEnvKey);
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [activeEnvKey]);

  // Keep highlight maps in sync with full resolved values so hover preview can display them.
  useEffect(() => {
    if (!editor || !isActive) return;
    updateEnvironmentData(activeEnvData ?? {});
    editor.view.dispatch(editor.state.tr.setMeta("forceHighlightUpdate", true));
  }, [editor, debouncedActiveEnvKey, activeEnvData, isActive]);

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

  // Fallback: if full value maps are unavailable, keep validity highlighting via keys-only lists.
  const { data: envKeys } = useEnvironmentKeys();
  const { data: voidVariableKeys } = useVoidVariables();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!editor || !isActive) return;

    const hasEnvValues = !!activeEnvData && Object.keys(activeEnvData).length > 0;
    const hasProcessValues = !!voidVariableData && Object.keys(voidVariableData).length > 0;

    if (!hasEnvValues) {
      updateEnvironmentKeys(envKeys ?? []);
      editor.view.dispatch(editor.state.tr.setMeta("forceHighlightUpdate", true));
    }
    if (!hasProcessValues) {
      updateVariableKeys(voidVariableKeys ?? []);
      editor.view.dispatch(editor.state.tr.setMeta("forceVariableHighlightUpdate", true));
    }
  }, [editor, envKeys, voidVariableKeys, activeEnvData, voidVariableData, isActive]);

  // Keep process/runtime variable values in sync for hover preview.
  useEffect(() => {
    if (!editor || !isActive) return;
    updateVariableData(voidVariableData ?? {});
    editor.view.dispatch(editor.state.tr.setMeta("forceVariableHighlightUpdate", true));
  }, [editor, voidVariableData, isActive]);

  // When this tab becomes active, refresh environment keys, file-link existence
  // checks, and block-link content so stale data from when the tab was hidden
  // is immediately corrected.
  useEffect(() => {
    if (!isActive) return;
    queryClient.invalidateQueries({ queryKey: ["environment-keys"] });
    queryClient.invalidateQueries({ queryKey: ["file:exists"] });
    queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"] });
  }, [isActive, queryClient]);

  // Restore scroll position and keep tracking per-tab scroll.
  // currentTarget tracks where the user last intentionally scrolled to. Only wheel/touch
  // events mark a scroll as user-initiated; editor-internal scrolls (ProseMirror
  // scrollIntoView, async transaction effects) are immediately snapped back to currentTarget
  // so they never corrupt the saved position.
  useLayoutEffect(() => {
    if (!editor || !isActive) return;

    const scrollContainer = document.getElementById("code-editor-container") as HTMLElement | null;
    if (!scrollContainer) return;

    let currentTarget = getScrollPosition(tabId);
    let isUserScrolling = false;
    let userScrollTimeout: number | null = null;
    let scrollSaveTimer: number | null = null;

    const setUserScrolling = () => {
      isUserScrolling = true;
      if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
      userScrollTimeout = window.setTimeout(() => {
        isUserScrolling = false;
        userScrollTimeout = null;
      }, 1000);
    };

    const applySavedScroll = (containerElement: HTMLElement) => {
      if (isUserScrolling) return;
      const maxScrollTop = Math.max(0, containerElement.scrollHeight - containerElement.clientHeight);
      containerElement.scrollTop = Math.min(currentTarget, maxScrollTop);
    };

    const handleScroll = () => {
      if (isUserScrolling) {
        currentTarget = scrollContainer.scrollTop;
        // Throttle Zustand writes to every 200ms
        if (scrollSaveTimer === null) {
          scrollSaveTimer = window.setTimeout(() => {
            scrollSaveTimer = null;
            setScrollPosition(tabId, currentTarget);
          }, 200);
        }
      } else {
        // Editor-internal scroll (ProseMirror, async effects) — snap back to user's target
        applySavedScroll(scrollContainer);
      }
    };

    const handleUserInteraction = () => { setUserScrolling(); };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    scrollContainer.addEventListener('wheel', handleUserInteraction, { passive: true, capture: true });
    scrollContainer.addEventListener('touchmove', handleUserInteraction, { passive: true, capture: true });
    scrollContainer.addEventListener('keydown', handleUserInteraction, { capture: true });
    scrollContainer.addEventListener('mousedown', handleUserInteraction, { capture: true });

    // Apply synchronously before the first paint so there is no visible jump.
    // useLayoutEffect runs after DOM mutations (display: block) but before paint.
    scrollContainer.style.scrollBehavior = "auto";
    applySavedScroll(scrollContainer);

    // Minimal cleanup set before RAF fires (handles early tab-switch before RAF runs)
    editor.storage.scrollCleanup = () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      scrollContainer.removeEventListener('wheel', handleUserInteraction, { capture: true });
      scrollContainer.removeEventListener('touchmove', handleUserInteraction, { capture: true });
      scrollContainer.removeEventListener('keydown', handleUserInteraction, { capture: true });
      scrollContainer.removeEventListener('mousedown', handleUserInteraction, { capture: true });
      if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
      if (scrollSaveTimer !== null) clearTimeout(scrollSaveTimer);
      setScrollPosition(tabId, currentTarget);
    };

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        scrollContainer.style.scrollBehavior = "auto";
        applySavedScroll(scrollContainer);

        const timeoutIds: number[] = [];
        timeoutIds.push(window.setTimeout(() => applySavedScroll(scrollContainer), 0));
        timeoutIds.push(window.setTimeout(() => applySavedScroll(scrollContainer), 60));
        timeoutIds.push(window.setTimeout(() => applySavedScroll(scrollContainer), 140));

        editor.storage.scrollCleanup = () => {
          scrollContainer.removeEventListener('scroll', handleScroll);
          scrollContainer.removeEventListener('wheel', handleUserInteraction, { capture: true });
          scrollContainer.removeEventListener('touchmove', handleUserInteraction, { capture: true });
          scrollContainer.removeEventListener('keydown', handleUserInteraction, { capture: true });
          scrollContainer.removeEventListener('mousedown', handleUserInteraction, { capture: true });
          if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
          if (scrollSaveTimer !== null) clearTimeout(scrollSaveTimer);
          timeoutIds.forEach((id) => window.clearTimeout(id));
          setScrollPosition(tabId, currentTarget);
        };
      });
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (editor.storage.scrollCleanup) {
        editor.storage.scrollCleanup();
      }
    };
  }, [editor, tabId, setScrollPosition, getScrollPosition, isActive]);

  // Helper to dispatch CM highlights for the current unified matches
  const dispatchCmHighlights = (matches: UnifiedMatch[], activeMatchIndex: number) => {
    if (!editor) return;
    const cmGroups = getCmMatchesByNode(matches);

    // Dispatch highlights to each CM instance that has matches
    for (const [pmNodePos, group] of cmGroups) {
      const cmView = findCmViewAtPos(editor.view, pmNodePos);
      if (!cmView) continue;
      // Find which group entry (if any) is the active match
      const currentIdx = group.findIndex((g) => g.index === activeMatchIndex);
      cmView.dispatch({
        effects: unifiedSearchHighlight.of({
          ranges: group.map((g) => ({ from: g.cmFrom, to: g.cmTo })),
          currentIndex: currentIdx,
        }),
      });
    }

    // Clear highlights from CM instances that have no matches
    const allCmViews = findAllCmViews(editor.view);
    for (const cmView of allCmViews) {
      const cmDom = cmView.dom.closest(".cm-editor") as HTMLElement;
      // Check if this CM view is in our groups (by checking its parent PM node)
      let hasMatches = false;
      for (const [pmNodePos] of cmGroups) {
        const domNode = editor.view.nodeDOM(pmNodePos) as HTMLElement | null;
        if (domNode && domNode.contains(cmDom)) {
          hasMatches = true;
          break;
        }
      }
      if (!hasMatches) {
        cmView.dispatch({
          effects: unifiedSearchHighlight.of({ ranges: [], currentIndex: -1 }),
        });
      }
    }
  };

  // Helper to clear all CM highlights
  const clearCmHighlights = () => {
    if (!editor) return;
    const allCmViews = findAllCmViews(editor.view);
    for (const cmView of allCmViews) {
      cmView.dispatch({
        effects: unifiedSearchHighlight.of({ ranges: [], currentIndex: -1 }),
      });
    }
  };

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
      clearCmHighlights();
      return;
    }

    // Dispatch PM highlight plugin meta
    const tr = editor.state.tr.setMeta(findHighlightPluginKey, {
      term: findTerm,
      matchCase,
      matchWholeWord,
      useRegex,
      currentMatch,
    });
    editor.view.dispatch(tr);

    // Build unified matches across PM text and CM code blocks
    const matches = buildUnifiedMatches(editor.state.doc, findTerm, {
      matchCase,
      matchWholeWord,
      useRegex,
    });

    setMatchPositions(matches);
    setCurrentMatch(-1);

    // Dispatch highlights to CM instances
    dispatchCmHighlights(matches, -1);
  };

  // Unified effect to recalc as needed
  useEffect(() => {
    recalcFindMatches();
  }, [editor, findTerm, matchCase, matchWholeWord, useRegex]);

  // Reapply highlights on document edits while search is active (without resetting selection)
  // Debounced to avoid dispatching a new transaction on every keystroke
  useEffect(() => {
    if (!editor || !findTerm) return;
    let searchDebounceTimer: number | null = null;
    const onUpdate = () => {
      if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => {
        searchDebounceTimer = null;
        const tr = editor.state.tr.setMeta(findHighlightPluginKey, {
          term: findTerm,
          matchCase,
          matchWholeWord,
          useRegex,
          currentMatch,
        });
        editor.view.dispatch(tr);
      }, 200);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    };
  }, [editor, findTerm, matchCase, matchWholeWord, useRegex, currentMatch]);

  // Navigate to a specific match (PM or CM)
  const navigateToMatch = (matchIndex: number, shouldFocus: boolean = true) => {
    if (!editor || matchIndex < 0 || matchIndex >= matchPositions.length) return;
    const match = matchPositions[matchIndex];
    const { source } = match;

    if (source.type === "prosemirror") {
      editor.commands.setTextSelection({ from: source.from, to: source.to });
      if (shouldFocus) editor.commands.focus();
    } else {
      // CodeMirror match: scroll PM to show the code block, then select in CM
      const cmView = findCmViewAtPos(editor.view, source.pmNodePos);
      if (cmView) {
        // Scroll PM so the code block is visible
        const domNode = editor.view.nodeDOM(source.pmNodePos) as HTMLElement | null;
        if (domNode) {
          domNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        // Select the match range in CM
        if (shouldFocus) cmView.focus();
        cmView.dispatch({
          selection: { anchor: source.cmFrom, head: source.cmTo },
          scrollIntoView: true,
        });
      }
    }

    setCurrentMatch(matchIndex);

    // Update PM highlight to show current match
    const pmMatches = getPmMatches(matchPositions);
    const pmCurrentIdx = source.type === "prosemirror"
      ? pmMatches.findIndex((m) => m.index === match.index)
      : -1;
    const meta = { term: findTerm, matchCase, matchWholeWord, useRegex, currentMatch: pmCurrentIdx };
    editor.view.dispatch(editor.state.tr.setMeta(findHighlightPluginKey, meta));

    // Update CM highlights to show current match
    dispatchCmHighlights(matchPositions, match.index);
  };

  // Auto-select first match on new search term, without focusing editor
  useEffect(() => {
    if (showFind && editor && findTerm && matchPositions.length > 0 && currentMatch < 0) {
      navigateToMatch(0, false);
    }
  }, [editor, showFind, findTerm, matchPositions]);

  // Select first match by default when opening the find toolbar
  useEffect(() => {
    if (!showFind || !editor || matchPositions.length === 0) return;
    navigateToMatch(0, false);
  }, [showFind, editor]);

  const handleFindPrevious = () => {
    if (matchPositions.length === 0 || !editor) return;
    const prevIndex = (currentMatch - 1 + matchPositions.length) % matchPositions.length;
    navigateToMatch(prevIndex, false);
  };

  const handleFindNext = () => {
    if (matchPositions.length === 0 || !editor) return;
    const nextIndex = (currentMatch + 1) % matchPositions.length;
    navigateToMatch(nextIndex, false);
  };

  const handleReplace = () => {
    if (matchPositions.length === 0 || currentMatch < 0 || !editor) return;
    const replaceIndex = currentMatch;
    const match = matchPositions[replaceIndex];
    const { source } = match;

    if (source.type === "prosemirror") {
      // PM replacement — goes through PM undo stack
      editor.commands.insertContentAt({ from: source.from, to: source.to }, replaceTerm);
    } else {
      // CM replacement — all through PM transaction for undo support
      const node = editor.state.doc.nodeAt(source.pmNodePos);
      if (node && typeof node.attrs.body === "string") {
        const body = node.attrs.body;
        const newBody =
          body.slice(0, source.cmFrom) + replaceTerm + body.slice(source.cmTo);
        const tr = editor.state.tr.setNodeMarkup(source.pmNodePos, undefined, {
          ...node.attrs,
          body: newBody,
        });
        editor.view.dispatch(tr);
      }
    }

    // Recompute unified matches after replacement
    const newMatches = buildUnifiedMatches(editor.state.doc, findTerm, {
      matchCase,
      matchWholeWord,
      useRegex,
    });
    setMatchPositions(newMatches);

    // Navigate to next match
    if (newMatches.length > 0) {
      const nextIndex = replaceIndex >= newMatches.length ? 0 : replaceIndex;
      // Defer navigation so state has settled
      setTimeout(() => navigateToMatch(nextIndex), 0);
    } else {
      setCurrentMatch(-1);
      clearCmHighlights();
    }

    // Refresh PM highlights
    const tr2 = editor.state.tr.setMeta(findHighlightPluginKey, {
      term: findTerm,
      matchCase,
      matchWholeWord,
      useRegex,
      currentMatch: newMatches.length > 0 ? (replaceIndex >= newMatches.length ? 0 : replaceIndex) : -1,
    });
    editor.view.dispatch(tr2);
  };

  const handleReplaceAll = () => {
    if (!editor || matchPositions.length === 0) return;

    // Build a single PM transaction for all replacements (single undo step)
    let tr = editor.state.tr;

    // Separate PM and CM matches
    const pmMatches = matchPositions
      .filter((m) => m.source.type === "prosemirror")
      .map((m) => m.source as { type: "prosemirror"; from: number; to: number });
    const cmMatchesByNode = getCmMatchesByNode(matchPositions);

    // Replace CM matches first (setNodeMarkup doesn't shift PM text positions)
    for (const [pmNodePos, group] of cmMatchesByNode) {
      const node = tr.doc.nodeAt(pmNodePos);
      if (!node || typeof node.attrs.body !== "string") continue;
      // Apply all replacements in reverse offset order within this body
      let body = node.attrs.body;
      const sorted = [...group].sort((a, b) => b.cmFrom - a.cmFrom);
      for (const { cmFrom, cmTo } of sorted) {
        body = body.slice(0, cmFrom) + replaceTerm + body.slice(cmTo);
      }
      tr = tr.setNodeMarkup(pmNodePos, undefined, { ...node.attrs, body });
    }

    // Replace PM matches in reverse order to preserve offsets
    const sortedPm = [...pmMatches].sort((a, b) => b.from - a.from);
    for (const { from, to } of sortedPm) {
      tr = tr.replaceWith(from, to, editor.schema.text(replaceTerm));
    }

    editor.view.dispatch(tr);

    // Recompute unified matches
    const newMatches = buildUnifiedMatches(editor.state.doc, findTerm, {
      matchCase,
      matchWholeWord,
      useRegex,
    });
    setMatchPositions(newMatches);
    setCurrentMatch(-1);

    // Refresh highlights
    const tr2 = editor.state.tr.setMeta(findHighlightPluginKey, {
      term: findTerm,
      matchCase,
      matchWholeWord,
      useRegex,
      currentMatch: -1,
    });
    editor.view.dispatch(tr2);
    dispatchCmHighlights(newMatches, -1);

    // If no matches remain, collapse selection
    if (newMatches.length === 0) {
      const pos = editor.state.selection.to;
      editor.commands.setTextSelection({ from: pos, to: pos });
      editor.commands.focus();
    }
  };

  const handleClick = useCallback(() => {
    if (!editor || !isActive) return;
    const { state } = editor;
    const lastChild = state.doc.lastChild;
    if (lastChild && lastChild.type.name !== "paragraph") {
      editor.chain().insertContentAt(state.doc.content.size, { type: "paragraph" }, { updateSelection: true }).focus("end").run();
    } else {
      editor.commands.focus("end");
    }
  }, [editor, isActive]);

  useEffect(() => {
    if (!editor || !isActive) return;

    function handleClickOutside(event: MouseEvent) {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        editor.commands.blur();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [editor, isActive]);

  // Listen for "scroll to section" events from the response panel
  useEffect(() => {
    if (!editor || !isActive) return;

    const handleScrollToSection = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log('[VoidenEditor] scroll-to-section event received:', detail);
      const { sectionIndex } = detail;
      if (typeof sectionIndex !== "number") return;

      // Always scroll to the TOP of the section:
      // Section 0 → doc start, Section N → the Nth separator node
      let targetPos = 0;

      if (sectionIndex === 0) {
        targetPos = 1;
      } else {
        let currentSection = 0;
        editor.state.doc.forEach((child, offset) => {
          if (child.type.name === "request-separator") {
            currentSection++;
            if (currentSection === sectionIndex) {
              // Position AT the separator (top of section)
              targetPos = offset + 1;
            }
          }
        });
      }

      if (targetPos > 0) {
        const pos = Math.min(targetPos, editor.state.doc.content.size);
        // Set cursor near the target and scroll into view — also gives focus to the editor
        const $pos = editor.state.doc.resolve(pos);
        const selection = TextSelection.near($pos);
        editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
        editor.view.focus();
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener("voiden:scroll-to-section", handleScrollToSection);
    return () => window.removeEventListener("voiden:scroll-to-section", handleScrollToSection);
  }, [editor, isActive]);

  if (!editor) return null;

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
                    setUnifiedSearchActive(false);
                    clearCmHighlights();
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

      <div className="mx-auto w-full px-2 bg-editor" style={{ maxWidth: 'var(--prose-max-width, 860px)' }}>
        {isActive && <VoidenDragMenu editor={editor} />}
        <EditorContent editor={editor} />
      </div>
      <div className="h-full w-full flex-1 min-h-64 bg-editor" onClick={handleClick} />
    </div>
  );
};

export const VoidenEditor = memo(VoidenEditorInner);
