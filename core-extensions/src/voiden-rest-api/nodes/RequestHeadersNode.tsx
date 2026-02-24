/**
 * Request Headers Node
 * Displays HTTP request headers, URL, Method, and TLS security details.
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { useParentResponseDoc } from "./ResponseDocNode";
import { Copy } from "lucide-react";

// --- INTERFACES ---

export interface RequestHeader {
  key: string;
  value: string;
}

// Interface for the attributes received by the Request Headers Node
export interface RequestHeadersAttrs {
  headers: RequestHeader[];
  url: string;
  method: string;
  httpVersion?: string;
  tls?: {
    // Structure for TLS details
    protocol: string;
    cipher: string;
    certificate?: {
      issuer: string;
      expiry: string;
    };
    isSecure: boolean;
  };
}

// --- HELPER FUNCTION FOR TLS/SUMMARY DISPLAY ---

/**
 * Renders the Security and Request Summary section using CodeMirror
 * Now collapsible like the headers section.
 */
const renderTLSSection = (
  CodeEditor: any,
  tls: any,
  url: string,
  method: string,
  httpVersion: string | undefined,
  handleCopy: () => void,
  activeNode: string | null,
  editor: any

) => {
  if (!tls && !url) return null;

  const isSecure = tls?.isSecure === true;
  const statusText = isSecure ? "Secure Connection (HTTPS)" : tls ? "Insecure Connection" : "HTTP Connection";

  const isCollapsed = activeNode !== "request-headers-security";

  // Handle click - call the editor command to set active node
  const handleSetActive = () => {
    if (isCollapsed) {
      editor.commands.setActiveResponseNode("request-headers-security");
    } else {
      editor.commands.setActiveResponseNode("");
    }
  };

  // Build the summary text for CodeMirror
  const summaryLines: string[] = [];
  summaryLines.push(`Method: ${method}`);
  summaryLines.push(`URL: ${url}`);
  if (httpVersion) {
    summaryLines.push(`HTTP Version: ${httpVersion}`);
  }
  summaryLines.push(`Security: ${statusText}`);

  if (isSecure && tls) {
    summaryLines.push(`TLS Protocol: ${tls.protocol}`);
    summaryLines.push(`Cipher Suite: ${tls.cipher}`);
    if (tls.certificate) {
      summaryLines.push(`Certificate Issuer: ${tls.certificate.issuer}`);
      summaryLines.push(`Certificate Expiry: ${tls.certificate.expiry}`);
    }
  }

  const summaryText = summaryLines.join('\n');

  return (
    <div className="my-2">
      {/* Header bar - collapsible */}
      <div
  className={`flex items-center justify-between ${!isCollapsed ? "bg-panel" : "bg-bg"} hover:bg-panel border-b  border-border  px-2 py-1.5 header-bar`}
        onClick={handleSetActive}

        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <div className="flex items-center gap-2">
          {/* Collapse Icon */}
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
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold" style={{ pointerEvents: "none" }}>
            Request Summary / Security
          </span>
        </div>

        {/* Copy Button */}
        {!isCollapsed && (
          <div className="flex items-center gap-1" style={{ userSelect: "none" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="response-action-btn px-3 py-1 text-xs text-comment rounded"
              title="Copy to clipboard"
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              <Copy size={14}/>
            </button>
          </div>
        )}
      </div>

      {/* Content - CodeMirror display */}
      {!isCollapsed &&
        (() => {
          // Calculate adaptive height based on number of lines
          const lineHeight = 20;
          const lines = summaryLines.length;
          const contentHeight = lines * lineHeight + 60;
          const viewportMaxHeight = window.innerHeight * 0.3;
          const maxHeight = Math.min(contentHeight, viewportMaxHeight, 400);
          const shouldFit = contentHeight <= maxHeight;

          return (
            <div
              style={{
                height: shouldFit ? `${contentHeight}px` : `${maxHeight}px`,
                maxHeight: `${maxHeight}px`,
                overflow: "visible", // Changed from "hidden" to allow find panel to show
                position: "relative",
              }}
            >
              <style>{`
                .request-summary-editor .cm-editor {
                  height: 100% !important;
                }
                .request-summary-editor .cm-scroller {
                  overflow: auto !important;
                  max-height: ${maxHeight}px !important;
                }
                /* Ensure find panel is visible */
                .request-summary-editor .cm-panels-top {
                  position: sticky !important;
                  top: 0 !important;
                  z-index: 10 !important;
                }
              `}</style>
              <div className="request-summary-editor" style={{ height: "100%", overflow: "auto" }}>
                <CodeEditor readOnly lang="text" value={summaryText} showReplace={false} />
              </div>
            </div>
          );
        })()}
    </div>
  );
};

// --- FACTORY FUNCTION ---

export const createRequestHeadersNode = (NodeViewWrapper: any, CodeEditor: any) => {
  const RequestHeadersComponent = ({ node ,getPos,editor}: any) => {
    // Destructure all required attributes
    const { headers, url, method, httpVersion, tls } = node.attrs as RequestHeadersAttrs;
     // Read parent's activeNode state - automatically updates when parent changes
    const { activeNode } = useParentResponseDoc(editor, getPos);
    const isCollapsed = activeNode !== "request-headers";

    // Handle click - call the editor command to set active node
    const handleSetActive = () => {
      if (isCollapsed) {
        editor.commands.setActiveResponseNode("request-headers");
      } else {
        editor.commands.setActiveResponseNode("");
      }
    };

    const headersText = (headers || []).map((header) => `${header.key}: ${header.value}`).join("\n");

    // No headers? Render summary + empty block.
    if (!headers || headers.length === 0) {
      const handleCopySummaryEmpty = async () => {
        try {
          const summaryLines: string[] = [];
          summaryLines.push(`Method: ${method}`);
          summaryLines.push(`URL: ${url}`);
          if (httpVersion) {
            summaryLines.push(`HTTP Version: ${httpVersion}`);
          }
          const isSecure = tls?.isSecure === true;
          const statusText = isSecure ? "Secure Connection (HTTPS)" : tls ? "Insecure Connection" : "HTTP Connection";
          summaryLines.push(`Security: ${statusText}`);
          if (isSecure && tls) {
            summaryLines.push(`TLS Protocol: ${tls.protocol}`);
            summaryLines.push(`Cipher Suite: ${tls.cipher}`);
            if (tls.certificate) {
              summaryLines.push(`Certificate Issuer: ${tls.certificate.issuer}`);
              summaryLines.push(`Certificate Expiry: ${tls.certificate.expiry}`);
            }
          }
          const summaryText = summaryLines.join('\n');
          await navigator.clipboard.writeText(summaryText);
        } catch (error) {
          // console.error("Copy error:", error);
        }
      };

      return (
        <NodeViewWrapper className="request-headers-node" style={{ userSelect: "text"}}>
             <style>{`
          .response-action-btn:hover {
            color: var(--accent) !important;
          }
        `}</style>

          {/* Render summary section even without headers */}
          {renderTLSSection(CodeEditor, tls, url, method, httpVersion, handleCopySummaryEmpty, activeNode, editor)}

          <div >
            <div className="bg-bg p-2 text-comment text-sm border-b border-border">No Request Headers Sent</div>
          </div>
        </NodeViewWrapper>
      );
    }

    // Copy/Download handlers
    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(headersText);
      } catch (error) {
        // console.error("Copy error:", error);
      }
    };

    const handleCopySummary = async () => {
      try {
        const summaryLines: string[] = [];
        summaryLines.push(`Method: ${method}`);
        summaryLines.push(`URL: ${url}`);
        if (httpVersion) {
          summaryLines.push(`HTTP Version: ${httpVersion}`);
        }
        const isSecure = tls?.isSecure === true;
        const statusText = isSecure ? "Secure Connection (HTTPS)" : tls ? "Insecure Connection" : "HTTP Connection";
        summaryLines.push(`Security: ${statusText}`);
        if (isSecure && tls) {
          summaryLines.push(`TLS Protocol: ${tls.protocol}`);
          summaryLines.push(`Cipher Suite: ${tls.cipher}`);
          if (tls.certificate) {
            summaryLines.push(`Certificate Issuer: ${tls.certificate.issuer}`);
            summaryLines.push(`Certificate Expiry: ${tls.certificate.expiry}`);
          }
        }
        const summaryText = summaryLines.join('\n');
        await navigator.clipboard.writeText(summaryText);
      } catch (error) {
        // console.error("Copy error:", error);
      }
    };

    return (
      <NodeViewWrapper className="request-headers-node" style={{ userSelect: "text"}}>
          <style>{`
          .response-action-btn:hover {
            color: var(--accent) !important;
          }
        `}</style>

        {/* 1. RENDER REQUEST SUMMARY / SECURITY SECTION */}
        {renderTLSSection(CodeEditor, tls, url, method, httpVersion, handleCopySummary, activeNode, editor)}

        {/* 2. RENDER REQUEST HEADERS COLLAPSIBLE BLOCK (Copied structure) */}
        <div className="my-2">
          {/* Header bar */}
          <div
              className={`flex items-center justify-between ${!isCollapsed ? "bg-panel" : "bg-bg"} hover:bg-panel border-b  border-border  px-2 py-1.5 header-bar`}
            onClick={handleSetActive}
            style={{ cursor: 'pointer', userSelect: 'none' }}

          >
            <div className="flex items-center gap-2">
              {/* Collapse Icon (Copied SVG) */}
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
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm font-semibold" style={{ pointerEvents: "none" }}>
                Request Headers Sent
              </span>
              <span className="text-xs text-comment" style={{ pointerEvents: "none" }}>
                ({headers.length})
              </span>
            </div>

            {/* Copy/Download Buttons*/}
            <div className="flex items-center gap-1" style={{ userSelect: "none" }}>
              {!isCollapsed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className="response-action-btn  px-3 py-1 text-xs text-comment rounded"
                  title="Copy to clipboard"
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  <Copy size={14}/>
                </button>
              )}
              {/* ... Download button if needed ... */}
            </div>
          </div>

          {/* Content - collapsible (CodeEditor for headers) */}
          {!isCollapsed &&
            (() => {
              // Calculate adaptive height (copied logic)
              const lineHeight = 20;
              const contentHeight = headers.length * lineHeight + 60;
              const viewportMaxHeight = window.innerHeight * 0.4;
              const maxHeight = Math.min(contentHeight, viewportMaxHeight, 600);
              const shouldFit = contentHeight <= maxHeight;

              return (
                <div
                  style={{
                    height: shouldFit ? `${contentHeight}px` : `${maxHeight}px`,
                    maxHeight: `${maxHeight}px`,
                    overflow: "visible", // Changed from "hidden" to allow find panel to show
                    position: "relative",
                  }}
                >
                  <style>{`
                    .request-headers-editor .cm-editor {
                      height: 100% !important;
                    }
                    .request-headers-editor .cm-scroller {
                      overflow: auto !important;
                      max-height: ${maxHeight}px !important;
                    }
                    /* Ensure find panel is visible */
                    .request-headers-editor .cm-panels-top {
                      position: sticky !important;
                      top: 0 !important;
                      z-index: 10 !important;
                    }
                  `}</style>
                  <div className="request-headers-editor" style={{ height: "100%", overflow: "auto" }}>
                    <CodeEditor autoFocus={false} readOnly lang="text" value={headersText} showReplace={false} />
                  </div>
                </div>
              );
            })()}
        </div>
      </NodeViewWrapper>
    );
  };

  // Node Definition
  return Node.create({
    name: "request-headers",
    group: "block",
    atom: true,

    addAttributes() {
      return {
        headers: {
          default: [],
        },
        url: {
          default: '',
        },
        method: {
          default: '',
        },
        httpVersion: {
          default: null,
        },
        tls: {
          default: null,
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: 'div[data-type="request-headers"]',
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "request-headers", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(RequestHeadersComponent);
    },
  });
};
