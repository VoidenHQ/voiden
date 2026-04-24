/**
 * Reactive store for stitch run state.
 * Stores results per triggering tab ID.
 */

import {
  StitchRunState,
  StitchFileResult,
  createEmptyRun,
  computeSummary,
} from './types';

type Listener = () => void;

/** All stitch runs keyed by tab ID when available, otherwise source file path */
let runs: Record<string, StitchRunState> = {};
/** Currently active run key (tabId-first, source path fallback) */
let activeRunKey: string = '';

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

function getActiveRun(): StitchRunState {
  return runs[activeRunKey] || createEmptyRun();
}

function resolveRunKey(tabId?: string, sourceFilePath?: string): string {
  return tabId || sourceFilePath || '';
}

export const stitchStore = {
  /** Start a new stitch run keyed by tab ID, falling back to source path when needed. */
  startRun(
    filePaths: { filePath: string; fileName: string }[],
    options: { sourceFilePath?: string; tabId?: string } = {},
  ) {
    const runKey = resolveRunKey(options.tabId, options.sourceFilePath);
    if (!runKey) return;

    activeRunKey = runKey;
    delete runs[runKey];

    runs[runKey] = {
      ...createEmptyRun(),
      id: `stitch-${Date.now()}`,
      tabId: options.tabId || '',
      sourceFilePath: options.sourceFilePath || '',
      status: 'running',
      startedAt: Date.now(),
      files: filePaths.map((f) => ({
        filePath: f.filePath,
        fileName: f.fileName,
        status: 'pending' as const,
        duration: 0,
        sections: [],
        assertions: { total: 0, passed: 0, failed: 0 },
      })),
      summary: {
        totalFiles: filePaths.length,
        passedFiles: 0,
        failedFiles: 0,
        skippedFiles: 0,
        errorFiles: 0,
        totalAssertions: 0,
        passedAssertions: 0,
        failedAssertions: 0,
      },
    };
    notify();
  },

  /** Mark a file as currently running. */
  setFileRunning(index: number) {
    const run = runs[activeRunKey];
    if (!run || index < 0 || index >= run.files.length) return;
    runs[activeRunKey] = {
      ...run,
      currentFileIndex: index,
      files: run.files.map((f, i) =>
        i === index ? { ...f, status: 'running' as const } : f
      ),
    };
    notify();
  },

  /** Update a file's result after execution. */
  updateFileResult(index: number, result: Partial<StitchFileResult>) {
    const run = runs[activeRunKey];
    if (!run || index < 0 || index >= run.files.length) return;
    const updatedFiles = run.files.map((f, i) =>
      i === index ? { ...f, ...result } : f
    );
    runs[activeRunKey] = {
      ...run,
      files: updatedFiles,
      summary: computeSummary(updatedFiles),
    };
    notify();
  },

  /** Complete the run. */
  completeRun() {
    const run = runs[activeRunKey];
    if (!run) return;
    const now = Date.now();
    runs[activeRunKey] = {
      ...run,
      status: 'completed',
      completedAt: now,
      duration: run.startedAt ? now - run.startedAt : 0,
      summary: computeSummary(run.files),
    };
    notify();
  },

  /** Cancel the run and mark remaining files as skipped. */
  cancelRun() {
    const run = runs[activeRunKey];
    if (!run) return;
    const now = Date.now();
    const updatedFiles = run.files.map((f) =>
      f.status === 'pending' || f.status === 'running'
        ? { ...f, status: 'skipped' as const }
        : f
    );
    runs[activeRunKey] = {
      ...run,
      status: 'cancelled',
      completedAt: now,
      duration: run.startedAt ? now - run.startedAt : 0,
      files: updatedFiles,
      summary: computeSummary(updatedFiles),
    };
    notify();
  },

  /** Mark run as errored. */
  errorRun(error: string) {
    const run = runs[activeRunKey];
    if (!run) return;
    const now = Date.now();
    runs[activeRunKey] = {
      ...run,
      status: 'error',
      completedAt: now,
      duration: run.startedAt ? now - run.startedAt : 0,
      summary: computeSummary(run.files),
    };
    notify();
  },

  /** Get run for a tab ID, falling back to source path only if explicitly provided. */
  getRun(tabId?: string, sourceFilePath?: string): StitchRunState {
    const runKey = resolveRunKey(tabId, sourceFilePath);
    if (runKey) {
      return runs[runKey] || createEmptyRun();
    }
    return getActiveRun();
  },

  /** Get all runs. */
  getAllRuns(): Record<string, StitchRunState> {
    return runs;
  },

  /** Get the active run key. */
  getActiveRunKey(): string {
    return activeRunKey;
  },

  /** Set active run using tab ID first and source path as fallback. */
  setActiveRun(tabId?: string, sourceFilePath?: string) {
    const runKey = resolveRunKey(tabId, sourceFilePath);
    if (runKey && activeRunKey !== runKey && runs[runKey]) {
      activeRunKey = runKey;
      notify();
    }
  },

  /** Clear results for the active source. */
  clear() {
    delete runs[activeRunKey];
    notify();
  },

  /** Clear all results. */
  clearAll() {
    runs = {};
    activeRunKey = '';
    notify();
  },

  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
