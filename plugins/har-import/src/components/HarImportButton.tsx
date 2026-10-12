import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { importHarLog } from '../utils/converter';
import { X, XCircle } from 'lucide-react';

interface HarImportButtonProps {
  tab: {
    tabId: string;
    title: string;
    content: string;
    type: string;
    source?: string;
  };
  showToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

interface ImportState {
  isImporting: boolean;
  progress: { current: number; total: number };
  error: string | null;
  ignoreStaticAssets: boolean;
}

const importStateCache = new Map<string, ImportState>();
const cancelSignals = new Map<string, { cancelled: boolean }>();

export const HarImportButton = ({ tab, showToast }: HarImportButtonProps) => {
  const cached = importStateCache.get(tab.tabId);
  const [progress, setProgress] = useState(cached?.progress ?? { current: 0, total: 0 });
  const [isImporting, setIsImporting] = useState(cached?.isImporting ?? false);
  const [error, setError] = useState<string | null>(cached?.error ?? null);
  const [ignoreStaticAssets, setIgnoreStaticAssets] = useState(cached?.ignoreStaticAssets ?? true);
  const [isErrorVisible, setIsErrorVisible] = useState(false);
  const cancelSignalRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    importStateCache.set(tab.tabId, { isImporting, progress, error, ignoreStaticAssets });
  }, [tab.tabId, isImporting, progress, error, ignoreStaticAssets]);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (error) {
      setIsErrorVisible(true);
      const hideTimer = setTimeout(() => {
        setIsErrorVisible(false);
        const clearTimer = setTimeout(() => setError(null), 300);
        return () => clearTimeout(clearTimer);
      }, 5000);
      return () => clearTimeout(hideTimer);
    }
  }, [error]);

  const handleCancel = () => {
    if (cancelSignalRef.current) {
      cancelSignalRef.current.cancelled = true;
    }
    setIsImporting(false);
    setProgress({ current: 0, total: 0 });
    importStateCache.delete(tab.tabId);
    cancelSignals.delete(tab.tabId);
  };

  const handleImport = async () => {
    try {
      setError(null);
      setIsErrorVisible(false);
      setIsImporting(true);
      setProgress({ current: 0, total: 0 });

      const signal = { cancelled: false };
      cancelSignalRef.current = signal;
      cancelSignals.set(tab.tabId, signal);

      const projects = queryClient.getQueryData<{
        projects: { path: string; name: string }[];
        activeProject: string;
      }>(['projects']);

      const activeProject = projects?.activeProject;

      if (!activeProject) {
        setError('No active project found');
        setIsImporting(false);
        return;
      }

      let content = tab.content;
      if ((!content || content.trim() === '') && tab.source) {
        content = (await (window as any).electron?.files?.read(tab.source)) ?? '';
      }

      if (!content || content.trim() === '') {
        setError('HAR file content is empty');
        setIsImporting(false);
        return;
      }

      try {
        JSON.parse(content);
      } catch {
        setError('Invalid HAR JSON format');
        setIsImporting(false);
        return;
      }

      const result = await importHarLog(
        content,
        activeProject,
        { ignoreStaticAssets },
        (current, total) => {
          setProgress({ current, total });
        },
        (itemName, err) => {
          const message = err instanceof Error ? err.message : String(err);
          showToast?.(`Failed to import "${itemName}": ${message}`, 'error');
        },
        signal
      );

      if (signal.cancelled) return;

      if (result?.message && showToast) {
        showToast(result.message, 'success');
      }

      setProgress({ current: 0, total: 0 });
      setIsImporting(false);
      importStateCache.delete(tab.tabId);
      cancelSignals.delete(tab.tabId);
    } catch (err) {
      console.error('Failed to import HAR file:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to import HAR file';
      setError(errorMessage);
      setProgress({ current: 0, total: 0 });
      setIsImporting(false);
    }
  };

  const dismissError = () => {
    setIsErrorVisible(false);
    setTimeout(() => setError(null), 300);
  };

  const getButtonText = () => {
    if (isImporting && progress.current > 0 && progress.current < progress.total) {
      return `Generating files... ${progress.current}/${progress.total}`;
    }
    if (progress.current === progress.total && progress.total > 0) {
      return `Generated ${progress.total} files`;
    }
    return 'Generate Voiden files';
  };

  const getButtonClass = () => {
    const baseClass = 'px-2 py-0.5 rounded-sm text-sm transition-all duration-200';
    if (isImporting && progress.current > 0 && progress.current < progress.total) {
      return `${baseClass} bg-yellow-500 hover:bg-yellow-600 text-black cursor-wait`;
    }
    if (progress.current === progress.total && progress.total > 0) {
      return `${baseClass} bg-green-500 hover:bg-green-600 text-white`;
    }
    return `${baseClass} bg-panel hover:bg-active text-foreground`;
  };

  const isInProgress = isImporting && progress.current > 0 && progress.current < progress.total;

  return (
    <div className="flex flex-col gap-1">
      {!error && (
        <div className="flex items-center gap-3">
          <button
            className={getButtonClass()}
            onClick={handleImport}
            disabled={isInProgress}
            title={isInProgress ? 'Import in progress...' : 'Import HAR file'}
          >
            {getButtonText()}
          </button>

          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ignoreStaticAssets}
              onChange={(e) => setIgnoreStaticAssets(e.target.checked)}
              disabled={isInProgress}
              className="rounded border-gray-400 text-primary focus:ring-primary"
            />
            Ignore static assets
          </label>

          {isImporting && (
            <button
              onClick={handleCancel}
              title="Cancel"
              className="text-muted hover:text-red-500 transition-colors"
            >
              <XCircle size={15} />
            </button>
          )}

          {isImporting && progress.current > 0 && progress.total > 0 && (
            <div className="text-xs text-gray-500">
              {Math.round((progress.current / progress.total) * 100)}%
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          className={`transition-all duration-300 overflow-hidden ${
            isErrorVisible ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="flex items-center justify-between border border-red-200 rounded px-2 py-1">
            <span className="text-red-600 dark:text-red-400 text-xs">{error}</span>
            <button
              onClick={dismissError}
              className="text-red-500 hover:text-red-700 text-xs ml-2"
              title="Dismiss error"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
