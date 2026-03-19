/* eslint-disable react/display-name */
import { CellSelection } from "@tiptap/pm/tables";
import { Editor, mergeAttributes, Node, NodeViewProps } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import {
  HttpHeadersHelp,
  HttpQueryParamsHelp,
  HttpUrlFormHelp,
  HttpMultipartFormHelp,
  HttpPathParamsHelp,
  HttpCookiesHelp,
} from "../help";

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
  (title: string, RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>, helpContent?: React.ReactNode) =>
  ({ editor, node }: NodeViewProps) => {
    const isEditable = !node?.attrs?.importedFrom || title === "Multipart Form";

    return (
      <NodeViewWrapper
        spellCheck="false"
        className="my-3"
      >
        <div className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--ui-line)' }}>
          <RequestBlockHeader
            title={title}
            editor={editor}
            importedDocumentId={node.attrs.importedFrom}
            openFile={openFile}
            helpContent={helpContent}
          />
          <div
            className="w-full max-w-full"
            contentEditable={editor.isEditable && isEditable}
            suppressContentEditableWarning
            style={{
              pointerEvents: !isEditable ? "none" : "unset",
              userSelect: isEditable ? "text" : "none",
            }}
          >
            <NodeViewContent />
          </div>
        </div>
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

// Factory functions to create table nodes with openFile callback and RequestBlockHeader component
export const createHeadersTableNodeView = (RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  TableWrapperNode.extend({
    name: "headers-table",
    atom: true,
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
      return ReactNodeViewRenderer(createNodeView("HTTP-HEADERS", RequestBlockHeader, openFile, <HttpHeadersHelp />));
    },
  });

export const createQueryTableNodeView = (RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  TableWrapperNode.extend({
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
      return ReactNodeViewRenderer(createNodeView("HTTP-QUERY-PARAMS", RequestBlockHeader, openFile, <HttpQueryParamsHelp />));
    },
  });

export const createURLTableNodeView = (RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  TableWrapperNode.extend({
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
      return ReactNodeViewRenderer(createNodeView("HTTP-URL-FORM", RequestBlockHeader, openFile, <HttpUrlFormHelp />));
    },
  });

export const createMultipartTableNodeView = (RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  TableWrapperNode.extend({
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
      return ReactNodeViewRenderer(createNodeView("HTTP-MULTIPART-FORM-DATA", RequestBlockHeader, openFile, <HttpMultipartFormHelp />));
    },
  });

export const createPathParamsTableNodeView = (RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  TableWrapperNode.extend({
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
      return ReactNodeViewRenderer(createNodeView("HTTP-PATH-PARAMS", RequestBlockHeader, openFile, <HttpPathParamsHelp />));
    },
  });

export const createCookiesTableNodeView = (RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  TableWrapperNode.extend({
    name: "cookies-table",
    addAttributes() {
      return {
        importedFrom: {
          default: "",
        },
      };
    },
    parseHTML() {
      return [{ tag: "cookies-table" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["cookies-table", mergeAttributes(HTMLAttributes), 0];
    },
    addNodeView() {
      return ReactNodeViewRenderer(createNodeView("HTTP-COOKIES", RequestBlockHeader, openFile, <HttpCookiesHelp />));
    },
  });

// Note: Backward compatibility exports removed
// All table nodes now require RequestBlockHeader component from context
// Use the factory functions (createHeadersTableNodeView, etc.) instead
