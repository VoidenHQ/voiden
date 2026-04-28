/**
 * Stitch Results Sidebar
 *
 * Right sidebar tab showing aggregated results from stitch runs.
 * Matches the response panel's collapsible section pattern with
 * status indicators, timing, and assertion details.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Trash2,
  Check,
  X,
  AlertCircle,
  Loader2,
  SkipForward,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  FileText,
  Circle,
  Search,
  Copy,
  ExternalLink,
  Download,
  ArrowLeft,
  History,
} from 'lucide-react';
import { stitchStore } from '../lib/stitchStore';
import type { StitchRunState, StitchFileResult, StitchSectionResult, StitchHistoryEntry } from '../lib/types';
import { exportStitchToExcel } from '../lib/exportExcel';
import { loadStitchHistory } from '../lib/stitchHistory';

/** Generate a simple cURL command from request info. */
function toCurl(req: NonNullable<StitchSectionResult['requestInfo']>): string {
  const parts = ['curl'];
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET') parts.push(`-X ${method}`);
  if (req.headers) {
    for (const h of req.headers) {
      const k = (h as any).key || (h as any).k || '';
      const v = (h as any).value || (h as any).v || '';
      if (k) parts.push(`-H '${k}: ${v}'`);
    }
  }
  if (req.body) parts.push(`-d '${req.body.replace(/'/g, "\\'")}'`);
  parts.push(`'${req.url}'`);
  return parts.join(' \\\n  ');
}

function useStitchRun(tabId?: string): StitchRunState {
  const [run, setRun] = useState<StitchRunState>(stitchStore.getRun());

  useEffect(() => {
    if (tabId) {
      stitchStore.setActiveRun(tabId);
    }
  }, [tabId]);

  useEffect(() => {
    const update = () => {
      const fileRun = tabId ? stitchStore.getRun(tabId) : stitchStore.getRun();
      setRun(fileRun);
    };
    update();
    return stitchStore.subscribe(update);
  }, [tabId]);

  return run;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/** Lightweight styled tooltip wrapper. */
const Tip = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="relative group/tip inline-flex">
    {children}
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-active border border-border rounded text-[10px] text-text whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-50">
      {label}
    </div>
  </div>
);

/** Small colored status dot matching the response panel style. */
const StatusDot = ({ status, size = 8 }: { status: string; size?: number }) => {
  const color = status === 'passed'
    ? 'var(--success, #4ade80)'
    : status === 'failed' || status === 'error'
      ? 'var(--error, #f87171)'
      : status === 'running'
        ? 'var(--accent)'
        : 'var(--syntax-comment)';

  if (status === 'running') {
    return <Loader2 size={size + 2} className="animate-spin flex-shrink-0" style={{ color }} />;
  }

  return (
    <div
      className="rounded-full flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
};

/** Pass rate arc — a simple SVG donut showing pass/fail ratio. */
const PassRateArc = ({ passed, failed, total, size = 36 }: { passed: number; failed: number; total: number; size?: number }) => {
  if (total === 0) return null;
  const pct = total > 0 ? passed / total : 0;
  const r = (size - 4) / 2;
  const c = Math.PI * 2 * r;
  const passLen = c * pct;
  const failLen = c - passLen;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {/* fail arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={3}
          stroke="var(--error, #f87171)" strokeOpacity={failed > 0 ? 1 : 0.15}
          strokeDasharray={`${failLen} ${c}`}
          strokeDashoffset={-passLen}
        />
        {/* pass arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={3}
          stroke="var(--success, #4ade80)"
          strokeDasharray={`${passLen} ${c}`}
        />
      </svg>
      <span className="absolute text-[11px] font-mono font-bold text-text">
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
};

/** Collapsible section row for a single request within a file. */
const SectionRow = ({ section, defaultExpanded }: { section: StitchSectionResult; defaultExpanded?: boolean }) => {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

  useEffect(() => {
    setExpanded(defaultExpanded ?? false);
  }, [defaultExpanded]);
  const [showReqBody, setShowReqBody] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [copiedReqBody, setCopiedReqBody] = useState(false);
  const [copiedResBody, setCopiedResBody] = useState(false);
  const [copiedReqHeaders, setCopiedReqHeaders] = useState(false);
  const [copiedResHeaders, setCopiedResHeaders] = useState(false);
  const hasAssertions = section.assertions.results.length > 0;
  const hasFailed = section.assertions.failed > 0 || !!section.error;
  const hasDetails = hasAssertions || !!section.error || !!section.requestInfo || !!section.responseInfo;
  const borderColor = hasFailed ? 'var(--error, #f87171)' : section.error ? 'var(--warning, #facc15)' : 'var(--success, #4ade80)';

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        className="flex items-center gap-2 px-3 py-1.5 bg-bg cursor-pointer hover:bg-active transition-colors select-none"
        style={{ borderLeft: `3px solid ${borderColor}` }}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {hasDetails ? (
          expanded
            ? <ChevronDown size={12} className="text-comment flex-shrink-0" />
            : <ChevronRight size={12} className="text-comment flex-shrink-0" />
        ) : <div className="w-3 flex-shrink-0" />}

        <StatusDot status={section.error ? 'error' : section.assertions.failed > 0 ? 'failed' : 'passed'} size={6} />

        <span className="font-mono text-[11px] font-bold flex-shrink-0">
          {section.status || '—'}
        </span>

        {section.requestInfo && (
          <span className="text-[10px] text-accent font-mono font-bold flex-shrink-0">
            {section.requestInfo.method}
          </span>
        )}

        <span className="text-[11px] text-text truncate flex-1">
          {section.sectionLabel || `Section ${section.sectionIndex + 1}`}
        </span>

        {hasAssertions && (
          <span className={`text-[10px] font-mono flex-shrink-0 ${section.assertions.failed > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {section.assertions.passed}/{section.assertions.total}
          </span>
        )}

        <span className="text-[10px] text-comment font-mono flex-shrink-0">
          {formatDuration(section.duration)}
        </span>

        {section.requestInfo && (
          <Tip label="Copy as cURL">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const curl = toCurl(section.requestInfo!);
                navigator.clipboard.writeText(curl).then(() => {
                  setCopiedReqBody(true);
                  setTimeout(() => setCopiedReqBody(false), 1500);
                });
              }}
              className="text-comment hover:text-text transition-colors p-0.5 rounded flex-shrink-0"
              style={{ cursor: 'pointer' }}
            >
              {copiedReqBody ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            </button>
          </Tip>
        )}
      </div>

      {expanded && (
        <div className="bg-editor border-l-[3px]" style={{ borderLeftColor: borderColor }}>
          {/* Request info */}
          {section.requestInfo?.url && (
            <div className="px-4 py-1.5 border-b border-border">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-comment font-semibold uppercase">Request</span>
                <span className="text-accent font-mono font-bold">{section.requestInfo.method}</span>
                <span className="text-text font-mono truncate flex-1">{section.requestInfo.url}</span>
                {section.requestInfo.headers && section.requestInfo.headers.length > 0 && (
                  <Tip label="Copy request headers">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const text = section.requestInfo!.headers!
                          .map((h: any) => `${h.key || h.k || ''}: ${h.value || h.v || ''}`)
                          .join('\n');
                        navigator.clipboard.writeText(text).then(() => {
                          setCopiedReqHeaders(true);
                          setTimeout(() => setCopiedReqHeaders(false), 1500);
                        });
                      }}
                      className="text-comment hover:text-text transition-colors p-0.5 rounded flex-shrink-0"
                      style={{ cursor: 'pointer' }}
                    >
                      {copiedReqHeaders ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                    </button>
                  </Tip>
                )}
              </div>
              {section.requestInfo.headers && section.requestInfo.headers.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {section.requestInfo.headers.slice(0, 8).map((h, i) => (
                    <div key={i} className="text-[10px] font-mono flex gap-1">
                      <span className="text-comment">{(h as any).key || (h as any).k || ''}: </span>
                      <span className="text-text truncate">{(h as any).value || (h as any).v || ''}</span>
                    </div>
                  ))}
                  {section.requestInfo.headers.length > 8 && (
                    <div className="text-[10px] text-comment italic">+{section.requestInfo.headers.length - 8} more</div>
                  )}
                </div>
              )}
              {section.requestInfo.body && (
                <div className="mt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowReqBody(!showReqBody); }}
                    className="text-[10px] text-accent hover:text-text transition-colors flex items-center gap-1"
                    style={{ cursor: 'pointer' }}
                  >
                    {showReqBody ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    Body {section.requestInfo.bodySize != null && <span className="text-comment">({formatBytes(section.requestInfo.bodySize)})</span>}
                  </button>
                  {showReqBody && (
                    <div className="relative mt-1 group/reqbody">
                      <pre className="p-2 bg-bg rounded border border-border text-[10px] text-text font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                        {section.requestInfo.body}
                      </pre>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(section.requestInfo!.body!).then(() => {
                            setCopiedReqBody(true);
                            setTimeout(() => setCopiedReqBody(false), 1500);
                          });
                        }}
                        className="absolute top-1 right-1 p-1 rounded bg-active opacity-0 group-hover/reqbody:opacity-100 transition-opacity text-comment hover:text-text"
                        title="Copy request body"
                        style={{ cursor: 'pointer' }}
                      >
                        {copiedReqBody ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Response info */}
          {section.responseInfo && (
            <div className="px-4 py-1.5 border-b border-border">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-comment font-semibold uppercase">Response</span>
                <span className="font-mono font-bold">{section.status} {section.statusText}</span>
                {section.responseInfo.contentType && (
                  <span className="text-comment font-mono">{section.responseInfo.contentType}</span>
                )}
                {section.responseInfo.bodySize != null && (
                  <span className="text-comment font-mono">{formatBytes(section.responseInfo.bodySize)}</span>
                )}
                <span className="flex-1" />
                {section.responseInfo.headers && section.responseInfo.headers.length > 0 && (
                  <Tip label="Copy response headers">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const text = section.responseInfo!.headers!
                          .map((h: any) => `${h.key || h.k || ''}: ${h.value || h.v || String(h)}`)
                          .join('\n');
                        navigator.clipboard.writeText(text).then(() => {
                          setCopiedResHeaders(true);
                          setTimeout(() => setCopiedResHeaders(false), 1500);
                        });
                      }}
                      className="text-comment hover:text-text transition-colors p-0.5 rounded flex-shrink-0"
                      style={{ cursor: 'pointer' }}
                    >
                      {copiedResHeaders ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                    </button>
                  </Tip>
                )}
              </div>
              {section.responseInfo.headers && section.responseInfo.headers.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {section.responseInfo.headers.slice(0, 6).map((h, i) => (
                    <div key={i} className="text-[10px] font-mono flex gap-1">
                      <span className="text-comment">{typeof h === 'object' ? (h as any).key || (h as any).k : ''}: </span>
                      <span className="text-text truncate">{typeof h === 'object' ? (h as any).value || (h as any).v : String(h)}</span>
                    </div>
                  ))}
                </div>
              )}
              {section.responseInfo.body && (
                <div className="mt-1">
                  <div className="flex items-center justify-between gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowBody(!showBody); }}
                      className="text-[10px] text-accent hover:text-text transition-colors flex items-center gap-1"
                      style={{ cursor: 'pointer' }}
                    >
                      {showBody ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      Body
                    </button>
                    <Tip label="Copy response body">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(section.responseInfo!.body!).then(() => {
                            setCopiedResBody(true);
                            setTimeout(() => setCopiedResBody(false), 1500);
                          });
                        }}
                        className="text-comment hover:text-text transition-colors p-0.5 rounded flex-shrink-0"
                        style={{ cursor: 'pointer' }}
                      >
                        {copiedResBody ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                      </button>
                    </Tip>
                  </div>
                  {showBody && (
                    <div className="relative mt-1 group/resbody">
                      <pre className="p-2 bg-bg rounded border border-border text-[10px] text-text font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                        {section.responseInfo.body}
                      </pre>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(section.responseInfo!.body!).then(() => {
                            setCopiedResBody(true);
                            setTimeout(() => setCopiedResBody(false), 1500);
                          });
                        }}
                        className="absolute top-1 right-1 p-1 rounded bg-active opacity-0 group-hover/resbody:opacity-100 transition-opacity text-comment hover:text-text"
                        title="Copy response body"
                        style={{ cursor: 'pointer' }}
                      >
                        {copiedResBody ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {section.error && (
            <div className="px-4 py-1.5 border-b border-border text-[11px] text-red-400 font-mono break-all">
              {section.error}
            </div>
          )}

          {/* Assertions */}
          {hasAssertions && (
            <div className="px-4 py-1.5">
              <div className="text-[10px] text-comment font-semibold uppercase mb-1">Assertions</div>
              {section.assertions.results.map((assertion, i) => {
                const desc = typeof assertion.description === 'string'
                  ? assertion.description
                  : assertion.operator
                    ? `${assertion.operator} ${assertion.expected || ''}`
                    : `Assertion ${i + 1}`;
                const errMsg = typeof assertion.error === 'string' ? assertion.error : undefined;
                return (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-[11px]">
                    <StatusDot status={assertion.passed ? 'passed' : 'failed'} size={6} />
                    <span className={`flex-1 ${assertion.passed ? 'text-text' : 'text-red-400'}`}>
                      {desc}
                      {!assertion.passed && errMsg && (
                        <span className="text-comment ml-1">— {errMsg}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Collapsible file row — matches the response panel multi-section header style. */
const FileRow = ({ file, defaultExpanded, onOpenFile }: { file: StitchFileResult; defaultExpanded?: boolean; onOpenFile?: (path: string) => void }) => {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const hasDetails = file.sections.length > 0 || !!file.error;

  useEffect(() => {
    setExpanded(defaultExpanded ?? false);
  }, [defaultExpanded]);
  const isRunning = file.status === 'running';

  return (
    <div className="border-b border-border">
      {/* File header — matches response panel section header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg cursor-pointer hover:bg-active transition-colors select-none"
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {hasDetails ? (
          expanded
            ? <ChevronDown size={14} className="text-comment flex-shrink-0" />
            : <ChevronRight size={14} className="text-comment flex-shrink-0" />
        ) : <div className="w-[14px] flex-shrink-0" />}

        <StatusDot status={file.status} />

        <span className="text-[11px] text-text font-mono truncate flex-1 group/filename">
          {onOpenFile ? (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenFile(file.filePath); }}
              className="hover:text-accent hover:underline transition-colors text-left"
              title={`Open ${file.fileName}`}
              style={{ cursor: 'pointer' }}
            >
              {file.fileName}
            </button>
          ) : file.fileName}
        </span>

        {file.assertions.total > 0 && (
          <span className={`text-[10px] font-mono font-bold flex-shrink-0 ${
            file.assertions.failed > 0 ? 'text-red-400' : 'text-green-400'
          }`}>
            {file.assertions.passed}/{file.assertions.total}
          </span>
        )}

        {file.duration > 0 && (
          <span className="text-[10px] text-comment font-mono flex-shrink-0">
            {formatDuration(file.duration)}
          </span>
        )}
      </div>

      {/* Sections — expand to show per-section results */}
      {expanded && (
        <div>
          {file.error && (
            <div className="px-4 py-2 text-[11px] text-red-400 font-mono break-all bg-editor">{file.error}</div>
          )}
          {file.sections.map((section, i) => (
            <SectionRow key={i} section={section} defaultExpanded={defaultExpanded} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Live timer while a run is in progress. */
const RunTimer = ({ startedAt }: { startedAt: number }) => {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => clearInterval(interval);
  }, [startedAt]);
  return <span>{formatDuration(elapsed)}</span>;
};

/** A single row in the history list. */
const HistoryRow = ({
  entry,
  isLatest,
  onClick,
}: {
  entry: StitchHistoryEntry;
  isLatest: boolean;
  onClick: () => void;
}) => {
  const hasFail = entry.summary.failedFiles + entry.summary.errorFiles > 0;
  const statusColor = entry.status === 'cancelled'
    ? 'text-comment'
    : hasFail
      ? 'text-red-400'
      : 'text-green-400';
  const statusLabel = entry.status === 'cancelled'
    ? 'Cancelled'
    : entry.status === 'error'
      ? 'Error'
      : hasFail
        ? 'Failed'
        : 'Passed';

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-border hover:bg-active cursor-pointer transition-colors select-none"
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <StatusDot status={entry.status === 'cancelled' ? 'skipped' : hasFail ? 'failed' : 'passed'} />
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold ${statusColor}`}>{statusLabel}</span>
          {isLatest && (
            <span className="text-[9px] text-accent font-semibold uppercase tracking-wide">latest</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-comment">
          <span>{entry.summary.totalFiles} file{entry.summary.totalFiles !== 1 ? 's' : ''}</span>
          {entry.summary.passedFiles > 0 && (
            <span className="text-green-400">{entry.summary.passedFiles}✓</span>
          )}
          {entry.summary.failedFiles + entry.summary.errorFiles > 0 && (
            <span className="text-red-400">{entry.summary.failedFiles + entry.summary.errorFiles}✗</span>
          )}
          {entry.summary.totalAssertions > 0 && (
            <span>{entry.summary.passedAssertions}/{entry.summary.totalAssertions} assertions</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <Tip label={formatDateTime(entry.runAt)}>
          <span className="text-[10px] text-comment font-mono">{formatRelativeTime(entry.runAt)}</span>
        </Tip>
        {entry.duration > 0 && (
          <span className="text-[9px] text-comment font-mono">{formatDuration(entry.duration)}</span>
        )}
      </div>
    </div>
  );
};

/** Inner run results view — shared between live run and history detail. */
const RunResultsView = ({
  run,
  isDone,
  isRunning,
  onOpenFile,
}: {
  run: Pick<StitchRunState, 'files' | 'summary' | 'status' | 'startedAt' | 'duration' | 'currentFileIndex'>;
  isDone: boolean;
  isRunning: boolean;
  onOpenFile: (path: string) => void;
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [run.currentFileIndex]);

  const filteredFiles = useMemo(() => {
    if (!filterText.trim()) return run.files;
    const q = filterText.toLowerCase();
    return run.files.filter((file) => {
      if (file.fileName.toLowerCase().includes(q)) return true;
      return file.sections.some((s) =>
        (s.sectionLabel && s.sectionLabel.toLowerCase().includes(q)) ||
        (s.requestInfo?.method && s.requestInfo.method.toLowerCase().includes(q)) ||
        (s.requestInfo?.url && s.requestInfo.url.toLowerCase().includes(q))
      );
    });
  }, [run.files, filterText]);

  const hasFailures = run.summary.failedFiles + run.summary.errorFiles > 0;
  const allPassed = isDone && !hasFailures;
  const statusLabel = isRunning ? 'Running' : run.status === 'completed'
    ? (allPassed ? 'Passed' : 'Failed')
    : run.status === 'cancelled' ? 'Cancelled' : run.status === 'error' ? 'Error' : null;
  const statusColor = allPassed
    ? 'text-green-400 bg-green-400/10'
    : isRunning ? 'text-accent bg-accent/10'
    : isDone ? 'text-red-400 bg-red-400/10' : '';

  return (
    <>
      {/* Sub-toolbar */}
      <div className="flex items-center justify-between h-8 border-b border-border px-3 flex-shrink-0 bg-bg">
        <div className="flex items-center gap-2">
          {statusLabel && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusColor}`}>
              {statusLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {run.files.length > 0 && (
            <>
              <button
                className={`p-1 transition-colors rounded ${showFilter ? 'text-accent' : 'text-comment hover:text-text'}`}
                title="Filter results"
                onClick={() => setShowFilter(!showFilter)}
                style={{ cursor: 'pointer' }}
              >
                <Search size={12} />
              </button>
              <button
                className="p-1 text-comment hover:text-text transition-colors rounded"
                title={allExpanded ? 'Collapse all' : 'Expand all'}
                onClick={() => setAllExpanded((v) => !v)}
                style={{ cursor: 'pointer' }}
              >
                {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {showFilter && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-panel flex-shrink-0">
          <input
            type="text"
            placeholder="Filter by file, request, or URL..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            autoFocus
            className="flex-1 h-6 px-2 text-[11px] font-mono bg-editor border border-border rounded-md text-text focus:outline-none focus:border-accent placeholder:text-comment/40"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowFilter(false); setFilterText(''); }
            }}
          />
          {filterText && (
            <span className="text-[10px] text-comment flex-shrink-0">{filteredFiles.length}/{run.files.length}</span>
          )}
          <button
            onClick={() => { setShowFilter(false); setFilterText(''); }}
            className="p-0.5 text-comment hover:text-text transition-colors rounded"
            style={{ cursor: 'pointer' }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Summary bar */}
      {run.status !== 'idle' && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-bg flex-shrink-0">
          {run.summary.totalAssertions > 0 && (
            <PassRateArc
              passed={run.summary.passedAssertions}
              failed={run.summary.failedAssertions}
              total={run.summary.totalAssertions}
              size={44}
            />
          )}
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-comment">{run.summary.totalFiles} file{run.summary.totalFiles !== 1 ? 's' : ''}</span>
              {run.summary.passedFiles > 0 && <span className="text-green-400">{run.summary.passedFiles} passed</span>}
              {run.summary.failedFiles + run.summary.errorFiles > 0 && (
                <span className="text-red-400">{run.summary.failedFiles + run.summary.errorFiles} failed</span>
              )}
              {run.summary.skippedFiles > 0 && <span className="text-comment">{run.summary.skippedFiles} skipped</span>}
            </div>
            {run.summary.totalAssertions > 0 && (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-comment">Assertions:</span>
                <span className="text-green-400">{run.summary.passedAssertions} passed</span>
                {run.summary.failedAssertions > 0 && <span className="text-red-400">{run.summary.failedAssertions} failed</span>}
                <span className="text-comment">/ {run.summary.totalAssertions}</span>
              </div>
            )}
          </div>
          <div className="text-[10px] text-comment font-mono flex-shrink-0">
            {isRunning && run.startedAt ? <RunTimer startedAt={run.startedAt} /> : run.duration > 0 ? formatDuration(run.duration) : null}
          </div>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-editor">
        {run.files.length === 0 && (
          <div className="p-4 text-comment text-center text-[11px]">No files in this run.</div>
        )}
        {filteredFiles.map((file, i) => (
          <FileRow key={`${file.filePath}-${i}`} file={file} defaultExpanded={allExpanded} onOpenFile={onOpenFile} />
        ))}
        <div ref={bottomRef} />
      </div>
    </>
  );
};

export const StitchResultsSidebar = ({ tabId }: { tabId?: string }) => {
  const run = useStitchRun(tabId);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<StitchHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<StitchHistoryEntry | null>(null);

  const sourceFilePath = run.sourceFilePath;

  // Load history when panel opens or source changes
  useEffect(() => {
    if (!showHistory || !sourceFilePath) return;
    setHistoryLoading(true);
    loadStitchHistory(sourceFilePath).then((entries) => {
      setHistoryEntries(entries);
      setHistoryLoading(false);
    });
  }, [showHistory, sourceFilePath]);

  // When a new run completes, refresh history list if it's open
  useEffect(() => {
    if (!showHistory || !sourceFilePath || run.status === 'running' || run.status === 'idle') return;
    loadStitchHistory(sourceFilePath).then(setHistoryEntries);
  }, [run.status, showHistory, sourceFilePath]);

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      const fileName = filePath.split('/').pop() || filePath;
      await (window as any).electron?.ipc?.invoke('fileLink:open', filePath, fileName);
      // @ts-ignore - Vite dynamic import
      const { getQueryClient } = await import(/* @vite-ignore */ '@/main');
      const queryClient = getQueryClient();
      queryClient.invalidateQueries({ queryKey: ['panel:tabs', 'main'] });
      queryClient.invalidateQueries({ queryKey: ['tab:content', 'main', fileName] });
    } catch (err) {
      console.error('[voiden-stitch] Failed to open file:', err);
    }
  }, []);

  const isIdle = run.status === 'idle';
  const isRunning = run.status === 'running';
  const isDone = run.status === 'completed' || run.status === 'cancelled' || run.status === 'error';
  const hasFailures = run.summary.failedFiles + run.summary.errorFiles > 0;
  const allPassed = isDone && !hasFailures;
  const statusLabel = isRunning ? 'Running' : run.status === 'completed'
    ? (allPassed ? 'Passed' : 'Failed')
    : run.status === 'cancelled' ? 'Cancelled' : run.status === 'error' ? 'Error' : null;
  const statusColor = allPassed
    ? 'text-green-400 bg-green-400/10'
    : isRunning ? 'text-accent bg-accent/10'
    : isDone ? 'text-red-400 bg-red-400/10' : '';

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full font-mono overflow-x-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between h-10 border-b border-border px-3 flex-shrink-0 bg-bg">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {showHistory && selectedEntry ? (
            <button
              onClick={() => setSelectedEntry(null)}
              className="flex items-center gap-1 text-comment hover:text-text transition-colors text-[11px]"
              style={{ cursor: 'pointer' }}
            >
              <ArrowLeft size={12} />
              <span>History</span>
            </button>
          ) : showHistory ? (
            <button
              onClick={() => { setShowHistory(false); setSelectedEntry(null); }}
              className="flex items-center gap-1 text-comment hover:text-text transition-colors text-[11px]"
              style={{ cursor: 'pointer' }}
            >
              <ArrowLeft size={12} />
              <span>Results</span>
            </button>
          ) : (
            <>
              <span className="text-comment text-xs">Stitch Results</span>
              {statusLabel && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusColor}`}>
                  {statusLabel}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* History toggle — shown when a source file is known */}
          {sourceFilePath && !showHistory && (
            <button
              className="p-1.5 text-comment hover:text-text transition-colors rounded"
              title="Run history"
              onClick={() => { setShowHistory(true); setSelectedEntry(null); }}
              style={{ cursor: 'pointer' }}
            >
              <History size={14} />
            </button>
          )}

          {/* Current run actions — only in normal view */}
          {!showHistory && run.files.length > 0 && (
            <>
              {isDone && (
                <button
                  onClick={() => exportStitchToExcel(run)}
                  className="p-1.5 text-comment hover:text-text transition-colors rounded"
                  title="Export to Excel"
                  style={{ cursor: 'pointer' }}
                >
                  <Download size={14} />
                </button>
              )}
              <button
                onClick={() => stitchStore.clear()}
                className="p-1.5 text-comment hover:text-text transition-colors rounded"
                title="Clear results"
                style={{ cursor: 'pointer' }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── History list view ── */}
      {showHistory && !selectedEntry && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-editor">
          {historyLoading && (
            <div className="p-4 flex items-center justify-center gap-2 text-comment text-[11px]">
              <Loader2 size={12} className="animate-spin" />
              Loading history...
            </div>
          )}
          {!historyLoading && historyEntries.length === 0 && (
            <div className="p-4 text-comment text-center text-[11px]">
              No history yet. Run the stitch to record results.
            </div>
          )}
          {!historyLoading && historyEntries.map((entry, i) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              isLatest={i === 0}
              onClick={() => setSelectedEntry(entry)}
            />
          ))}
        </div>
      )}

      {/* ── History detail view ── */}
      {showHistory && selectedEntry && (
        <>
          <div className="px-3 py-1.5 border-b border-border bg-panel flex-shrink-0 flex items-center gap-2">
            <Clock size={11} className="text-comment flex-shrink-0" />
            <Tip label={formatDateTime(selectedEntry.runAt)}>
              <span className="text-[11px] text-comment font-mono">{formatRelativeTime(selectedEntry.runAt)}</span>
            </Tip>
            <span className="text-[10px] text-comment">—</span>
            <span className="text-[11px] text-comment font-mono">{formatDateTime(selectedEntry.runAt)}</span>
          </div>
          <RunResultsView
            run={{
              files: selectedEntry.files,
              summary: selectedEntry.summary,
              status: selectedEntry.status,
              startedAt: selectedEntry.runAt,
              duration: selectedEntry.duration,
              currentFileIndex: -1,
            }}
            isDone={true}
            isRunning={false}
            onOpenFile={handleOpenFile}
          />
        </>
      )}

      {/* ── Current run view ── */}
      {!showHistory && (
        <>
          {isIdle ? (
            <div className="flex-1 flex items-center justify-center p-4 text-comment text-center text-[11px] bg-editor">
              Insert a <code className="text-text mx-1">/stitch</code> block and click Run to see results here.
            </div>
          ) : (
            <RunResultsView
              run={run}
              isDone={isDone}
              isRunning={isRunning}
              onOpenFile={handleOpenFile}
            />
          )}
        </>
      )}
    </div>
  );
};
