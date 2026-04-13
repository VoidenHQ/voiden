import { search, highlightSelectionMatches, searchKeymap, closeSearchPanel } from '@codemirror/search';
import { useCallback, useMemo, useState, useEffect, useLayoutEffect, memo, useRef } from "react";
import { Compartment } from "@codemirror/state";
import ReactCodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { useEditorStore } from "../voiden/VoidenEditor";
import { tags as t } from "@lezer/highlight";
import { createTheme, type CreateThemeOptions } from "@uiw/codemirror-themes";
import { linter, lintGutter } from "@codemirror/lint";
import { createCustomSearchPanel, customSearchPanelStyles } from "./lib/extensions/customSearchPanel";

import {
  javascript
} from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { langs } from "@uiw/codemirror-extensions-langs";
import { useCodeEditorStore } from "./CodeEditorStore";
import { lintYaml } from "@/core/editors/code/lib/extensions/lintYaml";

interface CodeEditorProps {
  tabId: string;
  content: string;
  source: string;
  panelId: string;
  isActive?: boolean;
  streamable?: boolean;
  fullSize?: number;
}

const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;
const AUTO_ENABLE_THRESHOLD = 10 * 1024 * 1024;
const MEDIUM_FILE_THRESHOLD = 512 * 1024;

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function (...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export const config = {
  background: "var(--editor-bg)",
  foreground: "var(--editor-fg)",
  caret: "var(--editor-fg)",
  selection: "var(--selection)",
  lineHighlight: "transparent",

  keyword: "var(--syntax-keyword)",
  variable: "var(--syntax-entity)",
  function: "var(--syntax-func)",
  string: "var(--syntax-string)",
  constant: "var(--syntax-constant)",
  type: "var(--syntax-entity)",
  class: "var(--syntax-markup)",
  number: "var(--syntax-constant)",
  comment: "var(--syntax-comment)",
  heading: "var(--syntax-tag)",
  invalid: "var(--error, #f87171)",
  regexp: "var(--syntax-regexp)",
  tag: "var(--syntax-tag)",
};

const defaultSettingsQuietlight: CreateThemeOptions["settings"] = {
  background: config.background,
  foreground: config.foreground,
  caret: config.caret,
  selection: config.selection,
  selectionMatch: "var(--editor-selection)",
  gutterBackground: config.background,
  gutterForeground: "var(--editor-gutter-normal)",
  gutterBorder: "transparent",
  lineHighlight: config.lineHighlight,
  fontSize: "var(--font-size-base)",
  fontFamily: "var(--font-family-mono)",
};

export const quietlightStyle: CreateThemeOptions["styles"] = [
  { tag: t.emphasis, backgroundColor: "#44403c" },
  { tag: t.keyword, color: config.keyword },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: config.variable },
  { tag: [t.propertyName], color: config.function },
  {
    tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
    color: config.string,
  },
  { tag: [t.function(t.variableName), t.labelName], color: config.function },
  {
    tag: [t.color, t.constant(t.name), t.standard(t.name)],
    color: config.constant,
  },
  { tag: [t.definition(t.name), t.separator], color: config.variable },
  { tag: [t.className], color: config.class },
  {
    tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: config.number,
  },
  { tag: [t.typeName], color: config.type, fontStyle: config.type },
  { tag: [t.operator, t.operatorKeyword], color: config.keyword },
  { tag: [t.url, t.escape, t.regexp, t.link], color: config.regexp },
  { tag: [t.meta, t.comment], color: config.comment },
  { tag: t.tagName, color: config.tag },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: config.heading },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: config.variable },
  { tag: t.invalid, color: config.invalid },
  { tag: t.strikethrough, textDecoration: "line-through" },
];

const quietlightInit = (options?: Partial<CreateThemeOptions>) => {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme: theme,
    settings: {
      ...defaultSettingsQuietlight,
      ...settings,
    },
    styles: [...quietlightStyle, ...styles],
  });
};

const searchPanelTheme = EditorView.theme({
  ".cm-panels": {
    position: "fixed !important",
    top: "70px !important",
    bottom: "auto !important",
    right: "8px !important",
    left: "auto !important",
    zIndex: "100 !important",
    maxWidth: "550px !important",
    width: "auto !important",
  },
  ".cm-content": {
    whiteSpace: "var(--cm-whitespace) !important",
    wordBreak: "var(--cm-wordbreak) !important",
    maxWidth: "var(--cm-wrapwidth) !important",
  },
  ".cm-panels-top": {
    border: "none !important",
    maxWidth: "550px !important",
    width: "auto !important",
  },
  ".cm-panels-bottom": {
    border: "none !important",
    maxWidth: "550px !important",
    width: "auto !important",
  },
  ".cm-panel.cm-search": {
    backgroundColor: "var(--panel) !important",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "8px 12px !important",
    boxShadow: "0 2px 12px rgba(0, 0, 0, 0.3)",
    maxWidth: "700px",
    minWidth: "500px",
  },
  ".cm-textfield": {
    backgroundColor: "var(--editor-bg) !important",
    border: "1px solid var(--panel-border) !important",
    borderRadius: "4px",
    padding: "8px 12px",
    color: "var(--text) !important",
    fontSize: "14px",
    minWidth: "200px",
    flex: "1 1 auto",
    height: "36px",
    outline: "none",
    fontFamily: "var(--font-family-ui)",
    transition: "border-color 0.15s ease",
    verticalAlign: "middle",
    backgroundImage: "none !important",
    "&:focus": {
      borderColor: "var(--icon-primary) !important",
      backgroundColor: "var(--editor-bg) !important",
      boxShadow: "0 0 0 1px var(--icon-primary)",
    },
    "&::placeholder": {
      color: "var(--comment)",
    },
  },
  ".cm-button": {
    backgroundColor: "var(--active) !important",
    border: "1px solid var(--panel-border) !important",
    borderRadius: "4px",
    padding: "8px 16px",
    color: "var(--text) !important",
    fontSize: "12px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    fontFamily: "var(--font-family-ui)",
    height: "36px",
    lineHeight: "1",
    whiteSpace: "nowrap",
    flexShrink: "0",
    fontWeight: "400",
    verticalAlign: "middle",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundImage: "none !important",
    boxShadow: "none !important",
    "&:hover": {
      backgroundColor: "var(--active) !important",
      borderColor: "var(--icon-primary) !important",
      color: "var(--text) !important",
    },
    "&:active": {
      transform: "scale(0.98)",
    },
    "&[name='close']": {
      padding: "8px",
      marginLeft: "auto",
      backgroundColor: "var(--active) !important",
      border: "1px solid var(--panel-border) !important",
      fontSize: "16px",
      color: "var(--comment) !important",
      width: "36px",
      height: "36px",
      "&:hover": {
        backgroundColor: "var(--active) !important",
        color: "var(--text) !important",
        borderColor: "var(--icon-primary) !important",
      },
    },
  },
  ".cm-search-label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    color: "var(--comment)",
    whiteSpace: "nowrap",
    flexShrink: "0",
  },
  "button[name='select']": {
    display: "none",
  },
  "button[name='prev']": {
    padding: "8px !important",
    minWidth: "36px",
  },
  "button[name='next']": {
    padding: "8px !important",
    minWidth: "36px",
  },
  ".cm-panel input[type=checkbox]": {
    accentColor: "var(--icon-primary)",
    cursor: "pointer",
    width: "16px",
    height: "16px",
    margin: "0",
    flexShrink: "0",
    borderRadius: "3px",
    verticalAlign: "middle",
  },
  ".cm-search-label:has(input[type=checkbox])": {
    backgroundColor: "var(--active)",
    padding: "6px 10px",
    borderRadius: "4px",
    fontSize: "12px",
    fontFamily: "var(--font-family-mono, monospace)",
    transition: "all 0.15s ease",
    cursor: "pointer",
    "&:hover": {
      backgroundColor: "color-mix(in srgb, var(--icon-primary) 20%, var(--active))",
    },
  },
});

export const voidenTheme = [quietlightInit(), searchPanelTheme];

const YAML_SPECTRAL_SIZE_LIMIT = 500 * 1024;
const myYamlLinter = linter((view) => {
  if (view.state.doc.length > YAML_SPECTRAL_SIZE_LIMIT) return Promise.resolve([]);
  return lintYaml(view, []);
}, { delay: 2000 });

const myJsonOASLinter = linter((view) => lintYaml(view, []), { delay: 2000 });

const lintGutterTheme = EditorView.theme({
  ".cm-gutter.cm-gutter-lint": {
    backgroundColor: "var(--editor-bg)",
    minWidth: "18px",
  },
  ".cm-gutter.cm-gutter-lint .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  ".cm-lint-marker-error": { color: "#ef4444" },
  ".cm-lint-marker-warning": { color: "#f59e0b" },
  ".cm-lint-marker-info": { color: "#3b82f6" },
  ".cm-lintRange, .cm-lintRange-error, .cm-lintRange-warning, .cm-lintRange-info": {
    textDecoration: "none !important",
    background: "none !important",
  },
  ".cm-tooltip.cm-tooltip-lint": {
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundColor: "var(--panel)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.24)",
    overflow: "hidden",
    maxWidth: "320px",
  },
  ".cm-tooltip.cm-tooltip-lint .cm-diagnostic": {
    margin: "0",
    padding: "7px 10px",
    fontSize: "12px",
    lineHeight: "1.4",
    color: "var(--text)",
    backgroundColor: "var(--editor-bg)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    borderBottom: "1px solid var(--border)",
  },
  ".cm-tooltip.cm-tooltip-lint .cm-diagnostic:last-child": {
    borderBottom: "none",
  },
});

const getLintExtensions = (ext: string | undefined) => {
  if (ext === "json") return [lintGutterTheme, lintGutter(), myJsonOASLinter];
  if (ext === "yml" || ext === "yaml") return [lintGutterTheme, lintGutter(), myYamlLinter];
  return [];
};

const getLanguageExtension = (filename: string) => {
  const ext = filename?.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "md":
    case "markdown":
      return markdown({ base: markdownLanguage });
    case "py":
      return python();
    case "java":
      return java();
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
      return cpp();
    case "rs":
      return rust();
    case "sql":
      return sql();
    case "xml":
      return xml();
    case "yml":
    case "yaml":
      return yaml();
    case "sh":
    case "bash":
      return langs.shell();
    default:
      return null;
  }
};

export const CodeEditor = memo(({ tabId, content, source, panelId, isActive = true, streamable, fullSize }: CodeEditorProps) => {
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [streamProgress, setStreamProgress] = useState<number | null>(streamable ? 0 : null);
  const [canHighlight, setCanHighlight] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const [isApplyingFeatures, setIsApplyingFeatures] = useState(false);
  const langCompartment = useRef(new Compartment()).current;
  const lintCompartment = useRef(new Compartment()).current;

  const { setUnsaved, clearUnsaved, setScrollPosition, getScrollPosition } = useEditorStore((state) => ({
    setUnsaved: state.setUnsaved,
    clearUnsaved: state.clearUnsaved,
    setScrollPosition: state.setScrollPosition,
    getScrollPosition: state.getScrollPosition,
  }));

  const { setActiveEditor, updateContent, setEditor, registerEditorView, unregisterEditorView, setStreamSnapshot } = useCodeEditorStore();

  const fileExtension = source.split(".").pop()?.toLowerCase();

  const langExt = useMemo(() => {
    const ext = getLanguageExtension(source);
    return ext ?? null;
  }, [source]);


  const isLargeFile = useMemo(() => {
    if (streamable) return true;
    const sizeInBytes = new Blob([content]).size;
    return sizeInBytes > LARGE_FILE_THRESHOLD;
  }, [content, streamable]);

  const isMediumFile = useMemo(() => {
    if (isLargeFile) return false;
    const sizeInBytes = new Blob([content]).size;
    return sizeInBytes > MEDIUM_FILE_THRESHOLD;
  }, [content, isLargeFile]);

  useEffect(() => {
    if (!streamable || !source || !editorView) return;
    setActiveEditor(tabId, "", source, panelId);

    const CHUNK = 512 * 1024;
    let cancelled = false;

    (async () => {
      let offset = 0;

      while (!cancelled) {
        const result = await window.electron?.files.readChunk(source, offset, CHUNK);
        if (cancelled || !result) break;

        const { content: chunk, bytesRead, done, totalSize } = result;

        if (chunk) {
          const scrollTop = editorView.scrollDOM.scrollTop;
          editorView.dispatch({
            changes: { from: editorView.state.doc.length, insert: chunk },
          });
          editorView.scrollDOM.scrollTop = scrollTop;
        }

        offset += bytesRead;

        if (fullSize || totalSize) {
          setStreamProgress(Math.min(100, Math.round((offset / (fullSize ?? totalSize)) * 100)));
        }

        if (done) break;

        await new Promise<void>((r) => setTimeout(r, 0));
      }

      if (!cancelled) {
        setStreamProgress(null);
        const fileSize = fullSize ?? 0;
        if (fileSize <= AUTO_ENABLE_THRESHOLD) {
          setIsApplyingFeatures(true);
          editorView.dispatch({
            effects: [
              ...(langExt ? [langCompartment.reconfigure([langExt])] : []),
              lintCompartment.reconfigure(getLintExtensions(fileExtension)),
            ],
          });
          setHighlighted(true);
        } else {
          // Very large file — let the user decide
          if (langExt) setCanHighlight(true);
        }
        const snapshot = editorView.state.doc.sliceString(0, CHUNK);
        updateContent(snapshot);
        setStreamSnapshot(tabId, snapshot);
      }
    })();

    return () => { cancelled = true; };
  }, [streamable, source, editorView, fullSize, langExt, langCompartment, lintCompartment, fileExtension, updateContent, setActiveEditor, setStreamSnapshot, tabId, panelId]);

  const debouncedUpdate = useMemo(
    () => debounce((value: string, tId: string) => {
      if (value === content) {
        clearUnsaved(tId);
      } else {
        setUnsaved(tId, value);
      }
      updateContent(value);
    }, isLargeFile ? 300 : 0),
    [isLargeFile, setUnsaved, clearUnsaved, updateContent, content]
  );

  useEffect(() => {
    const styleId = 'custom-search-panel-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = customSearchPanelStyles;
      document.head.appendChild(style);
    }
  }, []);

  const initialContent = useMemo(() => {
    return useEditorStore.getState().unsaved[tabId] || content;
  }, [tabId, content]);

  const onCreateEditor = useCallback(
    (view: EditorView) => {
      if (view) {
        setActiveEditor(tabId, initialContent, source, panelId);
        setEditor(view);
        setEditorView(view);
        registerEditorView(tabId, view);
      }
    },
    [setEditor, setActiveEditor, registerEditorView, tabId, initialContent, source, panelId],
  );

  useEffect(() => {
    return () => { unregisterEditorView(tabId); };
  }, [tabId, unregisterEditorView]);

  useLayoutEffect(() => {
    if (!editorView || !isActive) return;

    const scrollEl = document.getElementById("code-editor-container") as HTMLElement | null;
    if (!scrollEl) return;

    let currentTarget = getScrollPosition(tabId);
    let isUserScrolling = false;
    let userScrollTimeout: number | null = null;

    const setUserScrolling = () => {
      isUserScrolling = true;
      if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
      userScrollTimeout = window.setTimeout(() => {
        isUserScrolling = false;
        userScrollTimeout = null;
      }, 1000);
    };

    const applySavedScroll = () => {
      if (isUserScrolling) return;
      const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      scrollEl.scrollTop = Math.min(currentTarget, maxScrollTop);
    };

    const handleScroll = () => {
      if (isUserScrolling) {
        currentTarget = scrollEl.scrollTop;
        setScrollPosition(tabId, scrollEl.scrollTop);
      } else {
        applySavedScroll();
      }
    };

    const handleUserInteraction = () => { setUserScrolling(); };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    scrollEl.addEventListener("wheel", handleUserInteraction, { passive: true, capture: true });
    scrollEl.addEventListener("touchmove", handleUserInteraction, { passive: true, capture: true });
    scrollEl.addEventListener("keydown", handleUserInteraction, { capture: true });
    scrollEl.addEventListener("mousedown", handleUserInteraction, { capture: true });

    scrollEl.style.scrollBehavior = "auto";
    applySavedScroll();

    let rafId: number;
    const timeoutIds: number[] = [];

    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        scrollEl.style.scrollBehavior = "auto";
        applySavedScroll();
        timeoutIds.push(window.setTimeout(applySavedScroll, 0));
        timeoutIds.push(window.setTimeout(applySavedScroll, 60));
        timeoutIds.push(window.setTimeout(applySavedScroll, 140));
      });
    });

    return () => {
      scrollEl.removeEventListener("scroll", handleScroll);
      scrollEl.removeEventListener("wheel", handleUserInteraction, { capture: true });
      scrollEl.removeEventListener("touchmove", handleUserInteraction, { capture: true });
      scrollEl.removeEventListener("keydown", handleUserInteraction, { capture: true });
      scrollEl.removeEventListener("mousedown", handleUserInteraction, { capture: true });
      if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
      cancelAnimationFrame(rafId);
      timeoutIds.forEach(clearTimeout);
      setScrollPosition(tabId, currentTarget);
    };
  }, [editorView, tabId, isActive, getScrollPosition, setScrollPosition]);


  const handleFocus = useCallback(() => {
    setActiveEditor(tabId, initialContent, source, panelId);
  }, [tabId, initialContent, source, panelId, setActiveEditor]);

  const onChange = useCallback(
    (value: string) => {
      // If another tab is registered as active, re-register this one.
      // Tabs stay mounted when switching, so onCreateEditor doesn't re-fire —
      // onChange is the reliable signal that THIS editor is the one being edited.
      const store = useCodeEditorStore.getState();
      if (store.activeEditor.tabId !== tabId) {
        setActiveEditor(tabId, value, source, panelId);
        if (editorView) setEditor(editorView);
      }

      if (isLargeFile) {
        debouncedUpdate(value, tabId);
      } else {
        if (value === content) {
          clearUnsaved(tabId);
        } else {
          setUnsaved(tabId, value);
        }
        updateContent(value);
      }
    },
    [tabId, content, source, panelId, editorView, setUnsaved, clearUnsaved, updateContent, setActiveEditor, setEditor, isLargeFile, debouncedUpdate],
  );

  const languageExtension = useMemo(() => {
    return [langCompartment.of((isLargeFile || isMediumFile) ? [] : (langExt ? [langExt] : []))];
  }, [isLargeFile, isMediumFile, langExt, langCompartment]);

  const basicSetupOptions = useMemo(() => {
    if (isLargeFile || isMediumFile) {
      return {
        foldGutter: false,
        highlightActiveLine: false,
        highlightSelectionMatches: false,
      };
    }
    return undefined;
  }, [isLargeFile, isMediumFile]);

  const extensions = useMemo(() => {
    const initialLint = (isLargeFile || isMediumFile) ? [] : getLintExtensions(fileExtension);

    const baseExtensions = [
      ...languageExtension,
      lintCompartment.of(initialLint),
      search({ top: true, createPanel: (view) => createCustomSearchPanel(view) }),
      keymap.of([
        ...searchKeymap,
        { key: "Escape", run: closeSearchPanel }
      ]),
    ];

    if (!isLargeFile && !isMediumFile) {
      baseExtensions.push(highlightSelectionMatches());
    }

    return baseExtensions;
  }, [languageExtension, lintCompartment, fileExtension, isLargeFile, isMediumFile]);

  useEffect(() => {
    if (!isApplyingFeatures) return;
    const t = setTimeout(() => setIsApplyingFeatures(false), 900);
    return () => clearTimeout(t);
  }, [isApplyingFeatures]);

  // For non-streamable large/medium files with lintable extensions (json/yaml),
  // linting is skipped on load — show the opt-in banner once the editor is ready.
  const isLintableExt = fileExtension === "json" || fileExtension === "yml" || fileExtension === "yaml";
  useEffect(() => {
    if (streamable || highlighted) return;
    if ((isMediumFile || isLargeFile) && isLintableExt && editorView) {
      setCanHighlight(true);
    }
  }, [streamable, isMediumFile, isLargeFile, isLintableExt, editorView, highlighted]);

  const handleEnableHighlight = useCallback(() => {
    if (!editorView) return;
    setIsApplyingFeatures(true);
    editorView.dispatch({
      effects: [
        ...(langExt ? [langCompartment.reconfigure([langExt])] : []),
        lintCompartment.reconfigure(getLintExtensions(fileExtension)),
      ],
    });
    setCanHighlight(false);
    setHighlighted(true);
  }, [editorView, langExt, langCompartment, lintCompartment, fileExtension]);

  return (
    <div className="relative txt-editor flex flex-col h-full">
      {streamProgress !== null && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-active border-b border-border flex-shrink-0 select-none">
          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-150"
              style={{ width: `${streamProgress}%` }}
            />
          </div>
          <span className="text-xs text-comment whitespace-nowrap">
            {streamProgress < 100 ? `Loading… ${streamProgress}%` : "Loaded"}
          </span>
        </div>
      )}
      {isApplyingFeatures && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-active border-b border-border flex-shrink-0 select-none">
          <svg className="animate-spin w-3 h-3 text-comment flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-comment">Applying highlighting & linting…</span>
        </div>
      )}
      {canHighlight && !highlighted && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-active border-b border-border flex-shrink-0 select-none">
          <span className="text-xs text-comment flex-1">File loaded. Syntax highlighting and linting are off for performance.</span>
          <button
            onClick={handleEnableHighlight}
            className="text-xs px-2 py-0.5 rounded border border-border text-comment hover:text-text hover:border-accent transition-colors"
          >
            Enable highlighting & linting
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ReactCodeMirror
          autoFocus={false}
          value={initialContent}
          theme={voidenTheme}
          onChange={streamable ? undefined : onChange}
          onFocus={handleFocus}
          extensions={extensions}
          onCreateEditor={onCreateEditor}
          basicSetup={basicSetupOptions}
        />
      </div>
    </div>
  );
});

CodeEditor.displayName = 'CodeEditor';
