import React, { useEffect, useState } from 'react';
import { useCollectionRunnerStore } from '../lib/collectionRunnerStore';

// ─── CollectionRunnerSidebar ──────────────────────────────────────────────────

export function CollectionRunnerSidebar() {
  const { runFiles, isRunning, selectedFileId, setSelectedFile } = useCollectionRunnerStore();

  // Dynamically import ResponseViewer so it runs in the renderer context
  const [ResponseViewer, setResponseViewerComp] = useState<React.FC<any> | null>(null);
  useEffect(() => {
    // @ts-ignore - path resolved at runtime in app context
    import(/* @vite-ignore */ '@/core/request-engine/components/ResponseViewer')
      .then((m: any) => {
        setResponseViewerComp(() => m.ResponseViewer);
      })
      .catch(() => { });
  }, []);

  // Subscribe to responseStore to detect when the main file is executing
  const [isWaitingForMain, setIsWaitingForMain] = useState(false);
  useEffect(() => {
    let unsub: (() => void) | null = null;

    // @ts-ignore
    import(/* @vite-ignore */ '@/core/request-engine/stores/responseStore')
      .then((m: any) => {
        const store = m.useResponseStore;

        const update = (state: any) => {
          // Main file is executing when loading but the key is NOT a collection item
          const waiting = state.isLoading && !state.currentRequestTabId?.startsWith('collection:');
          setIsWaitingForMain(waiting);
        };

        // Sync initial state
        update(store.getState());
        unsub = store.subscribe(update);
      })
      .catch(() => { });

    return () => { unsub?.(); };
  }, []);

  const selectedFile = runFiles.find((f) => f.id === selectedFileId) ?? null;

  // Extract status info from the selected file's response doc attrs
  const attrs = selectedFile?.response?.attrs ?? null;
  const statusCode = attrs?.statusCode ?? null;
  const statusUrl = attrs?.url ?? null;
  const isSuccess = typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300;
  const isError = typeof statusCode === 'number' && statusCode >= 400;

  // ── Waiting for main file ────────────────────────────────────────────────────
  if (isWaitingForMain) {
    return (
      <div className="h-full bg-bg flex flex-col">
        <div className="flex items-center h-10 border-b border-border px-3 flex-shrink-0">
          <span className="text-sm font-mono text-comment">Collection Runner</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-text" />
            <div className="text-comment text-sm text-center">Waiting for main file<br />to execute…</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (runFiles.length === 0) {
    return (
      <div className="h-full bg-bg flex flex-col">
        <div className="flex items-center h-10 border-b border-border px-3 flex-shrink-0">
          <span className="text-sm font-mono text-comment">Collection Runner</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-comment text-sm">No collection run yet.</span>
        </div>
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full bg-bg flex flex-col overflow-hidden">
      {/* ── Top bar: file selector + spinner ── */}
      <div className="flex items-center gap-2 h-10 border-b border-border px-3 flex-shrink-0">
        <select
          value={selectedFileId ?? ''}
          onChange={(e) => setSelectedFile(e.target.value || null)}
          className="flex-1 text-xs bg-bg border border-border rounded px-2 py-1 text-text"
        >
          <option value="">Select a file…</option>
          {runFiles.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name || 'Unnamed'}
            </option>
          ))}
        </select>
        {/* ── Status: code + url for selected file ── */}
        {selectedFile && (
          <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 font-mono text-xs min-w-0">
            {statusCode != null ? (
              <>
                <div
                  className={`size-2 rounded-full flex-shrink-0 ${isSuccess ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-yellow-500'
                    }`}
                />
                <span className="font-bold flex-shrink-0">{statusCode}</span>
                {statusUrl && (
                  <span className="text-comment truncate">{statusUrl}</span>
                )}
              </>
            ) : selectedFile.status === 'running' ? (
              <span className="text-comment">Running…</span>
            ) : selectedFile.status === 'error' ? (
              <span className="text-red-400 truncate">{selectedFile.error || 'Error'}</span>
            ) : (
              <span className="text-comment">Pending</span>
            )}
          </div>
        )}
        {isRunning && (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-text flex-shrink-0" />
        )}
      </div>

      {/* ── Response viewer ── */}
      <div className="flex-1 overflow-auto">
        {selectedFile?.status === 'running' && (
          <div className="flex items-center justify-center p-8 h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-text" />
              <div className="text-comment text-sm">Executing request…</div>
            </div>
          </div>
        )}

        {selectedFile?.response && ResponseViewer && (
          <ResponseViewer content={selectedFile.response} />
        )}

        {!selectedFile && (
          <div className="flex items-center justify-center h-full text-comment text-sm p-4">
            Select a file above to view its response.
          </div>
        )}
      </div>
    </div>
  );
}
