import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { AlertCircle } from 'lucide-react';
import React from 'react';
import { revealPluginsTab } from '@/core/extensions/utils/revealPluginsTab';

/**
 * Renders in place of any block whose owning plugin isn't installed at all
 * (as opposed to PlaceholderBlock, which handles installed-but-disabled).
 * The original block's raw text is preserved verbatim in `rawText` so it
 * round-trips unchanged if the file is saved again without the plugin.
 */
const MissingPluginBlockView = ({ node }: any) => {
  const { pluginId, pluginVersion, blockType, rawText } = node.attrs;
  const [showMarkdown, setShowMarkdown] = React.useState(false);

  return (
    <NodeViewWrapper className="my-4 relative z-[100]">
      <div className="border-2 border-dashed border-orange-500/50 rounded-lg bg-orange-500/5 relative z-[100]">
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-orange-500/20 relative z-[100]">
          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-orange-500 mb-1">
              Plugin Not Installed: {pluginId} {pluginVersion ? `(v${pluginVersion} required)` : ''}
            </h3>
            <p className="text-xs text-comment">
              This <span className="font-mono text-text">{blockType}</span> block cannot be displayed because{' '}
              <span className="font-semibold text-text">{pluginId}</span>
              {pluginVersion ? <> v{pluginVersion}</> : null} is not installed.{' '}
              <button
                onClick={() => revealPluginsTab()}
                className="text-accent hover:text-orange-400 font-medium underline"
              >
                Install it from Extensions
              </button>{' '}
              to view and edit this content.
            </p>
          </div>
        </div>

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
                {rawText}
              </pre>
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const MissingPluginBlock = Node.create({
  name: 'missingPluginBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      pluginId: { default: null },
      pluginVersion: { default: null },
      blockType: { default: null },
      rawText: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="missingPluginBlock"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'missingPluginBlock' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MissingPluginBlockView);
  },
});
