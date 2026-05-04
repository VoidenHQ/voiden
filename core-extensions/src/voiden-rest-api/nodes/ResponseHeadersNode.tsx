/**
 * Response Headers Node
 *
 * Displays HTTP response headers in CodeMirror for easy selection
 * Uses generic components from plugin context for true extensibility
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Check, Copy, Download } from "lucide-react";

export interface ResponseHeader {
  key: string;
  value: string;
}

export interface ResponseHeadersAttrs {
  headers: ResponseHeader[];
}

// Factory function to create the node with context components
export const createResponseHeadersNode = (
  NodeViewWrapper: any,
  CodeEditor: any,
  useParentResponseDoc: (editor: any, getPos: () => number) => { openNodes: string[]; parentPos: number | null }
) => {
  const ResponseHeadersComponent = ({ node,getPos,editor }: any) => {
    const { headers } = node.attrs as ResponseHeadersAttrs;
 const { openNodes } = useParentResponseDoc(editor, getPos);
    const isCollapsed = !openNodes.includes("response-headers");
    const [copied, setCopied] = React.useState(false);
    const [downloaded, setDownloaded] = React.useState(false);

    // Handle click - toggle this node open/closed
    const handleSetActive = () => {
      editor.commands.toggleResponseNode("response-headers");
    };

    if (!headers || headers.length === 0) {
      return (
        <NodeViewWrapper className="response-headers-node" style={{ userSelect: 'text' }}>
          <div>
            <div className="bg-bg p-2 text-comment text-sm border-b !border-solid !border-[rgba(0,0,0,0.2)]">No headers</div>
          </div>
        </NodeViewWrapper>
      );
    }

    // Format headers as key-value pairs for code editor
    const headersText = headers
      .map(header => `${header.key}: ${header.value}`)
      .join('\n');

    // Copy handler
    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(headersText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
      }
    };

    // Download handler
    const handleDownload = () => {
      try {
        const blob = new Blob([headersText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `response_headers_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 2000);
      } catch (error) {
      }
    };

    return (
      <NodeViewWrapper className="response-headers-node" style={{ userSelect: 'text' }}>
           <style>{`
          .response-action-btn:hover {
            color: var(--accent) !important;
          }
          @keyframes response-icon-pop {
            0%   { transform: scale(0.6); opacity: 0; }
            60%  { transform: scale(1.2); }
            100% { transform: scale(1);   opacity: 1; }
          }
          .response-icon-animate {
            animation: response-icon-pop 0.2s ease-out forwards;
          }
          .response-headers-node .header-bar .response-header-actions { opacity: 0; transition: opacity 0.15s ease; }
          .response-headers-node .header-bar:hover .response-header-actions { opacity: 1; }
        `}</style>

        <div className="my-2">
          {/* Header with collapse button */}
          <div
         className={`flex items-center justify-between ${!isCollapsed ? "bg-panel" : "bg-bg"} hover:bg-panel border-b  border-border  px-2 py-1.5 header-bar`}
            onClick={handleSetActive}

          >
            <div className="flex items-center gap-2" style={{ userSelect: 'none' }}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className="text-comment"
                style={{
                  transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  pointerEvents: 'none',
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
              <span className="text-sm font-semibold" style={{ pointerEvents: 'none' }}>Response Headers</span>
              <span className="text-xs text-comment" style={{ pointerEvents: 'none' }}>({headers.length})</span>
            </div>

            <div className="flex items-center gap-1 response-header-actions" style={{ userSelect: 'none' }}>
              {/* Copy button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                title={copied ? "Copied!" : "Copy to clipboard"}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {copied ? <Check size={14} key="check" className="response-icon-animate text-status-success" /> : <Copy size={14} key="copy" />}
              </button>

              {/* Download button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                title={downloaded ? "Downloaded!" : "Download"}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {downloaded ? <Check size={14} key="check" className="response-icon-animate text-status-success" /> : <Download size={14} key="download" />}
              </button>
            </div>
          </div>

          {/* Content - collapsible */}
          {!isCollapsed && (() => {
            // Calculate adaptive height based on number of headers
            const lineHeight = 20;
            const contentHeight = headers.length * lineHeight + 60;
            const viewportMaxHeight = window.innerHeight * 0.4;
            const maxHeight = Math.min(contentHeight, viewportMaxHeight, 600);

            // If content fits, use exact height; otherwise use maxHeight
            const shouldFit = contentHeight <= maxHeight;

            return (
              <div style={{
                height: shouldFit ? `${contentHeight}px` : `${maxHeight}px`,
                maxHeight: `${maxHeight}px`,
                overflow: 'hidden',
                position: 'relative'
              }}>
                <style>{`
                  .response-headers-editor .cm-editor {
                    height: 100% !important;
                    max-height: none !important;
                  }
                  .response-headers-editor .cm-scroller {
                    max-height: none !important;
                    overflow-y: auto !important;
                  }
                  .response-headers-editor .cm-panels-top {
                    position: sticky !important;
                    top: 0 !important;
                    z-index: 10 !important;
                    background: var(--bg) !important;
                  }
                  .response-headers-editor .cm-panel.cm-search {
                    position: sticky !important;
                    top: 0 !important;
                    z-index: 10 !important;
                  }
                `}</style>
                <div className="response-headers-editor" style={{ height: '100%', overflow: 'auto' }}>
                  <CodeEditor
                    readOnly
                    lang="text"
                    value={headersText}
                    showReplace={false}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "response-headers",

    group: "block",

    atom: true,

    addAttributes() {
      return {
        headers: {
          default: [],
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: 'div[data-type="response-headers"]',
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "response-headers", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ResponseHeadersComponent);
    },
  });
};
