/**
 * Reactive store for stitch run state.
 * Stores results per source file path (like responseStore stores per tab).
 */

import {
  StitchRunState,
  StitchFileResult,
  createEmptyRun,
  computeSummary,
} from './types';

type Listener = () => void;

/** All stitch runs keyed by source file path */
let runs: Record<string, StitchRunState> = {};
/** Currently active source file path (last run or last viewed) */
let activeSourcePath: string = '';

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

function getActiveRun(): StitchRunState {
  return runs[activeSourcePath] || createEmptyRun();
}

export const stitchStore = {
  /** Start a new stitch run for the given source file. */
  startRun(filePaths: { filePath: string; fileName: string }[], sourceFilePath: string) {
    activeSourcePath = sourceFilePath;
    // Clear any previous run results for this source file
    delete runs[sourceFilePath];
    
    runs[sourceFilePath] = {
      ...createEmptyRun(),
      id: `stitch-${Date.now()}`,
      sourceFilePath,
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
    const run = runs[activeSourcePath];
    if (!run || index < 0 || index >= run.files.length) return;
    runs[activeSourcePath] = {
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
    const run = runs[activeSourcePath];
    if (!run || index < 0 || index >= run.files.length) return;
    const updatedFiles = run.files.map((f, i) =>
      i === index ? { ...f, ...result } : f
    );
    runs[activeSourcePath] = {
      ...run,
      files: updatedFiles,
      summary: computeSummary(updatedFiles),
    };
    notify();
  },

  /** Complete the run. */
  completeRun() {
    const run = runs[activeSourcePath];
    if (!run) return;
    const now = Date.now();
    runs[activeSourcePath] = {
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
    const run = runs[activeSourcePath];
    if (!run) return;
    const now = Date.now();
    const updatedFiles = run.files.map((f) =>
      f.status === 'pending' || f.status === 'running'
        ? { ...f, status: 'skipped' as const }
        : f
    );
    runs[activeSourcePath] = {
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
    const run = runs[activeSourcePath];
    if (!run) return;
    const now = Date.now();
    runs[activeSourcePath] = {
      ...run,
      status: 'error',
      completedAt: now,
      duration: run.startedAt ? now - run.startedAt : 0,
      summary: computeSummary(run.files),
    };
    notify();
  },

  /** Get run for a specific source file. */
  getRun(sourceFilePath?: string): StitchRunState {
    if (sourceFilePath) {
      return runs[sourceFilePath] || createEmptyRun();
    }
    return getActiveRun();
  },

  /** Get all runs. */
  getAllRuns(): Record<string, StitchRunState> {
    return runs;
  },

  /** Get the active source path. */
  getActiveSourcePath(): string {
    return activeSourcePath;
  },

  /** Set active source path (when user switches tabs). */
  setActiveSource(path: string) {
    if (activeSourcePath !== path && runs[path]) {
      activeSourcePath = path;
      notify();
    }
  },

  /** Clear results for the active source. */
  clear() {
    delete runs[activeSourcePath];
    notify();
  },

  /** Clear all results. */
  clearAll() {
    runs = {};
    activeSourcePath = '';
    notify();
  },

  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
