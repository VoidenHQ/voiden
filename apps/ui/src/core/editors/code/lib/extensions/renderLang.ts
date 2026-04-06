import { jsonCLinter } from "@/utils/jsonc.ts";
import { javascript } from "@codemirror/lang-javascript";
import { yaml } from "@codemirror/lang-yaml";
import { linter } from "@codemirror/lint";
import { jsonc } from "@shopify/lang-jsonc";
import { langs } from "@uiw/codemirror-extensions-langs";
import { EditorView } from "codemirror";

export const renderLang = (lang: string, skipLint = false) => {
  switch (lang) {
    case "javascript":
      return [javascript()];
    case "json":
    case "jsonc":
      // Using jsonc parser - template expressions will be handled by variable highlighting
      return skipLint ? [jsonc()] : [jsonc(), linter(jsonCLinter)];
    case "xml":
      return [langs.xml()];
    case "html":
      return [langs.html()];
    case "csharp":
      return [langs.csharp()];
    case "yaml":
      return [yaml()];
    case "python":
      return [langs.python()];
    case "text":
    case "plaintext":
      return []; // No syntax highlighting for plain text
    default:
      return [javascript()];
  }
};

export const toggleComment = (view: EditorView) => {
  const { state, dispatch } = view;
  const selection = state.selection.main;

  if (selection.empty) {
    const line = state.doc.lineAt(selection.from);
    const lineText = line.text;

    const commented = lineText.trimStart().startsWith("//");
    const indent = lineText.match(/^(\s*)/)?.[1] ?? "";

    const updatedText = commented
      ? lineText.replace(/^(\s*)\/\/\s?/, "$1") // Remove // while preserving indent
      : `${indent}// ${lineText.trimStart()}`; // Add // after indent

    dispatch(state.update({ changes: { from: line.from, to: line.to, insert: updatedText } }));
    return true;
  }

  const selectedText = state.doc.sliceString(selection.from, selection.to);
  const lines = selectedText.split("\n");

  // Only consider non-empty lines when deciding whether all are commented
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const commented = nonEmptyLines.length > 0 && nonEmptyLines.every((l) => l.trimStart().startsWith("//"));

  const updatedText = commented
    ? selectedText.replace(/(^|\n)(\s*)\/\/\s?/g, "$1$2") // Uncomment
    : selectedText.replace(/(^|\n)(\s*)/g, "$1$2// "); // Comment (preserve indent, add space)

  dispatch(state.update({ changes: { from: selection.from, to: selection.to, insert: updatedText } }));
  return true;
};
