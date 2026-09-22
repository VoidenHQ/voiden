import { useState, useEffect } from "react";

export type ResponseChildNodeType =
  | "response-body"
  | "response-headers"
  | "request-headers"
  | "request-headers-security"
  | "request-body-sent"
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
    // Every child node inside a response-doc (request-headers, response-body,
    // response-headers, assertion-results, ...) mounts its own instance of
    // this hook. "transaction" fires for EVERY transaction in the WHOLE
    // editor — not just ones touching this node — and each fire used to call
    // setParentState() unconditionally with a brand-new object, so opening
    // (or editing) any ONE of these nodes re-rendered ALL of the others too,
    // visible as a flicker across the whole response area. Only update state
    // when the actual values changed, and drop the "transaction" listener
    // entirely: openNodes/parentPos only ever change via a doc-changing
    // transaction (an attr edit or a position-shifting edit), which "update"
    // already covers — "transaction" additionally fires for pure selection
    // changes, which can never affect either value.
    let lastOpenNodes: ResponseChildNodeType[] = [];
    let lastParentPos: number | null = null;

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
            const parentPos = $pos.before(d);

            const sameOpenNodes =
              openNodes.length === lastOpenNodes.length &&
              openNodes.every((n, i) => n === lastOpenNodes[i]);
            if (sameOpenNodes && parentPos === lastParentPos) return;

            lastOpenNodes = openNodes;
            lastParentPos = parentPos;
            setParentState({ openNodes, parentPos });
            return;
          }
        }
      } catch {
        // Position might not be valid during unmount
      }
    };

    updateParentState();
    editor.on("update", updateParentState);

    return () => {
      editor.off("update", updateParentState);
    };
  }, [editor, getPos]);

  return parentState;
};
