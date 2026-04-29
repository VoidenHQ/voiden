import { useRef, useEffect, useContext, createContext } from "react";
import { isValidRegex } from "@/core/file-system/components/RegexHighlightOverlay";

/** Editors rendered inside this context will not react to the global searchParamsStore. */
export const NoGlobalSearchContext = createContext(false);
import { defaultKeymap, toggleComment, } from "@codemirror/commands";
import {
  SearchQuery,
  setSearchQuery,
  search,
  highlightSelectionMatches,
  findNext,
  findPrevious,
} from "@codemirror/search";
import { indentOnInput, indentUnit } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { prettifyJSONC } from "@/utils/jsonc.ts";

import CodeMirror, { KeyBinding, keymap, Prec } from "@uiw/react-codemirror";
import { codemirrorKeymap } from "../extensions/codemirrorKeymap.ts";
import { createHighlightPlugin } from "../extensions/createHighlightPlugin.ts";
import { renderLang, toggleComment as toggleCommentJSON } from "../extensions/renderLang.ts";
import { CodeNodeViewRendererProps } from "./TiptapCodeEditorWrapper.tsx";
import { voidenTheme } from "@/core/editors/code/CodeEditor.tsx";
import { globalSaveFile } from "@/core/file-system/hooks";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { useShallow } from "zustand/react/shallow";
import { useEditorEnhancementStore } from "@/plugins";
import { unifiedSearchField } from "@/core/editors/voiden/search/cmHighlightEffect";
import { useEnvironments } from "@/core/environment/hooks";
import { useVoidVariableData } from "@/core/runtimeVariables/hook/useVariableCapture.tsx";

interface SearchQuerySpec {
  term: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
}

const searchEffect = StateEffect.define<SearchQuerySpec>();

const searchField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    decos = decos.map(tr.changes);
    const spec = tr.effects.find((e) => e.is(searchEffect))?.value;
    if (!spec) return decos;
    if (!spec.term) return Decoration.none;
    const { term, matchCase, matchWholeWord, useRegex } = spec;
    let source = useRegex ? term : term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    if (!useRegex && matchWholeWord) source = `\\b${source}\\b`;
    const flags = matchCase ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(source, flags);
    } catch {
      return decos;
    }
    const text = tr.state.doc.toString();
    const builder = new RangeSetBuilder<Decoration>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const [match] = m;
      const from = m.index;
      const to = from + match.length;
      builder.add(
        from,
        to,
        Decoration.mark({
          attributes: {
            style: "background-color: rgba(255,255,0,0.4)",
          },
        })
      );
      if (regex.lastIndex === from) regex.lastIndex++;
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface ScriptDiagnostic {
  line: number;
  column: number;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

const lintTooltipTheme = EditorView.theme({
  ".cm-gutter.cm-gutter-lint": {
    backgroundColor: "var(--editor-bg)",
    borderLeft: "1px solid var(--border)",
    minWidth: "20px",
  },
  ".cm-gutter.cm-gutter-lint .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--comment)",
    opacity: "0.95",
  },
  ".cm-gutter.cm-gutter-lint .cm-lint-marker-error": {
    color: "#ef4444",
  },
  ".cm-gutter.cm-gutter-lint .cm-lint-marker-warning": {
    color: "#f59e0b",
  },
  ".cm-gutter.cm-gutter-lint .cm-lint-marker-info": {
    color: "#3b82f6",
  },
  ".cm-tooltip.cm-tooltip-lint": {
    maxWidth: "min(200px, calc(50vw - 10vh))",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    backgroundColor: "var(--panel)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
    overflow: "hidden",
    zIndex: "120",
  },
  ".cm-tooltip.cm-tooltip-lint .cm-diagnostic": {
    margin: "0",
    padding: "8px 10px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    borderBottom: "1px solid var(--border)",
    lineHeight: "1.4",
    fontSize: "12px",
    color: "var(--text)",
    backgroundColor: "var(--editor-bg)",
  },
  ".cm-tooltip.cm-tooltip-lint .cm-diagnostic:last-child": {
    borderBottom: "none",
  },
  ".cm-lintRange": { textDecoration: "none !important", background: "none !important" },
  ".cm-lintRange-error": { textDecoration: "none !important", background: "none !important" },
  ".cm-lintRange-warning": { textDecoration: "none !important", background: "none !important" },
  ".cm-lintRange-info": { textDecoration: "none !important", background: "none !important" },
  ".cm-lint-marker": {
    width: "14px",
    height: "14px",
    cursor: "pointer",
  },
});

// Content size thresholds for performance tiering
const LARGE_CONTENT_SIZE = 150 * 1024;      // 150 KB — disable linter, env vars, selection matches
const VERY_LARGE_CONTENT_SIZE = 500 * 1024; // 500 KB — also disable syntax highlighting

interface CodeEditorProps {
  value?: string;
  tiptapProps?: CodeNodeViewRendererProps;
  envKeys?: string[]; // Environment variable keys (secure - no values)
  lang?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  autofocus?: boolean;
  /** Optional lint function — called with editor content, returns diagnostics shown inline. */
  validateFn?: (content: string) => ScriptDiagnostic[];
  /** Force syntax highlighting even when content exceeds the very-large threshold. */
  forceHighlight?: boolean;
}

export const CodeEditor = ({
  value,
  tiptapProps,
  lang = "json",
  readOnly = false,
  onChange,
  autofocus = false,
  validateFn,
  forceHighlight = false,
}: CodeEditorProps) => {
  // Check if the parent Tiptap editor is editable
  const isParentEditable = tiptapProps?.editor?.isEditable ?? true;
  const effectiveReadOnly = readOnly || !isParentEditable;
  const editorRef = useRef<EditorView | null>(null);
  const { data: envData } = useEnvironments();
  const { data: processData = {} } = useVoidVariableData();
  const activeEnvData = (envData?.activeEnv && envData?.data[envData.activeEnv]) ? envData.data[envData.activeEnv] : {};

  // Track if this is the initial mount to prevent onChange during initialization
  const isInitialMount = useRef(true);
  const initialValueRef = useRef<string>('');

  // Get default placeholder text based on language
  const getDefaultText = (lang: string, currentValue?: string) => {
    // Only return placeholder if truly empty
    if (currentValue !== undefined && currentValue !== null && currentValue.trim()) {
      return currentValue;
    }

    switch (lang) {
      case 'json':
      case 'jsonc':
        return '{\n \n}';
      case 'javascript':
        return '';
      case 'xml':
        return '';
      case 'html':
        return '';
      default:
        return '';
    }
  };

  const initialValue = tiptapProps?.node.attrs.body ?? value ?? '';
  const displayValue = initialValue || getDefaultText(lang);

  // Size-based performance tiers — larger content disables progressively more extensions
  const contentSize = displayValue.length;
  const isLargeContent = contentSize > LARGE_CONTENT_SIZE;
  const isVeryLargeContent = contentSize > VERY_LARGE_CONTENT_SIZE;

  // Store the initial value to compare against in onChange
  if (isInitialMount.current) {
    initialValueRef.current = displayValue;
  }

  const noGlobalSearch = useContext(NoGlobalSearchContext);
  const { searchTerm, matchCase, matchWholeWord, useRegex, openPanelTick } = useSearchStore(useShallow((s) => ({
    searchTerm: s.term,
    matchCase: s.matchCase,
    matchWholeWord: s.matchWholeWord,
    useRegex: s.useRegex,
    openPanelTick: s.openPanelTick,
  })));
  const handledOpenTickRef = useRef(0);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const dom = view.dom;

    // Ensure dom exists before adding listeners
    if (!dom) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.stopPropagation();
    };

    const handleCopyShortcut = (e: KeyboardEvent) => {
      // Only handle copy shortcut, don't interfere with anything else
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const sel = window.getSelection()?.toString();
        if (sel) {
          e.preventDefault();
          navigator.clipboard.writeText(sel);
        }
      }
    };

    // Prevent CodeMirror keyboard shortcuts from bubbling up to the main window
    // This fixes issues on Linux where shortcuts like Ctrl+/ would select text outside the editor
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      const isModKey = e.metaKey || e.ctrlKey;

      // Only intercept if modifier key is pressed
      // This allows normal typing without interference
      if (!isModKey) {
        // Let all regular keys (letters, numbers, Enter, Space, etc.) pass through normally
        return;
      }

      // List of CodeMirror shortcuts that should not bubble up
      const editorShortcuts = [
        '/', // Toggle comment
        'z', // Undo
        'y', // Redo (Windows/Linux)
        'g', // Go to line
        '[', // Outdent
        ']', // Indent
        'd', // Delete line
      ];

      // When embedded in TipTap, let find/replace shortcuts bubble up
      // so the unified search panel opens instead of CM's own search
      if (!tiptapProps) {
        editorShortcuts.push('f', 'h');
      }

      if (editorShortcuts.includes(e.key.toLowerCase())) {
        // Only stop propagation, DON'T prevent default
        // CodeMirror needs to handle these shortcuts itself
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      // Also stop propagation for Shift+Ctrl combinations (Redo on Windows/Linux)
      if (e.shiftKey && e.key.toLowerCase() === 'z') {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    dom.addEventListener("contextmenu", handleContextMenu, true);
    dom.addEventListener("keydown", handleCopyShortcut, true);
    dom.addEventListener("keydown", handleKeyboardShortcuts, false);
    return () => {
      dom.removeEventListener("contextmenu", handleContextMenu, true);
      dom.removeEventListener("keydown", handleCopyShortcut, true);
      dom.removeEventListener("keydown", handleKeyboardShortcuts, false);
    };
  }, [editorRef.current]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    // Embedded TipTap editors and response-panel viewers are highlighted by their
    // own search — never by the global searchParamsStore.
    if (tiptapProps || noGlobalSearch) return;
    view.dispatch({
      effects: searchEffect.of({
        term: searchTerm,
        matchCase,
        matchWholeWord,
        useRegex,
      }),
    });
  }, [searchTerm, matchCase, matchWholeWord, useRegex, noGlobalSearch]);

  // For standalone use (no tiptapProps): sync query into CM when openPanelTick fires.
  // The persistent panel is already open via the store tick.
  useEffect(() => {
    if (openPanelTick === handledOpenTickRef.current) return;
    if (tiptapProps || noGlobalSearch) return;
    const view = editorRef.current;
    if (!view) return;
    if (!view.dom.offsetParent) return;
    handledOpenTickRef.current = openPanelTick;
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: searchTerm,
        caseSensitive: matchCase,
        wholeWord: matchWholeWord,
        regexp: useRegex && isValidRegex(searchTerm),
      })),
    });
  }, [openPanelTick, searchTerm, matchCase, matchWholeWord, useRegex, tiptapProps]);

  // Get dynamic CodeMirror extensions from plugin store
  const codemirrorExtensionsFromStore = useEditorEnhancementStore((state) => state.codemirrorExtensions);

  // Create a key from extension count to force remount when extensions change
  const extensionsKey = codemirrorExtensionsFromStore.length;

  const extensions = [
    searchField,
    // Unified search highlight support (used by both VoidenEditor and ResponsePanel)
    unifiedSearchField,
    // When embedded in TipTap, skip CM's search extension entirely —
    // the unified search panel handles find/replace
    ...(tiptapProps ? [] : [search({ top: true, createPanel: () => ({ dom: document.createElement("div") }) })]),
    // Disable selection matching for large content — it scans the full doc on every selection
    ...(isLargeContent ? [] : [highlightSelectionMatches()]),
    EditorView.theme({
      "&": {
        "--editor-selection": "rgba(255, 99, 132, 0.6)",
      },
    }),
    // Very large content: skip syntax highlight entirely (lezer parses the full doc)
    // Large content: keep highlight but skip the linter (expensive on huge files)
    ...((isVeryLargeContent && !forceHighlight) ? [] : renderLang(lang, isLargeContent)),
    // Disable env-variable decorations for large content — needlessly scans full doc
    ...(isLargeContent ? [] : [createHighlightPlugin(activeEnvData, processData)]),
    // Indentation support
    indentOnInput(),
    indentUnit.of("  "),
    // Line wrapping: off for very large content (wrapping many chars → DOM bloat)
    ...(isVeryLargeContent ? [] : [EditorView.lineWrapping]),
    ...codemirrorExtensionsFromStore, // Add dynamic extensions from plugins
    // Custom inline linter from validateFn prop (skip for large content)
    ...(!isLargeContent && validateFn ? [
      lintTooltipTheme,
      lintGutter(),
      linter((view) => {
        const content = view.state.doc.toString();
        const allResults = validateFn(content);
        const results = allResults.length > 100 ? allResults.slice(0, 100) : allResults;
        return results.map((r) => {
          try {
            const line = view.state.doc.line(r.line);
            const from = line.from + Math.max(0, r.column - 1);
            const to = line.to;
            return {
              from,
              to,
              message: r.message,
              severity: (r.severity || 'error') as 'error' | 'warning' | 'info',
              renderMessage: () => {
                const box = document.createElement('div');
                box.style.cssText = 'padding:6px 10px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-width:320px;';
                box.textContent = r.message;
                return box;
              },
            };
          } catch {
            return null;
          }
        }).filter(Boolean) as any[];
      }),
    ] : []),
    // Filter out Ctrl-w from defaultKeymap to allow browser tab closing
    keymap.of(defaultKeymap.filter(binding => {
      return binding.key !== "Ctrl-w" && binding.key !== "Mod-w";
    })),
    Prec.highest(keymap.of([
      // For standalone use, override Mod-f/h to open the persistent panel.
      // For tiptap-embedded use, these bubble up to the VoidenEditor handler.
      ...(tiptapProps ? [] : [
        {
          key: "Mod-f", preventDefault: true, run: () => {
            useSearchStore.getState().setShowReplace(false);
            useSearchStore.getState().setIsOpen(true);
            useSearchStore.getState().setUnifiedSearchActive(true);
            return true;
          }
        },
        {
          key: "Mod-h", preventDefault: true, run: () => {
            useSearchStore.getState().setShowReplace(true);
            useSearchStore.getState().setIsOpen(true);
            useSearchStore.getState().setUnifiedSearchActive(true);
            return true;
          }
        },
        { key: "F3", run: findNext },
        { key: "Mod-g", run: findNext },
        { key: "Shift-F3", run: findPrevious },
        { key: "Shift-Mod-g", run: findPrevious },
      ]),
      {
        key: "Escape", run: () => {
          const store = useSearchStore.getState();
          if (!store.isOpen) return false;
          store.setIsOpen(false);
          store.setUnifiedSearchActive(false);
          return true;
        }
      }
    ])),
  ];

  // Only add codemirrorKeymap for editable editors
  // Read-only editors (like in BlockPreviewEditor) shouldn't navigate out
  if (tiptapProps && !effectiveReadOnly) {
    extensions.push(
      keymap.of([...(codemirrorKeymap(tiptapProps) as KeyBinding[])])
    );
  }

  extensions.push(
    Prec.highest(
      keymap.of([
        {
          key: "Ctrl-/",
          run: (lang === "json" || lang === "jsonc") ? toggleCommentJSON : toggleComment,
          preventDefault: true,
        },
        {
          key: "Mod-/",
          run: (lang === "json" || lang === "jsonc") ? toggleCommentJSON : toggleComment,
          preventDefault: true,
        },
      ])
    )
  );

  extensions.push(
    Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => true,
          preventDefault: true,
        },
      ])
    )
  );

  extensions.push(
    Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            globalSaveFile().catch(console.error);
            return true;
          },
        },
      ])
    )
  );

  // Only add seamless navigation for editable editors
  // Read-only editors (like in BlockPreviewEditor) shouldn't navigate out
  if (tiptapProps && !effectiveReadOnly) {
    extensions.push(
      Prec.highest(
        keymap.of([
          {
            key: "ArrowUp",
            run: (view) => {
              const { state } = view;
              const line = state.doc.lineAt(state.selection.main.head);
              // Navigate out if on first line
              if (line.number === 1) {
                const { editor, getPos } = tiptapProps;
                const pos = getPos();
                if (pos > 0) {
                  // Try to set position before the block
                  // If it fails, appendTransaction will fix it
                  try {
                    editor.commands.focus();
                    editor.commands.setTextSelection(pos - 1);
                  } catch (e) {
                    // Position is invalid, try setting to the start of the node
                    try {
                      editor.commands.focus();
                      editor.commands.setTextSelection(pos);
                    } catch (e2) {
                      return false;
                    }
                  }
                }
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowDown",
            run: (view) => {
              const { state } = view;
              const totalLines = state.doc.lines;
              const line = state.doc.lineAt(state.selection.main.head);
              // Navigate out if on last line
              if (line.number === totalLines) {
                const { editor, getPos, node } = tiptapProps;
                const pos = getPos();
                const endPos = pos + node.nodeSize;

                try {
                  // If we're at the end of document, stay in CodeMirror
                  if (endPos >= editor.state.doc.content.size) {
                    return false;
                  }
                  editor.commands.focus();
                  editor.commands.setTextSelection(endPos);
                } catch (e) {
                  return false;
                }
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowLeft",
            run: (view) => {
              const { state } = view;
              const { main } = state.selection;

              if (main.empty && main.head === 0) {
                const { editor, getPos } = tiptapProps;
                const pos = getPos();
                if (pos > 0) {
                  try {
                    editor.commands.focus();
                    editor.commands.setTextSelection(pos - 1);
                    return true; // Only return true after successful navigation
                  } catch (e) {
                    return false; // Let CodeMirror handle it if navigation fails
                  }
                }
              }
              return false; // Let CodeMirror handle normal left arrow
            },
          },
          {
            key: "ArrowRight",
            run: (view) => {
              const { state } = view;
              const { main } = state.selection;
              const docLength = state.doc.length;

              // Only navigate out if there's no selection and cursor is at the end
              if (main.empty && main.head === docLength) {
                const { editor, getPos, node } = tiptapProps;
                const pos = getPos();
                const endPos = pos + node.nodeSize;

                try {
                  if (endPos >= editor.state.doc.content.size) {
                    return false;
                  }
                  editor.commands.focus();
                  editor.commands.setTextSelection(endPos);
                  return true; // Only return true after successful navigation
                } catch (e) {
                  return false; // Let CodeMirror handle it if navigation fails
                }
              }
              return false; // Let CodeMirror handle normal right arrow
            },
          },
        ])
      )
    );
  }

  useEffect(() => {
    if (autofocus && editorRef.current) {
      // Use a longer delay to ensure CodeMirror is fully initialized
      const timeoutId = setTimeout(() => {
        const view = editorRef.current;
        if (view) {
          // First ensure the DOM element is focused
          view.dom.focus();
          // Then focus the CodeMirror view
          view.focus();

          // For empty JSON objects, position cursor between braces
          const content = view.state.doc.toString();
          // Match format: {\n  \n} (opening brace, newline, spaces, newline, closing brace)
          if ((lang === 'json' || lang === 'jsonc') && /^\{\s+\}$/s.test(content)) {
            // Position cursor on the line with indentation (line 2)
            // This puts the cursor after the indentation spaces on the empty line
            const secondLine = view.state.doc.line(2);
            const indentMatch = secondLine.text.match(/^(\s*)/);
            const indentLength = indentMatch ? indentMatch[1].length : 0;
            view.dispatch({
              selection: { anchor: secondLine.from + indentLength }
            });
          } else {
            view.dispatch({
              selection: { anchor: view.state.doc.length }
            });
          }
        }
      }, 100); // Increased delay to 100ms

      return () => clearTimeout(timeoutId);
    }
  }, [lang]);
  return (
    <div
      onClick={() => {
        const view = editorRef.current;
        if (view) {
          view.dom.focus();
          view.focus();
        }
      }}
      onPasteCapture={(event: React.ClipboardEvent) => {
        const pasted = event.clipboardData.getData("text");
        if (!pasted || lang !== "javascript") return;
        try {
          const pretty = prettifyJSONC(pasted);
          const view = editorRef.current;
          if (view) {
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: pretty },
            });
          }
          event.preventDefault();
        } catch (e) {
        }
      }}
    >
      <CodeMirror
        key={`codemirror-${extensionsKey}`}
        lang={lang}
        theme={voidenTheme}
        readOnly={effectiveReadOnly}
        value={displayValue}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          // Disable built-in search when embedded in TipTap — unified search handles it
          searchKeymap: !tiptapProps,
        }}
        onCreateEditor={(view) => {
          editorRef.current = view;

          const cmElement = view.dom.closest('.cm-editor') as any;
          if (cmElement) {
            cmElement.cmView = view;
          }
          if (autofocus) {
            setTimeout(() => {
              if (view && editorRef.current === view) {
                // First ensure the DOM element is focused
                view.dom.focus();
                // Then focus the CodeMirror view
                view.focus();

                // For empty JSON objects, position cursor between braces
                const content = view.state.doc.toString();
                // Match format: {\n  \n} (opening brace, newline, spaces, newline, closing brace)
                if ((lang === 'json' || lang === 'jsonc') && /^\{\s+\}$/s.test(content)) {
                  // Position cursor on the line with indentation (line 2)
                  // This puts the cursor after the indentation spaces on the empty line
                  const secondLine = view.state.doc.line(2);
                  const indentMatch = secondLine.text.match(/^(\s*)/);
                  const indentLength = indentMatch ? indentMatch[1].length : 0;
                  view.dispatch({
                    selection: { anchor: secondLine.from + indentLength }
                  });
                } else {
                  view.dispatch({
                    selection: { anchor: view.state.doc.length }
                  });
                }
              }
            }, 100); // 100ms delay for initialization
          }

          setTimeout(() => {
            isInitialMount.current = false;
          }, 150);
        }}
        onChange={(value) => {
          if (isInitialMount.current && value === initialValueRef.current) {
            return;
          }

          if (tiptapProps && isParentEditable) {
            queueMicrotask(() => {
              tiptapProps.updateAttributes({ body: value });
            });
          }
          if (onChange) {
            queueMicrotask(() => {
              onChange(value);
            });
          }
        }}
      />
    </div>
  );
};
