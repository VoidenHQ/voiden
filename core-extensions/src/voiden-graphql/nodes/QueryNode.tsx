/**
 * GraphQL Query Node (Container)
 *
 * Non-atom container for gqlurl + gqlbody child nodes.
 * Handles migration of old single-atom format to new child-node format.
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";

export const createGraphQLQueryNode = (NodeViewWrapper: any, _CodeEditor: any, RequestBlockHeader: any, _useSendRestRequest?: any) => {
  const GraphQLQueryComponent = (props: any) => {
    const migrated = React.useRef(false);

    // Migrate old-format gqlquery (has body/endpoint attrs, no children) to new format
    React.useEffect(() => {
      if (migrated.current) return;
      const node = props.node;
      const hasLegacyAttrs = node.attrs.body !== undefined || node.attrs.endpoint != null;
      const hasChildren = node.content && node.content.childCount > 0;
      if (!hasLegacyAttrs || hasChildren) return;

      migrated.current = true;
      const { state } = props.editor;
      let nodePos = -1;
      state.doc.descendants((n: any, pos: number) => {
        if (n === node) { nodePos = pos; return false; }
      });
      if (nodePos === -1) return;

      const { schema } = state;
      const endpointText = node.attrs.endpoint || '';

      const gqlUrlNode = schema.nodes.gqlurl?.create(
        {},
        endpointText ? [schema.text(endpointText)] : []
      );
      const gqlBodyNode = schema.nodes.gqlbody?.create({
        body: node.attrs.body || '',
        operationType: node.attrs.operationType || 'query',
        schemaFileName: node.attrs.schemaFileName ?? null,
        schemaFilePath: node.attrs.schemaFilePath ?? null,
        schemaUrl: node.attrs.schemaUrl ?? null,
        importedFrom: node.attrs.importedFrom,
      });

      if (!gqlUrlNode || !gqlBodyNode) return;

      const newNode = schema.nodes.gqlquery.create(
        { importedFrom: node.attrs.importedFrom },
        [gqlUrlNode, gqlBodyNode]
      );

      const tr = state.tr.replaceWith(nodePos, nodePos + node.nodeSize, newNode);
      props.editor.view.dispatch(tr);
    }, []);

    return (
      <NodeViewWrapper>
        <div className="my-2 overflow-hidden">
          <RequestBlockHeader
            title="GRAPHQL-Query"
            withBorder={false}
            editor={props.editor}
            importedDocumentId={props.node.attrs.importedFrom}
          />
          <NodeViewContent />
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "gqlquery",
    group: "block",
    content: "(gqlurl gqlbody)?",
    atom: false,
    isolating: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        importedFrom: { default: undefined },
        // Legacy attrs kept so old documents load before migration runs
        body: { default: undefined },
        operationType: { default: undefined },
        endpoint: { default: undefined },
        schemaFileName: { default: undefined },
        schemaFilePath: { default: undefined },
        schemaUrl: { default: undefined },
      };
    },

    parseHTML() {
      return [{ tag: "gqlquery" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["gqlquery", mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(GraphQLQueryComponent);
    },

    addKeyboardShortcuts() {
      return {
        Backspace: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'gqlquery') return true;
          return false;
        },
        Delete: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'gqlquery') return true;
          return false;
        },
      };
    },
  });
};

export const GraphQLQueryNode = createGraphQLQueryNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>CodeEditor not available</div>,
  () => <div>Header not available</div>
);
