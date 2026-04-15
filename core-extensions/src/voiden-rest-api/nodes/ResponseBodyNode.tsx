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
import { AlertCircle, ChevronDown, Copy, Download, Eye, FileDown, FileText, WrapText } from "lucide-react";

type LangOption = { label: string; value: string };
const LANG_OPTIONS: LangOption[] = [
  { label: "Auto", value: "auto" },
  { label: "Raw", value: "raw" },
  { label: "JSON", value: "json" },
  { label: "XML", value: "xml" },
  { label: "HTML", value: "html" },
  { label: "YAML", value: "yaml" },
  { label: "JavaScript", value: "javascript" },
  { label: "Python", value: "python" },
  { label: "Plain Text", value: "text" },
  { label: "Hex", value: "hex" },
  { label: "Base64", value: "base64" },
];

// Truncate response body display at this character count to prevent UI freeze
const TRUNCATE_THRESHOLD = 500 * 1024; // 500 KB

function formatBodySize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(2)} MB`;
}


export interface ResponseBodyAttrs {
  body: any;
  contentType: string | null;
  downloadFilename: string | null;
}

const PRETTIFIABLE_LANGS = new Set(["json", "xml", "html", "yaml", "javascript", "python", "css"]);

const prettifyContent = (text: string, lang: string): string => {
  try {
    if (lang === "json") {
      return JSON.stringify(JSON.parse(text), null, 2);
    }
    if (lang === "xml" || lang === "html") {
      return prettifyHtml(text);
    }
    if (lang === "yaml") {
      // Basic YAML prettify: normalize indentation to 2 spaces
      return text
        .split("\n")
        .map((line) => {
          const match = line.match(/^(\t+)/);
          if (match) return "  ".repeat(match[1].length) + line.slice(match[1].length);
          return line;
        })
        .join("\n")
        .trim();
    }
  } catch {
    // If parsing fails, return original
  }
  return text;
};

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
  useParentResponseDoc: (editor: any, getPos: () => number) => { openNodes: string[]; parentPos: number | null },
  useResponseBodyHeight: () => { height: number | null; setHeight: (h: number) => void },
  Tip: any
) => {
  const ResponseBodyComponent = ({ node, getPos, editor }: any) => {
    const { body, contentType, downloadFilename } = node.attrs as ResponseBodyAttrs;
    const [viewMode, setViewMode] = React.useState<ViewMode>("raw");
    const [isPrettified, setIsPrettified] = React.useState(false);
    const [langOverride, setLangOverride] = React.useState<string>("auto");
    const [isLangDropdownOpen, setIsLangDropdownOpen] = React.useState(false);
    const langDropdownRef = React.useRef<HTMLDivElement>(null);

    // Reset prettify when language changes
    React.useEffect(() => { setIsPrettified(false); }, [langOverride]);

    React.useEffect(() => {
      if (!isLangDropdownOpen) return;
      const handleClickOutside = (e: MouseEvent) => {
        if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as globalThis.Node)) {
          setIsLangDropdownOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isLangDropdownOpen]);

    // Content-type detection — derived from contentType only, safe to compute before hooks
    const ct = (contentType || "").toLowerCase();
    const isImage = ct.startsWith("image/");
    const isVideo = ct.startsWith("video/");
    const isAudio = ct.startsWith("audio/");
    const isPdf = ct === "application/pdf";
    const isJson = ct.includes("json");
    const isXml = ct.includes("xml");
    const isHtml = ct.includes("html");
    const isText = ct.startsWith("text/");
    const isBinary = ct === "application/octet-stream" || (!isImage && !isVideo && !isAudio && !isPdf && !isJson && !isXml && !isHtml && !isText && ct.startsWith("application/"));
    const hasPreview = isImage || isVideo || isAudio || isPdf || isHtml;

    // Keep hook call for API stability (hook order must not change)
    useResponseBodyHeight();

    // Memoize body serialization — JSON.stringify on large objects is expensive
    const { serializedBody, totalBodySize } = React.useMemo(() => {
      if (!body || isImage || isVideo || isAudio || isPdf) {
        return { serializedBody: null, totalBodySize: 0 };
      }
      if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
        return { serializedBody: null, totalBodySize: body.data.length };
      }
      let text: string;
      if (isJson) {
        text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      } else if (isXml || isHtml || isText) {
        text = typeof body === "string" ? body : String(body);
      } else if (typeof body === "object") {
        text = JSON.stringify(body, null, 2);
      } else {
        text = String(body);
      }
      return { serializedBody: text, totalBodySize: text.length };
    }, [body, isJson, isXml, isHtml, isText, isImage, isVideo, isAudio, isPdf]);

    const [showFullContent, setShowFullContent] = React.useState(false);
    const [highlightEnabled, setHighlightEnabled] = React.useState(false);
    const isTruncated = !showFullContent && totalBodySize > TRUNCATE_THRESHOLD;
    const showHighlightBtn = showFullContent && !highlightEnabled && totalBodySize > TRUNCATE_THRESHOLD;

    // Read parent's openNodes state - automatically updates when parent changes
    const { openNodes } = useParentResponseDoc(editor, getPos);
    const isCollapsed = !openNodes.includes("response-body");

    // Compute effective lang at component level so header buttons can use it
    const autoLang = (() => {
      if (isJson || (!isXml && !isHtml && !isText && typeof body === "object")) return "json";
      if (isXml) return "xml";
      if (isHtml) return "html";
      return "text";
    })();
    const effectiveLang = langOverride === "auto" ? autoLang : langOverride;
    const canPrettify = PRETTIFIABLE_LANGS.has(effectiveLang);

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

    // Download handler
    const handleDownload = () => {
      try {
        let blob: Blob;

        // Precedence: Content-Disposition filename > content-type derived name
        let fileName: string;
        if (downloadFilename) {
          fileName = downloadFilename;
        } else {
          const extMap: Record<string, string> = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/svg+xml": ".svg",
            "video/mp4": ".mp4",
            "video/webm": ".webm",
            "audio/mpeg": ".mp3",
            "audio/wav": ".wav",
            "application/pdf": ".pdf",
            "application/json": ".json",
            "application/xml": ".xml",
            "application/zip": ".zip",
            "application/gzip": ".gz",
            "application/x-tar": ".tar",
            "application/octet-stream": ".bin",
            "text/html": ".html",
            "text/plain": ".txt",
            "text/csv": ".csv",
            "text/xml": ".xml",
            "text/calendar": ".ics",
            "text/yaml": ".yaml",
            "text/x-yaml": ".yaml",
          };
          fileName = `response_${Date.now()}` + (extMap[ct] || "");
        }

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
      }
    };

    // Copy handler
    const handleCopy = async () => {
      try {
        const textToCopy = typeof body === "string" ? body : JSON.stringify(body, null, 2);
        await navigator.clipboard.writeText(textToCopy);
      } catch (error) {
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
            imageUrl = `data:${ct};base64,${String(body)}`;
          }
        } catch (error) {
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
          return <div className="p-4 text-comment text-sm">Failed to load PDF.</div>;
        }

        const pdfViewerUrl = `${pdfUrl}${pdfUrl.includes("#") ? "&" : "#"}toolbar=0&navpanes=0&scrollbar=0`;

        return (
          <div className="bg-bg" style={{ height: '500px' }}>
            <embed src={pdfViewerUrl} type="application/pdf" className="w-full h-full" />
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
      if (langOverride === "hex") return renderHex();
      if (langOverride === "base64") return renderBase64();
      if (langOverride === "raw") return renderRawNoHighlight();

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

      // Binary buffer — show download prompt
      if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
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
      }

      const lang = effectiveLang;

      // Use memoized serialized body; apply prettify if toggled
      let displayValue = serializedBody ?? String(body);
      if (isPrettified && canPrettify) {
        displayValue = prettifyContent(displayValue, lang);
      }

      // Truncate very large content — CodeMirror can handle big docs but the initial
      // parse + syntax highlight of multi-MB content still stalls the main thread.
      const displayedValue = isTruncated ? displayValue.slice(0, TRUNCATE_THRESHOLD) : displayValue;

      return (
        <div style={{ height: 'auto', overflow: 'visible' }}>
          <style>{`
            .response-body-editor .cm-editor {
              height: auto !important;
            }
            .response-body-editor .cm-scroller {
              min-height: 0 !important;
              max-height: min(600px, calc(var(--response-panel-height, 70vh) - 120px)) !important;
              overflow-y: auto !important;
            }
            .response-body-editor .cm-panels-top {
              position: sticky !important;
              top: 0 !important;
              z-index: 10 !important;
              background: var(--bg) !important;
            }
          `}</style>
          {isTruncated && (
            <div className="flex justify-end">
              <button
                onClick={(e) => { e.stopPropagation(); setShowFullContent(true); }}
                className="flex items-center shrink-0 whitespace-nowrap cursor-pointer px-4 py-2 text-accent"
              >
                Show full response
                <ChevronDown size={14} className="ml-1" />
              </button>
            </div>
          )}
          {showHighlightBtn && (
            <div className="flex items-center justify-end gap-3 px-3 py-1.5">
              <span className="text-xs text-comment">Syntax highlighting is off for performance.</span>
              <button
                onClick={(e) => { e.stopPropagation(); setHighlightEnabled(true); }}
                className="text-xs px-2 py-0.5 rounded border border-border text-comment hover:text-text hover:border-accent transition-colors shrink-0"
              >
                Enable highlighting
              </button>
            </div>
          )}
          <div className="response-body-editor">
            <CodeEditor
              readOnly
              lang={lang}
              value={displayedValue}
              showReplace={false}
              forceHighlight={highlightEnabled}
            />
          </div>
        </div>
      );
    };

    // Render raw content with no syntax highlighting
    const renderRawNoHighlight = () => {
      const text = serializedBody ?? String(body);
      const displayed = isTruncated ? text.slice(0, TRUNCATE_THRESHOLD) : text;
      return (
        <div className="response-body-editor">
          <CodeEditor readOnly lang="text" value={displayed} showReplace={false} />
        </div>
      );
    };

    // Convert body to bytes for hex/base64 views
    const getBodyBytes = (): Uint8Array => {
      if (typeof body === "string") return new TextEncoder().encode(body);
      if (body instanceof Uint8Array) return body;
      if (body instanceof ArrayBuffer) return new Uint8Array(body);
      if (body instanceof Blob) return new Uint8Array(0); // can't sync-read Blob
      if (typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
        return new Uint8Array(body.data);
      }
      return new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body, null, 2));
    };

    // Render hex dump view
    const renderHex = () => {
      const HEX_BYTE_LIMIT = 64 * 1024; // show up to 64 KB of bytes
      const bytes = getBodyBytes();
      const truncated = bytes.length > HEX_BYTE_LIMIT;
      const slice = truncated ? bytes.slice(0, HEX_BYTE_LIMIT) : bytes;
      const ROW = 16;
      const rows: string[] = [];
      for (let i = 0; i < slice.length; i += ROW) {
        const chunk = slice.slice(i, i + ROW);
        const offset = i.toString(16).padStart(8, "0");
        const hex = Array.from(chunk)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")
          .padEnd(ROW * 3 - 1, " ");
        const ascii = Array.from(chunk)
          .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
          .join("");
        rows.push(`${offset}  ${hex}  |${ascii}|`);
      }
      const hexText = rows.join("\n");

      return (
        <div>
          {truncated && (
            <div className="flex justify-end px-3 py-1.5">
              <span className="text-xs text-accent">Showing first 64 KB of {formatBodySize(bytes.length)}</span>
            </div>
          )}
          <div className="response-body-editor">
            <CodeEditor
              readOnly
              lang="text"
              value={hexText}
              showReplace={false}
            />
          </div>
        </div>
      );
    };

    // Render base64 view
    const renderBase64 = () => {
      let b64 = "";
      try {
        const bytes = getBodyBytes();
        const CHUNK = 8192;
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
        }
        b64 = btoa(binary);
      } catch {
        b64 = "(failed to encode as base64)";
      }
      return (
        <div className="response-body-editor">
          <CodeEditor
            readOnly
            lang="text"
            value={b64}
            showReplace={false}
          />
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
              {totalBodySize > 0 && (
                <span
                  className="text-xs text-comment font-mono"
                  style={{ pointerEvents: 'none', opacity: 0.7 }}
                >
                  {formatBodySize(totalBodySize)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1" style={{ userSelect: 'none' }}>
              {/* Copy button - only show for text-based content */}
              {(isJson || isXml || isHtml || isText) && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                  className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                  title="Copy to clipboard"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <Copy size={14} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="response-action-btn px-3 py-1 text-xs text-comment rounded"
                title="Download"
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <Download size={14} />
              </button>
            </div>
          </div>

          {/* Content area - collapsible */}
          {!isCollapsed && (
            <div className="bg-editor">
              {/* Toolbar: content-type + view controls */}
              <div className="flex items-center justify-between p-3 border-b border-border" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-comment font-mono" style={{ pointerEvents: 'none' }}>
                  {contentType ?? ""}
                </span>
                <div className="flex items-center gap-1">
                  {/* Preview / Raw tabs */}
                  {hasPreview && !isBinary && (
                    <button
                      onClick={() => setViewMode("preview")}
                      className={`px-2 py-1 text-xs rounded ${viewMode === "preview" ? "bg-active text-text" : "text-comment hover:bg-active"}`}
                      title="Preview"
                      style={{ cursor: 'pointer' }}
                    >
                      <Eye size={13} />
                    </button>
                  )}
                  {!isBinary && (
                    <button
                      onClick={() => setViewMode("raw")}
                      className={`px-2 py-1 text-xs rounded ${viewMode === "raw" ? "bg-active text-text" : "text-comment hover:bg-active"}`}
                      title="Raw"
                      style={{ cursor: 'pointer' }}
                    >
                      <FileText size={13} />
                    </button>
                  )}

                  {/* Prettify */}
                  {canPrettify && viewMode === "raw" && (
                    <button
                      onClick={() => setIsPrettified(!isPrettified)}
                      className={`px-2 py-1 text-xs rounded ${isPrettified ? "bg-active text-text" : "text-comment hover:bg-active"}`}
                      title={isPrettified ? "Show original" : `Prettify ${effectiveLang.toUpperCase()}`}
                      style={{ cursor: 'pointer' }}
                    >
                      <WrapText size={13} />
                    </button>
                  )}

                  {/* Language selector */}
                  {!isBinary && !isImage && !isVideo && !isAudio && !isPdf && viewMode === "raw" && (
                    <div ref={langDropdownRef} className="relative">
                      <button
                        onClick={() => setIsLangDropdownOpen((o) => !o)}
                        className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded ${isLangDropdownOpen ? "bg-active text-text" : "text-comment hover:bg-active"}`}
                        style={{ cursor: 'pointer', fontFamily: 'var(--font-family-mono)' }}
                        title="Change language"
                      >
                        {LANG_OPTIONS.find((o) => o.value === langOverride)?.label ?? "Auto"}
                        <ChevronDown size={10} />
                      </button>
                      {isLangDropdownOpen && (
                        <div
                          className="absolute right-0 z-50 mt-1 py-1 rounded border border-border bg-panel shadow-lg"
                          style={{ minWidth: '110px', top: '100%' }}
                        >
                          {LANG_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => { setLangOverride(opt.value); setIsLangDropdownOpen(false); }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-active transition-colors ${langOverride === opt.value ? "text-accent" : "text-text"}`}
                              style={{ cursor: 'pointer', fontFamily: 'var(--font-family-mono)' }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

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
        downloadFilename: {
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
