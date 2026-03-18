/**
 * cURL Paste Handler Extension for TipTap Editor
 *
 * This extension provides intelligent paste handling for various content types:
 *
 * PASTE HANDLERS (executed in order):
 * 1. URL/Method nodes - Strips formatting, inserts as plain text
 * 2. cURL commands - Parses and populates editor with request details
 * 3. ProseMirror content - Preserves images and formatting using default handler
 * 4. HTML content - Extracts and inserts as plain text
 * 5. Fenced JSON blocks - Prettifies and renders with syntax highlighting
 * 6. Plain text with newlines - Creates separate paragraphs
 * 7. Markdown content - Parses and renders with fallback support
 *
 * SKIP CONDITIONS:
 * - Code blocks, headings, lists (use default paste behavior)
 * - Special protocols (e.g., block://)
 * - Empty clipboard content
 */

// ============================================================================
// Imports
// ============================================================================

import {
  type ImportRequest,
  convertToHeadersTableNode,
  convertToJsonNode,
  convertToXMLNode,
  convertToYmlNode,
  convertToUrlTableNode,
  convertToMethodNode,
  convertToQueryTableNode,
  convertToURLNode,
  findAndReplaceOrAddNode,
  insertParagraphAfterRequestBlocks,
  updateEditorContent,
  convertCurlToRequest,
} from "@voiden/core-extensions";
import { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { Fragment, Node, Slice } from "@tiptap/pm/model";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import markdownIt from "markdown-it";
// TODO: Expose through SDK
// import { prettifyJSONC } from "@/utils/jsonc.ts";
// import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";

// Temporary stub implementations
const prettifyJSONC = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const parseMarkdown = (_markdown: string, _schema: any) => {
  // Stub - TODO: Implement proper markdown parsing via SDK
  return { type: 'doc', content: [] as any[] };
};


// ============================================================================
// Constants
// ============================================================================

const md = markdownIt({ html: false });

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Recursively removes empty text nodes from a node tree
 * @param node - The node to clean
 * @returns The cleaned node or null if it should be removed
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanEmptyTextNodes(node: any): any {
  if (!node) return null;

  // Remove text nodes with empty text
  if (node.type === "text" && (!node.text || node.text === "")) {
    return null;
  }

  // Recursively clean child content
  if (node.content && Array.isArray(node.content)) {
    node.content = node.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((child: any) => cleanEmptyTextNodes(child))
      .filter(Boolean);
  }

  return node;
}

/**
 * Extracts plain text from HTML content
 * @param html - The HTML string to extract text from
 * @returns The extracted plain text
 */
function extractPlainTextFromHtml(html: string): string {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
}

/**
 * Attempts to parse text as a cURL command
 * @param text - The text to parse
 * @returns The parsed ImportRequest or false if parsing fails
 */
export const handleCurl = (text: string): ImportRequest | false => {
  try {
    const requests = convertCurlToRequest(text) as unknown as ImportRequest[];
    return requests && requests.length > 0 ? requests[0] : false;
  } catch (error) {
    return false;
  }
};

// ============================================================================
// Content Rendering Helpers
// ============================================================================

/**
 * Renders markdown to ProseMirror document
 * @param markdown - The markdown text to render
 * @param schema - The ProseMirror schema to use
 * @returns The rendered ProseMirror document
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMarkdownToDoc(markdown: string, schema: any) {
  const html = md.render(markdown);
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const parser = ProseMirrorDOMParser.fromSchema(schema);
  return parser.parse(tempDiv);
}

/**
 * Creates a text node in the editor
 * @param view - The editor view
 * @param text - The text to insert
 */
function insertTextNode(view: EditorView, text: string): void {
  const tr = view.state.tr.replaceSelectionWith(view.state.schema.text(text));
  view.dispatch(tr);
}

/**
 * Creates paragraph nodes from lines of text
 * @param view - The editor view
 * @param lines - Array of text lines
 */
function insertParagraphNodes(view: EditorView, lines: string[]): void {
  const nodes = lines.map(line =>
    view.state.schema.nodes.paragraph.create({}, line ? view.state.schema.text(line) : null)
  );
  const fragment = Fragment.fromArray(nodes);
  const slice = new Slice(fragment, 0, 0);
  const tr = view.state.tr.replaceSelection(slice);
  view.dispatch(tr);
}

// ============================================================================
// cURL Request Processor
// ============================================================================

/**
 * Populates the editor with content from a parsed cURL request
 * This function updates the editor's JSON content structure with:
 * - HTTP method and URL
 * - Headers table
 * - Query parameters table
 * - Request body (URL-encoded, multipart, or JSON)
 *
 * @param editor - The TipTap editor instance
 * @param request - The parsed ImportRequest from the cURL command
 */
const isAbsolutePath = (p: string) =>
  p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);

export const pasteCurl = async (editor: Editor, request: ImportRequest) => {
  // Pre-resolve multipart file paths to absolute before the sync editor update.
  let multipartRows: any[] | null = null;
  if (request.body?.mimeType === 'multipart/form-data' && request.body.params) {
    let activeProject: string | undefined;
    try {
      // @ts-ignore
      const { getQueryClient } = await import(/* @vite-ignore */ '@/main');
      const qc = getQueryClient();
      const projects = (qc.getQueryData(["projects"]) as any);
      activeProject = projects?.activeProject;
    } catch { /* ignore */ }

    const makeCell = (content: any[]) => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: 'paragraph', content }],
    });

    multipartRows = await Promise.all(
      request.body.params.map(async (param: any) => {
        const keyCell = makeCell(param.name ? [{ type: 'text', text: param.name }] : []);

        // File path — from @path notation or a value that looks like a project-relative path
        const rawFile = param.fileName
          ? param.fileName.replace(/^"|"$/g, '').replace(/^@/, '')
          : null;

        // Treat param.value as a file path if it starts with / or \ and isn't a URL
        const rawPathFromValue = !rawFile && param.value
          ? (() => {
              const v = String(param.value).trim();
              return (v.startsWith('/') || v.startsWith('\\')) && !v.includes('://') ? v : null;
            })()
          : null;

        const filePath = rawFile ?? rawPathFromValue;

        let resolvedPath = filePath;
        let isExternalFile = false;

        if (rawFile) {
          if (!isAbsolutePath(rawFile) && activeProject) {
            // Relative @path → try to resolve to absolute
            try {
              const joined = await (window as any).electron?.utils?.pathJoin?.(activeProject, rawFile);
              if (joined) {
                const result = await (window as any).electron?.files?.hash?.(joined);
                if (result?.exists) { resolvedPath = joined; isExternalFile = true; }
              }
            } catch { /* best-effort */ }
          } else {
            // Looks absolute — confirm it actually exists on the filesystem
            try {
              const result = await (window as any).electron?.files?.hash?.(rawFile);
              isExternalFile = !!result?.exists;
            } catch { /* best-effort */ }
          }
        }
        // rawPathFromValue: always project-relative → isExternalFile stays false

        const valCell = resolvedPath
          ? makeCell([{
              type: 'fileLink',
              attrs: {
                filePath: resolvedPath,
                filename: resolvedPath.split(/[\\/]/).pop() ?? resolvedPath,
                isExternal: isExternalFile,
              },
            }])
          : makeCell(param.value ? [{ type: 'text', text: param.value }] : []);

        return { type: 'tableRow', attrs: { disabled: false }, content: [keyCell, valCell] };
      }),
    );
  }

  updateEditorContent(editor, (editorJsonContent) => {
    const requestBlocks = ["headers-table", "query-table", "url-table", "multipart-table", "cookies-table", "json_body", "xml_body", "yml_body"];

    // Step 1: Clean up existing request nodes
    // Remove orphaned method/url nodes and request blocks that should be nested
    editorJsonContent = editorJsonContent.filter((node) => {
      if (node.type === "method" || node.type === "url") return false;
      if (node.type && requestBlocks.includes(node.type)) return false;
      return true;
    });

    // Step 2: Update or create the main request node
    // Find existing non-imported request node
    const requestIndex = editorJsonContent.findIndex((node) => node.type === "request" && !node.attrs?.importedFrom);

    // Create method and URL nodes
    const newEndpointContent = [convertToMethodNode(request.method), convertToURLNode(request.url)];

    if (requestIndex > -1) {
      // Update existing request node
      editorJsonContent[requestIndex] = {
        ...editorJsonContent[requestIndex],
        content: newEndpointContent,
      };
    } else {
      // Create new request node
      const newRequestNode = {
        type: "request",
        content: newEndpointContent,
      };
      editorJsonContent.push(newRequestNode);
    }

    // Step 3: Add headers if present
    if (request.headers?.length) {
      editorJsonContent = findAndReplaceOrAddNode(
        editorJsonContent,
        "headers-table",
        convertToHeadersTableNode(request.headers.map((header) => [header.name, header.value])),
      );
    }

    // Step 4: Add query parameters if present
    if (request.parameters?.length) {
      editorJsonContent = findAndReplaceOrAddNode(
        editorJsonContent,
        "query-table",
        convertToQueryTableNode(request.parameters.map((param) => [param.name, param.value || ""])),
      );
    }

    // Step 5: Add request body based on content type
    if (request.body) {
      const mimeType = request.body.mimeType || "";

      // Handle URL-encoded form data
      if (mimeType === "application/x-www-form-urlencoded" && request.body.params) {
        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "url-table",
          convertToUrlTableNode(request.body.params.map((param) => [param.name, param.value || ""])),
        );
      }
      // Handle multipart form data
      else if (mimeType === "multipart/form-data" && (multipartRows || request.body.params)) {
        const rows = multipartRows ?? [];
        const multipartNode = {
          type: "multipart-table",
          content: [{ type: "table", content: rows }],
        };
        editorJsonContent = findAndReplaceOrAddNode(editorJsonContent, "multipart-table", multipartNode);
      }
      // Handle YAML body
      else if (["application/x-yaml", "text/yaml", "text/x-yaml", "application/yaml"].includes(mimeType) && request.body.text) {
        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "yml_body",
          convertToYmlNode(request.body.text, mimeType || "application/x-yaml"),
        );
      }
      // Handle XML body
      else if (["application/xml", "text/xml", "application/xhtml+xml"].includes(mimeType) && request.body.text) {
        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "xml_body",
          convertToXMLNode(request.body.text, mimeType || "application/xml"),
        );
      }
      // Handle HTML body
      else if (mimeType === "text/html" && request.body.text) {
        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "json_body",
          convertToJsonNode(request.body.text, "html"),
        );
      }
      // Handle JSON body (including JSON variants and hal+json)
      else if (["application/json", "application/hal+json", "application/ld+json", "application/problem+json"].includes(mimeType) && request.body.text) {
        let bodyText = request.body.text;
        try { bodyText = prettifyJSONC(request.body.text); } catch { /* silently fail */ }

        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "json_body",
          convertToJsonNode(bodyText, "json"),
        );
      }
      // Handle plain text body
      else if (mimeType === "text/plain" && request.body.text) {
        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "json_body",
          convertToJsonNode(request.body.text, "text"),
        );
      }
      // Fallback: unknown or missing content type but body text is present — auto-detect
      else if (request.body.text) {
        const trimmed = request.body.text.trim();

        // Looks like XML/HTML (starts with a tag)
        if (trimmed.startsWith("<")) {
          editorJsonContent = findAndReplaceOrAddNode(
            editorJsonContent,
            "xml_body",
            convertToXMLNode(request.body.text, "application/xml"),
          );
        }
        // Looks like YAML (key: value lines, no leading { or [)
        else if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("<") && /^[a-zA-Z_][\w-]*\s*:/m.test(trimmed)) {
          editorJsonContent = findAndReplaceOrAddNode(
            editorJsonContent,
            "yml_body",
            convertToYmlNode(request.body.text, "application/x-yaml"),
          );
        }
        // Looks like URL-encoded form data (key=value pairs, no JSON/XML indicators)
        else if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("<") && /^[^=\s]+=/.test(trimmed)) {
          const params = trimmed.split("&").map((pair) => {
            const eqIdx = pair.indexOf("=");
            if (eqIdx === -1) return [decodeURIComponent(pair.trim()), ""];
            return [
              decodeURIComponent(pair.slice(0, eqIdx).trim()),
              decodeURIComponent(pair.slice(eqIdx + 1).trim()),
            ];
          });
          editorJsonContent = findAndReplaceOrAddNode(
            editorJsonContent,
            "url-table",
            convertToUrlTableNode(params),
          );
        }
        // Try JSON, fall back to plain text
        else {
          let bodyText = request.body.text;
          let detectedType = "text";
          try {
            JSON.parse(trimmed);
            bodyText = prettifyJSONC(request.body.text);
            detectedType = "json";
          } catch { /* not JSON */ }

          editorJsonContent = findAndReplaceOrAddNode(
            editorJsonContent,
            "json_body",
            convertToJsonNode(bodyText, detectedType),
          );
        }
      }
    }

    // Step 6: Ensure proper structure with paragraph after request blocks
    return insertParagraphAfterRequestBlocks(editorJsonContent);
  });
};

// ============================================================================
// Paste Detection Helpers
// ============================================================================

/**
 * Checks if the current cursor position is inside a special node type
 * that should use default paste behavior
 */
function shouldSkipCustomPaste(nodeTypeName: string): boolean {
  const skipNodeTypes = ["codeBlock", "heading", "bulletList", "orderedList"];
  return skipNodeTypes.includes(nodeTypeName);
}

/**
 * Checks if the pasted content is a special protocol that should be skipped
 */
function isSpecialProtocol(text: string): boolean {
  return text.startsWith("block://");
}

/**
 * Checks if the current node is a URL or method node
 */
function isUrlOrMethodNode(nodeTypeName: string): boolean {
  return ["url", "method"].includes(nodeTypeName);
}

/**
 * Detects if content is from ProseMirror editor (contains special markers)
 */
function isProseMirrorContent(html: string | undefined): boolean {
  return !!html && html.includes('<p data-pm-slice');
}

/**
 * Detects if content is HTML (contains div tags)
 */
function isHtmlContent(html: string | undefined): boolean {
  return !!html && html.includes('<div>');
}

/**
 * Checks if text contains markdown formatting indicators
 */
function hasMarkdownFormatting(text: string): boolean {
  // Check for markdown indicators: headers, lists, code blocks, blockquotes, images, links
  // eslint-disable-next-line no-useless-escape
  return !!text.match(/^[#*\-+`>|!\[]/m);
}

// ============================================================================
// TipTap Extension
// ============================================================================

export const CurlPaste = () =>
  Extension.create({
    name: "customPasteHandler",

    addProseMirrorPlugins() {
      const editor = this.editor;

      return [
        new Plugin({
          props: {
            handlePaste(view, event) {
              const { $from } = view.state.selection;
              const clipboardData = event.clipboardData;
              const pastedText = clipboardData?.getData("text/plain");
              const pastedHtml = clipboardData?.getData("text/html");

              // Early exit conditions
              const currentNodeName = $from.parent.type.name;

              // Skip custom paste for special node types (code blocks, headings, lists)
              if (shouldSkipCustomPaste(currentNodeName)) {
                return false;
              }

              // Skip if no text content
              if (!pastedText) {
                return false;
              }

              // Skip special protocols like block://
              if (isSpecialProtocol(pastedText)) {
                return false;
              }

              // === HANDLER 1: Paste into URL/method nodes ===
              // Strip formatting and insert as plain text
              if (isUrlOrMethodNode(currentNodeName)) {
                let cleanedText = pastedText.trim();

                // Extract plain text from HTML if present
                if (isHtmlContent(pastedHtml)) {
                  cleanedText = (pastedHtml ? extractPlainTextFromHtml(pastedHtml) : null) || cleanedText;
                }

                // Strip fenced code block markers (```bash ... ```)
                const tripleBacktickMatch = cleanedText.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
                if (tripleBacktickMatch) {
                  cleanedText = tripleBacktickMatch[1].trim();
                }

                // Insert as plain text
                const tr = view.state.tr.replaceSelectionWith(view.state.schema.text(cleanedText));
                view.dispatch(tr);
                return true;
              }

              // === HANDLER 2: cURL command detection and processing ===
              // Extract text from HTML if needed and attempt to parse as cURL
              let processedText = pastedText;

              if (isHtmlContent(pastedHtml) || isProseMirrorContent(pastedHtml)) {
                processedText = (pastedHtml ? extractPlainTextFromHtml(pastedHtml) : null) || pastedText;
              }

              const request = handleCurl(processedText);
              if (request) {

                // Confirm replacement if editor is not empty
                if (!editor.isEmpty) {
                  const proceed = window.confirm("Pasting this curl request will replace the current content. Do you want to proceed?");
                  if (!proceed) {
                    return true; // Handled but cancelled
                  }
                }

                pasteCurl(editor, request);
                return true;
              }

              // === HANDLER 3: ProseMirror content (preserve images and formatting) ===
              // Let ProseMirror handle its own content to preserve images and formatting
              if (isProseMirrorContent(pastedHtml)) {
                return false; // Use default ProseMirror paste handler
              }

              // === HANDLER 4: HTML content (convert to plain text) ===
              // Convert HTML to plain text for non-ProseMirror HTML
              if (isHtmlContent(pastedHtml)) {
                const plainText = (pastedHtml ? extractPlainTextFromHtml(pastedHtml) : null) || pastedText;

                insertTextNode(view, plainText);
                return true;
              }

              // === HANDLER 5: Fenced JSON code blocks ===
              // Prettify and insert JSON code blocks

              const fencedMatch = pastedText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
              if (fencedMatch) {
                try {
                  const inner = fencedMatch[1];
                  const prettified = prettifyJSONC(inner);
                  const formatted = "```json\n" + prettified + "\n```";
                  const doc = renderMarkdownToDoc(formatted, view.state.schema);
                  const tr = view.state.tr.replaceSelectionWith(doc);
                  view.dispatch(tr);
                  return true;
                } catch (error) {
                  // silently fail
                }
              }

              // === HANDLER 6: Plain text with newlines (not markdown) ===
              // Preserve line breaks by creating separate paragraphs
              const hasNewlines = pastedText.includes('\n');
              const hasMarkdown = hasMarkdownFormatting(pastedText);

              if (hasNewlines && !hasMarkdown) {
                const lines = pastedText.split('\n');
                insertParagraphNodes(view, lines);
                return true;
              }

              // === HANDLER 7: Markdown content ===
              // Parse and render markdown with fallback to basic rendering

              try {
                // Use custom parseMarkdown function which properly handles images
                const parsedDoc = parseMarkdown(pastedText, view.state.schema);

                // Filter out null values (e.g., from definition nodes)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const validContent = parsedDoc.content.filter((nodeJson: any) => nodeJson !== null);

                // Recursively remove empty text nodes
                const cleanContent = validContent
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((nodeJson: any) => cleanEmptyTextNodes(nodeJson))
                  .filter(Boolean);

                // Create ProseMirror nodes from JSON
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const nodes = cleanContent.map((nodeJson: any) => {
                  return view.state.schema.nodeFromJSON(nodeJson);
                });

                // Insert nodes into editor
                const fragment = Fragment.fromArray(nodes);
                const slice = new Slice(fragment, 0, 0);
                const transaction = view.state.tr.replaceSelection(slice);
                view.dispatch(transaction);
                return true;
              } catch (error) {
                // Fallback to basic markdown rendering
                if (error instanceof Error) {
                  // silently fail
                }

                const doc = renderMarkdownToDoc(pastedText, view.state.schema);
                const transaction = view.state.tr.replaceSelectionWith(doc);
                view.dispatch(transaction);
                return true;
              }
            },

            /**
             * Filters out method and url nodes from pasted content
             * This prevents duplicate method/url nodes when pasting from one request to another
             */
            transformPasted(slice) {

              // Filter out method and url nodes
              const content: Node[] = [];
              slice.content.forEach((node) => {
                if (!["method", "url"].includes(node.type.name)) {
                  content.push(node);
                }
              });

              const filteredFragment = Fragment.fromArray(content);

              return new Slice(filteredFragment, slice.openStart, slice.openEnd);
            },
          },
        }),
      ];
    },
  });