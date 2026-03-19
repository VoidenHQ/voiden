import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewContent } from "@tiptap/react";
import { NodeViewProps } from "@tiptap/core";
import React from "react";

// Factory function to create RestFile with context components
export const createRestFileNode = (NodeViewWrapper: any, RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) => {
  // Custom NodeView for RestFile
  const RestFileNodeView = ({ node, editor }: NodeViewProps) => {
    // Check if this BLOCK itself is imported (not just contains a file link)
    const isImported = !!node.attrs.importedFrom;
    const importedFrom = node.attrs.importedFrom;

    return (
      <NodeViewWrapper className="not-prose my-3">
        <div className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--ui-line)' }}>
          <RequestBlockHeader
            title="HTTP-BINARY-FILE"
            editor={editor}
            importedDocumentId={importedFrom}
            openFile={openFile}
          />

          {/* Content area */}
          <NodeViewContent className="p-2 px-3" />
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "restFile",
    content: "inline*",
    group: "block",
    marks: "",

    addAttributes() {
      return {
        fieldName: {
          default: "file",
        },
        importedFrom: {
          default: undefined,
        },
      };
    },

    parseHTML() {
      return [{ tag: "div[data-type='rest-file']" }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          "data-type": "rest-file",
        }),
        0,
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(RestFileNodeView);
    },

    addKeyboardShortcuts() {
      return {
        "Mod-a": () => {
          const { state, commands } = this.editor;
          const { $from } = state.selection;
          const node = $from.node();

          if (node && node.type.name === "restFile") {
            commands.setTextSelection({
              from: $from.start(),
              to: $from.end(),
            });
            return true;
          }
          return false;
        },
      };
    },
  });
};

// Legacy export for backward compatibility
export const RestFile = Node.create({
  name: "restFile",
  content: "inline*",
  group: "block",
  marks: "",

  addAttributes() {
    return {
      fieldName: {
        default: "file",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='rest-file']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "rest-file",
      }),
      0,
    ];
  },
});

export default RestFile;
