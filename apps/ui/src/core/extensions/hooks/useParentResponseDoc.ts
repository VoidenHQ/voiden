import { useState, useEffect } from "react";

export type ResponseChildNodeType =
  | "response-body"
  | "response-headers"
  | "request-headers"
  | "request-headers-security"
  | "assertion-results"
  | "openapi-validation-results"
  | "script-assertion-results";

/**
 * Hook for child nodes inside a `response-doc` to read the parent's state.
 * Provided to plugins via context.ui.hooks — do not redefine locally in plugin files.
 */
export const useParentResponseDoc = (editor: any, getPos: () => number) => {
  const [parentState, setParentState] = useState<{
    openNodes: ResponseChildNodeType[];
    parentPos: number | null;
  }>({
    openNodes: [],
    parentPos: null,
  });

  useEffect(() => {
    const updateParentState = () => {
      try {
        const pos = getPos();
        const $pos = editor.state.doc.resolve(pos);

        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.type.name === "response-doc") {
            const rawOpenNodes = node.attrs.openNodes;
            const openNodes: ResponseChildNodeType[] = Array.isArray(rawOpenNodes)
              ? rawOpenNodes
              : [];
            setParentState({ openNodes, parentPos: $pos.before(d) });
            return;
          }
        }
      } catch {
        // Position might not be valid during unmount
      }
    };

    updateParentState();
    editor.on("update", updateParentState);
    editor.on("transaction", updateParentState);

    return () => {
      editor.off("update", updateParentState);
      editor.off("transaction", updateParentState);
    };
  }, [editor, getPos]);

  return parentState;
};
