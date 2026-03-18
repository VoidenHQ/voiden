/* eslint-disable react/display-name */
import { CellSelection } from "@tiptap/pm/tables";
import { RequestBlockHeader } from "./RequestBlockHeader.tsx";
import { Editor, mergeAttributes, Node, NodeViewProps } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

export function isCellSelection(value: unknown): value is CellSelection {
  return value instanceof CellSelection;
}

const TableWrapperNode = Node.create({
  name: "table-wrapper",
  group: "block",
  content: "table",
  parseHTML() {
    return [{ tag: "table-wrapper" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "table-wrapper",
      mergeAttributes(HTMLAttributes, {
        class: "w-full overflow-auto",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableNodeView);
  },
});
const createNodeView =
  (title: string) =>
  ({ editor, node }: NodeViewProps) => {
    const isEditable = !node?.attrs?.importedFrom || title === "Multipart Form";

    return (
      <NodeViewWrapper spellCheck="false" className="my-4">
        <RequestBlockHeader withBorder title={title} editor={editor} importedDocumentId={node.attrs.importedFrom} />

        <NodeViewContent className={`w-full max-w-full`} style={{
          pointerEvents: !isEditable ? "none" : "unset",
        }} />
      </NodeViewWrapper>
    );
  };

const TableNodeView = (props: { editor: Editor }) => {
  return (
    <NodeViewWrapper>
      <span className="pointer-none" tabIndex={-1} contentEditable={false}>
        Table
      </span>
      <NodeViewContent />
    </NodeViewWrapper>
  );
};

// Extend the TableWrapperNode to create a HeadersTableNode
export const HeadersTableNodeView = TableWrapperNode.extend({
  name: "headers-table",
  addAttributes() {
    return {
      importedFrom: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "headers-table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["headers-table", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(createNodeView("HTTP-HEADERS"), {
      stopEvent: () => false, // Don't stop any events - let them bubble to ProseMirror
    });
  },
});

export const QueryTableNodeView = TableWrapperNode.extend({
  name: "query-table",
  addAttributes() {
    return {
      importedFrom: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "query-table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["query-table", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(createNodeView("HTTP-QUERY-PARAMS"), {
      stopEvent: () => false,
    });
  },
});

export const URLTableNodeView = TableWrapperNode.extend({
  name: "url-table",
  addAttributes() {
    return {
      importedFrom: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "url-table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["url-table", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(createNodeView("HTTP-URL-FORM"), {
      stopEvent: () => false,
    });
  },
});

export const MultipartTableNodeView = TableWrapperNode.extend({
  name: "multipart-table",
  addAttributes() {
    return {
      importedFrom: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "multipart-table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["multipart-table", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(createNodeView("HTTP-MULTIPART-FORM-DATA"), {
      stopEvent: () => false,
    });
  },
});

export const PathParamsTableNodeView = TableWrapperNode.extend({
  name: "path-table",
  addAttributes() {
    return {
      importedFrom: {
        default: "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "path-table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["path-table", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(createNodeView("HTTP-PATH-PARAMS"), {
      stopEvent: () => false,
    });
  },
});
