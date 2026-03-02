/**
 * Response Doc Node - Parent-Child Communication via Editor Commands
 *
 * Approach: Children call editor commands, parent listens to attribute changes
 * No need to navigate or find parent - everything goes through the editor state
 */

import * as React from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewContent } from "@tiptap/react";

export type ResponseChildNodeType =
  | "response-body"
  | "response-headers"
  | "request-headers"
  | "assertion-results"
  | "openapi-validation-results"
  | "script-assertion-results";

export interface ResponseDocAttrs {
  openNodes: ResponseChildNodeType[];
  statusCode: number;
  statusMessage: string;
  elapsedTime: number;
  url: string | null;
}

const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
};

const RESPONSE_TABS: { type: ResponseChildNodeType; label: string }[] = [
  { type: "response-body", label: "Body" },
  { type: "response-headers", label: "Headers" },
  { type: "request-headers", label: "Request" },
];

// ============================================================================
// HELPER HOOK - Get Parent Response Doc State (exported for child nodes)
// ============================================================================

// Custom hook that children can use to read parent's openNodes
export const useParentResponseDoc = (editor: any, getPos: () => number) => {
  const [parentState, setParentState] = React.useState<{
    openNodes: ResponseChildNodeType[];
    parentPos: number | null;
  }>({
    openNodes: [],
    parentPos: null,
  });

  React.useEffect(() => {
    const updateParentState = () => {
      try {
        const pos = getPos();
        const $pos = editor.state.doc.resolve(pos);

        // Walk up to find response-doc parent
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.type.name === "response-doc") {
            const rawOpenNodes = node.attrs.openNodes;
            const openNodes: ResponseChildNodeType[] = Array.isArray(rawOpenNodes)
              ? rawOpenNodes
              : typeof rawOpenNodes === "string"
                ? JSON.parse(rawOpenNodes)
                : [];
            setParentState({
              openNodes,
              parentPos: $pos.before(d),
            });
            return;
          }
        }
      } catch (e) {
        // Position might not be valid during unmount
      }
    };

    // Initial read
    updateParentState();

    // Listen to editor updates using the correct TipTap API
    editor.on('update', updateParentState);
    editor.on('transaction', updateParentState);

    return () => {
      editor.off('update', updateParentState);
      editor.off('transaction', updateParentState);
    };
  }, [editor, getPos]);

  return parentState;
};

// ============================================================================
// PARENT NODE - Response Doc
// ============================================================================

export const createResponseDocNode = (NodeViewWrapper: any) => {
  const ResponseDocComponent = ({
    node,
    updateAttributes,
    editor
  }: any) => {
    const { openNodes, statusCode, statusMessage, elapsedTime, url } =
      node.attrs as ResponseDocAttrs;

    const isSuccess = statusCode >= 200 && statusCode < 300;
    const isError = statusCode >= 400;

    return (
      <NodeViewWrapper className="response-doc-node">
        <div className="overflow-hidden">
          {/* Children container */}
          <div className="response-doc-children">
            <NodeViewContent className="response-doc-content" />
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "response-doc",
    group: "block",
    content: "block*",
    isolating: true,
    defining: true,

    addAttributes() {
      return {
        openNodes: {
          default: ["response-body", "response-headers", "request-headers"],
          parseHTML: (element: HTMLElement) => {
            const val = element.getAttribute("data-open-nodes");
            if (val) {
              try { return JSON.parse(val); } catch { return ["response-body", "response-headers", "request-headers"]; }
            }
            return ["response-body", "response-headers", "request-headers"];
          },
          renderHTML: (attributes: any) => {
            return { "data-open-nodes": JSON.stringify(attributes.openNodes || []) };
          },
        },
        statusCode: {
          default: 200,
        },
        statusMessage: {
          default: "OK",
        },
        elapsedTime: {
          default: 0,
        },
        url: {
          default: null,
        },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="response-doc"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { "data-type": "response-doc" }),
        0,
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ResponseDocComponent);
    },

    addCommands() {
      return {
        // Command that children can call to toggle a node open/closed
        toggleResponseNode:
          (nodeType: string) =>
          ({ tr, state, dispatch }: any) => {
            // Find the response-doc node in the document
            let responseDocPos: number | null = null;

            state.doc.descendants((node: any, pos: number) => {
              if (node.type.name === "response-doc") {
                responseDocPos = pos;
                return false; // Stop iteration
              }
            });

            if (responseDocPos === null) return false;

            if (dispatch) {
              const currentAttrs = state.doc.nodeAt(responseDocPos)?.attrs;
              const rawOpenNodes = currentAttrs?.openNodes;
              const currentOpen: string[] = Array.isArray(rawOpenNodes)
                ? rawOpenNodes
                : typeof rawOpenNodes === "string"
                  ? JSON.parse(rawOpenNodes)
                  : [];
              const newOpen = currentOpen.includes(nodeType)
                ? currentOpen.filter((n: string) => n !== nodeType)
                : [...currentOpen, nodeType];

              tr.setNodeMarkup(responseDocPos, undefined, {
                ...currentAttrs,
                openNodes: newOpen,
              });
              dispatch(tr);
            }

            return true;
          },
      } as any;
    },
  });
};
