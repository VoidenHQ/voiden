/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
//@ts-nocheck

import { applyEdits, format, Node, parseTree, stripComments as stripComments_ } from "jsonc-parser";
import jsonParse from "./jsoncParse";
import { EditorView } from "codemirror";
import { Diagnostic } from "@codemirror/lint";

export type LinterResult = {
  message: string;
  severity: "warning" | "error";
  from: { line: number; ch: number };
  to: { line: number; ch: number };
};
export type LinterDefinition = (text: string) => Promise<LinterResult[]>;

export function convertIndexToLineCh(text: string, i: number): { line: number; ch: number } {
  const lines = text.split("\n");

  let line = 0;
  let counter = 0;

  while (line < lines.length) {
    if (i > lines[line].length + counter) {
      counter += lines[line].length + 1;
      line++;
    } else {
      return {
        line: line + 1,
        ch: i - counter + 1,
      };
    }
  }

  throw new Error("Invalid input");
}

export function convertLineChToIndex(text: string, lineCh: { line: number; ch: number }): number {
  const textSplit = text.split("\n");

  if (textSplit.length < lineCh.line) throw new Error("Invalid position");

  const tillLineIndex = textSplit.slice(0, lineCh.line).reduce((acc, line) => acc + line.length + 1, 0);

  return tillLineIndex + lineCh.ch;
}

/**
 * Replaces template expressions with valid JSON placeholders for validation
 * Supports: {{process.var}}, {{$req.body}}, {{$res.body}}, {{$faker.name}}, {{ENV_VAR}}
 */
function replaceTemplateExpressionsForValidation(text: string): string {
  // Replace templates within strings with placeholder text
  // This handles cases like "some text {{var}} more text"
  let result = text.replace(/"([^"]*\{\{[^}]+\}\}[^"]*)"/g, (match, content) => {
    // Replace all {{...}} within this string with PLACEHOLDER
    const replaced = content.replace(/\{\{[^}]+\}\}/g, 'PLACEHOLDER');
    return `"${replaced}"`;
  });

  // Replace any remaining standalone unquoted templates with quoted placeholder
  result = result.replace(/\{\{[^}]+\}\}/g, '"PLACEHOLDER"');

  return result;
}

const linter: LinterDefinition = (text) => {
  try {
    // Replace template expressions with valid JSON before validation
    const textForValidation = replaceTemplateExpressionsForValidation(text);
    jsonParse(textForValidation);
    return Promise.resolve([]);
  } catch (e: any) {
    return Promise.resolve([
      <LinterResult>{
        from: convertIndexToLineCh(text, e.start),
        to: convertIndexToLineCh(text, e.end),
        message: e.message,
        severity: "error",
      },
    ]);
  }
};

/**
 * An internal error that is thrown when an invalid JSONC node configuration
 * is encountered
 */
class InvalidJSONCNodeError extends Error {
  constructor() {
    super();
    this.message = "Invalid JSONC node";
  }
}

// NOTE: If we choose to export this function, do refactor it to return a result discriminated union instead of throwing
/**
 * @throws {InvalidJSONCNodeError} if the node is in an invalid configuration
 * @returns The JSON string without comments and trailing commas or null
 * if the conversion failed
 */
function convertNodeToJSON(node: Node): string {
  switch (node.type) {
    case "string":
      return JSON.stringify(node.value);
    case "null":
      return "null";
    case "array":
      if (!node.children) {
        throw new InvalidJSONCNodeError();
      }

      return `[${node.children.map((child) => convertNodeToJSON(child)).join(",")}]`;
    case "number":
      return JSON.stringify(node.value);
    case "boolean":
      return JSON.stringify(node.value);
    case "object":
      if (!node.children) {
        throw new InvalidJSONCNodeError();
      }

      return `{${node.children.map((child) => convertNodeToJSON(child)).join(",")}}`;
    case "property": {
      if (!node.children || node.children.length !== 2) {
        throw new InvalidJSONCNodeError();
      }

      const [keyNode, valueNode] = node.children;

      // If the valueNode configuration is wrong, this will return an error, which will propagate up
      return `${JSON.stringify(keyNode)}:${convertNodeToJSON(valueNode)}`;
    }
  }
}

function stripCommentsAndCommas(text: string): string {
  const tree = parseTree(text, undefined, {
    allowEmptyContent: true,
    allowTrailingComma: true,
  });

  // If we couldn't parse the tree, return the original text
  if (!tree) {
    return text;
  }

  // convertNodeToJSON can throw an error if the tree is invalid
  try {
    return convertNodeToJSON(tree);
  } catch (_) {
    return text;
  }
}

/**
 * Removes comments from a JSON string.
 * @param jsonString The JSON string with comments.
 * @returns The JSON string without comments.
 */

export function stripComments(jsonString: string) {
  return stripCommentsAndCommas(stripComments_(jsonString));
}

export default linter;

const JSON_LINT_SIZE_LIMIT = 500 * 1024;

export const jsonCLinter = async (view: EditorView) => {
  if (view.state.doc.length > JSON_LINT_SIZE_LIMIT) return [];
  const diagnostics: Diagnostic[] = [];
  const code = view.state.doc.toString();

  const lintResults = await linter(code);

  for (const result of lintResults) {
    diagnostics.push({
      from: view.state.doc.line(result.from.line).from + result.from.ch - 1,
      to: view.state.doc.line(result.to.line).from + result.to.ch - 1,
      severity: result.severity,
      message: result.message,
    });
  }

  return diagnostics;
};

export function prettifyJSONC(str: string) {
  const editResult = format(str, undefined, {
    insertSpaces: true,
    tabSize: 2,
  });
  return applyEdits(str, editResult);
}
