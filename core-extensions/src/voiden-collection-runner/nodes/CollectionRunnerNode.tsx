import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useCollectionRunnerStore } from '../lib/collectionRunnerStore';

// ─── Node View ────────────────────────────────────────────────────────────────

function CollectionRunnerView(props: NodeViewProps & {
  RequestBlockHeader: any;
}) {
  const { editor, RequestBlockHeader } = props;
  const { isRunning, runFiles } = useCollectionRunnerStore();

  // Compact status shown next to the title
  const doneCount = runFiles.filter((f) => f.status === 'done').length;
  const errorCount = runFiles.filter((f) => f.status === 'error').length;
  const total = runFiles.length;

  let statusLabel: React.ReactNode = null;
  if (isRunning) {
    statusLabel = (
      <span className="text-xs text-yellow-400 animate-pulse font-mono">
        running {doneCount + errorCount}/{total}…
      </span>
    );
  } else if (total > 0) {
    statusLabel = (
      <span className={`text-xs font-mono ${errorCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
        {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : `done ${doneCount}/${total}`}
      </span>
    );
  }

  return (
    <NodeViewWrapper spellCheck="false" className="my-2">
      <RequestBlockHeader
        withBorder
        title="COLLECTION RUNNER"
        editor={editor}
        actions={statusLabel}
      />
      {/* NodeViewContent renders the child `table` node — keyboard-navigable */}
      <div className="w-full max-w-full" suppressContentEditableWarning>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}

// ─── Node factory ─────────────────────────────────────────────────────────────

export function createCollectionRunnerNode(RequestBlockHeader: any) {
  return Node.create({
    name: 'collection-runner',
    group: 'block',
    content: 'table', // wraps exactly one Tiptap table — Tab/Enter keyboard nav works naturally

    addAttributes() {
      return {};
    },

    parseHTML() {
      return [{ tag: 'collection-runner' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['collection-runner', mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(
        (props: NodeViewProps) =>
          React.createElement(CollectionRunnerView, { ...props, RequestBlockHeader }),
        { stopEvent: () => false }
      );
    },
  });
}
