import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ReactCodeMirror from '@uiw/react-codemirror';
import { useHistoryStore } from '../historyStore';
import { readHistory, clearHistory, checkAttachmentChanges, AttachmentChange } from '../historyManager';
import { getProjectPathFn, importCurlFn } from '../pipelineHooks';
import { HistoryEntry, getEntryMeta, getEntryPluginId } from '../types';
import { historyAdapterRegistry } from '../adapterRegistry';
import { voidenTheme } from '@/core/editors/code/CodeEditor';
import { renderLang } from '@/core/editors/code/lib/extensions/renderLang';
import { Clock, RotateCcw, Copy, Check, Trash2, Search, Zap, MoreHorizontal, Download, Square, CheckSquare, X, ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp, Loader2, FileText, AlertTriangle, Paperclip } from 'lucide-react';
import { useResponseStore } from '@/core/request-engine/stores/responseStore';
import { METHOD_COLORS } from '@/constants';
import { Tip } from '@/core/components/ui/Tip';
import { useGetPanelTabs } from '@/core/layout/hooks';
import { buildCurlForEntry, getHistoryRenderer } from '@/plugins';
import { toast } from '@/core/components/ui/sonner';

// ─── Code viewer ─────────────────────────────────────────────────────────────

/** Detects a reasonable language from content-type or raw content */
function detectLang(contentType?: string | null, body?: string): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  if (ct.includes('yaml')) return 'yaml';
  if (ct.includes('javascript')) return 'javascript';
  const first = body?.trimStart()[0];
  if (first === '{' || first === '[') return 'json';
  if (first === '<') return 'xml';
  return 'text';
}

const HistoryCodeViewer: React.FC<{ value: string; contentType?: string | null;}> = ({
  value,
  contentType,
}) => {
  const lang = detectLang(contentType, value);
  const extensions = renderLang(lang === 'json' ? 'jsonc' : lang);

  return (
    <div style={{ maxHeight:300, overflow: 'hidden' }} className="rounded overflow-hidden">
      <ReactCodeMirror
        value={value}
        readOnly
        theme={voidenTheme}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          searchKeymap: false,
          syntaxHighlighting: true,
        }}
        style={{ maxHeight:300, overflow: 'auto', fontSize: 11 }}
      />
    </div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatAbsoluteDateTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon = months[d.getMonth()];
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const datePart = d.getFullYear() !== now.getFullYear()
    ? `${mon} ${day}, ${d.getFullYear()}`
    : `${mon} ${day}`;
  return `${datePart} · ${h}:${m}`;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Group label: TODAY / YESTERDAY / N days ago / older */
function getGroupLabel(ts: number): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  if (ts >= todayStart) return 'TODAY';
  if (ts >= yesterdayStart) return 'YESTERDAY';
  const daysAgo = Math.floor((todayStart - ts) / 86400000);
  if (daysAgo < 7) return `${daysAgo} DAYS AGO`;
  return 'OLDER';
}

// ─── Method badge ─────────────────────────────────────────────────────────────

function methodBadge(method: string): string {
  const methodKey = method.toUpperCase();
  const textClass = METHOD_COLORS[methodKey] ?? 'text-comment';
  const bgClass = textClass.startsWith('text-') ? textClass.replace('text-', 'bg-') : 'bg-muted';
  return `${textClass} ${bgClass}/15 border border-border`;
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} className="bg-yellow-400/25 text-yellow-200 rounded-[2px] not-italic">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function statusBadge(status?: number, error?: string | null): string {
  if (error || !status) return 'text-red-400';
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-amber-400';
  return 'text-red-400';
}

// ─── File attachments ─────────────────────────────────────────────────────────

interface AttachmentStatus { changed: boolean; missing: boolean; checked: boolean; }

const FileAttachmentsSection: React.FC<{ attachments: FileAttachmentMeta[]; query?: string }> = ({ attachments, query = '' }) => {
  const [statuses, setStatuses] = useState<Record<string, AttachmentStatus>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results: Record<string, AttachmentStatus> = {};
      await Promise.all(attachments.map(async (a) => {
        if (!a.path || !a.hash) { results[a.key] = { changed: false, missing: false, checked: false }; return; }
        try {
          const result = await (window as any).electron?.files?.hash?.(a.path);
          if (!result?.exists) { results[a.key] = { changed: false, missing: true, checked: true }; }
          else { results[a.key] = { changed: result.hash !== a.hash, missing: false, checked: true }; }
        } catch { results[a.key] = { changed: false, missing: false, checked: false }; }
      }));
      if (!cancelled) setStatuses(results);
    })();
    return () => { cancelled = true; };
  }, [attachments]);

  return (
    <div>
      <p className="text-[10px] uppercase text-comment tracking-wide mb-1 flex items-center gap-1">
        <Paperclip size={9} />File Attachments
      </p>
      <div className="space-y-1">
        {attachments.map((a) => {
          const s = statuses[a.key];
          const hasWarning = s?.missing || s?.changed;
          return (
            <div key={a.key} className={`flex items-start gap-2 text-[11px] font-mono rounded px-2 py-1 ${hasWarning ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-muted/40'}`}>
              <div className="flex-1 min-w-0">
                <span className="text-comment"><Highlight text={a.key} query={query} /></span>
                <span className="text-text/50 mx-1">=</span>
                <span className="text-text truncate"><Highlight text={a.name} query={query} /></span>
                {a.size !== undefined && <span className="text-comment/60 ml-1.5">({formatBytes(a.size)})</span>}
              </div>
              {s?.checked && hasWarning && (
                <div className="flex items-center gap-1 shrink-0 text-amber-400" title={s.missing ? 'File no longer exists' : 'File has changed since this request was made'}>
                  <AlertTriangle size={10} />
                  <span className="text-[9px]">{s.missing ? 'missing' : 'changed'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Collapsible section ──────────────────────────────────────────────────────

interface CollapsibleSectionProps {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  copyValue?: string;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ label, count, open, onToggle, copyValue, children }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { }
  };

  return (
    <div className='bg-bg'>
      <div className="flex items-center gap-1 w-full border-border border-b group/sec mb-1 bg-bg p-2 rounded">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 flex-1 text-left min-w-0 pl-2"
        >
          {open
            ? <ChevronDown size={10} className="text-comment shrink-0" />
            : <ChevronRight size={10} className="text-comment shrink-0" />}
          <span className="text-[10px] uppercase tracking-wide text-comment group-hover/sec:text-text transition-colors">
            {label}{count !== undefined ? ` (${count})` : ''}
          </span>
        </button>
        {copyValue && (
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy'}
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-green-400' : 'opacity-0 group-hover/sec:opacity-100 text-comment hover:text-text'}`}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        )}
      </div>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRelativePath(filePath: string, projectPath: string | null): string {
  if (!projectPath || !filePath) return filePath.split('/').pop() ?? filePath;
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath.split('/').pop() ?? filePath;
}

// ─── Entry card ───────────────────────────────────────────────────────────────

type DetailTab = 'request' | 'response';

interface EntryCardProps {
  entry: HistoryEntry;
  isCopied: boolean;
  query: string;
  sourceFile?: string;
  isSelecting?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onReplay: (entry: HistoryEntry) => void;
  onCopy: (entry: HistoryEntry) => void;
}

const EntryCard: React.FC<EntryCardProps> = ({ entry, isCopied, query, sourceFile, isSelecting, isSelected, onToggleSelect, onReplay, onCopy }) => {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('request');
  const [attachmentChanges, setAttachmentChanges] = useState<AttachmentChange[]>([]);

  // Lazily check if any attached files have changed since capture
  useEffect(() => {
    const hasCheckable = entry.request?.fileAttachments?.some((a) => a.path && a.hash);
    if (!hasCheckable) return;
    checkAttachmentChanges(entry).then(setAttachmentChanges).catch(() => {});
  }, [entry.id]);

  // Legacy section open state (used when no adapter viewer is available)
  const [openSections, setOpenSections] = useState({
    reqHeaders: true,
    reqBody: true,
    resHeaders: true,
    resBody: true,
  });
  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  const allReqOpen = openSections.reqHeaders && openSections.reqBody;
  const allResOpen = openSections.resHeaders && openSections.resBody;
  const setAllReq = (open: boolean) =>
    setOpenSections((s) => ({ ...s, reqHeaders: open, reqBody: open }));
  const setAllRes = (open: boolean) =>
    setOpenSections((s) => ({ ...s, resHeaders: open, resBody: open }));

  // Resolve meta for card header
  const meta = getEntryMeta(entry);

  const url = meta.url || '—';
  const duration = meta.duration;
  const bytes = meta.bytesContent;
  const status = meta.error ? 'ERR' : String(meta.statusCode ?? '—');

  let urlDisplay = url;
  try {
    const u = new URL(url);
    urlDisplay = u.host + u.pathname;
  } catch { }

  const q = query.toLowerCase();
  const matchInHeaders = q ? entry.request?.headers?.some(
    (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
  ) : false;
  const matchInBody = q ? entry.request?.body?.toLowerCase().includes(q) : false;
  const matchInResponseHeaders = q ? entry.response?.headers?.some(
    (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
  ) : false;
  const matchInResponseBody = q ? entry.response?.body?.toLowerCase().includes(q) : false;

  const handleCardClick = () => {
    if (isSelecting) { onToggleSelect?.(); } else { setExpanded((v) => !v); }
  };

  return (
    <div
      className={`mx-2 rounded-lg border bg-panel transition-all duration-150 cursor-pointer group
        ${isSelecting
          ? isSelected
            ? 'border-active bg-active/10'
            : 'border-border hover:border-active/50'
          : expanded
            ? 'border-active hover:bg-muted/30'
            : 'border-border hover:border-border/80 hover:bg-muted/30'
        }`}
      onClick={handleCardClick}
    >
      {/* Card top row */}
      <div className="px-3 pt-2.5 py-2">
        {/* Selection indicator + method + status + time */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {isSelecting && (
            <span className={`shrink-0 ${isSelected ? 'text-active' : 'text-comment/50'}`}>
              {isSelected ? <CheckSquare size={12} className='text-accent' /> : <Square size={12} />}
            </span>
          )}
          <span
            className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border-border ${methodBadge(meta.method ?? '')}`}
          >
            {meta.method ?? '—'}
          </span>
          <span className={`text-xs font-mono font-semibold ${statusBadge(meta.statusCode, meta.error)}`}>
            {status}
          </span>
          {attachmentChanges.length > 0 && (
            <Tip
              label={attachmentChanges.map((c) => `${c.name}: ${c.status}`).join('\n')}
              side="top"
            >
              <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 cursor-default">
                <AlertTriangle size={9} />
              </span>
            </Tip>
          )}
          <div className="flex flex-col items-end ml-auto gap-0.5">
            <span className="text-[10px] text-comment">{formatRelativeTime(entry.timestamp)}</span>
            <span className="text-[9px] text-comment/50">{formatAbsoluteDateTime(entry.timestamp)}</span>
          </div>
        </div>

        {/* URL */}
        <p
          className="text-xs font-mono text-text truncate leading-relaxed"
          title={url}
        >
          <Highlight text={urlDisplay} query={query} />
        </p>

        {/* Source file */}
        {sourceFile && (
          <div className="flex items-center gap-1 mt-1">
            <FileText size={9} className="text-comment/60 shrink-0" />
            <span className="text-[10px] text-comment truncate">
              <Highlight text={sourceFile} query={query} />
            </span>
          </div>
        )}

        {/* Match-location chips */}
        {(matchInHeaders || matchInBody || matchInResponseHeaders || matchInResponseBody) && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {matchInHeaders && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in req headers</span>
            )}
            {matchInBody && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in req body</span>
            )}
            {matchInResponseHeaders && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in res headers</span>
            )}
            {matchInResponseBody && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in response</span>
            )}
          </div>
        )}

        {/* Metadata + actions */}
        <div className="flex items-center mt-2 gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {duration !== undefined && (
              <span className="flex items-center gap-1 text-[10px] text-comment">
                <Clock size={9} />
                {formatDuration(duration)}
              </span>
            )}
            {bytes !== undefined && (
              <span className="flex items-center gap-1 text-[10px] text-comment">
                <Zap size={9} />
                {formatBytes(bytes)}
              </span>
            )}
          </div>

          {/* Actions — visible on hover */}
          <div
            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <Tip label="Replay" side="top" align="end">
              <button
                onClick={() => onReplay(entry)}
                className="p-1 rounded hover:bg-blue-500/20 text-comment hover:text-blue-400 transition-colors"
              >
                <RotateCcw size={11} />
              </button>
            </Tip>
            <Tip label={isCopied ? 'Copied!' : 'Copy as cURL'} side="top" align="end">
              <button
                onClick={() => onCopy(entry)}
                className={`p-1 rounded hover:bg-muted transition-colors ${isCopied ? 'text-green-400' : 'text-comment hover:text-text'}`}
              >
                {isCopied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </Tip>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="border-t border-border"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Tab nav */}
          <div className="flex border-b border-border">
            {(['request', 'response'] as DetailTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors
                  ${activeTab === tab
                    ? 'text-accent border-b-2 border-accent -mb-px bg-muted/20'
                    : 'text-comment hover:text-accent'
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Request tab */}
          {activeTab === 'request' && (
            <div className="px-3 py-2.5 space-y-2">
              <div className="text-xs font-mono bg-muted/60 rounded px-2 py-1.5 break-all select-all text-text leading-relaxed">{url}</div>
              {(entry.request?.headers?.length || entry.request?.body) && (
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setAllReq(true)} disabled={allReqOpen} className="text-xs text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsUpDown size={14} /></button>
                  <button onClick={() => setAllReq(false)} disabled={!allReqOpen} className="text-xs text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsDownUp size={14} /></button>
                </div>
              )}
              {entry.request?.headers && entry.request.headers.length > 0 && (
                <CollapsibleSection label="Headers" count={entry.request.headers.length} open={openSections.reqHeaders} onToggle={() => toggle('reqHeaders')} copyValue={entry.request.headers.map((h) => `${h.key}: ${h.value}`).join('\n')}>
                  <div className="bg-bg rounded p-2 space-y-0.5 font-mono text-[11px]">
                    {entry.request.headers.map((h, i) => (
                      <div key={i} className="flex gap-2 py-0.5 border-b border-border last:border-0">
                        <span className="text-comment shrink-0 min-w-[100px]"><Highlight text={h.key} query={query} /></span>
                        <span className="text-text break-all"><Highlight text={h.value} query={query} /></span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}
              {entry.request?.body && (
                <CollapsibleSection label="Body" open={openSections.reqBody} onToggle={() => toggle('reqBody')} copyValue={entry.request.body}>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-text bg-bg rounded p-2 max-h-[280px] overflow-y-auto"><Highlight text={entry.request.body} query={query} /></pre>
                </CollapsibleSection>
              )}
              {entry.request?.fileAttachments && entry.request.fileAttachments.length > 0 && (
                <FileAttachmentsSection attachments={entry.request.fileAttachments} query={query} />
              )}
            </div>
          )}

          {/* Response tab */}
          {activeTab === 'response' && (() => {
            const legacyRenderer = getHistoryRenderer(entry);
            const adapterForRenderer = !legacyRenderer && entry.pluginId ? historyAdapterRegistry.get(entry.pluginId) : null;
            const PluginRenderer: React.ComponentType<{ entry: any }> | null = legacyRenderer
              ?? (adapterForRenderer?.ResponseViewer
                ? (({ entry: e }: { entry: any }) => {
                    const RV = adapterForRenderer.ResponseViewer!;
                    return <RV responseState={e.responseState ?? e.response} requestState={e.requestState ?? e.request} />;
                  })
                : null);
            return (
              <div className="px-3 py-2.5 space-y-2">
                {PluginRenderer
                  ? <PluginRenderer entry={entry} />
                  : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono font-semibold ${statusBadge(entry.response?.status, entry.response?.error)}`}>
                          {entry.response?.error ? 'Error' : `${entry.response?.status ?? '—'} ${entry.response?.statusText ?? ''}`}
                        </span>
                        {entry.response?.contentType && (
                          <span className="text-xs text-comment font-mono truncate flex-1 min-w-0">{entry.response.contentType}</span>
                        )}
                        {(entry.response?.headers?.length || entry.response?.body) && (
                          <div className="flex items-center gap-2 ml-auto shrink-0">
                            <button onClick={() => setAllRes(true)} disabled={allResOpen} className="text-[9px] text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsUpDown size={14} /></button>
                            <button onClick={() => setAllRes(false)} disabled={!allResOpen} className="text-[9px] text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsDownUp size={14} /></button>
                          </div>
                        )}
                      </div>
                      {entry.response?.error && (
                        <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1.5 break-all">{entry.response.error}</div>
                      )}
                      {entry.response?.headers && entry.response.headers.length > 0 && (
                        <CollapsibleSection label="Headers" count={entry.response.headers.length} open={openSections.resHeaders} onToggle={() => toggle('resHeaders')} copyValue={entry.response.headers.map((h) => `${h.key}: ${h.value}`).join('\n')}>
                          <div className="bg-bg rounded p-2 space-y-0.5 font-mono text-[11px]">
                            {entry.response.headers.map((h, i) => (
                              <div key={i} className="flex gap-2 py-0.5 border-b border-border last:border-0">
                                <span className="text-comment shrink-0 min-w-[100px]"><Highlight text={h.key} query={query} /></span>
                                <span className="text-text break-all"><Highlight text={h.value} query={query} /></span>
                              </div>
                            ))}
                          </div>
                        </CollapsibleSection>
                      )}
                      {entry.response?.body && (
                        <CollapsibleSection label="Body" open={openSections.resBody} onToggle={() => toggle('resBody')} copyValue={entry.response.body}>
                          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-text bg-bg rounded p-2 max-h-[280px] overflow-y-auto"><Highlight text={entry.response.body} query={query} /></pre>
                        </CollapsibleSection>
                      )}
                      {!entry.response?.error && !entry.response?.body && (!entry.response?.headers || entry.response.headers.length === 0) && (
                        <p className="text-[10px] text-comment/60 italic">No response data recorded</p>
                      )}
                    </>
                  )
                }
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

const PendingEntryCard: React.FC = () => {
  return (
    <div className="mx-2 rounded-lg border border-active/40 bg-panel/80">
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
            ...
          </span>
          <span className="text-xs font-mono font-semibold text-comment/80">Running</span>
          <Loader2 size={11} className="text-accent animate-spin ml-auto" />
        </div>

        <div className="h-3 w-4/5 rounded bg-muted animate-pulse mb-2" />

        <div className="flex items-center gap-2.5">
          <div className="h-2.5 w-14 rounded bg-muted animate-pulse" />
          <div className="h-2.5 w-12 rounded bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
};

// ─── Sidebar root ─────────────────────────────────────────────────────────────

export const HistorySidebar: React.FC = () => {
  const { entries, currentFilePath, setEntries, clearEntries } = useHistoryStore();
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [activeDocumentTabId, setActiveDocumentTabId] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'custom'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const isRequestLoading = useResponseStore((state) => state.isLoading);
  const currentRequestTabId = useResponseStore((state) => state.currentRequestTabId);

  // Reactively track the active document tab from the main panel
  const { data: panelData } = useGetPanelTabs('main');
  const panelActiveTabId = panelData?.activeTabId ?? null;
  const panelActiveDocTab = (panelData?.tabs as any[] | undefined)?.find(
    (t) => t.id === panelActiveTabId && t.type === 'document',
  );
  const panelActiveSource = (panelActiveDocTab?.source as string | null) ?? null;
  const panelActiveDocTabId = (panelActiveDocTab?.id as string | null) ?? null;

  // Load (or smart-merge) history whenever the active file changes
  useEffect(() => {
    let cancelled = false;

    setActiveSource(panelActiveSource);
    setActiveDocumentTabId(panelActiveDocTabId);

    if (!panelActiveSource) { clearEntries(); return; }

    setIsLoading(true);
    void (async () => {
      try {
        const projectPath = getProjectPathFn ? await getProjectPathFn() : null;
        if (!cancelled) setProjectPath(projectPath);
        if (cancelled || !projectPath) return;
        const settings = await (window as any).electron?.userSettings?.get?.();
        const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));
        const history = await readHistory(projectPath, panelActiveSource, retentionDays);
        if (cancelled) return;

        // Smart merge: if the store already has entries for this file, only prepend
        // genuinely new ones so the list doesn't fully re-render on every tab switch.
        const storeState = useHistoryStore.getState();
        if (storeState.currentFilePath === panelActiveSource && storeState.entries.length > 0) {
          const existingIds = new Set(storeState.entries.map((e: HistoryEntry) => e.id));
          const newEntries = history.entries.filter((e: HistoryEntry) => !existingIds.has(e.id));
          if (newEntries.length > 0) {
            setEntries(panelActiveSource, [...newEntries, ...storeState.entries]);
          }
          // else: already up-to-date — skip re-render
        } else {
          setEntries(panelActiveSource, history.entries);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [panelActiveSource, panelActiveDocTabId, clearEntries, setEntries]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const guardAttachments = useCallback(async (entry: HistoryEntry, action: () => Promise<void>) => {
    try {
      const changes = await checkAttachmentChanges(entry);
      if (changes.length > 0) {
        const detail = changes.map((c) => `• ${c.name} — ${c.status}`).join('\n');
        const response = await (window as any).electron?.dialog?.showMessageBox?.({
          type: 'warning',
          title: 'Attachment files changed',
          message: 'Some attached files have changed since this request was recorded.',
          detail,
          buttons: ['Cancel', 'Continue anyway'],
          defaultId: 0,
          cancelId: 0,
        });
        if (response !== 1) return;
      }
      await action();
    } catch {
      await action();
    }
  }, []);

  const handleReplay = useCallback(async (entry: HistoryEntry) => {
    await guardAttachments(entry, async () => {
      try {
        const base = activeSource
          ? (activeSource.split('/').pop()?.replace(/\.void$/, '') ?? 'replay')
          : 'replay';
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const dt = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const title = `replay-${base}-${dt}.void`;

        if (!importCurlFn) return;
        const curl = buildCurlForEntry(entry, projectPath ?? undefined);
        await importCurlFn(title, curl);
      } catch { }
    });
  }, [activeSource, guardAttachments]);

  const handleCopy = useCallback(async (entry: HistoryEntry) => {
    await guardAttachments(entry, async () => {
      try {
        const curl = buildCurlForEntry(entry, projectPath ?? undefined);
        await navigator.clipboard.writeText(curl);
        setCopied(entry.id);
        setTimeout(() => setCopied(null), 1500);
      } catch { }
    });
  }, [guardAttachments]);

  const handleClear = useCallback(async () => {
    if (!activeSource) return;
    setIsClearing(true);
    try {
      const projectPath = getProjectPathFn ? await getProjectPathFn() : null;
      if (projectPath) {
        await clearHistory(projectPath, activeSource);
        setEntries(activeSource, []);
        // Also remove these entries from the global history slice
        const store = useHistoryStore.getState();
        store.setAllEntries(store.allEntries.filter((e) => e.filePath !== activeSource));
      }
    } catch { } finally {
      setIsClearing(false);
    }
  }, [activeSource, setEntries]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
    setMenuOpen(false);
  }, []);

  const handleExport = useCallback(async (entriesToExport: HistoryEntry[] | null) => {
    if (!activeSource) return;
    const projectPath = getProjectPathFn ? await getProjectPathFn() : null;
    if (!projectPath) return;

    const electronAny = (window as any).electron;
    const tabBasename = activeSource.split('/').pop()?.replace(/\.void$/, '') || 'unknown';

    // Build Exports/request-history/{tabBasename} directory hierarchy
    const exportsExists = await electronAny?.files?.getDirectoryExist(projectPath, 'Exports');
    if (!exportsExists) await electronAny?.files?.createDirectory(projectPath, 'Exports');
    const exportsPath = await electronAny?.utils?.pathJoin(projectPath, 'Exports');
    const reqHistExists = await electronAny?.files?.getDirectoryExist(exportsPath, 'request-history');
    if (!reqHistExists) await electronAny?.files?.createDirectory(exportsPath, 'request-history');
    const reqHistPath = await electronAny?.utils?.pathJoin(exportsPath, 'request-history');
    const tabFolderExists = await electronAny?.files?.getDirectoryExist(reqHistPath, tabBasename);
    if (!tabFolderExists) await electronAny?.files?.createDirectory(reqHistPath, tabBasename);
    const rootFolderPath = await electronAny?.utils?.pathJoin(reqHistPath, tabBasename);

    // Determine which entries to export.
    // null = "export all": read fresh from disk so today's newly-executed entries
    // are always included (appendToHistory writes to disk before updating the store).
    // non-null = "export selected": use the explicitly passed selection.
    let toExport: HistoryEntry[];
    if (entriesToExport === null) {
      const settings = await electronAny?.userSettings?.get?.();
      const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));
      const freshHistory = await readHistory(projectPath, activeSource, retentionDays);
      // Also include any in-memory-only entries not yet reflected on disk (edge case)
      const diskIds = new Set(freshHistory.entries.map((e: HistoryEntry) => e.id));
      const storeState = useHistoryStore.getState();
      const memOnly = (storeState.currentFilePath === activeSource ? storeState.entries : [])
        .filter((e) => !diskIds.has(e.id));
      toExport = [...memOnly, ...freshHistory.entries];
    } else {
      toExport = entriesToExport;
    }

    if (!toExport.length) return;

    // Check for changed/missing attachments across all entries being exported
    const exportableWithAttachments = toExport.filter(
      (e) => e.request?.fileAttachments?.some((a) => a.path && a.hash),
    );
    if (exportableWithAttachments.length > 0) {
      const allChanges: AttachmentChange[] = [];
      for (const e of exportableWithAttachments) {
        const changes = await checkAttachmentChanges(e);
        allChanges.push(...changes);
      }
      if (allChanges.length > 0) {
        const detail = allChanges.map((c) => `• ${c.name} — ${c.status}`).join('\n');
        const response = await (window as any).electron?.dialog?.showMessageBox?.({
          type: 'warning',
          title: 'Attachment files changed',
          message: 'Some attached files have changed since these requests were recorded.',
          detail,
          buttons: ['Cancel', 'Export anyway'],
          defaultId: 0,
          cancelId: 0,
        });
        if (response !== 1) return;
      }
    }


    // Group by YYYY-MM-DD
    const byDay = new Map<string, HistoryEntry[]>();
    for (const entry of toExport) {
      const d = new Date(entry.timestamp);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(entry);
    }

    for (const [dayKey, dayEntries] of byDay) {
      const dayExists = await electronAny?.files?.getDirectoryExist(rootFolderPath, dayKey);
      if (!dayExists) await electronAny?.files?.createDirectory(rootFolderPath, dayKey);
      const dayFolderPath = await electronAny?.utils?.pathJoin(rootFolderPath, dayKey);

      for (const entry of dayEntries) {
        const adapter = historyAdapterRegistry.get(getEntryPluginId(entry));
        if (!adapter?.exportToVoid) continue;
        const markdown = await adapter.exportToVoid(entry);
        if (!markdown) continue;
        const d = new Date(entry.timestamp);
        const timeStr = `${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
        const fileName = `${tabBasename}-${timeStr}.void`;
        const filePath = await electronAny?.utils?.pathJoin(dayFolderPath, fileName);
        if (filePath) {
          await electronAny?.files?.write(filePath, markdown);
        }
      }
    }

    setMenuOpen(false);
    setSelectedIds(new Set());
    setIsSelecting(false);
    toast.success(`Exported ${toExport.length} ${toExport.length === 1 ? 'entry' : 'entries'}`, {
      description: rootFolderPath,
    });
  }, [activeSource]);

  const handleClearSelected = useCallback(async () => {
    if (!activeSource || selectedIds.size === 0) return;
    const remaining = entries.filter((e) => !selectedIds.has(e.id));
    const projectPath = getProjectPathFn ? await getProjectPathFn() : null;
    if (projectPath) {
      const electronAny = (window as any).electron;
      const histPath = await electronAny?.utils?.pathJoin(projectPath, '.voiden', 'history');
      const fileName = activeSource.split('/').pop()?.replace(/\.void$/, '') + '-history.json';
      const fullPath = await electronAny?.utils?.pathJoin(histPath, fileName);
      if (fullPath) {
        await electronAny?.files?.write(fullPath, JSON.stringify({ version: '1.0.0', filePath: activeSource, entries: remaining }, null, 2));
      }
      setEntries(activeSource, remaining);
      // Also remove selected entries from the global history slice
      const store = useHistoryStore.getState();
      store.setAllEntries(store.allEntries.filter((e) => !selectedIds.has(e.id)));
    }
    setSelectedIds(new Set());
    setIsSelecting(false);
    setMenuOpen(false);
  }, [activeSource, entries, selectedIds, setEntries]);

  const displayEntries = currentFilePath === activeSource ? entries : [];

  // Filter by date chip + search
  const filtered = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 6 * 86400000;

    let result = displayEntries;

    if (dateFilter !== 'all') {
      result = result.filter((e) => {
        if (dateFilter === 'today') return e.timestamp >= todayStart;
        if (dateFilter === 'yesterday') return e.timestamp >= yesterdayStart && e.timestamp < todayStart;
        if (dateFilter === 'week') return e.timestamp >= weekStart;
        if (dateFilter === 'custom') {
          const from = dateFrom ? new Date(dateFrom).getTime() : 0;
          const to = dateTo ? new Date(dateTo).getTime() : Infinity;
          return e.timestamp >= from && e.timestamp <= to;
        }
        return true;
      });
    }

    if (!search.trim()) return result;
    const q = search.toLowerCase();
    return result.filter((e) => {
      const m = getEntryMeta(e);
      if (m.url.toLowerCase().includes(q)) return true;
      if ((m.method ?? '').toLowerCase().includes(q)) return true;
      if (String(m.statusCode ?? '').includes(q)) return true;
      if (activeSource && activeSource.toLowerCase().includes(q)) return true;
      if (e.request?.fileAttachments?.some(
        (a) => a.name.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
      )) return true;
      if (e.request?.headers?.some(
        (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q)
      )) return true;
      if (e.request?.body) {
        try {
          if (JSON.stringify(JSON.parse(e.request.body)).toLowerCase().includes(q)) return true;
        } catch {
          if (e.request.body.toLowerCase().includes(q)) return true;
        }
      }
      if (e.response?.headers?.some(
        (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q)
      )) return true;
      if (e.response?.body && e.response.body.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [displayEntries, search, dateFilter, dateFrom, dateTo]);

  // Group by day label
  const grouped = useMemo(() => {
    const map: { label: string; entries: HistoryEntry[] }[] = [];
    for (const entry of filtered) {
      const label = getGroupLabel(entry.timestamp);
      const last = map[map.length - 1];
      if (last && last.label === label) {
        last.entries.push(entry);
      } else {
        map.push({ label, entries: [entry] });
      }
    }
    return map;
  }, [filtered]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  const isActiveFileExecuting = isRequestLoading
    && !!activeDocumentTabId
    && currentRequestTabId === activeDocumentTabId;

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden">

      {/* Search bar */}
      <div className="px-2 pt-2 pb-1.5 shrink-0">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/60 border border-border focus-within:border-border/80">
          <Search size={11} className="text-comment shrink-0" />
          <input
            type="text"
            placeholder="Search URL, method, file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent text-xs text-text placeholder:text-comment outline-none min-w-0"
          />
          {isActiveFileExecuting && (
            <span className="flex items-center gap-1 text-[10px] text-comment shrink-0">
              <Loader2 size={11} className="animate-spin" />
              Running
            </span>
          )}
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-comment hover:text-text text-xs shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Date filter chips */}
      {displayEntries.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-1.5 shrink-0">
          {(['all', 'today', 'yesterday', 'week', 'custom'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`text-[10px] px-1 py-0.5 mt-2 rounded border transition-colors text-comment ${dateFilter === f
                  ? 'bg-active/20 border-active text-text'
                  : 'border-border text-comment hover:border-border/80 hover:text-text'
                }`}
            >
              {f === 'all' ? 'All' : f === 'today' ? 'Today' : f === 'yesterday' ? 'Yesterday' : f === 'week' ? 'This week' : 'Custom'}
            </button>
          ))}
        </div>
      )}

      {/* Custom date range inputs */}
      {dateFilter === 'custom' && (
        <div className="flex items-center gap-1.5 px-2 pb-1.5 mt-2 shrink-0">
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0"
          />
          <span className="text-[9px] text-comment shrink-0">→</span>
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0"
          />
        </div>
      )}

  {/* Toolbar row */}
      {displayEntries.length > 0 && (
        <div className="flex items-center px-3 pt-2 pb-0.5 shrink-0 gap-2">
          {isSelecting ? (
            <>
              <button
                onClick={() => {
                  if (allFilteredSelected) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filtered.map((e) => e.id)));
                  }
                }}
                className="flex items-center gap-1 text-[10px] text-comment hover:text-text transition-colors"
              >
                {allFilteredSelected
                  ? <CheckSquare size={11} className="text-accent" />
                  : <Square size={11} />}
                <span>{allFilteredSelected ? 'Deselect all' : 'Select all'}</span>
              </button>
              {selectedIds.size > 0 && (
                <span className="text-[10px] text-accent ml-1">{selectedIds.size} selected</span>
              )}
              <button onClick={cancelSelection} className="ml-auto p-1 rounded hover:bg-muted text-comment hover:text-text transition-colors">
                <X size={11} />
              </button>
            </>
          ) : (
            <div className="ml-auto relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="p-1 rounded hover:bg-muted text-comment hover:text-text transition-colors"
              >
                <MoreHorizontal size={13} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-max bg-panel border border-border rounded-lg shadow-lg py-1 text-[11px]">
                  <button
                    onClick={() => { setIsSelecting(true); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-text hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <CheckSquare size={11} className="text-accent" /> Select
                  </button>
                  <button
                    onClick={() => handleExport(null)}
                    className="w-full text-left px-3 py-1.5 text-text hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Download size={11} className="text-accent" /> Export all
                  </button>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={() => { handleClear(); setMenuOpen(false); }}
                    disabled={isClearing}
                    className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-40"
                  >
                    <Trash2 size={11} /> {isClearing ? 'Clearing…' : 'Clear all'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selection action bar */}
      {isSelecting && selectedIds.size > 0 && (
        <div className="flex mt-2 items-center gap-1.5 px-3 pb-1 shrink-0">
          <button
            onClick={() => handleExport(entries.filter((e) => selectedIds.has(e.id)))}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border text-comment hover:text-text hover:border-border/80 transition-colors"
          >
            <Download size={10} /> Export ({selectedIds.size})
          </button>
          <button
            onClick={handleClearSelected}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={10} /> Clear ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1 text-xs text-comment">
          Loading…
        </div>
      ) : !activeSource ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-1.5 px-4 text-center">
          <Clock size={20} className="text-comment/40" />
          <p className="text-xs text-comment">No file open</p>
          <p className="text-[10px] text-comment/50">Open a .void request file to see its history</p>
        </div>
      ) : displayEntries.length === 0 && !isActiveFileExecuting ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-1.5 px-4 text-center">
          <Clock size={20} className="text-comment/40" />
          <p className="text-xs text-comment">No history yet</p>
          <p className="text-[10px] text-comment/50">History is recorded each time you send a request</p>
        </div>
      ) : filtered.length === 0 && !isActiveFileExecuting ? (
        <div className="flex items-center justify-center flex-1 text-xs text-comment">
          No results for "{search}"
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pt-0.5 pb-2">
          {isActiveFileExecuting && (
            <div className="pt-2">
              <PendingEntryCard />
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label}>
              {/* Group label */}
              <div className="px-3 py-1.5 flex items-center gap-2">
                <span className="text-[9px] font-semibold tracking-widest text-comment/60 uppercase">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>

              {/* Cards */}
              {group.entries.map((entry) => (
                <div className='pt-2' key={entry.id}>
                  <EntryCard
                    entry={entry}
                    isCopied={copied === entry.id}
                    query={search.trim().toLowerCase()}
                    sourceFile={activeSource ? toRelativePath(activeSource, projectPath) : undefined}
                    isSelecting={isSelecting}
                    isSelected={selectedIds.has(entry.id)}
                    onToggleSelect={() => toggleSelect(entry.id)}
                    onReplay={handleReplay}
                    onCopy={handleCopy}
                  />
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && isActiveFileExecuting && (
            <div className="px-3 py-2 text-[10px] text-comment/70">
              Waiting for response. History entry will appear when execution finishes.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
