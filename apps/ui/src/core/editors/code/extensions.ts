import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { bracketMatching, indentOnInput, foldKeymap, indentUnit } from "@codemirror/language";
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { defaultKeymap, history, historyKeymap, toggleComment, commentKeymap } from "@codemirror/commands";
import { lintKeymap, linter, Diagnostic } from "@codemirror/lint";
import { Extension } from "@codemirror/state";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { parser as htmlParser } from "@lezer/html";
import { parser as xmlParser } from "@lezer/xml";
import { tags as t } from "@lezer/highlight";
import { createTheme, type CreateThemeOptions } from "@uiw/codemirror-themes";
import { LRParser } from "@lezer/lr";

// THEME

const config = {
  // UI colors (dark stone-based)
  background: "#1c1917", // stone-900
  foreground: "#fafaf9", // stone-50
  caret: "#fafaf9", // stone-50
  selection: "#292524", // stone-800
  lineHighlight: "#292524", // stone-800 with some transparency

  // Syntax highlighting colors - using vibrant colors against dark bg
  keyword: "#60a5fa", // blue-400
  variable: "#c084fc", // purple-400
  function: "#f87171", // red-400
  string: "#4ade80", // green-400
  constant: "#fb923c", // orange-400
  type: "#c084fc", // purple-400
  class: "#f87171", // red-400
  number: "#fb923c", // orange-400
  comment: "#78716c", // stone-500
  heading: "#f87171", // red-400
  invalid: "#f87171", // red-400
  regexp: "#60a5fa", // blue-400
  tag: "#60a5fa", // blue-400
};

const defaultSettingsQuietlight: CreateThemeOptions["settings"] = {
  background: config.background,
  foreground: config.foreground,
  caret: config.caret,
  selection: "#57534e",
  selectionMatch: "#44403c", // gray-600 - for matching selections
  gutterBackground: config.background,
  gutterForeground: "#78716c", // stone-500 to match comment color
  gutterBorder: "transparent",
  lineHighlight: config.lineHighlight,
  fontSize: "var(--font-size-base)",
  fontFamily: "var(--font-family-mono, monospace)",
};

const quietlightStyle: CreateThemeOptions["styles"] = [
  { tag: t.emphasis, backgroundColor: "#44403c" }, // Add this for word selection highlighting
  { tag: t.keyword, color: config.keyword },
  {
    tag: [t.name, t.deleted, t.character, t.macroName],
    color: config.variable,
  },
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

const voidenTheme: Extension = createTheme({
  theme: "dark",
  settings: {
    ...defaultSettingsQuietlight,
    background: config.background,
    foreground: config.foreground,
    caret: config.caret,
    selection: "#57534e",
    selectionMatch: "#44403c",
    gutterBackground: config.background,
    gutterForeground: "#78716c",
    gutterBorder: "transparent",
    lineHighlight: config.lineHighlight,
  },
  styles: quietlightStyle,
});

// Helper function to create a linter for JSON
const jsonLinter = linter((view) => {
  try {
    JSON.parse(view.state.doc.toString());
    return [];
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON";
    return [
      {
        from: 0,
        to: view.state.doc.length,
        severity: "error",
        message,
      },
    ];
  }
});

// Helper function to create a linter for HTML/XML
const markupLinter = (parser: LRParser) => {
  return linter((view) => {
    const diagnostics: Diagnostic[] = [];
    const content = view.state.doc.toString();

    try {
      parser.parse(content);
    } catch (e) {
      if (e instanceof Error) {
        // Basic error location detection
        const lineMatch = e.message.match(/line (\d+)/);
        const line = lineMatch ? parseInt(lineMatch[1]) - 1 : 0;
        const pos = view.state.doc.line(line + 1).from;

        diagnostics.push({
          from: pos,
          to: pos + 1,
          severity: "error",
          message: e.message,
        });
      }
    }

    return diagnostics;
  });
};

// Get language-specific linter based on file extension
const getLinter = (filePath: string): Extension => {
  const extension = filePath.split(".").pop()?.toLowerCase();
  switch (extension) {
    // case 'js':
    // case 'jsx':
    // case 'ts':
    // case 'tsx':
    //   return linter(esLint({
    //     configuration: eslintConfig,
    //     eslint: {
    //       baseConfig: eslintConfig,
    //       overrideConfig: [],
    //       useEslintrc: false
    //     }
    //   })
    // );
    case "json":
      return jsonLinter;
    case "html":
    case "htm":
      return markupLinter(htmlParser);
    case "xml":
    case "svg":
      return markupLinter(xmlParser);
    default:
      return [];
  }
};

// Base editor configuration with syntax features
const getBaseExtensions = (): Extension[] => [
  // Syntax highlighting
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

  // Bracket handling
  bracketMatching(),
  closeBrackets(),

  // Indentation
  indentOnInput(),
  indentUnit.of("  "),

  // Search and highlight
  highlightSelectionMatches(),

  // History (undo/redo)
  history(),

  // Autocompletion
  autocompletion(),

  // Editor view configuration
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),

  // Combine all keymaps into a single extension
  // commentKeymap should come first to ensure Ctrl+/ isn't overridden by other keymaps
  keymap.of([...commentKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, ...closeBracketsKeymap, ...defaultKeymap]),
];

// Helper function to determine language extension based on file path
const getLanguageExtension = (filePath: string): Extension => {
  const extension = filePath.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return javascript();
    case "json":
      return json();
    case "html":
    case "htm":
      return html();
    case "xml":
    case "svg":
      return xml();
    default:
      return javascript(); // fallback to javascript
  }
};

export { getBaseExtensions, getLanguageExtension, getLinter, voidenTheme };
