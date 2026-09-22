import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { AlertCircle } from 'lucide-react';
import YAML from 'yaml';
import React from 'react';
import { revealPluginsTab } from '@/core/extensions/utils/revealPluginsTab';

/**
 * Registry to track which plugin (and version) owns which block type
 */
export const blockOwnership: Map<string, { pluginId: string; pluginName: string; pluginVersion: string }> = new Map();

export const registerBlockOwnership = (blockType: string, pluginId: string, pluginName: string, pluginVersion: string) => {
  blockOwnership.set(blockType, { pluginId, pluginName, pluginVersion });
};

/**
 * Simplify table nodes for better markdown representation
 */
const simplifyTableNode = (tableJson: any) => {
  const simplified = { type: 'table', rows: [] };

  if (!tableJson.content || !Array.isArray(tableJson.content)) return simplified;

  tableJson.content.forEach((rowNode: any) => {
    if (rowNode.type !== 'tableRow') return;
    const simpleRow: any = {};

    if (rowNode.attrs && Object.keys(rowNode.attrs).length > 0) {
      simpleRow.attrs = rowNode.attrs;
    }

    simpleRow.row = [];
    if (rowNode.content && Array.isArray(rowNode.content)) {
      rowNode.content.forEach((cellNode: any) => {
        if (cellNode.type !== 'tableCell' && cellNode.type !== 'tableHeader') return;

        // Extract text content from cell
        let cellValue = '';
        if (cellNode.content && cellNode.content.length === 1 && cellNode.content[0].type === 'paragraph') {
          const paragraphContent = cellNode.content[0].content;
          if (paragraphContent && paragraphContent.length === 1 && paragraphContent[0].type === 'text') {
            cellValue = paragraphContent[0].text;
          }
        }
        simpleRow.row.push(cellValue);
      });
    }

    (simplified as any).rows.push(simpleRow);
  });

  return simplified;
};

/**
 * Convert node to markdown representation (same format as saved in files)
 */
const nodeToMarkdown = (nodeJson: any): string => {
  // Create a clean copy to avoid mutating the original
  const cleanNode: any = {
    type: nodeJson.type,
  };

  // Copy attrs if they exist, filtering out internal placeholder attrs
  if (nodeJson.attrs) {
    const attrs: any = {};
    Object.keys(nodeJson.attrs).forEach((key) => {
      // Skip internal attributes and null values
      if (key === '__originalAttrs' || nodeJson.attrs[key] === null) {
        return;
      }
      attrs[key] = nodeJson.attrs[key];
    });

    // Only add attrs if there are any
    if (Object.keys(attrs).length > 0) {
      cleanNode.attrs = attrs;
    }
  }

  // Process content to simplify tables
  if (nodeJson.content && Array.isArray(nodeJson.content)) {
    cleanNode.content = nodeJson.content.map((child: any) => {
      if (child.type === 'table') {
        return simplifyTableNode(child);
      }
      return child;
    });
  }

  // Use YAML stringify with proper options for multiline strings
  const yaml = YAML.stringify(cleanNode, {
    lineWidth: 0, // Don't wrap lines
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
  });

  return `\`\`\`void\n---\n${yaml}---\n\`\`\``;
};

/**
 * Component to render disabled plugin blocks
 */
const PlaceholderBlockView = ({ node }: any) => {
  const blockType = node.type.name;
  const owner = blockOwnership.get(blockType);

  // Get the full node JSON including all attributes and content
  // If __preserved exists, use that for the markdown representation (it's the original node)
  // Otherwise use the current node JSON
  const nodeJson = node.toJSON();
  const originalNode = nodeJson.attrs?.__preserved || nodeJson;
  const markdownRepresentation = nodeToMarkdown(originalNode);
  const [showMarkdown, setShowMarkdown] = React.useState(false);

  // Check if node has content (like auth node with table)
  const hasContent = originalNode.content && originalNode.content.length > 0;

  return (
    <NodeViewWrapper className="my-4 relative z-[100]">
      <div className="border-2 border-dashed border-orange-500/50 rounded-lg bg-orange-500/5 relative z-[100]">
        {/* Warning Header */}
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-orange-500/20 relative z-[100]">
          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-orange-500 mb-1">
              Plugin Required: {owner?.pluginName || 'Unknown Plugin'}
              {owner?.pluginVersion ? ` (v${owner.pluginVersion})` : ''}
            </h3>
            <p className="text-xs text-comment">
              This <span className="font-mono text-text">{blockType}</span> block cannot be displayed because{' '}
              {owner ? (
                <>
                  <span className="font-semibold text-text">{owner.pluginName}</span> v{owner.pluginVersion} is disabled.{' '}
                  <button
                    onClick={() => revealPluginsTab()}
                    className="text-accent hover:text-orange-400 font-medium underline"
                  >
                    Enable it in Extensions
                  </button>{' '}
                  to view and edit this content.
                </>
              ) : (
                'the required plugin is disabled.'
              )}
            </p>
            {hasContent && (
              <p className="text-xs text-orange-400 mt-1">
                This block contains nested content that will be preserved.
              </p>
            )}
          </div>
        </div>

        {/* Markdown Representation */}
        <div className="p-4 relative z-[100]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-comment">
              The content is preserved in markdown format below (read-only):
            </p>
            <button
              onClick={() => setShowMarkdown(!showMarkdown)}
              className="text-xs text-accent hover:text-orange-400 font-medium relative z-[100]"
            >
              {showMarkdown ? 'Hide' : 'Show'} Markdown
            </button>
          </div>

          {showMarkdown && (
            <div className="relative z-[100]">
              <pre className="text-xs bg-bg border border-border rounded p-3 overflow-auto max-h-96 text-comment font-mono whitespace-pre-wrap">
                {markdownRepresentation}
              </pre>
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

/**
 * Creates a placeholder node that preserves the ENTIRE original node unchanged
 * This acts as a transparent wrapper that stores and restores the exact JSON
 * Works with DocumentPreserver's __preserved attribute system
 */
export const createPlaceholderBlock = (blockType: string) => {
  return Node.create<any>({
    name: blockType,
    group: 'block',
    // IMPORTANT: Don't use atom:true because some nodes (like auth) have child content
    atom: false,
    // Allow any content - this lets us preserve tables, paragraphs, etc.
    content: 'block*',

    // Store all original attributes dynamically
    addAttributes() {
      return {
        // CRITICAL: __preserved is used by DocumentPreserver to restore original nodes
        __preserved: {
          default: null,
          parseHTML: () => null,
          renderHTML: () => null,
          keepOnSplit: false,
        },
        // Also keep explicit attributes for display purposes
        uid: { default: null },
        body: { default: null },
        language: { default: null },
        fieldName: { default: null },
        importedFrom: { default: null },
        authType: { default: null },
      };
    },

    parseHTML() {
      return [{
        tag: `div[data-type="${blockType}"]`,
        getAttrs: (element: HTMLElement) => {
          // Extract all data attributes
          const attrs: Record<string, any> = {};
          Array.from(element.attributes).forEach((attr: Attr) => {
            if (attr.name.startsWith('data-') && attr.name !== 'data-type') {
              const key = attr.name.replace('data-', '');
              try {
                attrs[key] = JSON.parse(attr.value);
              } catch {
                attrs[key] = attr.value;
              }
            }
          });
          return attrs;
        },
      }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', { 'data-type': blockType, ...HTMLAttributes }, 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(PlaceholderBlockView);
    },
  });
};
