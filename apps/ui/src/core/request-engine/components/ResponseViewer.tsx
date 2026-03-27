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
import { useMemo, useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { voidenExtensions } from '@/core/editors/voiden/extensions';
import { useEditorEnhancementStore } from '@/plugins';
import { getSchema } from '@tiptap/core';
import { parseMarkdown } from '@/core/editors/voiden/markdownConverter';
import { proseClasses } from '@/core/editors/voiden/VoidenEditor';
import UniqueID from '@/core/editors/voiden/extensions/uniqueId';
import type { ResponseNodeType } from '../stores/responseStore';

export interface ResponseViewerHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

interface ResponseViewerProps {
  content: string | any; // Can be markdown string or doc JSON
  preferredActiveNode?: ResponseNodeType | null;
  onActiveNodeChange?: (nodeType: ResponseNodeType) => void;
  panelScrollTop?: number;
  onPanelScrollChange?: (scrollTop: number) => void;
  nodeScrollPositions?: Record<string, number>;
  onNodeScrollChange?: (nodeKey: string, scrollTop: number) => void;
  isActive?: boolean;
}

export const ResponseViewer = forwardRef<ResponseViewerHandle, ResponseViewerProps>(function ResponseViewer({
  content,
  preferredActiveNode = null,
  onActiveNodeChange,
  panelScrollTop = 0,
  onPanelScrollChange,
  nodeScrollPositions = {},
  onNodeScrollChange,
  isActive = true,
}: ResponseViewerProps, ref) {
  const COLLAPSIBLE_RESPONSE_NODES = useMemo(
    () =>
      [
        'response-body',
        'response-headers',
        'request-headers',
        'request-headers-security',
        'assertion-results',
        'openapi-validation-results',
        'script-assertion-results',
      ] as const,
    [],
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const panelScrollRafRef = useRef<number | null>(null);
  const panelScrollTopRef = useRef(panelScrollTop);
  const isProgrammaticPanelScrollRef = useRef(false);
  const hasSeenNonZeroUserScrollRef = useRef(false);
  const nodeScrollRafByKeyRef = useRef<Record<string, number | null>>({});
  const nodeScrollPositionsRef = useRef<Record<string, number>>(nodeScrollPositions);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  panelScrollTopRef.current = panelScrollTop;
  const [availableNodes, setAvailableNodes] = useState<string[]>([]);

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

  // Parse content based on type, applying persisted activeNode if available
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

  // Update editor content when response changes (e.g. multi-request sections)
  useEffect(() => {
    if (editor && parsedContent) {
      editor.commands.setContent(parsedContent);
    }
  }, [editor, parsedContent]);

  useEffect(() => {
    if (!editor) return;

    const readResponseDocState = () => {
      const presentNodeSet = new Set<string>();
      editor.state.doc.descendants((node: any) => {
        if (COLLAPSIBLE_RESPONSE_NODES.includes(node.type.name)) {
          presentNodeSet.add(node.type.name);
        }
        return true;
      });

      const presentNodes = COLLAPSIBLE_RESPONSE_NODES.filter((name) => presentNodeSet.has(name as string));
      setAvailableNodes(presentNodes as string[]);
    };

    readResponseDocState();
    editor.on('update', readResponseDocState);
    editor.on('transaction', readResponseDocState);

    return () => {
      editor.off('update', readResponseDocState);
      editor.off('transaction', readResponseDocState);
    };
  }, [editor, COLLAPSIBLE_RESPONSE_NODES]);

  const handleExpandAllResponseNodes = () => {
    if (!editor) return;

    const { state } = editor;
    let responseDocPos: number | null = null;
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'response-doc') {
        responseDocPos = pos;
        return false;
      }
      return true;
    });
    if (responseDocPos === null) return;

    const responseDocNode = state.doc.nodeAt(responseDocPos);
    if (!responseDocNode) return;

    const currentOpenNodes = Array.isArray(responseDocNode.attrs?.openNodes) ? responseDocNode.attrs.openNodes : [];
    const nextOpenNodes = Array.from(new Set([...currentOpenNodes, ...COLLAPSIBLE_RESPONSE_NODES]));
    const nextActiveNode = responseDocNode.attrs?.activeNode || availableNodes[0] || null;

    const tr = state.tr.setNodeMarkup(responseDocPos, undefined, {
      ...responseDocNode.attrs,
      openNodes: nextOpenNodes,
      activeNode: nextActiveNode,
    });
    editor.view.dispatch(tr);
  };

  const handleCollapseAllResponseNodes = () => {
    if (!editor) return;

    const { state } = editor;
    let responseDocPos: number | null = null;
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'response-doc') {
        responseDocPos = pos;
        return false;
      }
      return true;
    });
    if (responseDocPos === null) return;

    const responseDocNode = state.doc.nodeAt(responseDocPos);
    if (!responseDocNode) return;

    const tr = state.tr.setNodeMarkup(responseDocPos, undefined, {
      ...responseDocNode.attrs,
      openNodes: [],
      activeNode: null,
    });
    editor.view.dispatch(tr);
  };

  useImperativeHandle(ref, () => ({
    expandAll: handleExpandAllResponseNodes,
    collapseAll: handleCollapseAllResponseNodes,
  }));

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
    if (!isActive) return;
    const el = scrollContainerRef.current;
    if (!el || !onPanelScrollChange) return;

    const onScroll = () => {
      if (panelScrollRafRef.current !== null) {
        cancelAnimationFrame(panelScrollRafRef.current);
      }
      panelScrollRafRef.current = requestAnimationFrame(() => {
        const next = el.scrollTop;
        if (isProgrammaticPanelScrollRef.current) return;
        if (next > 0) hasSeenNonZeroUserScrollRef.current = true;
        // Ignore initial hidden/mount 0 scroll events when we already have
        // persisted non-zero scroll for this tab.
        if (!hasSeenNonZeroUserScrollRef.current && panelScrollTopRef.current > 0 && next === 0) return;
        if (Math.abs(next - panelScrollTopRef.current) <= 1) return;
        onPanelScrollChange(next);
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
  }, [onPanelScrollChange, isActive]);

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

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const target = panelScrollTopRef.current;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTop = target;
    }
  }, [content]);

  // Re-apply panel scroll when this tab becomes visible again.
  useLayoutEffect(() => {
    if (!isActive) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    hasSeenNonZeroUserScrollRef.current = false;

    const restore = () => {
      const target = panelScrollTopRef.current;
      if (Math.abs(el.scrollTop - target) > 1) {
        isProgrammaticPanelScrollRef.current = true;
        el.scrollTop = target;
        requestAnimationFrame(() => {
          isProgrammaticPanelScrollRef.current = false;
        });
      }
    };

    const t1 = setTimeout(restore, 0);
    const t2 = setTimeout(restore, 60);
    const t3 = setTimeout(restore, 140);
    restore();

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isActive]);

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
        .request-summary-editor .cm-scroller,
        .request-body-sent-editor .cm-editor,
        .request-body-sent-editor .cm-scroller {
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
})
