/**
 * Voiden REST API Helpers
 *
 * Public API for other plugins/extensions to create REST API blocks programmatically.
 * This allows plugins like postman-import to generate Voiden REST API structures.
 */

import { JSONContent, generateJSON } from "@tiptap/core";
import YAML from "yaml";
import {
  convertToMethodNode,
  convertToURLNode,
  convertToHeadersTableNode,
  convertToQueryTableNode,
  convertToMultipartTableNode,
  convertToUrlTableNode,
  convertToCookiesTableNode,
  convertToJsonNode,
  convertToXMLNode,
  insertParagraphAfterRequestBlocks,
} from "./converter";

/**
 * Helper interface that will be exposed to other plugins
 */
export interface VoidenRestApiHelpers {
  // Node creators
  createMethodNode: (method: string) => JSONContent;
  createUrlNode: (url: string) => JSONContent;
  createHeadersTableNode: (headers: [string, string][]) => JSONContent;
  createQueryTableNode: (params: [string, string][]) => JSONContent;
  createMultipartTableNode: (formData: [string, string][]) => JSONContent;
  createUrlTableNode: (formData: [string, string][]) => JSONContent;
  createCookiesTableNode: (cookies: [string, string][]) => JSONContent;
  createJsonBodyNode: (body: string, contentType: string) => JSONContent;
  createXMLBodyNode: (body: string, contentType: string) => JSONContent;

  // Content utilities
  convertToVoidMarkdown: (jsonContent: JSONContent) => Promise<string>;
  convertBlocksToVoidFile: (title: string, blocks: JSONContent[]) => string;
  insertParagraphAfterRequestBlocks: (content: JSONContent[]) => JSONContent[];
}

/**
 * Create HTTP method node
 */
export function createMethodNode(method: string): JSONContent {
  return convertToMethodNode(method);
}

/**
 * Create URL node
 */
export function createUrlNode(url: string): JSONContent {
  return convertToURLNode(url);
}

/**
 * Create headers table node
 */
export function createHeadersTableNode(headers: [string, string][]): JSONContent {
  return convertToHeadersTableNode(headers);
}

/**
 * Create query parameters table node
 */
export function createQueryTableNode(params: [string, string][]): JSONContent {
  return convertToQueryTableNode(params);
}

/**
 * Create multipart form data table node
 */
export function createMultipartTableNode(formData: [string, string][]): JSONContent {
  return convertToMultipartTableNode(formData);
}

/**
 * Create URL-encoded form data table node (application/x-www-form-urlencoded)
 */
export function createUrlTableNode(formData: [string, string][]): JSONContent {
  return convertToUrlTableNode(formData);
}

/**
 * Create cookies table node
 */
export function createCookiesTableNode(cookies: [string, string][]): JSONContent {
  return convertToCookiesTableNode(cookies);
}

/**
 * Create JSON body node
 */
export function createJsonBodyNode(body: string, contentType: string = "json"): JSONContent {
  return convertToJsonNode(body, contentType);
}

/**
 * Create XML body node
 */
export function createXMLBodyNode(body: string, contentType: string = "xml"): JSONContent {
  return convertToXMLNode(body, contentType);
}

/**
 * Convert JSON content to Voiden markdown format
 * This function converts a ProseMirror JSONContent structure to markdown
 * suitable for saving as a .void file
 */
export async function convertToVoidMarkdown(jsonContent: JSONContent): Promise<string> {
  // Get the markdown converter function that was set up by the plugin
  const converter = (window as any).__voidenMarkdownConverter__;

  if (!converter) {
    throw new Error(
      'Markdown converter not available. Make sure voiden-rest-api plugin is loaded first.'
    );
  }

  // Convert the JSONContent to markdown with frontmatter
  return await converter(jsonContent);
}


/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Extract text content from a JSONContent node
 * Recursively extracts text from the content array
 */
function extractTextContent(node: JSONContent): string {
  if (!node) return '';

  // If the node has a text property, return it
  if ('text' in node && typeof node.text === 'string') {
    return node.text;
  }

  // If the node has content, recursively extract text from children
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(child => extractTextContent(child)).join('');
  }

  return '';
}

/**
 * Ensure all blocks have UIDs
 */
function ensureUIDs(block: JSONContent): JSONContent {
  const result = { ...block };

  // Add UID if not present
  if (!result.attrs) {
    result.attrs = {};
  }
  if (!result.attrs.uid) {
    result.attrs.uid = generateUUID();
  }

  // Recursively add UIDs to content
  if (result.content && Array.isArray(result.content)) {
    result.content = result.content.map(item =>
      typeof item === 'object' && item.type ? ensureUIDs(item) : item
    );
  }

  return result;
}

/**
 * Convert JSONContent blocks to a complete .void file format
 * This generates markdown with YAML frontmatter and voiden blocks
 *
 * @param title - Document title
 * @param blocks - Array of JSONContent blocks (request, headers-table, etc.)
 * @returns Complete .void file content as string
 */
export function convertBlocksToVoidFile(title: string, blocks: JSONContent[]): string {
  const now = new Date().toISOString();
  let voidContent = '';

  // YAML frontmatter
  voidContent += '---\n';
  voidContent += 'version: 0.20.1\n';
  voidContent += 'generatedBy: Voiden Extension\n';
  voidContent += 'note: This file is auto-generated\n';
  voidContent += `generatedAt: ${now}\n`;
  voidContent += '---\n\n';

  // Title
  voidContent += `# ${title}\n\n`;

  // Add each block as a void, json or text code
  blocks.forEach(block => {
    if ( block.type == 'inline-json' ) {
      voidContent += '```json\n';
      // Extract text content from the block's content array
      const textContent = extractTextContent(block);
      voidContent += textContent;
      voidContent += '\n```\n\n';
    } else if ( block.type == 'paragraph' ) {
      voidContent += '\n';
      // Extract text content from the block's content array
      const textContent = extractTextContent(block);
      voidContent += textContent;
      voidContent += '\n';
    } else {
      // Ensure all blocks have UIDs
      const blockWithUID = ensureUIDs(block);

      voidContent += '```void\n';
      voidContent += '---\n';
      voidContent += YAML.stringify(blockWithUID, {
        lineWidth: 0, // Don't wrap lines
        defaultStringType: 'QUOTE_DOUBLE',
        defaultKeyType: 'PLAIN',
      });
      voidContent += '---\n';
      voidContent += '```\n\n';
    }
  });

  return voidContent;
}

/**
 * Insert paragraph nodes after request blocks for better formatting
 */
export function insertParagraphAfterRequestBlocksHelper(content: JSONContent[]): JSONContent[] {
  return insertParagraphAfterRequestBlocks(content);
}

/**
 * Export all helpers as a single object
 * This is what will be exposed through window.__voidenHelpers__
 */
export const helpers: VoidenRestApiHelpers = {
  createMethodNode,
  createUrlNode,
  createHeadersTableNode,
  createQueryTableNode,
  createMultipartTableNode,
  createUrlTableNode,
  createCookiesTableNode,
  createJsonBodyNode,
  createXMLBodyNode,
  convertToVoidMarkdown,
  convertBlocksToVoidFile,
  insertParagraphAfterRequestBlocks: insertParagraphAfterRequestBlocksHelper,
};
