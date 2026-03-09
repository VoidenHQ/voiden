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
  convertToMethodNode,
  convertToMultipartTableNode,
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

const parseMarkdown = (markdown: string, schema: any) => {
  // Stub - TODO: Implement proper markdown parsing via SDK
  return { type: 'doc', content: [] };
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
export const pasteCurl = (editor: Editor, request: ImportRequest) => {
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
      // Handle URL-encoded form data
      if (request.body.mimeType === "application/x-www-form-urlencoded" && request.body.params) {
        // TODO: Fix - convertToUrlTableNode doesn't exist, needs proper implementation
        // editorJsonContent = findAndReplaceOrAddNode(
        //   editorJsonContent,
        //   "url-table",
        //   convertToUrlTableNode(request.body.params.map((param) => [param.name, param.value || ""])),
        // );
      }
      // Handle multipart form data
      else if (request.body.mimeType === "multipart/form-data" && request.body.params) {
        const formatFileName = (fileName: string) => {
          return `@${fileName.replace(/^"|"$/g, "")}`;
        };

        const tableData = request.body.params.map((param) => {
          const name = param.name;
          const value = param.fileName ? formatFileName(param.fileName) : param.value || "";
          const valueWithoutQuotes = value.replace(/^"|"$/g, "");
          return [name, valueWithoutQuotes];
        });

        editorJsonContent = findAndReplaceOrAddNode(editorJsonContent, "multipart-table", convertToMultipartTableNode(tableData));
      }
      // Handle YAML body
      else if (["application/x-yaml", "text/yaml", "text/x-yaml", "application/yaml"].includes(request.body.mimeType || "") && request.body.text) {
        const bodyText = request.body.text;

        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "yml_body",
          convertToYmlNode(bodyText, request.body.mimeType || "application/x-yaml")
        );
      }
      // Handle XML body
      else if (["application/xml", "text/xml"].includes(request.body.mimeType || "") && request.body.text) {
        const bodyText = request.body.text;

        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "xml_body",
          convertToXMLNode(bodyText, request.body.mimeType || "application/xml")
        );
      }
      // Handle JSON/text body
      else if (["application/hal+json", "application/json", "text/plain"].includes(request.body.mimeType || "") && request.body.text) {
        const contentType = request.body.mimeType && ["application/json", "application/hal+json"].includes(request.body.mimeType) ? "json" : "text";

        // Prettify JSON payload if applicable
        const rawJson = request.body.text;
        let bodyText = rawJson;
        if (contentType === "json") {
          try {
            bodyText = prettifyJSONC(rawJson);
          } catch (e) {
           // silently fail
          }
        }

        editorJsonContent = findAndReplaceOrAddNode(
          editorJsonContent,
          "json_body",
          convertToJsonNode(bodyText, contentType)
        );
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