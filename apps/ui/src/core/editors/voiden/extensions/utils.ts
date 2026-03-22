import { EditorState } from "@tiptap/pm/state";
import { Editor, Range } from "@tiptap/react";

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
    if (["headers-table", "query-table", "url-table", "multipart-table", "cookies-table", "options-table", "assertions-table"].includes(type)) return type;
    return "table";
  }

  return "general";
};

export const insertRequestTableNode = (editor: Editor, sourceRange: Range, tableType: string) => {
  const existingNodes = editor.$nodes(tableType);
  const existingDocNode = existingNodes?.find((node) => !node.attributes.importedFrom);
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
  const isCustomNode = ["method", "url", "headers-table", "query-table", "url-table", "cookies-table", "options-table", "assertions-table", "table"].includes(nodeType);
  // Check if the node type is 'paragraph'
  const isAccessibleInParagraph = !isCustomNode && node.type.name === "paragraph";

  if (suggestionType === "command") {
    if (isAccessibleInHeadersTable) return false;
    return isAccessibleInParagraph;
  }

  return false;
};
