/**
 * Paste Orchestrator
 *
 * Central coordinator for paste handling across plugins.
 * Implements the paste priority chain:
 *
 * a) Pasting inside a Voiden block → Block owner handles
 * b) LinkBlock:// prefix (linked block reference) → Insert linked block
 * c) Block:// prefix (single block copy) → Parse and render (with singleton check)
 * d) Full Voiden document → Extract blocks, route to owners
 * e) Partial Voiden content → Route blocks to owners
 * f) Pattern matching (cURL, etc.) → Plugins handle
 * g) Valid markdown → Convert and render
 * h) HTML → Convert and render
 * i) Default → Plain text
 */

import { EditorView } from '@tiptap/pm/view';
import { Node as ProseMirrorNode, Fragment, Slice } from '@tiptap/pm/model';
import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import { parseMarkdown } from '@/core/editors/voiden/markdownConverter';
import markdownIt from 'markdown-it';
import type {
  BlockPasteHandler,
  BlockExtension,
  PatternHandler,
  VoidenBlock,
  ExtensionContext
} from '@voiden/sdk/ui';
import { pasteLogger } from '@/core/lib/logger';

const md = markdownIt({ html: false });

export interface VoidenDocument {
  metadata?: Record<string, any>;
  blocks: VoidenBlock[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPER FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Recursively removes empty text nodes from a node tree
 */
function cleanEmptyTextNodes(node: any): any {
  if (!node) return null;

  // Remove text nodes with empty text
  if (node.type === "text" && (!node.text || node.text === "")) {
    return null;
  }

  // Recursively clean child content
  if (node.content && Array.isArray(node.content)) {
    node.content = node.content
      .map((child: any) => cleanEmptyTextNodes(child))
      .filter(Boolean);
  }

  return node;
}

/**
 * Renders markdown to ProseMirror document (fallback method)
 */
function renderMarkdownToDoc(markdown: string, schema: any) {
  const html = md.render(markdown);
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const parser = ProseMirrorDOMParser.fromSchema(schema);
  return parser.parse(tempDiv);
}

export class PasteOrchestrator {
  private blockOwners = new Map<string, BlockPasteHandler>();
  private blockExtensions = new Map<string, BlockExtension[]>();
  private patternHandlers: Array<{ pluginId: string; handler: PatternHandler }> = [];

  /**
   * Register a block owner (plugin that owns a block type)
   */
  registerBlockOwner(blockType: string, handler: BlockPasteHandler, pluginId: string) {
    if (this.blockOwners.has(blockType)) {
      pasteLogger.warn(`Block type "${blockType}" already has an owner. Plugin "${pluginId}" cannot override.`);
      return;
    }

    pasteLogger.info(`Plugin "${pluginId}" registered as owner of block "${blockType}"`);
    this.blockOwners.set(blockType, handler);
  }

  /**
   * Register a block extension (plugin that extends a block type)
   */
  registerBlockExtension(extension: BlockExtension, pluginId: string) {
    const owner = this.blockOwners.get(extension.blockType);

    if (!owner) {
      pasteLogger.warn(`Cannot extend block "${extension.blockType}" - no owner registered yet. Plugin: ${pluginId}`);
      return;
    }

    if (!owner.allowExtensions) {
      pasteLogger.warn(`Block "${extension.blockType}" does not allow extensions. Plugin: ${pluginId}`);
      return;
    }

    if (!this.blockExtensions.has(extension.blockType)) {
      this.blockExtensions.set(extension.blockType, []);
    }

    this.blockExtensions.get(extension.blockType)!.push(extension);
    pasteLogger.info(`Plugin "${pluginId}" registered extension for block "${extension.blockType}"`);
  }

  /**
   * Register a pattern handler (e.g., cURL matcher)
   */
  registerPatternHandler(handler: PatternHandler, pluginId: string) {
    this.patternHandlers.push({ pluginId, handler });
    pasteLogger.info(`Plugin "${pluginId}" registered pattern handler`);
  }

  /**
   * Run only the registered text pattern handlers.
   * Used by history replay/import flows that already have a command string.
   */
  handlePatternText(view: EditorView, text: string, html?: string | null): boolean {
    for (const { pluginId, handler } of this.patternHandlers) {
      if (handler.canHandle(text, html || undefined)) {
        pasteLogger.info(`Delegating text import to pattern handler from plugin "${pluginId}"`);
        const handled = handler.handle(text, html || undefined, view);
        if (handled) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Main paste handler - coordinates all paste logic
   */
  handlePaste(view: EditorView, event: ClipboardEvent): boolean {
    const text = event.clipboardData?.getData('text/plain');
    const html = event.clipboardData?.getData('text/html');

    if (!text) {
      return false;
    }

    const { $from } = view.state.selection;

    // Check if we're inside a table cell - if so, let prosemirror-tables handle it
    let insideTableCell = false;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        insideTableCell = true;
        break;
      }
    }

    // Inside a table cell: insert as plain text to prevent TipTap's markdown parser
    // from converting the content (e.g. backtick-wrapped text → code block).
    if (insideTableCell) {
      view.dispatch(view.state.tr.insertText(text));
      return true;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // a) PASTING INSIDE A VOIDEN BLOCK
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const currentNode = $from.parent;
    const blockOwner = this.blockOwners.get(currentNode.type.name);

    if (blockOwner && blockOwner.handlePasteInside) {
      pasteLogger.info(`Delegating paste to block owner "${currentNode.type.name}"`);
      const handled = blockOwner.handlePasteInside(text, html, currentNode, view);
      if (handled) {
        return true;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // b) LINKBLOCK:// PREFIX (linked block reference)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (text.startsWith('linkblock://')) {
      try {
        const jsonStr = text.slice('linkblock://'.length);
        const linkedBlockData = JSON.parse(jsonStr);

        // Insert the linked block
        const node = view.state.schema.nodeFromJSON(linkedBlockData);
        const transaction = view.state.tr.replaceSelectionWith(node);
        view.dispatch(transaction);
        pasteLogger.info('Pasted linked block reference:', linkedBlockData);
        return true;
      } catch (error) {
        pasteLogger.error('Error parsing linkblock:// paste:', error);
        return false;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // c) BLOCK:// PREFIX (single block copy/paste)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (text.startsWith('block://')) {
      try {
        const jsonStr = text.slice('block://'.length);
        const nodeData = JSON.parse(jsonStr);

        // Check if this is a singleton block that already exists
        const singletonBlocks = [
          // REST API blocks
          'headers-table', 'request', 'json_body', 'xml_body', 'query-table', 'multipart-table', 'url-table', 'cookies-table', 'rest-file',
          // WebSocket blocks
          'socket-request'
        ];
        if (singletonBlocks.includes(nodeData.type)) {
          // Check if this singleton block type already exists in the document
          let existingBlockPos: number | null = null;

          view.state.doc.descendants((node, pos) => {
            if (node.type.name === nodeData.type) {
              existingBlockPos = pos;
              return false; // Stop iteration
            }
          });

          if (existingBlockPos !== null) {
            // Show confirmation dialog
            const blockTypeLabel = nodeData.type.replace(/-/g, ' ').replace(/_/g, ' ');
            const shouldReplace = window.confirm(
              `A ${blockTypeLabel} block already exists in this document.\n\nDo you want to replace it with the pasted block?`
            );

            if (shouldReplace) {
              // Find the existing node and preserve its uid
              const existingNode = view.state.doc.nodeAt(existingBlockPos);
              if (existingNode) {
                // Preserve the uid from the existing block
                const preservedUid = existingNode.attrs?.uid;

                // Create new node with pasted content but preserve the uid
                const newNodeData = {
                  ...nodeData,
                  attrs: {
                    ...nodeData.attrs,
                    uid: preservedUid, // Keep the original uid so linked blocks still work
                  },
                };

                const node = view.state.schema.nodeFromJSON(newNodeData);
                const transaction = view.state.tr.replaceRangeWith(
                  existingBlockPos,
                  existingBlockPos + existingNode.nodeSize,
                  node
                );
                view.dispatch(transaction);
                pasteLogger.info(`Replaced ${blockTypeLabel} block while preserving uid: ${preservedUid}`);
                return true;
              }
            }
            // User cancelled or something went wrong - don't paste
            return true;
          }
        }

        const node = view.state.schema.nodeFromJSON(nodeData);
        const transaction = view.state.tr.replaceSelectionWith(node);
        view.dispatch(transaction);
        return true;
      } catch (error) {
        pasteLogger.error('Error parsing block:// paste:', error);
        return false;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // d) FULL VOIDEN DOCUMENT (with metadata header)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (this.isFullVoidenDocument(text)) {
      const doc = this.parseVoidenDocument(text);
      const handled = this.routeBlocksToOwners(doc.blocks, view);
      if (handled) {
        return true;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // e) PARTIAL VOIDEN CONTENT (contains Voiden blocks)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (this.containsVoidenBlocks(text)) {
      const blocks = this.extractVoidenBlocks(text);
      const handled = this.routeBlocksToOwners(blocks, view);
      if (handled) {
        return true;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // f) PATTERN MATCHING (cURL, GraphQL, SQL, etc.)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (this.handlePatternText(view, text, html)) {
      return true;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // g) VALID MARKDOWN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (this.isValidMarkdown(text)) {
      try {
        const parsedDoc = parseMarkdown(text, view.state.schema);
        const validContent = parsedDoc.content.filter((nodeJson: any) => nodeJson !== null);
        const cleanContent = validContent
          .map((nodeJson: any) => cleanEmptyTextNodes(nodeJson))
          .filter(Boolean);

        const nodes = cleanContent.map((nodeJson: any) => {
          return view.state.schema.nodeFromJSON(nodeJson);
        });

        const fragment = Fragment.fromArray(nodes);
        const slice = new Slice(fragment, 0, 0);
        const transaction = view.state.tr.replaceSelection(slice);
        view.dispatch(transaction);
        return true;
      } catch (error) {
        pasteLogger.error("Error parsing markdown:", error);
        try {
          const doc = renderMarkdownToDoc(text, view.state.schema);
          const transaction = view.state.tr.replaceSelectionWith(doc);
          view.dispatch(transaction);
          return true;
        } catch (fallbackError) {
          pasteLogger.error("Fallback markdown rendering failed:", fallbackError);
          return false;
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // h) HTML CONTENT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (html && this.isHtml(html)) {
      // Check if this is VS Code styled HTML (only styling, no semantic markup)
      if (this.isVSCodeStyledHtml(html)) {
        // Use plain text instead of styled HTML - insert it manually
        pasteLogger.info('Detected VS Code styled HTML, using plain text instead');
        const textNode = view.state.schema.text(text);
        const transaction = view.state.tr.replaceSelectionWith(textNode);
        view.dispatch(transaction);
        return true;  // Prevent default handling
      }

      // Check if HTML contains meaningful semantic elements
      if (this.hasSemanticHtml(html)) {
        return false;  // Let browser/TipTap handle semantic HTML
      }

      // HTML only has styling, use plain text manually
      pasteLogger.info('HTML contains only styling, using plain text');
      const textNode = view.state.schema.text(text);
      const transaction = view.state.tr.replaceSelectionWith(textNode);
      view.dispatch(transaction);
      return true;  // Prevent default handling
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // i) DEFAULT: PLAIN TEXT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    return false;  // Use browser default
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DETECTION HELPERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Check if text is a full Voiden document (has metadata header)
   */
  private isFullVoidenDocument(text: string): boolean {
    // Check for metadata header: <!-- voiden-version: 1.0.0 -->
    const metadataPattern = /^<!--\s*voiden-version:\s*\d+\.\d+\.\d+/m;
    return metadataPattern.test(text);
  }

  /**
   * Parse full Voiden document
   */
  private parseVoidenDocument(text: string): VoidenDocument {
    try {
      const parts = text.split('-->');
      if (parts.length < 2) {
        return { blocks: [] };
      }

      const metadataSection = parts[0];
      const content = parts.slice(1).join('-->').trim();

      const metadata: Record<string, any> = {};
      const metadataLines = metadataSection.split('\n');
      for (const line of metadataLines) {
        const match = line.match(/(\w+):\s*(.+)/);
        if (match) {
          metadata[match[1]] = match[2].trim();
        }
      }

      const blocks = JSON.parse(content);

      return { metadata, blocks };
    } catch (error) {
      pasteLogger.error("Error parsing Voiden document:", error);
      return { blocks: [] };
    }
  }

  /**
   * Check if text contains Voiden blocks (JSON array of blocks)
   */
  private containsVoidenBlocks(text: string): boolean {
    try {
      const json = JSON.parse(text);
      return Array.isArray(json) && json.every((item: any) => item && typeof item === 'object' && item.type);
    } catch {
      return false;
    }
  }

  /**
   * Extract Voiden blocks from text
   */
  private extractVoidenBlocks(text: string): VoidenBlock[] {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  /**
   * Check if text is valid markdown
   * Only treat as markdown if it has multiple markdown indicators or clear structure
   */
  private isValidMarkdown(text: string): boolean {
    // Count markdown indicators
    const hasHeaders = /^#{1,6}\s/m.test(text);
    const hasLists = /^[\*\-\+]\s/m.test(text) || /^\d+\.\s/m.test(text);
    const hasCodeBlocks = /^```/m.test(text) && text.split('```').length >= 3; // Opening and closing
    const hasLinks = /\[.+\]\(.+\)/.test(text);
    const hasBold = /\*\*.+\*\*/.test(text) || /__.+__/.test(text);
    const hasItalic = /\*.+\*/.test(text) || /_.+_/.test(text);
    const hasBlockquotes = /^>/m.test(text);

    // Count how many markdown features are present
    const features = [
      hasHeaders,
      hasLists,
      hasCodeBlocks,
      hasLinks,
      hasBold,
      hasItalic,
      hasBlockquotes
    ].filter(Boolean).length;

    // Only treat as markdown if it has 2 or more markdown features
    // This prevents plain text with incidental characters from being parsed as markdown
    return features >= 2;
  }

  /**
   * Check if HTML content
   */
  private isHtml(html: string): boolean {
    return /<\/?[a-z][\s\S]*>/i.test(html);
  }

  /**
   * Check if HTML is from VS Code (styled divs with monospace font)
   */
  private isVSCodeStyledHtml(html: string): boolean {
    // VS Code HTML has specific patterns:
    // - meta charset tag
    // - monospace font families (Menlo, Monaco, Courier New)
    // - white-space: pre styling
    const hasMetaCharset = /<meta charset=['"]utf-8['"]/i.test(html);
    const hasMonospaceFont = /font-family:\s*[^;]*(Menlo|Monaco|Courier New|monospace)/i.test(html);
    const hasPreWhitespace = /white-space:\s*pre/i.test(html);

    // If it has all these markers, it's VS Code HTML
    return hasMetaCharset && hasMonospaceFont && hasPreWhitespace;
  }

  /**
   * Check if HTML has semantic elements (not just styling)
   */
  private hasSemanticHtml(html: string): boolean {
    // Semantic elements we want to preserve
    const semanticTags = /<(h[1-6]|p|ul|ol|li|blockquote|pre|code|table|tr|td|th|strong|em|a)\b/i;
    return semanticTags.test(html);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BLOCK ROUTING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Route blocks to their owners, apply extensions, and insert
   */
  private routeBlocksToOwners(blocks: VoidenBlock[], view: EditorView): boolean {
    if (!blocks || blocks.length === 0) {
      return false;
    }

    try {
      const processedBlocks = blocks.map(block => this.processBlock(block));

      const nodes = processedBlocks.map(block => {
        try {
          return view.state.schema.nodeFromJSON(block);
        } catch (error) {
          pasteLogger.error("Error creating node from block:", error);
          return null;
        }
      }).filter(Boolean) as ProseMirrorNode[];

      if (nodes.length === 0) {
        return false;
      }

      const tr = view.state.tr;
      nodes.forEach(node => {
        tr.insert(tr.selection.from, node);
      });
      view.dispatch(tr);

      return true;
    } catch (error) {
      pasteLogger.error("Error routing blocks:", error);
      return false;
    }
  }

  /**
   * Process a single block (owner processing + extensions)
   */
  private processBlock(block: VoidenBlock): VoidenBlock {
    const owner = this.blockOwners.get(block.type);

    if (!owner) {
      pasteLogger.warn(`No owner for block type "${block.type}" - returning as-is`);
      return block;
    }

    let processedBlock = owner.processBlock ? owner.processBlock(block) : block;

    if (owner.allowExtensions) {
      const extensions = this.blockExtensions.get(block.type) || [];

      if (extensions.length > 0) {
        if (extensions.length > 1) {
          extensions.sort(() => Math.random() - 0.5);
        }

        const context: ExtensionContext = {
          isTransient: true,
        };

        for (const ext of extensions) {
          try {
            processedBlock = ext.extendBlock(processedBlock, context);
          } catch (error) {
            pasteLogger.error(`Error in block extension for "${block.type}":`, error);
          }
        }
      }
    }

    if (processedBlock.content && Array.isArray(processedBlock.content)) {
      processedBlock.content = processedBlock.content.map(child => this.processBlock(child));
    }

    return processedBlock;
  }

  /**
   * Clear all handlers (for plugin reloading)
   */
  clear() {
    this.blockOwners.clear();
    this.blockExtensions.clear();
    this.patternHandlers = [];
    pasteLogger.info("Cleared all plugin handlers");
  }
}

// Global singleton instance
export const pasteOrchestrator = new PasteOrchestrator();
