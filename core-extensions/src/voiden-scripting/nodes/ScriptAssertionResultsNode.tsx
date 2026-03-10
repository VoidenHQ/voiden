import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
export interface ScriptAssertionResultsAttrs {
  results: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any; reason?: string }>;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
}

export const createScriptAssertionResultsNode = (NodeViewWrapper: any, useParentResponseDoc: (editor: any, getPos: () => number) => { openNodes: string[]; parentPos: number | null }) => {
  const ScriptAssertionResultsComponent = ({ node, editor, getPos }: any) => {
    const { results, totalAssertions, passedAssertions, failedAssertions } =
      node.attrs as ScriptAssertionResultsAttrs;
    const { openNodes } = useParentResponseDoc(editor, getPos);
    const isCollapsed = !openNodes.includes("script-assertion-results");
    const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});

    const stringifyValue = (value: any) => {
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    };

    const copyText = async (text: string) => {
      if (!text) return;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          return;
        }
      } catch {
        // Fall through to legacy copy approach.
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    };

    const assertionToCopyText = (r: ScriptAssertionResultsAttrs["results"][number], index: number) => {
      const lines = [
        `Assertion ${index + 1}`,
        `Status: ${r.passed ? "Passed" : "Failed"}`,
        `Condition: ${r.condition || "Condition unavailable"}`,
        `Value Got: ${stringifyValue(r.actualValue)}`,
      ];
      if (r.operator) lines.push(`Operator: ${r.operator}`);
      if (r.expectedValue !== undefined) lines.push(`Expected Value: ${stringifyValue(r.expectedValue)}`);
      if (r.message) lines.push(`Message: ${r.message}`);
      if (r.reason) lines.push(`Reason: ${r.reason}`);
      return lines.join("\n");
    };

    const handleCopy = async () => {
      const text = results.map((r, idx) => assertionToCopyText(r, idx)).join("\n\n");
      await copyText(text);
    };

    const passRate = totalAssertions > 0
      ? Math.round((passedAssertions / totalAssertions) * 100)
      : 0;

    return (
      <NodeViewWrapper
        className="script-assertion-results-node"
        style={{ userSelect: "text" }}
      >
        <div className="my-2">
          <div
            className="bg-bg border-b !border-solid !border-[rgba(0,0,0,0.2)] px-2 py-1.5 flex items-center justify-between header-bar cursor-pointer"
            onClick={() => editor.commands.toggleResponseNode("script-assertion-results")}
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
                Script Assertions
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  failedAssertions === 0
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
                  className="px-3 py-1 text-xs text-comment hover:bg-active/50 rounded"
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  Copy
                </button>
              )}
            </div>
          </div>

          {!isCollapsed && (
            <div className="bg-editor">
              {results.length === 0 ? (
                <div className="p-4 text-center text-comment text-sm">
                  No script assertions to display
                </div>
              ) : (
                <div className="flex flex-col gap-2 p-2">
                  {results.map((result, index) => {
                    const isOpen = Boolean(expanded[index]);
                    const condition = result.condition || "Condition unavailable";
                    return (
                      <div
                        key={index}
                        className={`border rounded border-border border-b`}
                      >
                        <button
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [index]: !prev[index] }))
                          }
                          className="w-full px-2 py-2 flex items-center justify-between text-left hover:bg-active/30"
                          style={{ cursor: "pointer" }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs font-semibold ${result.passed ? "text-green-400" : "text-red-400"}`}>
                              {result.passed ? "PASS" : "FAIL"}
                            </span>
                            <span className="font-mono text-sm truncate" title={condition}>
                              {condition}
                            </span>
                          </div>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            className="text-comment"
                            style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}
                          >
                            <path
                              d="M3 4.5L6 7.5L9 4.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {isOpen && (
                          <div className="px-2 pb-2 text-xs border-t !border-solid !border-[rgba(0,0,0,0.12)]">
                            <div className="mt-2">
                              <div className="text-comment mb-1">Condition</div>
                              <div className="font-mono whitespace-pre-wrap break-all">{condition}</div>
                            </div>
                            <div className="mt-2">
                              <div className="text-comment mb-1">Value Got</div>
                              <pre className="font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded m-0">
                                {stringifyValue(result.actualValue)}
                              </pre>
                            </div>
                            {result.operator && (
                              <div className="mt-2">
                                <div className="text-comment mb-1">Operator</div>
                                <div className="font-mono whitespace-pre-wrap break-all">{result.operator}</div>
                              </div>
                            )}
                            {result.expectedValue !== undefined && (
                              <div className="mt-2">
                                <div className="text-comment mb-1">Expected Value</div>
                                <pre className="font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded m-0">
                                  {stringifyValue(result.expectedValue)}
                                </pre>
                              </div>
                            )}
                            {result.message && (
                              <div className="mt-2">
                                <div className="text-comment mb-1">Message</div>
                                <div className="font-mono whitespace-pre-wrap break-all">{result.message}</div>
                              </div>
                            )}
                            {result.reason && (
                              <div className="mt-2">
                                <div className="text-comment mb-1">Reason</div>
                                <div className="font-mono whitespace-pre-wrap break-all text-red-400">{result.reason}</div>
                              </div>
                            )}
                            <div className="mt-2">
                              <span className="text-comment mr-2">Status</span>
                              <span className={`font-semibold ${result.passed ? "text-green-400" : "text-red-400"}`}>
                                {result.passed ? "Passed" : "Failed"}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "script-assertion-results",
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
      return [{ tag: 'div[data-type="script-assertion-results"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "script-assertion-results", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ScriptAssertionResultsComponent);
    },
  });
};
