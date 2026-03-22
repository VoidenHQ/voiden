/**
 * Utility functions for REST API extension
 */

import { Editor, Range } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    table: {
      insertTable: ({ type, rows, cols, withHeaderRow }?: { type?: string; rows?: number; cols?: number; withHeaderRow?: boolean }) => ReturnType;
      toggleRowDisabled: () => ReturnType;
      goToNextCell: () => ReturnType;
      addRowAfter: () => ReturnType;
      deleteTable: () => ReturnType;
      deleteTableRow: () => ReturnType;
      deleteRow: () => ReturnType;
    };
  }
}

export const getNodeType = (editor: Editor) => {
  const isTriggeredFromTable = (editor.state.selection.$head as any).path.some((val: any) => {
    if (typeof val == "object" && val.type.name === "table") {
      return true;
    }
    return false;
  });
  if (isTriggeredFromTable) {
    const node = editor.state.selection.$head.node(-4);
    const isImportedBlock = node?.attrs.importedFrom;
    const type: string = node?.type.name;
    if (isImportedBlock) return `${type}--imported`;
    if (["headers-table", "query-table", "url-table", "multipart-table", "path-table", "cookies-table", "options-table"].includes(type)) return type;
    return "table";
  }

  return "general";
};

export const insertRequestTableNode = (editor: Editor, sourceRange: Range, tableType: string) => {
  // Find section boundaries around the cursor (between request-separator nodes)
  const cursorPos = sourceRange.from;
  let sectionStart = 0;
  let sectionEnd = editor.state.doc.content.size;
  editor.state.doc.forEach((child, offset) => {
    const nodeStart = offset + 1;
    const nodeEnd = nodeStart + child.nodeSize;
    if (child.type.name === "request-separator") {
      if (cursorPos >= nodeEnd) {
        sectionStart = nodeEnd;
      } else if (sectionEnd === editor.state.doc.content.size && cursorPos < nodeStart) {
        sectionEnd = nodeStart;
      }
    }
  });

  // Only check for existing nodes within the current section
  const existingNodes = editor.$nodes(tableType);
  const existingDocNode = existingNodes?.find((node) => {
    if (node.attributes.importedFrom) return false;
    return node.from >= sectionStart && node.from < sectionEnd;
  });
  if (existingDocNode) {
    editor.chain().focus(existingDocNode.to).deleteRange(sourceRange).run();
  } else {
    editor
      .chain()
      .focus()
      .deleteRange(sourceRange)
      .insertTable({
        type: tableType,
        rows: 1,
        cols: 2,
        withHeaderRow: false,
      })
      .focus(editor.state.doc.resolve(sourceRange.from + 1).pos)
      .run();
  }
};

export const getAllowedSuggestionPopup = (suggestionType: string) => (props: { editor: Editor; state: EditorState; range: Range }) => {
  const nodeType = getNodeType(props.editor);

  if (nodeType.endsWith("--imported")) return false;
  // Check if the node type is 'headers-table'
  const isAccessibleInHeadersTable = nodeType === "headers-table";

  if (suggestionType === "suggestion") return isAccessibleInHeadersTable;

  // Get the node type at the current selection
  const node = props.state.selection.$from.parent;
  const isCustomNode = ["method", "url", "headers-table", "query-table", "url-table", "cookies-table", "table"].includes(nodeType);
  // Check if the node type is 'paragraph'
  const isAccessibleInParagraph = !isCustomNode && node.type.name === "paragraph";

  if (suggestionType === "command") {
    if (isAccessibleInHeadersTable) return false;
    return isAccessibleInParagraph;
  }

  return false;
};

/**
 * Strip comments from JSONC (JSON with Comments)
 * Removes both single-line (//) and multi-line (/* *\/) comments
 *
 * @param jsonc - JSON string with comments
 * @returns JSON string without comments
 */
export function stripJsonComments(jsonc: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < jsonc.length) {
    const char = jsonc[i];
    const nextChar = jsonc[i + 1];

    // Handle string boundaries
    if ((char === '"' || char === "'") && (i === 0 || jsonc[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
      result += char;
      i++;
      continue;
    }

    // If we're inside a string, just copy the character
    if (inString) {
      result += char;
      i++;
      continue;
    }

    // Handle single-line comments //
    if (char === '/' && nextChar === '/') {
      // Skip until end of line
      i += 2;
      while (i < jsonc.length && jsonc[i] !== '\n' && jsonc[i] !== '\r') {
        i++;
      }
      // Keep the newline for formatting
      if (i < jsonc.length && (jsonc[i] === '\n' || jsonc[i] === '\r')) {
        result += jsonc[i];
        i++;
      }
      continue;
    }

    // Handle multi-line comments /* */
    if (char === '/' && nextChar === '*') {
      i += 2;
      // Skip until we find */
      while (i < jsonc.length - 1) {
        if (jsonc[i] === '*' && jsonc[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Regular character
    result += char;
    i++;
  }

  return result;
}
