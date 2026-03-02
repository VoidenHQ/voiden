/**
 * Response Viewer
 *
 * Read-only Voiden viewer for displaying responses
 * Does not interfere with the main VoidenEditor's global state
 */

import { useEditor, EditorContent } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { voidenExtensions } from '@/core/editors/voiden/extensions';
import { useEditorEnhancementStore } from '@/plugins';
import { getSchema } from '@tiptap/core';
import { parseMarkdown } from '@/core/editors/voiden/markdownConverter';
import { proseClasses } from '@/core/editors/voiden/VoidenEditor';
import UniqueID from '@/core/editors/voiden/extensions/uniqueId';
import { useResponseStore } from '../stores/responseStore';

interface ResponseViewerProps {
  content: string | any; // Can be markdown string or doc JSON
  tabId: string;
}

export function ResponseViewer({ content, tabId }: ResponseViewerProps) {
  // Get plugin extensions
  const pluginExtensions = useEditorEnhancementStore((state) => state.voidenExtensions);
  const { getOpenNodes, setOpenNodes } = useResponseStore();

  // Build extensions list
  const finalExtensions = useMemo(() => {
    const baseExtensions = [...voidenExtensions, ...pluginExtensions];
    return [
      ...baseExtensions,
      UniqueID.configure({
        types: ['heading', 'paragraph', 'codeBlock', 'blockquote'],
      }),
    ];
  }, [pluginExtensions]);

  // Parse content based on type, applying persisted openNodes if available
  const parsedContent = useMemo(() => {
    try {
      let doc: any;
      // If it's already a document object (has type: 'doc'), use it directly
      if (typeof content === 'object' && content?.type === 'doc') {
        doc = content;
      } else {
        // Otherwise, parse as markdown (legacy path)
        const schema = getSchema(finalExtensions);
        doc = parseMarkdown(content, schema);
      }

      // Apply persisted openNodes from the store if available
      const persistedOpenNodes = getOpenNodes(tabId);
      if (persistedOpenNodes && doc?.content) {
        doc = {
          ...doc,
          content: doc.content.map((node: any) => {
            if (node.type === 'response-doc') {
              return {
                ...node,
                attrs: {
                  ...node.attrs,
                  openNodes: persistedOpenNodes,
                },
              };
            }
            return node;
          }),
        };
      }

      return doc;
    } catch (error) {
      // console.error('[ResponseViewer] Error parsing content:', error);
      return null;
    }
  }, [content, finalExtensions]);

  // Create read-only editor with text selection enabled
  const editor = useEditor({
    extensions: finalExtensions,
    content: parsedContent,
    editable: false, // Read-only
    editorProps: {
      attributes: {
        class: `${proseClasses} outline-none px-5`,
        style: 'user-select: text; -webkit-user-select: text;', // Enable text selection
      },
    },
  }, [parsedContent]);

  // Sync openNodes changes back to the store for persistence across tab switches
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'response-doc') {
          const rawOpenNodes = node.attrs.openNodes;
          const openNodes: string[] = Array.isArray(rawOpenNodes)
            ? rawOpenNodes
            : typeof rawOpenNodes === 'string'
              ? JSON.parse(rawOpenNodes)
              : [];
          setOpenNodes(tabIdRef.current, openNodes);
          return false; // Stop iteration
        }
      });
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor, setOpenNodes]);

  if (!editor) {
    return <div className="p-4 text-comment">Loading response...</div>;
  }

  return (
    <div
      className="h-full overflow-auto"
      style={{
        userSelect: 'text',
        WebkitUserSelect: 'text',
        MozUserSelect: 'text',
        msUserSelect: 'text',
      }}
    >
      <style>{`
        .response-viewer-content * {
          user-select: text !important;
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
          -ms-user-select: text !important;
        }
        /* Override cursor for entire header bars in response nodes */
        .response-body-node .header-bar,
        .response-headers-node .header-bar,
        .request-headers-node .header-bar {
          cursor: pointer !important;
        }
        .response-body-node .header-bar *:not(button),
        .response-headers-node .header-bar *:not(button),
        .request-headers-node .header-bar *:not(button) {
          cursor: pointer !important;
        }
        .response-body-node .header-bar button,
        .response-headers-node .header-bar button,
        .request-headers-node .header-bar button {
          cursor: pointer !important;
        }
        /* Full width response blocks with top spacing */
        .response-body-node,
        .response-headers-node {
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        .response-body-node > div,
        .response-headers-node > div {
          margin: 0 !important;
          border-radius: 0 !important;
          border-left: none !important;
          border-right: none !important;
        }
        .response-body-node:first-of-type > div {
          margin-top: 0.5rem !important;
        }
        .response-viewer-content .ProseMirror {
          user-select: text !important;
          -webkit-user-select: text !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        .response-body-node .cm-scroller {
          overflow-y: auto !important;
        }
      `}</style>
      <div className="response-viewer-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
