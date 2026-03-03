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
import { useMemo, useEffect, useRef } from 'react';
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
  panelScrollTop?: number;
  onPanelScrollChange?: (scrollTop: number) => void;
  nodeScrollPositions?: Record<string, number>;
  onNodeScrollChange?: (nodeKey: string, scrollTop: number) => void;
}

export function ResponseViewer({
  content,
  preferredActiveNode = null,
  onActiveNodeChange,
  panelScrollTop = 0,
  onPanelScrollChange,
  nodeScrollPositions = {},
  onNodeScrollChange,
}: ResponseViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const panelScrollRafRef = useRef<number | null>(null);
  const nodeScrollRafByKeyRef = useRef<Record<string, number | null>>({});
  const nodeScrollPositionsRef = useRef<Record<string, number>>(nodeScrollPositions);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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

  // Persist outer response panel scroll position.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !onPanelScrollChange) return;

    const onScroll = () => {
      if (panelScrollRafRef.current !== null) {
        cancelAnimationFrame(panelScrollRafRef.current);
      }
      panelScrollRafRef.current = requestAnimationFrame(() => {
        onPanelScrollChange(el.scrollTop);
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (panelScrollRafRef.current !== null) {
        cancelAnimationFrame(panelScrollRafRef.current);
        panelScrollRafRef.current = null;
      }
    };
  }, [onPanelScrollChange]);

  // Keep a CSS var in sync with current response panel height so node editors can
  // use available vertical space instead of a fixed pixel cap.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateAvailableHeight = () => {
      el.style.setProperty('--response-panel-height', `${el.clientHeight}px`);
    };

    updateAvailableHeight();
    resizeObserverRef.current = new ResizeObserver(() => updateAvailableHeight());
    resizeObserverRef.current.observe(el);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  // Restore outer response panel scroll position instantly (no smooth scrolling).
  useEffect(() => {
    nodeScrollPositionsRef.current = nodeScrollPositions;
  }, [nodeScrollPositions]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - panelScrollTop) > 1) {
      el.scrollTop = panelScrollTop;
    }
  }, [panelScrollTop, content]);

  // Persist and restore inner node editor scroll positions.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const nodeSelectors: Array<{ keyBase: string; selector: string }> = [
      { keyBase: 'response-body', selector: '.response-body-editor .cm-scroller' },
      { keyBase: 'response-headers', selector: '.response-headers-editor .cm-scroller' },
      { keyBase: 'request-headers', selector: '.request-headers-editor .cm-scroller' },
      { keyBase: 'request-summary', selector: '.request-summary-editor .cm-scroller' },
    ];

    const listeners: Array<{ el: Element; fn: EventListener }> = [];
    const restore = () => {
      for (const { keyBase, selector } of nodeSelectors) {
        const scrollers = Array.from(container.querySelectorAll(selector));
        scrollers.forEach((scroller, index) => {
          const nodeKey = scrollers.length > 1 ? `${keyBase}:${index}` : keyBase;
          const saved = nodeScrollPositionsRef.current[nodeKey];
          if (typeof saved === 'number') {
            (scroller as HTMLElement).scrollTop = saved;
          }

          if (!onNodeScrollChange) return;
          const onScroll = () => {
            const rafMap = nodeScrollRafByKeyRef.current;
            const existing = rafMap[nodeKey];
            if (existing != null) {
              cancelAnimationFrame(existing);
            }
            rafMap[nodeKey] = requestAnimationFrame(() => {
              onNodeScrollChange(nodeKey, (scroller as HTMLElement).scrollTop);
            });
          };
          scroller.addEventListener('scroll', onScroll, { passive: true });
          listeners.push({ el: scroller, fn: onScroll as EventListener });
        });
      }
    };

    // Retry a few times to catch delayed CodeMirror mount.
    const t1 = setTimeout(restore, 0);
    const t2 = setTimeout(restore, 60);
    const t3 = setTimeout(restore, 140);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      listeners.forEach(({ el, fn }) => el.removeEventListener('scroll', fn));
      const rafMap = nodeScrollRafByKeyRef.current;
      Object.keys(rafMap).forEach((key) => {
        const raf = rafMap[key];
        if (raf != null) cancelAnimationFrame(raf);
        rafMap[key] = null;
      });
    };
  }, [content, onNodeScrollChange]);

  // Return null while editor is initializing — the parent (ResponsePanelContainer)
  // already handles all loading/error/empty states, so no fallback text needed here.
  if (!editor) return null;

  return (
    <div
      ref={scrollContainerRef}
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
        .response-body-node .cm-scroller,
        .response-body-editor .cm-editor,
        .response-body-editor .cm-scroller,
        .response-headers-node .cm-editor,
        .response-headers-node .cm-scroller,
        .response-headers-editor .cm-editor,
        .response-headers-editor .cm-scroller,
        .request-headers-node .cm-editor,
        .request-headers-node .cm-scroller,
        .request-headers-editor .cm-editor,
        .request-headers-editor .cm-scroller,
        .request-summary-node .cm-editor,
        .request-summary-node .cm-scroller,
        .request-summary-editor .cm-editor,
        .request-summary-editor .cm-scroller {
          height: auto !important;
          min-height: 180px !important;
          max-height: max(180px, calc(var(--response-panel-height, 70vh) - 170px)) !important;
          overflow-y: auto !important;
        }
      `}</style>
      <div className="response-viewer-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
