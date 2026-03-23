import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { AssertionResult } from "../lib/assertionEngine";
import { Copy } from "lucide-react";

export interface AssertionResultsAttrs {
  results: AssertionResult[];
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
}
export type ResponseChildNodeType =
  | "response-body"
  | "response-headers"
  | "request-headers"
  | "assertion-results"
  | "openapi-validation-results";

export interface ResponseDocAttrs {
  activeNode: ResponseChildNodeType | null;
}


const useParentResponseDoc = (editor: any, getPos: () => number) => {
  const [parentState, setParentState] = React.useState<{
    activeNode: ResponseChildNodeType | null;
    parentPos: number | null;
  }>({
    activeNode: null,
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
            setParentState({
              activeNode: node.attrs.activeNode,
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




/** Truncated cell that shows a tooltip on hover for long values */
const TruncatedCell = ({ value, className }: { value: string; className?: string }) => {
  const maxLen = 80;
  const isLong = value.length > maxLen;
  const [showFull, setShowFull] = React.useState(false);

  if (!isLong) {
    return <span className={`font-mono ${className || ''}`}>{value}</span>;
  }

  return (
    <span className="relative group">
      <span
        className={`font-mono truncate block max-w-[200px] cursor-help ${className || ''}`}
        title={value}
        onClick={() => setShowFull(!showFull)}
      >
        {value.slice(0, maxLen)}...
      </span>
      {showFull && (
        <div className="absolute z-50 left-0 top-full mt-1 p-2 bg-panel border border-border rounded shadow-lg max-w-[400px] max-h-[200px] overflow-auto text-[10px] font-mono whitespace-pre-wrap break-all text-text">
          {value}
        </div>
      )}
    </span>
  );
};

// Factory function pattern
export const createAssertionResultsNode = (NodeViewWrapper: any, useParentResponseDoc: (editor: any, getPos: () => number) => { openNodes: string[]; parentPos: number | null }) => {
  const AssertionResultsComponent = ({ node, getPos, editor }: any) => {
    const { results, totalAssertions, passedAssertions, failedAssertions } =
      node.attrs as AssertionResultsAttrs;

    const { openNodes } = useParentResponseDoc(editor, getPos);
    const isCollapsed = !openNodes.includes("assertion-results");
    const handleSetActive = () => {
      editor.commands.toggleResponseNode("assertion-results");
    };

    const getStatusColor = (passed: boolean) => {
      return passed ? "text-green-400" : "text-red-400";
    };

    const handleCopy = () => {
      const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const header = "| Status | Assertion | Operator | Expected | Actual | Error |";
      const separator = "|--------|-----------|----------|----------|--------|-------|";
      const rows = results.map((r) => {
        const status = r.passed ? "PASS" : "FAIL";
        const assertion = esc(r.assertion.description || r.assertion.field);
        const operator = esc(r.assertion.operator);
        const expected = esc(r.assertion.expectedValue);
        const actual = r.actualValue !== null && r.actualValue !== undefined
          ? esc(typeof r.actualValue === "object" ? JSON.stringify(r.actualValue) : String(r.actualValue))
          : "undefined";
        const error = esc(r.error || "");
        return `| ${status} | ${assertion} | ${operator} | ${expected} | ${actual} | ${error} |`;
      });
      const text = [header, separator, ...rows].join("\n");
      navigator.clipboard.writeText(text);
    };

    const passRate = totalAssertions > 0
      ? Math.round((passedAssertions / totalAssertions) * 100)
      : 0;

    return (
      <NodeViewWrapper
        className="assertion-results-node"
        style={{ userSelect: "text" }}
      >
        <style>{`
          .response-action-btn:hover {
            color: var(--accent) !important;
          }
        `}</style>

        <div className="my-2">
          {/* Header with collapse */}
          <div
            className={`bg-bg border-b border-border ${!isCollapsed ? "bg-panel" : "bg-bg"} hover:bg-panel px-2 py-1.5 flex items-center justify-between header-bar cursor-pointer`}
            onClick={handleSetActive}

          >
            <div className="flex items-center gap-2" style={{ userSelect: "none" }}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className="text-comment"
                style={{
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                  pointerEvents: "none",
                }}
              >
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-sm font-semibold" style={{ pointerEvents: "none" }}>
                Assertion Results
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${failedAssertions === 0
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
                  }`}

                style={{ pointerEvents: "none" }}
              >
                {passedAssertions}/{totalAssertions} passed ({passRate}%)
              </span>
            </div>

            <div className="flex items-center gap-1" style={{ userSelect: "none" }}>
              {!isCollapsed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className="response-action-btn  px-3 py-1 text-xs text-comment rounded"
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Content - collapsible */}
          {!isCollapsed && (
            <div className="bg-editor overflow-x-auto">
              {results.length === 0 ? (
                <div className="p-4 text-center text-comment text-sm">
                  No assertions to display
                </div>
              ) : (
                <table className="w-full text-xs table-fixed">
                  <thead>
                    <tr className="bg-bg border-b !border-solid !border-[rgba(0,0,0,0.2)]">
                      <th className="px-2 py-2 text-left font-semibold text-comment" style={{ width: "60px" }}>
                        Status
                      </th>
                      <th className="px-2 py-2 text-left font-semibold text-comment" style={{ width: "30%" }}>
                        Assertion
                      </th>
                      <th className="px-2 py-2 text-left font-semibold text-comment" style={{ width: "100px" }}>
                        Operator
                      </th>
                      <th className="px-2 py-2 text-left font-semibold text-comment" style={{ width: "15%" }}>
                        Expected
                      </th>
                      <th className="px-2 py-2 text-left font-semibold text-comment" style={{ width: "15%" }}>
                        Actual
                      </th>
                      <th className="px-2 py-2 text-left font-semibold text-comment" style={{ width: "auto" }}>
                        Error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, index) => (
                      <tr
                        key={index}
                         className={`border-b !border-solid !border-[rgba(0,0,0,0.1)] hover:bg-active/30 transition-colors ${result.passed ? "" : "bg-red-500/5"
                          }`}

                      >
                        <td className="px-2 py-2">
                          <span className={`font-medium text-xs ${getStatusColor(result.passed)}`}>
                            {result.passed ? "PASS" : "FAIL"}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-mono truncate" title={result.assertion.description || result.assertion.field}>
                            {result.assertion.description || result.assertion.field}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <span className="font-mono text-ui-fg">
                            {result.assertion.operator}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <TruncatedCell
                            value={result.assertion.expectedValue}
                            className="text-green-400"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <TruncatedCell
                            value={
                              result.actualValue !== null && result.actualValue !== undefined
                                ? typeof result.actualValue === "object"
                                  ? JSON.stringify(result.actualValue)
                                  : String(result.actualValue)
                                : "undefined"
                            }
                            className={result.passed ? "text-green-400" : "text-red-400"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {result.error && (
                            <TruncatedCell value={result.error} className="text-red-400" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "assertion-results",
    group: "block",
    atom: true,

    addAttributes() {
      return {
        results: { default: [] },
        totalAssertions: { default: 0 },
        passedAssertions: { default: 0 },
        failedAssertions: { default: 0 },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="assertion-results"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "assertion-results", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(AssertionResultsComponent);
    },
  });
};
