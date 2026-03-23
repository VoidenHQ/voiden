/**
 * Voiden Stitch Types
 */

/** Configuration stored as stitch block attributes */
export interface StitchConfig {
  /** Glob patterns to include */
  include: string[];
  /** Glob patterns to exclude */
  exclude: string[];
  /** Stop execution on first file/assertion failure */
  stopOnFailure: boolean;
  /** Delay in ms between files (0 = none) */
  delayBetweenFiles: number;
  /** Reset runtime variables between files (each file starts clean) */
  isolateFiles: boolean;
  /** Environment to use (empty = active environment) */
  environment: string;
}

/** Result for a single request section within a file */
export interface StitchSectionResult {
  sectionIndex: number;
  sectionLabel: string | null;
  status: number | null;
  statusText: string | null;
  duration: number;
  error: string | null;
  assertions: {
    total: number;
    passed: number;
    failed: number;
    results: AssertionResult[];
  };
  /** Request/response details for inspection */
  requestInfo?: {
    method: string;
    url: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    bodySize?: number;
  };
  responseInfo?: {
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    bodySize?: number;
    contentType?: string;
  };
}

export interface AssertionResult {
  description: string;
  passed: boolean;
  operator?: string;
  actual?: string;
  expected?: string;
  error?: string;
}

/** Result for a single .void file */
export interface StitchFileResult {
  filePath: string;
  fileName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped' | 'running' | 'pending';
  duration: number;
  sections: StitchSectionResult[];
  error?: string;
  assertions: {
    total: number;
    passed: number;
    failed: number;
  };
}

/** Overall stitch run state */
export interface StitchRunState {
  id: string;
  /** The source file path that triggered this stitch run */
  sourceFilePath: string;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  startedAt: number | null;
  completedAt: number | null;
  duration: number;
  files: StitchFileResult[];
  currentFileIndex: number;
  summary: StitchSummary;
}

export interface StitchSummary {
  totalFiles: number;
  passedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  errorFiles: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
}

export function createEmptyRun(): StitchRunState {
  return {
    id: '',
    sourceFilePath: '',
    status: 'idle',
    startedAt: null,
    completedAt: null,
    duration: 0,
    files: [],
    currentFileIndex: -1,
    summary: {
      totalFiles: 0,
      passedFiles: 0,
      failedFiles: 0,
      skippedFiles: 0,
      errorFiles: 0,
      totalAssertions: 0,
      passedAssertions: 0,
      failedAssertions: 0,
    },
  };
}

function computeSummary(files: StitchFileResult[]): StitchSummary {
  const summary: StitchSummary = {
    totalFiles: files.length,
    passedFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    errorFiles: 0,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
  };
  for (const f of files) {
    if (f.status === 'passed') summary.passedFiles++;
    else if (f.status === 'failed') summary.failedFiles++;
    else if (f.status === 'skipped') summary.skippedFiles++;
    else if (f.status === 'error') summary.errorFiles++;
    summary.totalAssertions += f.assertions.total;
    summary.passedAssertions += f.assertions.passed;
    summary.failedAssertions += f.assertions.failed;
  }
  return summary;
}

export { computeSummary };
