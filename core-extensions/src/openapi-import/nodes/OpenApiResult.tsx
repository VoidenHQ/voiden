import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Check, CircleAlert,Copy, X } from "lucide-react";

export interface ValidationError {
  type: 'schema' | 'status' | 'header' | 'content-type';
  message: string;
  path?: string;
  expected?: any;
  actual?: any;
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


export interface ValidationWarning {
  type: 'missing-field' | 'extra-field' | 'deprecated';
  message: string;
  path?: string;
}

export interface OpenApiValidationAttrs {
  passed: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  validatedAgainst: {
    path: string;
    method: string;
    operationId?: string;
  };
  totalErrors: number;
  totalWarnings: number;
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

// Factory function pattern
export const createOpenApiValidationResultsNode = (NodeViewWrapper: any, useParentResponseDoc: (editor: any, getPos: () => number) => { openNodes: string[]; parentPos: number | null }) => {
  const OpenApiValidationComponent = ({ node,getPos,editor }: any) => {
    const {
      passed,
      errors,
      warnings,
      validatedAgainst,
      totalErrors,
      totalWarnings
    } = node.attrs as OpenApiValidationAttrs;

    const [selectedTab, setSelectedTab] = React.useState<'all' | 'errors' | 'warnings'>('all');

      const { openNodes } = useParentResponseDoc(editor, getPos);
    const isCollapsed = !openNodes.includes("openapi-validation-results");
    const handleSetActive = () => {
      editor.commands.toggleResponseNode("openapi-validation-results");
    };

    // SAFETY CHECK: Ensure validatedAgainst has the correct structure
    const safeValidatedAgainst = React.useMemo(() => {
      // Handle case where old data format {key, value, enabled} is passed
      if (validatedAgainst && typeof validatedAgainst === 'object') {
        // Check if it's the old format
        if ('key' in validatedAgainst || 'value' in validatedAgainst) {
          console.warn('Old validatedAgainst format detected, converting...', validatedAgainst);
          return {
            path: (validatedAgainst as any).value || (validatedAgainst as any).path || '/',
            method: (validatedAgainst as any).key || (validatedAgainst as any).method || 'GET',
            operationId: (validatedAgainst as any).operationId,
          };
        }
        // Already correct format
        return {
          path: validatedAgainst.path || '/',
          method: validatedAgainst.method || 'GET',
          operationId: validatedAgainst.operationId,
        };
      }
      // Fallback default
      return {
        path: '/',
        method: 'GET',
        operationId: undefined,
      };
    }, [validatedAgainst]);

    const getTypeBadge = (type: string) => {
      switch (type) {
        case 'schema': return "bg-red-500/20 text-red-400";
        case 'status': return "bg-orange-500/20 text-orange-400";
        case 'header': return "bg-yellow-500/20 text-yellow-400";
        case 'content-type': return "bg-blue-500/20 text-blue-400";
        case 'missing-field': return "bg-yellow-500/20 text-yellow-400";
        case 'extra-field': return "bg-blue-500/20 text-blue-400";
        case 'deprecated': return "bg-gray-500/20 text-gray-400";
        default: return "bg-gray-500/20 text-gray-400";
      }
    };

    const handleCopy = () => {
      const lines: string[] = [];
      lines.push(`OpenAPI Validation Results`);
      lines.push(`Operation: ${safeValidatedAgainst.method} ${safeValidatedAgainst.path}`);
      if (safeValidatedAgainst.operationId) {
        lines.push(`Operation ID: ${safeValidatedAgainst.operationId}`);
      }
      lines.push(`Status: ${passed ? 'PASSED ✓' : 'FAILED ✗'}`);
      lines.push(`Errors: ${totalErrors}, Warnings: ${totalWarnings}`);
      lines.push('');

      if (errors.length > 0) {
        lines.push('ERRORS:');
        errors.forEach((err, i) => {
          lines.push(`${i + 1}. [${err.type}] ${err.message}`);
          if (err.path) lines.push(`   Path: ${err.path}`);
          if (err.expected !== undefined) lines.push(`   Expected: ${JSON.stringify(err.expected)}`);
          if (err.actual !== undefined) lines.push(`   Actual: ${JSON.stringify(err.actual)}`);
        });
        lines.push('');
      }

      if (warnings.length > 0) {
        lines.push('WARNINGS:');
        warnings.forEach((warn, i) => {
          lines.push(`${i + 1}. [${warn.type}] ${warn.message}`);
          if (warn.path) lines.push(`   Path: ${warn.path}`);
        });
      }

      navigator.clipboard.writeText(lines.join('\n'));
    };

    const filteredItems = React.useMemo(() => {
      switch (selectedTab) {
        case 'errors':
          return { errors, warnings: [] };
        case 'warnings':
          return { errors: [], warnings };
        default:
          return { errors, warnings };
      }
    }, [errors, warnings, selectedTab]);

    const totalIssues = totalErrors + totalWarnings;

    return (
      <NodeViewWrapper
        className="openapi-validation-results-node"
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
              className={`bg-bg border-b border-border ${!isCollapsed?'bg-panel':"bg-bg"} hover:bg-panel  px-2 py-1.5 flex items-center justify-between header-bar cursor-pointer`}
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
                OpenAPI Validation
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                {safeValidatedAgainst.method} {safeValidatedAgainst.path}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${passed
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
                  }`}
                style={{ pointerEvents: "none" }}
              >
                {passed ? "✓ PASSED" : "✗ FAILED"}
              </span>
            </div>

            <div className="flex items-center gap-1" style={{ userSelect: "none" }}>
              {!isCollapsed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  <Copy size={14}/>
                </button>
              )}
            </div>
          </div>

          {/* Content - collapsible */}
          {!isCollapsed && (
            <div className="bg-editor">
              {/* Operation Info */}
              <div className="px-4 py-2 bg-bg border-b !border-solid !border-[rgba(0,0,0,0.1)]">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-comment">Operation:</span>
                  <span className="font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                    {safeValidatedAgainst.method}
                  </span>
                  <span className="text-ui-fg">{safeValidatedAgainst.path}</span>
                  {safeValidatedAgainst.operationId && (
                    <>
                      <span className="text-comment">ID:</span>
                      <span className="text-ui-fg">{safeValidatedAgainst.operationId}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Filter tabs */}
              {totalIssues > 0 && (
                <div className="flex">
                  <button
                    onClick={() => setSelectedTab('all')}
                    className={`px-4 py-2 text-xs font-medium ${selectedTab === 'all'
                      ? 'text-blue-400 border-b '
                      : 'text-comment hover:text-ui-fg'
                      }`}
                    style={{ borderBottom: 'var(--editor-fg)' }}
                  >
                    All ({totalIssues})
                  </button>
                  <button
                    onClick={() => setSelectedTab('errors')}
                    className={`px-4 py-2 text-xs font-medium cursor-pointer ${selectedTab === 'errors'
                      ? 'text-red-400 border-b'
                      : 'text-comment hover:text-ui-fg'
                      }`}
                    style={{ borderBottom: 'var(--editor-fg)' }}
                  >
                    Errors ({totalErrors})
                  </button>
                  <button
                    onClick={() => setSelectedTab('warnings')}
                    className={`px-4 py-2 text-xs font-medium cursor-pointer ${selectedTab === 'warnings'
                      ? 'text-yellow-400 border-yellow-400'
                      : 'text-comment hover:text-ui-fg'
                      }`}
                    style={{ borderBottom: 'var(--editor-fg)' }}
                  >
                    Warnings ({totalWarnings})
                  </button>
                </div>
              )}

              {/* No issues - success state */}
              {totalIssues === 0 ? (
                <div className="p-6 text-center">
                  <div className="text-4xl mb-2">✓</div>
                  <div className="text-sm font-semibold text-green-400 mb-1">
                    Validation Passed
                  </div>
                  <div className="text-xs text-comment">
                    Response matches OpenAPI specification
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-[rgba(0,0,0,0.1)]">
                  {/* Errors Section */}
                  {filteredItems.errors.length > 0 ? (
                    <div className="p-4">
                      <div className="font-semibold text-sm mb-3 text-red-400 flex items-center gap-2">
                        <X size={14} />
                        <span>Errors ({filteredItems.errors.length})</span>
                      </div>
                      <div className="space-y-3">
                        {filteredItems.errors.map((error, index) => (
                          <div
                            key={index}
                            className="bg-red-500/10 border border-red-500 rounded p-3"
                          >
                            <div className="flex items-start gap-2 mb-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${getTypeBadge(error.type)}`}>
                                {error.type.toUpperCase()}
                              </span>
                              {error.path && (
                                <span className="text-xs font-mono text-comment">
                                  {error.path}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-ui-fg mb-2">
                              {error.message}
                            </div>
                            {(error.expected !== undefined || error.actual !== undefined) && (
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {error.expected !== undefined && (
                                  <div>
                                    <span className="text-comment">Expected:</span>
                                    <div className="font-mono mt-1 p-2 bg-bg rounded">
                                      {typeof error.expected === 'object'
                                        ? JSON.stringify(error.expected, null, 2)
                                        : String(error.expected)}
                                    </div>
                                  </div>
                                )}
                                {error.actual !== undefined && (
                                  <div>
                                    <span className="text-comment">Actual:</span>
                                    <div className="font-mono mt-1 p-2 bg-bg rounded">
                                      {typeof error.actual === 'object'
                                        ? JSON.stringify(error.actual, null, 2)
                                        : String(error.actual)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    selectedTab === 'errors' ? (
                      <div className="p-6 text-center">
                        <div className="text-sm font-semibold text-green-400 mb-1 flex items-center justify-center gap-2">
                          <X size={14} /> No Error
                        </div>
                      </div>
                    ) : null
                  )}

                  {/* Warnings Section */}
                  {filteredItems.warnings.length > 0 ? (
                    <div className="p-4">
                      <div className="font-semibold text-sm mb-3 text-yellow-400 flex items-center gap-2">
                        <CircleAlert size={14} />
                        <span>Warnings ({filteredItems.warnings.length})</span>
                      </div>
                      <div className="space-y-3">
                        {filteredItems.warnings.map((warning, index) => (
                          <div
                            key={index}
                            className="bg-yellow-200/10 border border-yellow-500 rounded p-3"
                          >
                            <div className="flex items-start gap-2 mb-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${getTypeBadge(warning.type)}`}>
                                {warning.type.toUpperCase()}
                              </span>
                              {warning.path && (
                                <span className="text-xs font-mono text-comment">
                                  {warning.path}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-ui-fg">
                              {warning.message}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    selectedTab === 'warnings' ? (
                      <div className="p-6 text-center">
                        <div className="text-sm font-semibold text-green-400 mb-1 flex items-center justify-center gap-2">
                          <CircleAlert size={14} /> No Warning
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {/* Summary footer */}
              <div
                className="bg-bg border-t px-4 py-2 text-xs text-comment flex justify-between items-center"
                style={{ borderTopColor: "var(--editor-fg)" }}
              >
                <div className="flex items-center gap-4">
                  <span className="text-red-400">
                    {totalErrors} {totalErrors === 1 ? "error" : "errors"}
                  </span>

                  <span className="text-yellow-400">
                    {totalWarnings} {totalWarnings === 1 ? "warning" : "warnings"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={
                      passed ? "text-green-400 font-semibold" : "text-red-400 font-semibold"
                    }
                  >
                    <span className="flex items-center gap-1">
                      {passed ? <Check size={14} /> : <X size={14} />}
                      {passed ? "PASSED" : "FAILED"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "openapi-validation-results",
    group: "block",
    atom: true,

    addAttributes() {
      return {
        passed: { default: false },
        errors: { default: [] },
        warnings: { default: [] },
        validatedAgainst: {
          default: {
            path: '',
            method: '',
            operationId: undefined,
          }
        },
        totalErrors: { default: 0 },
        totalWarnings: { default: 0 },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="openapi-validation-results"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "openapi-validation-results", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(OpenApiValidationComponent);
    },
  });
};
