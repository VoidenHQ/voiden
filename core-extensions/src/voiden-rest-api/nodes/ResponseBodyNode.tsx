/**
 * Response Body Node
 *
 * Comprehensive response body viewer with support for:
 * - Images, videos, audio, PDFs
 * - Binary downloads
 * - Raw view and rendered view tabs
 * - Structured like request blocks with header and options
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Copy, Download, Eye, FileDown, FileText, WrapText } from "lucide-react";


export interface ResponseBodyAttrs {
  body: any;
  contentType: string | null;
}

const prettifyHtml = (html: string): string => {
  let formatted = '';
  let indent = 0;
  const indentStr = '  ';

  // Remove existing whitespace between tags
  const cleaned = html.replace(/>\s+</g, '><').trim();

  // Split by tags
  const tokens = cleaned.split(/(<[^>]+>)/g).filter(Boolean);

  for (const token of tokens) {
    if (token.startsWith('</')) {
      // Closing tag - decrease indent first
      indent = Math.max(0, indent - 1);
      formatted += indentStr.repeat(indent) + token + '\n';
    } else if (token.startsWith('<') && !token.startsWith('<!') && !token.endsWith('/>') && !token.match(/<(br|hr|img|input|meta|link|area|base|col|embed|param|source|track|wbr)[^>]*>/i)) {
      // Opening tag (not self-closing, not void element)
      formatted += indentStr.repeat(indent) + token + '\n';
      indent++;
    } else if (token.startsWith('<')) {
      // Self-closing, void element, or doctype/comment
      formatted += indentStr.repeat(indent) + token + '\n';
    } else {
      // Text content
      const trimmed = token.trim();
      if (trimmed) {
        formatted += indentStr.repeat(indent) + trimmed + '\n';
      }
    }
  }

  return formatted.trim();
};

type ViewMode = "preview" | "raw";

// Factory function to create the node with context components
export const createResponseBodyNode = (
  NodeViewWrapper: any,
  CodeEditor: any,
  useParentResponseDoc: (editor: any, getPos: () => number) => { openNodes: string[]; parentPos: number | null }
) => {
  const ResponseBodyComponent = ({ node, getPos, editor }: any) => {
    const { body, contentType } = node.attrs as ResponseBodyAttrs;
    const [viewMode, setViewMode] = React.useState<ViewMode>("preview");
    const [isPrettified, setIsPrettified] = React.useState(false);

    // Read parent's openNodes state - automatically updates when parent changes
    const { openNodes } = useParentResponseDoc(editor, getPos);
    const isCollapsed = !openNodes.includes("response-body");

    // Handle click - toggle this node open/closed
    const handleSetActive = () => {
      editor.commands.toggleResponseNode("response-body");
    };

    if (!body) {
      return (
        <NodeViewWrapper className="response-body-node" style={{ userSelect: 'text' }}>
          <div className="my-2">
            <div className="bg-bg p-2 text-comment text-sm border-b !border-solid !border-[rgba(0,0,0,0.2)]">No response body</div>
          </div>
        </NodeViewWrapper>
      );
    }

    const ct = (contentType || "").toLowerCase();

    // Detect content type category
    const isImage = ct.startsWith("image/");
    const isVideo = ct.startsWith("video/");
    const isAudio = ct.startsWith("audio/");
    const isPdf = ct === "application/pdf";
    const isJson = ct.includes("json");
    const isXml = ct.includes("xml");
    const isHtml = ct.includes("html");
    const isText = ct.startsWith("text/");
    const isBinary = ct === "application/octet-stream" || (!isImage && !isVideo && !isAudio && !isPdf && !isJson && !isXml && !isHtml && !isText && ct.startsWith("application/"));

    // Can show preview?
    const hasPreview = isImage || isVideo || isAudio || isPdf || isHtml;

    // Download handler
    const handleDownload = () => {
      try {
        let blob: Blob;
        let fileName = `response_${Date.now()}`;

        // Determine file extension
        const extMap: Record<string, string> = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/gif": ".gif",
          "image/webp": ".webp",
          "video/mp4": ".mp4",
          "video/webm": ".webm",
          "audio/mpeg": ".mp3",
          "audio/wav": ".wav",
          "application/pdf": ".pdf",
          "application/json": ".json",
          "application/xml": ".xml",
          "text/html": ".html",
          "text/plain": ".txt",
        };
        fileName += extMap[ct] || "";

        if (typeof body === "string") {
          blob = new Blob([body], { type: contentType || "text/plain" });
        } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
          const uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body);
          blob = new Blob([uint8Array as any], { type: contentType || "application/octet-stream" });
        } else if (body instanceof Blob) {
          blob = body;
        } else if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
          const uint8Array = new Uint8Array(body.data);
          blob = new Blob([uint8Array as any], { type: contentType || "application/octet-stream" });
        } else {
          blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        // console.error("[ResponseBody] Download error:", error);
      }
    };

    // Copy handler
    const handleCopy = async () => {
      try {
        const textToCopy = typeof body === "string" ? body : JSON.stringify(body, null, 2);
        await navigator.clipboard.writeText(textToCopy);
      } catch (error) {
        // console.error("[ResponseBody] Copy error:", error);
      }
    };

    // Render preview content
    const renderPreview = () => {
      if (isImage) {
        let imageUrl: string;

        try {
          if (typeof body === "string" && body.startsWith("data:")) {
            // Already a data URL
            imageUrl = body;
          } else if (typeof body === "string" && (body.startsWith("http://") || body.startsWith("https://"))) {
            // It's a URL string
            imageUrl = body;
          } else if (body instanceof Blob) {
            // Create object URL from Blob
            imageUrl = URL.createObjectURL(body);
          } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
            // Direct binary data (Uint8Array or ArrayBuffer)
            const uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body);
            const blob = new Blob([uint8Array as any], { type: ct });
            imageUrl = URL.createObjectURL(blob);
          } else if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
            // Node.js Buffer serialized as {type: 'Buffer', data: [...]}
            const uint8Array = new Uint8Array(body.data);
            const blob = new Blob([uint8Array as any], { type: ct });
            imageUrl = URL.createObjectURL(blob);
          } else if (typeof body === "string") {
            // Binary string - convert to base64
            const base64 = btoa(body);
            imageUrl = `data:${ct};base64,${base64}`;
          } else {
            // Fallback - try toString
            // console.warn("[ResponseBody] Unknown body format for image:", typeof body, body?.constructor?.name);
            imageUrl = `data:${ct};base64,${String(body)}`;
          }
        } catch (error) {
          // console.error("[ResponseBody] Error creating image URL:", error);
          return (
            <div className="p-4 text-comment text-sm">
              Failed to load image. Error: {String(error)}
            </div>
          );
        }

        return (
          <div className="p-4 flex items-center justify-center bg-bg">
            <img
              src={imageUrl}
              alt="Response"
              className="max-w-full max-h-96 object-contain"
              onError={(e) => {
              }}
            />
          </div>
        );
      }

      if (isVideo) {
        const supportedFormats = ["video/mp4", "video/webm", "video/ogg"];
        if (!supportedFormats.includes(ct)) {
          return (
            <div className="p-4 text-comment text-sm">
              This video format ({ct}) is not supported for preview. Use the download button to view it externally.
            </div>
          );
        }

        let videoUrl: string;
        try {
          if (typeof body === "string" && body.startsWith("data:")) {
            videoUrl = body;
          } else if (body instanceof Blob) {
            videoUrl = URL.createObjectURL(body);
          } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
            const uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body);
            const blob = new Blob([uint8Array as any], { type: ct });
            videoUrl = URL.createObjectURL(blob);
          } else if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
            const uint8Array = new Uint8Array(body.data);
            const blob = new Blob([uint8Array as any], { type: ct });
            videoUrl = URL.createObjectURL(blob);
          } else if (typeof body === "string") {
            const base64 = btoa(body);
            videoUrl = `data:${ct};base64,${base64}`;
          } else {
            videoUrl = `data:${ct};base64,${String(body)}`;
          }
        } catch (error) {
          // console.error("[ResponseBody] Error creating video URL:", error);
          return <div className="p-4 text-comment text-sm">Failed to load video.</div>;
        }

        return (
          <div className="p-4 bg-bg">
            <video controls className="max-w-full max-h-96">
              <source src={videoUrl} type={ct} />
              Your browser does not support the video tag.
            </video>
          </div>
        );
      }

      if (isAudio) {
        let audioUrl: string;
        try {
          if (typeof body === "string" && body.startsWith("data:")) {
            audioUrl = body;
          } else if (body instanceof Blob) {
            audioUrl = URL.createObjectURL(body);
          } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
            const uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body);
            const blob = new Blob([uint8Array as any], { type: ct });
            audioUrl = URL.createObjectURL(blob);
          } else if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
            const uint8Array = new Uint8Array(body.data);
            const blob = new Blob([uint8Array as any], { type: ct });
            audioUrl = URL.createObjectURL(blob);
          } else if (typeof body === "string") {
            const base64 = btoa(body);
            audioUrl = `data:${ct};base64,${base64}`;
          } else {
            audioUrl = `data:${ct};base64,${String(body)}`;
          }
        } catch (error) {
          // console.error("[ResponseBody] Error creating audio URL:", error);
          return <div className="p-4 text-comment text-sm">Failed to load audio.</div>;
        }

        return (
          <div className="p-4 bg-bg">
            <audio controls className="w-full">
              <source src={audioUrl} type={ct} />
              Your browser does not support the audio tag.
            </audio>
          </div>
        );
      }

      if (isPdf) {
        let pdfUrl: string;
        try {
          if (typeof body === "string" && body.startsWith("data:")) {
            pdfUrl = body;
          } else if (body instanceof Blob) {
            pdfUrl = URL.createObjectURL(body);
          } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
            const uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body);
            const blob = new Blob([uint8Array as any], { type: "application/pdf" });
            pdfUrl = URL.createObjectURL(blob);
          } else if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
            const uint8Array = new Uint8Array(body.data);
            const blob = new Blob([uint8Array as any], { type: "application/pdf" });
            pdfUrl = URL.createObjectURL(blob);
          } else if (typeof body === "string") {
            const base64 = btoa(body);
            pdfUrl = `data:application/pdf;base64,${base64}`;
          } else {
            pdfUrl = `data:application/pdf;base64,${String(body)}`;
          }
        } catch (error) {
          // console.error("[ResponseBody] Error creating PDF URL:", error);
          return <div className="p-4 text-comment text-sm">Failed to load PDF.</div>;
        }

        return (
          <div className="bg-bg" style={{ height: '500px' }}>
            <embed src={pdfUrl} type="application/pdf" className="w-full h-full" />
          </div>
        );
      }
      if (isHtml) {
        const htmlContent = typeof body === "string" ? body : String(body);

        // Calculate adaptive height based on content
        const lines = htmlContent.split('\n').length;
        const lineHeight = 20;
        const contentHeight = Math.max(lines * lineHeight + 60, 400);
        const viewportMaxHeight = window.innerHeight * 0.6;
        const maxHeight = Math.min(contentHeight, viewportMaxHeight, 800);

        return (
          <div className="bg-bg" style={{ height: `${maxHeight}px`, minHeight: '400px' }}>
            <iframe
              srcDoc={htmlContent}
              title="HTML Preview"
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
              style={{ background: '#fff' }}
            />
          </div>
        );
      }


      // Fallback to raw view
      return renderRaw();
    };

    // Render raw content
    const renderRaw = () => {
      // For binary/media content, show a message instead of trying to display raw bytes
      if (isImage || isVideo || isAudio || isPdf) {
        return (
          <div className="p-8 text-center bg-bg">
            <div className="text-comment mb-4">
              Binary content cannot be displayed as text.
            </div>
            <div className="text-sm text-comment mb-4">
              Use the Preview tab to view the content, or download the file.
            </div>
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-active hover:bg-border rounded text-sm"
              style={{ cursor: 'pointer' }}
            >
              Download File
            </button>
          </div>
        );
      }

      let lang = "text";
      let displayValue = body;

      if (isJson) {
        lang = "json";
        displayValue = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      } else if (isXml) {
        lang = "xml";
        displayValue = typeof body === "string" ? body : String(body);
      } else if (isHtml) {
        lang = "html";
        const rawHtml = typeof body === "string" ? body : String(body);
        displayValue = isPrettified ? prettifyHtml(rawHtml) : rawHtml;

      } else if (isText) {
        lang = "text";
        displayValue = String(body);
      } else if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
        // Binary buffer - show hex representation or message
        return (
          <div className="p-8 text-center bg-bg">
            <div className="text-comment mb-4">
              Binary data ({body.data.length} bytes)
            </div>
            <div className="text-sm text-comment mb-4">
              This is binary content that cannot be displayed as text.
            </div>
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-active hover:bg-border rounded text-sm"
              style={{ cursor: 'pointer' }}
            >
              Download File
            </button>
          </div>
        );
      } else if (typeof body === "object") {
        lang = "json";
        displayValue = JSON.stringify(body, null, 2);
      } else {
        displayValue = String(body);
      }


      const viewportMaxHeight = window.innerHeight * 0.6;
      const maxHeight = Math.min(viewportMaxHeight, 500);

      return (
        <div style={{ height: 'auto', overflow: 'visible' }}>
          <style>{`
            .response-body-editor .cm-editor {
              max-height: ${maxHeight}px !important;
            }
            .response-body-editor .cm-scroller {
              max-height: ${maxHeight}px !important;
              overflow-y: auto !important;
            }
            /* Ensure find panel is visible and not clipped */
            .response-body-editor .cm-panels-top {
              position: sticky !important;
              top: 0 !important;
              z-index: 10 !important;
              background: var(--bg) !important;
            }
          `}</style>
          <div className="response-body-editor">
            <CodeEditor
              readOnly
              lang={lang}
              value={displayValue}
              showReplace={false}
            />
          </div>
        </div>
      );
    };

    // Render binary download view
    const renderBinaryView = () => {
      return (
        <div className="p-8 text-center bg-bg">
          <div className="text-comment mb-4">
            Binary content ({contentType || "application/octet-stream"})
          </div>
          <button
            onClick={handleDownload}
            className="px-4 py-2 bg-active hover:bg-border rounded text-sm"
          >
            <FileDown size={14} />

          </button>
        </div>
      );
    };

    return (
      <NodeViewWrapper className="response-body-node" style={{ userSelect: 'text' }}>
        <style>{`
          .response-action-btn:hover {
            color: var(--accent) !important;
          }
        `}</style>

        <div className="my-2">
          {/* Header with tabs and actions */}
          <div
            className={`flex items-center justify-between ${!isCollapsed ? "bg-panel" : "bg-bg"} hover:bg-panel border-b  border-border  px-2 py-1.5 header-bar`}
            onClick={handleSetActive}

          >
            <div className="flex items-center gap-2 flex-1" style={{ userSelect: 'none' }}>
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
              <span className="text-sm font-semibold" style={{ pointerEvents: 'none' }}>Response Body</span>

            </div>

            <div className="flex items-center gap-1" style={{ userSelect: 'none' }}>
              {/* Tab buttons */}
              {!isCollapsed && hasPreview && !isBinary && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewMode("preview"); }}
                    className={`px-3 py-1 text-xs rounded ${viewMode === "preview"
                      ? "bg-active text-text"
                      : "text-comment hover:bg-active"
                      }`}

                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <Eye size={14}></Eye>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewMode("raw"); }}
                    className={`px-3 py-1 text-xs rounded ${viewMode === "raw"
                      ? "bg-active text-text"
                      : "text-comment hover:bg-active"
                      }`}

                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <FileText size={14} />
                  </button>
                </>
              )}

              {/* Prettify button - only show for HTML in raw view */}
              {!isCollapsed && isHtml && (viewMode === "raw" || !hasPreview) && (
                <button
                  onClick={(e) => { e.stopPropagation(); setIsPrettified(!isPrettified); }}
                  className={`px-3 py-1 text-xs rounded ${isPrettified
                    ? "bg-active text-text"
                    : "text-comment hover:bg-active"
                    }`}
                  title={isPrettified ? "Show raw HTML" : "Prettify HTML"}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <WrapText size={14} />
                </button>
              )}

              {/* Copy button - only show for text-based content */}
              {!isCollapsed && (isJson || isXml || isHtml || isText) && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                  className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                  title="Copy to clipboard"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <Copy size={14} />
                </button>
              )}

              {!isCollapsed && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                  className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                  title="Download"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <Download size={14} />
                </button>
              )}

            </div>
          </div>

          {/* Content area - collapsible */}
          {!isCollapsed && (
            <div className="bg-editor">
              {contentType && (
                <span className="px-4 py-2 text-xs text-comment font-mono" style={{ pointerEvents: 'none' }}>{contentType}</span>
              )}

              {isBinary
                ? renderBinaryView()
                : viewMode === "preview" && hasPreview
                  ? renderPreview()
                  : renderRaw()}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "response-body",

    group: "block",

    atom: true,

    addAttributes() {
      return {
        body: {
          default: null,
        },
        contentType: {
          default: null,
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: 'div[data-type="response-body"]',
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "response-body", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ResponseBodyComponent);
    },
  });
};
