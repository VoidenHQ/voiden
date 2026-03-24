// CodeEditor.tsx
import { search, highlightSelectionMatches, searchKeymap, closeSearchPanel } from '@codemirror/search';
import { useCallback, useMemo, useState, useEffect, useLayoutEffect, memo } from "react";
import ReactCodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { useEditorStore } from "../voiden/VoidenEditor";
import { tags as t } from "@lezer/highlight";
import { createTheme, type CreateThemeOptions } from "@uiw/codemirror-themes";
import { linter } from "@codemirror/lint"; // New import for linter
import { createCustomSearchPanel, customSearchPanelStyles } from "./lib/extensions/customSearchPanel";

// Import language support packages from CodeMirror v6
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
  source: string; // The file path used for saving and determining the language.
  panelId: string;
  isActive?: boolean;
}

// File size threshold for performance optimizations (5MB)
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;

// Debounce helper for large file updates
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
  // UI colors - theme-aware
  background: "var(--editor-bg)",
  foreground: "var(--editor-fg)",
  caret: "var(--editor-fg)",
  selection: "var(--selection)",
  lineHighlight: "transparent",

  // Syntax highlighting colors - all theme-aware via CSS variables
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
  selectionMatch: "var(--editor-selection)", // gray-600 - for matching selections
  gutterBackground: config.background,
  gutterForeground: "var(--editor-gutter-normal)", // stone-500 to match comment color
  gutterBorder: "transparent",
  lineHighlight: config.lineHighlight,
  fontSize: "var(--font-size-base)",
  fontFamily: "var(--font-family-mono)",
};

export const quietlightStyle: CreateThemeOptions["styles"] = [
  { tag: t.emphasis, backgroundColor: "#44403c" }, // Highlight for word selection.
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

// Minimal search panel theme to match Voiden aesthetic
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

const myLinter = linter((view) => lintYaml(view));

// Helper function to determine the language extension based on the file's extension.
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

export const CodeEditor = memo(({ tabId, content, source, panelId, isActive = true }: CodeEditorProps) => {
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  // const isRenaming = useFocusStore((state) => state.isRenaming);
  const { setUnsaved, clearUnsaved, setScrollPosition, getScrollPosition } = useEditorStore((state) => ({
    setUnsaved: state.setUnsaved,
    clearUnsaved: state.clearUnsaved,
    setScrollPosition: state.setScrollPosition,
    getScrollPosition: state.getScrollPosition,
  }));

  const { setActiveEditor, updateContent, setEditor } = useCodeEditorStore();

  // Detect if this is a large file
  const isLargeFile = useMemo(() => {
    const sizeInBytes = new Blob([content]).size;
    return sizeInBytes > LARGE_FILE_THRESHOLD;
  }, [content]);

  // Create debounced update function for large files
  const debouncedUpdate = useMemo(
    () => debounce((value: string, tId: string) => {
      if (value === content) {
        clearUnsaved(tId);
      } else {
        setUnsaved(tId, value);
      }
      updateContent(value);
    }, isLargeFile ? 300 : 0), // 300ms debounce for large files
    [isLargeFile, setUnsaved, clearUnsaved, updateContent, content]
  );

  // Inject custom search panel styles once
  useEffect(() => {
    const styleId = 'custom-search-panel-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = customSearchPanelStyles;
      document.head.appendChild(style);
    }
  }, []);

  // Compute the initial content just once on mount.
  // Uses unsaved content from the store (if available) or falls back to the file's content.
  const initialContent = useMemo(() => {
    return useEditorStore.getState().unsaved[tabId] || content;
  }, [tabId, content]);

  // Store editor instance when created — state-driven so scroll effect re-runs when ready.
  const onCreateEditor = useCallback(
    (view: EditorView) => {
      if (view) {
        setEditor(view);
        setEditorView(view);
      }
    },
    [setEditor],
  );

  // Restore scroll position and keep tracking per-tab scroll.
  // currentTarget tracks where the user last intentionally scrolled to. Only wheel/touch
  // events mark a scroll as user-initiated; editor-internal scrolls (CodeMirror cursor
  // positioning, async effects) are immediately snapped back to currentTarget so they
  // never corrupt the saved position.
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
        // Editor-internal scroll — snap back to user's target
        applySavedScroll();
      }
    };

    const handleUserInteraction = () => { setUserScrolling(); };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    scrollEl.addEventListener("wheel", handleUserInteraction, { passive: true, capture: true });
    scrollEl.addEventListener("touchmove", handleUserInteraction, { passive: true, capture: true });
    scrollEl.addEventListener("keydown", handleUserInteraction, { capture: true });
    scrollEl.addEventListener("mousedown", handleUserInteraction, { capture: true });

    // Apply synchronously before the first paint so there is no visible jump.
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


  // Focus handler to track the active editor
  const handleFocus = useCallback(() => {
    setActiveEditor(tabId, initialContent, source, panelId);
  }, [tabId, initialContent, source, panelId, setActiveEditor]);

  // onChange callback that updates the unified store
  // For large files, debounce the updates to prevent UI freezing
  const onChange = useCallback(
    (value: string) => {
      if (isLargeFile) {
        // For large files, debounce the store updates
        debouncedUpdate(value, tabId);
      } else {
        // For small files, update immediately
        if (value === content) {
          clearUnsaved(tabId);
        } else {
          setUnsaved(tabId, value);
        }
        updateContent(value);
      }
    },
    [tabId, content, setUnsaved, clearUnsaved, updateContent, isLargeFile, debouncedUpdate],
  );

  // Determine the language extension based on the file extension of the source.
  // For large files, disable syntax highlighting to improve performance
  const languageExtension = useMemo(() => {
    const ext = getLanguageExtension(source);
    return ext ? [ext] : [];
  }, [source, isLargeFile]);

  // TODO: this should be refactored into a separate plugin
  // Disable linting for large files to improve performance
  const fileExtension = source.split(".").pop()?.toLowerCase();
  const lintExtension = useMemo(() => {
    if (isLargeFile) return [];
    return fileExtension === "json" || fileExtension === "yml" || fileExtension === "yaml" ? [myLinter] : [];
  }, [fileExtension, isLargeFile]);

  // Performance-focused editor configuration for large files
  const basicSetupOptions = useMemo(() => {
    if (isLargeFile) {
      return {
        foldGutter: false,
        highlightActiveLine: false,
        highlightSelectionMatches: false,
      };
    }
    return undefined;
  }, [isLargeFile]);

  // Memoize extensions array to prevent recreation on every render
  const extensions = useMemo(() => {
    const baseExtensions = [
      ...languageExtension,
      ...lintExtension,
      search({ top: true, createPanel: (view) => createCustomSearchPanel(view) }),
      keymap.of([
        ...searchKeymap,
        { key: "Escape", run: closeSearchPanel }
      ]),
    ];

    // Only add highlightSelectionMatches for smaller files
    if (!isLargeFile) {
      baseExtensions.push(highlightSelectionMatches());
    }

    return baseExtensions;
  }, [languageExtension, lintExtension, isLargeFile]);

  return (
    <div className="relative txt-editor">
      <ReactCodeMirror
        autoFocus={initialContent.length === 0}
        // readOnly={isRenaming}
        value={initialContent}
        theme={voidenTheme}
        onChange={onChange}
        onFocus={handleFocus}
        extensions={extensions}
        onCreateEditor={onCreateEditor}
        basicSetup={basicSetupOptions}
      />
    </div>
  );
});

CodeEditor.displayName = 'CodeEditor';
