/* eslint-disable react/display-name */
import { mergeAttributes, Node, NodeViewProps } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { SimpleAssertionsHelp } from "../help";

// Base table wrapper node for assertions
const TableWrapperNode = Node.create({
  name: "assertions-table-wrapper",
  group: "block",
  content: "table",
  parseHTML() {
    return [{ tag: "assertions-table-wrapper" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "assertions-table-wrapper",
      mergeAttributes(HTMLAttributes, {
        class: "w-full overflow-auto",
      }),
      0,
    ];
  },
});

const createNodeView =
  (title: string, RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) =>
  ({ editor, node }: NodeViewProps) => {
    return (
      <NodeViewWrapper spellCheck="false" className="my-3">
        <div className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--ui-line)' }}>
          <RequestBlockHeader
            title={title}
            editor={editor}
            helpContent={<SimpleAssertionsHelp />}
          />
          <div
            className="w-full max-w-full assertions-table-container"
            contentEditable={editor.isEditable}
            suppressContentEditableWarning
          >
            <NodeViewContent />
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

// Factory function to create assertions table node
export const createAssertionsTableNodeView = (
  RequestBlockHeader: any,
  openFile?: (relativePath: string) => Promise<void>
) => {
  const AssertionsTable = TableWrapperNode.extend({
    name: "assertions-table",
    atom: true,
    parseHTML() {
      return [{ tag: "assertions-table" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["assertions-table", mergeAttributes(HTMLAttributes), 0];
    },
    addNodeView() {
      return ReactNodeViewRenderer(createNodeView("SIMPLE-ASSERTIONS", RequestBlockHeader, openFile));
    },
    // Add ProseMirror plugin to intercept text input and prevent markdown
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('disableMarkdownInAssertionsTable'),
          props: {
            // Intercept ALL text input in assertions table
            handleTextInput(view, from, to, text) {
              const { $from } = view.state.selection;
              let insideAssertionsTable = false;

              // Check if we're inside assertions-table
              for (let d = $from.depth; d > 0; d--) {
                const node = $from.node(d);
                if (node.type.name === 'assertions-table') {
                  insideAssertionsTable = true;
                  break;
                }
              }

              if (insideAssertionsTable) {
                // Insert text directly, bypassing all input rules
                const tr = view.state.tr.insertText(text, from, to);
                view.dispatch(tr);
                return true; // Prevent further processing
              }

              return false;
            },
          },
        }),
      ];
    },
  });

  return AssertionsTable;
};
