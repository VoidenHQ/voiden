import { search, highlightSelectionMatches, replaceNext, replaceAll, setSearchQuery, SearchQuery, getSearchQuery, openSearchPanel, closeSearchPanel } from '@codemirror/search';
import { isValidRegex } from "@/core/file-system/components/RegexHighlightOverlay";
import { useSearchStore as useEditorSearchStore, type SearchCallbacks } from "@/core/stores/searchParamsStore";
import { useCallback, useMemo, useState, useEffect, useLayoutEffect, memo, useRef } from "react";
import { Compartment, RangeSetBuilder } from "@codemirror/state";
import ReactCodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap, ViewUpdate, Decoration, DecorationSet, ViewPlugin } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useEditorStore } from "../voiden/VoidenEditor";
import { tags as t } from "@lezer/highlight";
import { createTheme, type CreateThemeOptions } from "@uiw/codemirror-themes";
import { linter, lintGutter } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";

import {
  javascript
} from "@codemirror/lang-javascript";
import { json, jsonParseLinter } from "@codemirror/lang-json";
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
  selection: "var(--editor-selection-bg)",
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
  selectionMatch: "var(--editor-selection-match)",
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
    display: "none !important",
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
  ".cm-searchMatch": {
    borderRadius: "2px",
  },
});

export const voidenTheme = [quietlightInit(), searchPanelTheme];

const emptyRegexSearchMark = Decoration.mark({ class: "cm-searchMatch" });
const activeMatchMark = Decoration.mark({ class: "cm-active-match" });

// CM's built-in search skips zero-length matches (e.g. from `w*`), so they never
// get a cm-searchMatch decoration. This plugin finds those zero-length matches and
// expands each to a 1-char highlight so they're visually apparent.
const emptyRegexSearchHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some(tr => tr.effects.some(e => e.is(setSearchQuery)))) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const q = getSearchQuery(view.state);
      if (!q.search || !q.regexp) return Decoration.none;
      const docLen = view.state.doc.length;
      const builder = new RangeSetBuilder<Decoration>();
      try {
        const cursor = q.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
        for (let n = cursor.next(); !n.done; n = cursor.next()) {
          const { from, to } = n.value;
          if (from === to && from < docLen) builder.add(from, from + 1, emptyRegexSearchMark);
        }
      } catch { return Decoration.none; }
      return builder.finish();
    }
  },
  { decorations: v => v.decorations },
);

// Tracks the active (navigated-to) match independently of CM's cm-searchMatch-selected,
// which can be unreliable when selection is dispatched programmatically.
const activeMatchHighlighter = Prec.high(ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(e => e.is(setSearchQuery)))) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const q = getSearchQuery(view.state);
      if (!q.search) return Decoration.none;
      const sel = view.state.selection.main;
      const docLen = view.state.doc.length;
      const builder = new RangeSetBuilder<Decoration>();
      try {
        const cursor = q.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
        for (let n = cursor.next(); !n.done; n = cursor.next()) {
          const { from, to } = n.value;
          const isZeroLen = from === to;
          const markTo = isZeroLen ? Math.min(from + 1, docLen) : to;
          if (markTo <= from) continue;
          const isActive = isZeroLen
            ? sel.from === from && sel.to === from
            : sel.from >= from && sel.to <= to;
          if (isActive) { builder.add(from, markTo, activeMatchMark); break; }
        }
      } catch { return Decoration.none; }
      return builder.finish();
    }
  },
  { decorations: v => v.decorations },
));

function scrollMatchIntoView(view: EditorView) {
  requestAnimationFrame(() => {
    const scrollEl = document.getElementById("code-editor-container");
    if (!scrollEl) return;
    const pos = view.state.selection.main.head;
    const coords = view.coordsAtPos(pos);
    if (!coords) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const relativeTop = coords.top - containerRect.top + scrollEl.scrollTop;
    scrollEl.scrollTop = Math.max(0, relativeTop - scrollEl.clientHeight / 2);
  });
}

function navigateNext(view: EditorView) {
  const q = getSearchQuery(view.state);
  if (!q.search) return;
  const sel = view.state.selection.main;
  // Advance past zero-length matches to avoid getting stuck at the same position.
  const from = sel.from === sel.to ? sel.to + 1 : sel.to;
  const docLen = view.state.doc.length;
  try {
    let match: { from: number; to: number } | null = null;
    if (from <= docLen) {
      const c = q.getCursor(view.state.doc, from) as Iterator<{ from: number; to: number }>;
      const n = c.next();
      if (!n.done) match = n.value;
    }
    if (!match) {
      const c = q.getCursor(view.state.doc, 0) as Iterator<{ from: number; to: number }>;
      const n = c.next();
      if (!n.done) match = n.value;
    }
    if (match) view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  } catch { /* invalid regex */ }
}

function navigatePrev(view: EditorView) {
  const q = getSearchQuery(view.state);
  if (!q.search) return;
  const before = view.state.selection.main.from;
  try {
    let lastMatch: { from: number; to: number } | null = null;
    const c = q.getCursor(view.state.doc, 0) as Iterator<{ from: number; to: number }>;
    for (let n = c.next(); !n.done; n = c.next()) {
      if (n.value.from >= before) break;
      lastMatch = n.value;
    }
    if (!lastMatch) {
      const c2 = q.getCursor(view.state.doc, 0) as Iterator<{ from: number; to: number }>;
      for (let n = c2.next(); !n.done; n = c2.next()) lastMatch = n.value;
    }
    if (lastMatch) view.dispatch({ selection: { anchor: lastMatch.from, head: lastMatch.to }, scrollIntoView: true });
  } catch { /* invalid regex */ }
}

function navigateToFirst(view: EditorView) {
  const q = getSearchQuery(view.state);
  if (!q.search) return;
  try {
    const c = q.getCursor(view.state.doc, 0) as Iterator<{ from: number; to: number }>;
    const n = c.next();
    if (!n.done) view.dispatch({ selection: { anchor: n.value.from, head: n.value.to }, scrollIntoView: true });
  } catch { /* invalid regex */ }
}


const YAML_SPECTRAL_SIZE_LIMIT = 500 * 1024;
const myYamlLinter = linter((view) => {
  if (view.state.doc.length > YAML_SPECTRAL_SIZE_LIMIT) return Promise.resolve([]);
  return lintYaml(view, []);
}, { delay: 1000 });

const myJsonOASLinter = linter((view) => lintYaml(view, []), { delay: 1000 });

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

const syntaxErrorLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  syntaxTree(view.state).cursor().iterate((node) => {
    if (node.type.isError) {
      diagnostics.push({
        from: node.from,
        to: Math.max(node.to, node.from + 1),
        severity: "error",
        message: "Syntax error",
      });
    }
  });
  return diagnostics;
});

const getLintExtensions = (ext: string | undefined) => {
  if (ext === "json") return [lintGutterTheme, lintGutter(), linter(jsonParseLinter()), myJsonOASLinter];
  if (ext === "yml" || ext === "yaml") return [lintGutterTheme, lintGutter(), myYamlLinter];
  if (ext) return [lintGutterTheme, lintGutter(), syntaxErrorLinter];
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
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const { setUnsaved, clearUnsaved, setScrollPosition, getScrollPosition } = useEditorStore((state) => ({
    setUnsaved: state.setUnsaved,
    clearUnsaved: state.clearUnsaved,
    setScrollPosition: state.setScrollPosition,
    getScrollPosition: state.getScrollPosition,
  }));

  const { setActiveEditor, updateContent, setEditor, registerEditorView, unregisterEditorView, setStreamSnapshot } = useCodeEditorStore();

  const searchTerm = useEditorSearchStore((s) => s.term);
  const matchCase = useEditorSearchStore((s) => s.matchCase);
  const matchWholeWord = useEditorSearchStore((s) => s.matchWholeWord);
  const useRegex = useEditorSearchStore((s) => s.useRegex);
  const replaceTerm = useEditorSearchStore((s) => s.replaceTerm);

  const prevQueryRef = useRef({ term: searchTerm, matchCase, matchWholeWord, useRegex });

  // Push store search params into CM whenever they change while this editor is active.
  // When the query itself changes (not just editorView/isActive re-firing), navigate to
  // the first match from position 0 so search always starts at the top of the document.
  useEffect(() => {
    if (!editorView || !isActive) return;
    const prev = prevQueryRef.current;
    const queryChanged =
      searchTerm !== prev.term ||
      matchCase !== prev.matchCase ||
      matchWholeWord !== prev.matchWholeWord ||
      useRegex !== prev.useRegex;
    prevQueryRef.current = { term: searchTerm, matchCase, matchWholeWord, useRegex };
    editorView.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: searchTerm,
        caseSensitive: matchCase,
        wholeWord: matchWholeWord,
        regexp: useRegex && isValidRegex(searchTerm),
        replace: replaceTerm,
      })),
    });
    if (queryChanged && searchTerm && useEditorSearchStore.getState().isOpen) {
      // Skip if a targeted line jump is pending — storeTargetLine effect handles it.
      if (useEditorSearchStore.getState().targetLine === null) {
        navigateToFirst(editorView);
        scrollMatchIntoView(editorView);
      }
    }
  }, [searchTerm, matchCase, matchWholeWord, useRegex, replaceTerm, editorView, isActive]);

  const cmStatusCacheRef = useRef<{ query: string; docLen: number; count: number } | null>(null);

  const computeCmStatus = (view: EditorView): string => {
    try {
      const q = getSearchQuery(view.state);
      if (!q.search) return "";

      // If regex mode is on but the current term is not a valid regex, show an error
      // instead of attempting to iterate matches (which would throw).
      const { useRegex, term } = useEditorSearchStore.getState();
      if (useRegex && term && !isValidRegex(term)) return "Invalid regex";

      const sel = view.state.selection.main;
      const docLen = view.state.doc.length;
      const cacheKey = `${q.search}|${q.caseSensitive}|${q.wholeWord}|${q.regexp}`;

      let count: number;
      const cache = cmStatusCacheRef.current;
      if (cache && cache.query === cacheKey && cache.docLen === docLen) {
        count = cache.count;
      } else {
        const cursor = q.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
        count = 0;
        for (let n = cursor.next(); !n.done; n = cursor.next()) count++;
        cmStatusCacheRef.current = { query: cacheKey, docLen, count };
      }

      if (count === 0) return "No results";

      const cursor2 = q.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
      let currentIdx = -1;
      let idx = 0;
      for (let n = cursor2.next(); !n.done; n = cursor2.next()) {
        if (sel.from >= n.value.from && sel.to <= n.value.to) { currentIdx = idx; break; }
        idx++;
      }
      if (currentIdx >= 0) return `${currentIdx + 1} of ${count}`;
      return `${count} result${count > 1 ? "s" : ""}`;
    } catch {
      return "Invalid regex";
    }
  };

  // Register CM-backed search callbacks when this tab is active; unregister on deactivate.
  useEffect(() => {
    if (!editorView || !isActive) return;
    const { registerSearchCallbacks, unregisterSearchCallbacks } = useEditorSearchStore.getState();
    const callbacks: SearchCallbacks = {
      onFindNext: () => { navigateNext(editorView); scrollMatchIntoView(editorView); },
      onFindPrevious: () => { navigatePrev(editorView); scrollMatchIntoView(editorView); },
      onClose: () => {
        useEditorSearchStore.getState().setIsOpen(false);
        useEditorSearchStore.getState().setUnifiedSearchActive(false);
      },
      onReplace: () => { replaceNext(editorView); scrollMatchIntoView(editorView); },
      onReplaceAll: () => replaceAll(editorView),
      getStatus: () => computeCmStatus(editorView),
    };
    registerSearchCallbacks(callbacks);
    return () => { unregisterSearchCallbacks(); };
  }, [editorView, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep CM's internal search panel open/closed in sync with the store.
  // Only manages the CM panel state — navigation is handled by openPanelTick/storeTargetLine.
  const isOpen = useEditorSearchStore((s) => s.isOpen);
  useEffect(() => {
    if (!editorView || !isActive) return;
    if (isOpen) {
      openSearchPanel(editorView);
    } else {
      closeSearchPanel(editorView);
    }
  }, [isOpen, editorView, isActive]);

  // Sync store search params into CM and navigate to first match when the panel opens.
  // Initialised to the CURRENT tick so a newly-mounted editor doesn't process stale
  // ticks from before it existed (which would fire navigateToFirst before targetLine is set).
  const openPanelTick = useEditorSearchStore((s) => s.openPanelTick);
  const handledOpenTickRef = useRef(openPanelTick);
  useEffect(() => {
    if (!editorView || !isActive) return;
    if (openPanelTick === handledOpenTickRef.current) return;
    handledOpenTickRef.current = openPanelTick;
    const { term, matchCase, matchWholeWord, useRegex, targetLine } = useEditorSearchStore.getState();
    editorView.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: term,
        caseSensitive: matchCase,
        wholeWord: matchWholeWord,
        regexp: useRegex && isValidRegex(term),
      })),
    });
    // Skip first-match navigation when targetLine is set — the dedicated effect below handles it.
    if (targetLine !== null) return;
    navigateToFirst(editorView);
    scrollMatchIntoView(editorView);
  }, [openPanelTick, editorView, isActive]);

  // Dedicated effect: jump to the exact line from a search-result click.
  // Uses direct character-position navigation (not getCursor) so it works
  // regardless of whether the CM search panel is open yet.
  // Guards with targetPath so only the correct editor instance responds.
  // Retries via `content` dep when a newly-opened file's doc is still empty.
  const storeTargetLine = useEditorSearchStore((s) => s.targetLine);
  const storeTargetPath = useEditorSearchStore((s) => s.targetPath);
  const storeTargetCol = useEditorSearchStore((s) => s.targetCol);
  useEffect(() => {
    if (!editorView || !isActive || storeTargetLine === null) return;
    // Only the editor that owns the target file should respond.
    if (storeTargetPath !== null && source !== storeTargetPath) return;
    // Doc still loading — content dep will re-fire this effect when it arrives.
    if (editorView.state.doc.length === 0 && storeTargetLine > 1) return;

    const { term, matchCase, matchWholeWord, useRegex, targetCol, setTargetLine, setTargetCol, setTargetPath } = useEditorSearchStore.getState();
    setTargetLine(null);
    setTargetCol(null);
    setTargetPath(null);

    const docLines = editorView.state.doc.lines;
    const targetL = Math.min(Math.max(1, storeTargetLine), docLines);
    const lineInfo = editorView.state.doc.line(targetL);
    // Use col (1-indexed) for exact match position; fall back to line start.
    const colOffset = targetCol !== null ? Math.max(0, targetCol - 1) : 0;
    const pos = Math.min(lineInfo.from + colOffset, lineInfo.to);

    // Move cursor to the exact match position and sync the search query in one
    // atomic dispatch so CM's searchHighlighter sees both changes together and
    // renders cm-searchMatch + cm-active-match in the same update cycle.
    editorView.dispatch({
      selection: { anchor: pos, head: pos },
      effects: term ? [setSearchQuery.of(new SearchQuery({
        search: term,
        caseSensitive: matchCase,
        wholeWord: matchWholeWord,
        regexp: useRegex && isValidRegex(term),
      }))] : [],
    });

    // Scroll the custom container to centre the target line.
    // Retry at increasing delays to handle layout timing on newly mounted editors.
    const doScroll = () => {
      const scrollEl = document.getElementById("code-editor-container");
      if (!scrollEl) return false;
      const coords = editorView.coordsAtPos(pos);
      if (!coords) return false;
      const relTop = coords.top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      scrollEl.scrollTop = Math.max(0, relTop - scrollEl.clientHeight / 2);
      return true;
    };
    if (!doScroll()) {
      const delays = [50, 150, 400];
      delays.forEach(d => setTimeout(doScroll, d));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTargetLine, storeTargetCol, storeTargetPath, editorView, isActive, source, content]);

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

  // When this tab becomes the active visible tab, sync the store so callers like
  // the OpenAPI preview button always read the correct editor — not a stale one
  // from whichever tab was last typed into.
  useEffect(() => {
    if (!isActive || !editorView) return;
    const currentContent = editorView.state.doc.toString();
    setActiveEditor(tabId, currentContent, source, panelId);
    setEditor(editorView);
  }, [isActive, editorView, tabId, source, panelId, setActiveEditor, setEditor]);

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
      }
      // Programmatic scrolls (e.g. find navigation) must not be fought against —
      // the initial rAF restoration already handles tab-switch scroll restoration.
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
      search({ top: true, createPanel: () => ({ dom: document.createElement("div") }) }),
      Prec.highest(keymap.of([
        {
          key: "Mod-f", preventDefault: true, run: () => {
            useEditorSearchStore.getState().setShowReplace(false);
            useEditorSearchStore.getState().requestOpenSearchPanel();
            useEditorSearchStore.getState().setUnifiedSearchActive(true);
            return true;
          }
        },
        {
          key: "Mod-h", preventDefault: true, run: () => {
            useEditorSearchStore.getState().setShowReplace(true);
            useEditorSearchStore.getState().requestOpenSearchPanel();
            useEditorSearchStore.getState().setUnifiedSearchActive(true);
            return true;
          }
        },
        {
          key: "Escape", run: () => {
            if (!useEditorSearchStore.getState().isOpen) return false;
            useEditorSearchStore.getState().setIsOpen(false);
            useEditorSearchStore.getState().setUnifiedSearchActive(false);
            return true;
          }
        },
        { key: "F3", run: (v) => { navigateNext(v); scrollMatchIntoView(v); return true; } },
        { key: "Mod-g", run: (v) => { navigateNext(v); scrollMatchIntoView(v); return true; } },
        { key: "Shift-F3", run: (v) => { navigatePrev(v); scrollMatchIntoView(v); return true; } },
        { key: "Shift-Mod-g", run: (v) => { navigatePrev(v); scrollMatchIntoView(v); return true; } },
      ])),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (!isActiveRef.current) return;
        const { isOpen, bumpStatusTick } = useEditorSearchStore.getState();
        if (!isOpen) return;
        if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(e => e.is(setSearchQuery)))) {
          bumpStatusTick();
        }
      }),
    ];

    if (!isLargeFile && !isMediumFile) {
      baseExtensions.push(highlightSelectionMatches());
    }

    baseExtensions.push(emptyRegexSearchHighlighter);
    baseExtensions.push(activeMatchHighlighter);

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
          extensions={extensions}
          onCreateEditor={onCreateEditor}
          basicSetup={basicSetupOptions}
        />
      </div>
    </div>
  );
});

CodeEditor.displayName = 'CodeEditor';
