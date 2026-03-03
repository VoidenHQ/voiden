/**
 * Response Viewer
 *
 * Read-only Voiden viewer for displaying responses.
 * Does not interfere with the main VoidenEditor's global state.
 *
 * preferredActiveNode is applied via transaction (not via content re-init) to prevent
 * editor recreation cycles that cause a visible glitch on first load.
 */

import { useEditor, EditorContent } from '@tiptap/react';
import { useMemo, useEffect } from 'react';
import { voidenExtensions } from '@/core/editors/voiden/extensions';
import { useEditorEnhancementStore } from '@/plugins';
import { getSchema } from '@tiptap/core';
import { parseMarkdown } from '@/core/editors/voiden/markdownConverter';
import { proseClasses } from '@/core/editors/voiden/VoidenEditor';
import UniqueID from '@/core/editors/voiden/extensions/uniqueId';
import type { ResponseNodeType } from '../stores/responseStore';

interface ResponseViewerProps {
  content: string | any; // Can be markdown string or doc JSON
  preferredActiveNode?: ResponseNodeType | null;
  onActiveNodeChange?: (nodeType: ResponseNodeType) => void;
}

export function ResponseViewer({ content, preferredActiveNode = null, onActiveNodeChange }: ResponseViewerProps) {
  // Get plugin extensions
  const pluginExtensions = useEditorEnhancementStore((state) => state.voidenExtensions);

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

  // Parse content — intentionally excludes preferredActiveNode from deps.
  // Applying it here would cause parsedContent to change → useEditor deps change → editor
  // recreates on every onTransaction call, producing a visible flash. Instead we apply
  // preferredActiveNode via a transaction in the effect below.
  const parsedContent = useMemo(() => {
    try {
      if (typeof content === 'object' && content?.type === 'doc') {
        return content;
      }
      // Legacy path: markdown string
      const schema = getSchema(finalExtensions);
      return parseMarkdown(content, schema);
    } catch {
      return null;
    }
  }, [content, finalExtensions]);

  // Create read-only editor. Deps are stable: parsedContent changes only when the
  // actual response content changes (new request), and onActiveNodeChange is ref-backed.
  const editor = useEditor({
    extensions: finalExtensions,
    content: parsedContent,
    editable: false,
    onTransaction: ({ editor: transactionEditor }) => {
      if (!onActiveNodeChange) return;
      transactionEditor.state.doc.descendants((node: any) => {
        if (node.type.name !== 'response-doc') return true;
        onActiveNodeChange((node.attrs?.activeNode ?? '') as ResponseNodeType);
        return false;
      });
    },
    editorProps: {
      attributes: {
        class: `${proseClasses} outline-none px-5`,
        style: 'user-select: text; -webkit-user-select: text;',
      },
    },
  }, [parsedContent, onActiveNodeChange]);

  // Apply preferredActiveNode via a transaction instead of through content re-init.
  // This restores the last-viewed response tab (body/headers/etc.) without triggering
  // editor recreation.
  useEffect(() => {
    if (!editor || !preferredActiveNode) return;
    const { state } = editor;
    let tr = state.tr;
    let changed = false;
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'response-doc' && node.attrs?.activeNode !== preferredActiveNode) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, activeNode: preferredActiveNode });
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) {
      editor.view.dispatch(tr);
    }
  }, [editor, preferredActiveNode]);

  // Return null while editor is initializing — the parent (ResponsePanelContainer)
  // already handles all loading/error/empty states, so no fallback text needed here.
  if (!editor) return null;

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
        .response-body-node .cm-editor,
        .response-body-node .cm-scroller {
          height: 100% !important;
          max-height: 400px !important;
          overflow-y: auto !important;
        }
      `}</style>
      <div className="response-viewer-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
