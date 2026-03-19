import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Copy, Check, Search, RotateCcw, Zap, ChevronDown, ChevronRight, Loader2, RefreshCw, FileText, X, Paperclip, AlertTriangle, ChevronsUpDown, ChevronsDownUp, Download, Trash2, Square, CheckSquare, MoreHorizontal } from 'lucide-react';
import { useHistoryStore } from '../historyStore';
import { readAllHistory, clearAllHistory, removeEntriesFromHistory, checkAttachmentChanges, AttachmentChange } from '../historyManager';
import { FileAttachmentMeta, HistoryEntryWithFile } from '../types';
import { getProjectPathFn, importCurlFn } from '../pipelineHooks';
import { buildCurlForEntry, getHistoryRenderer, buildVoidFileForEntry, useEditorEnhancementStore } from '@/plugins';
import { historyAdapterRegistry } from '../adapterRegistry';
import { getSchema } from '@tiptap/core';
import { voidenExtensions } from '@/core/editors/voiden/extensions';
import { METHOD_COLORS } from '@/constants';
import { Tip } from '@/core/components/ui/Tip';
import { toast } from '@/core/components/ui/sonner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRelativePath(filePath: string, projectPath: string | null): string {
  if (!projectPath || !filePath) return filePath.split('/').pop() ?? filePath;
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath.split('/').pop() ?? filePath;
}

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

function methodBadge(method: string): string {
  const methodKey = method.toUpperCase();
  const textClass = METHOD_COLORS[methodKey] ?? 'text-comment';
  const bgClass = textClass.startsWith('text-') ? textClass.replace('text-', 'bg-') : 'bg-muted';
  return `${textClass} ${bgClass}/15 border border-border`;
}

function statusBadge(status?: number, error?: string | null): string {
  if (error || !status) return 'text-red-400';
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-amber-400';
  return 'text-red-400';
}



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
    <div className="bg-bg">
      <div className="flex items-center gap-1 w-full border-border border-b group/sec mb-1 bg-bg p-2 rounded">
        <button onClick={onToggle} className="flex items-center gap-1 flex-1 text-left min-w-0 pl-2">
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
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-green-400' : 'text-comment/50 hover:text-text'}`}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        )}
      </div>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
};

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

// ─── File attachments with change detection ───────────────────────────────────

interface AttachmentStatus {
  changed: boolean;
  missing: boolean;
  checked: boolean;
}

const FileAttachmentsSection: React.FC<{ attachments: FileAttachmentMeta[]; query?: string }> = ({ attachments, query = '' }) => {
  const [statuses, setStatuses] = useState<Record<string, AttachmentStatus>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results: Record<string, AttachmentStatus> = {};
      await Promise.all(
        attachments.map(async (a) => {
          if (!a.path || !a.hash) {
            results[a.key] = { changed: false, missing: false, checked: false };
            return;
          }
          try {
            const result = await (window as any).electron?.files?.hash?.(a.path);
            if (!result?.exists) {
              results[a.key] = { changed: false, missing: true, checked: true };
            } else {
              results[a.key] = { changed: result.hash !== a.hash, missing: false, checked: true };
            }
          } catch {
            results[a.key] = { changed: false, missing: false, checked: false };
          }
        }),
      );
      if (!cancelled) setStatuses(results);
    })();
    return () => { cancelled = true; };
  }, [attachments]);

  return (
    <div>
      <p className="text-[10px] uppercase text-comment tracking-wide mb-1 flex items-center gap-1">
        <Paperclip size={9} />
        File Attachments
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
                {a.size !== undefined && (
                  <span className="text-comment/60 ml-1.5">({formatBytes(a.size)})</span>
                )}
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

// ─── Date preset type ─────────────────────────────────────────────────────────

type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'custom';

function getPresetRange(preset: DatePreset): { from: number; to: number } | null {
  const now = Date.now();
  const todayStart = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  })();
  if (preset === 'today') return { from: todayStart, to: now };
  if (preset === 'yesterday') return { from: todayStart - 86400000, to: todayStart - 1 };
  if (preset === 'week') return { from: todayStart - 6 * 86400000, to: now };
  return null; // 'all' or 'custom' handled separately
}

// ─── Entry row ────────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: HistoryEntryWithFile;
  query: string;
  copiedId: string | null;
  projectPath: string | null;
  isSelected: boolean;
  isSelecting: boolean;
  onToggleSelect: (id: string) => void;
  onReplay: (e: HistoryEntryWithFile) => void;
  onCopy: (e: HistoryEntryWithFile) => void;
}

type DetailTab = 'request' | 'response';

const EntryRow: React.FC<EntryRowProps> = ({ entry, query, copiedId, projectPath, isSelected, isSelecting, onToggleSelect, onReplay, onCopy }) => {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('request');
  const [openSections, setOpenSections] = useState({ reqHeaders: true, reqBody: true, resHeaders: true, resBody: true });
  const [attachmentChanges, setAttachmentChanges] = useState<AttachmentChange[]>([]);

  useEffect(() => {
    const hasCheckable = entry.request.fileAttachments?.some((a) => a.path && a.hash);
    if (!hasCheckable) return;
    checkAttachmentChanges(entry).then(setAttachmentChanges).catch(() => {});
  }, [entry.id]);
  const toggle = (key: keyof typeof openSections) => setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  const allReqOpen = openSections.reqHeaders && openSections.reqBody;
  const allResOpen = openSections.resHeaders && openSections.resBody;
  const setAllReq = (open: boolean) => setOpenSections((s) => ({ ...s, reqHeaders: open, reqBody: open }));
  const setAllRes = (open: boolean) => setOpenSections((s) => ({ ...s, resHeaders: open, resBody: open }));
  const isCopied = copiedId === entry.id;

  const q = query.toLowerCase();
  const matchInHeaders = q ? entry.request.headers?.some(
    (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
  ) : false;
  const matchInBody = q ? entry.request.body?.toLowerCase().includes(q) : false;
  const matchInResponseHeaders = q ? entry.response.headers?.some(
    (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
  ) : false;
  const matchInResponseBody = q ? entry.response.body?.toLowerCase().includes(q) : false;

  const url = entry.request.url || '—';
  const isSocketEntry = /^(WSS?|GRPCS?)$/i.test(entry.request.method || '');
  const status = entry.response.error
    ? 'ERR'
    : isSocketEntry
      ? 'Closed'
      : String(entry.response.status ?? '—');
  const duration = entry.response.timing?.duration;
  const bytes = entry.response.bytesContent;
  const fileName = entry.filePath ? toRelativePath(entry.filePath, projectPath) : '';

  let urlDisplay = url;
  try { const u = new URL(url); urlDisplay = u.host + u.pathname; } catch { }

  return (
    <div
      className={`mx-2 mb-1 rounded-lg border bg-panel cursor-pointer group transition-all duration-150
        ${isSelecting
          ? isSelected
            ? 'border-active bg-active/10'
            : 'border-border hover:border-active/50'
          : expanded
            ? 'border-active'
            : 'border-border hover:border-border/80 hover:bg-muted/30'
        }`}
      onClick={() => { if (isSelecting) { onToggleSelect(entry.id); } else { setExpanded((v) => !v); } }}
    >
      <div className="px-3 pt-2.5 pb-2">
        {/* Method + status + time */}
        <div className="flex items-center gap-1.5 mb-1">
          {isSelecting && (
            <span className={`shrink-0 ${isSelected ? 'text-active' : 'text-comment/50'}`}>
              {isSelected ? <CheckSquare size={12} className="text-accent" /> : <Square size={12} />}
            </span>
          )}
          <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border-border ${methodBadge(entry.request.method)}`}>
            {entry.request.method}
          </span>
          <span className={`text-xs font-mono font-semibold ${statusBadge(entry.response.status, entry.response.error)}`}>
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
        <p className="text-xs font-mono text-text truncate leading-relaxed" title={url}>
          <Highlight text={urlDisplay} query={query} />
        </p>

        {/* Source file + attachment hint */}
        {(fileName || (entry.request.fileAttachments && entry.request.fileAttachments.length > 0)) && (
          <div className="flex items-center gap-1 mt-1">
            <FileText size={9} className="text-comment/60 shrink-0" />
            {fileName && (
              <span className="text-[10px] text-comment truncate">
                <Highlight text={fileName} query={query} />
              </span>
            )}
            {entry.request.fileAttachments && entry.request.fileAttachments.length > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-comment/60 ml-auto shrink-0">
                <Paperclip size={8} />
                {entry.request.fileAttachments.length}
              </span>
            )}
          </div>
        )}

        {/* Match-location chips */}
        {(matchInHeaders || matchInBody || matchInResponseHeaders || matchInResponseBody) && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {matchInHeaders && <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in req headers</span>}
            {matchInBody && <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in req body</span>}
            {matchInResponseHeaders && <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in res headers</span>}
            {matchInResponseBody && <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/80 border border-yellow-400/20">in response</span>}
          </div>
        )}

        {/* Meta + actions */}
        <div className="flex items-center mt-2 gap-2">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {duration !== undefined && (
              <span className="flex items-center gap-1 text-[10px] text-comment">
                <Clock size={9} />{formatDuration(duration)}
              </span>
            )}
            {bytes !== undefined && (
              <span className="flex items-center gap-1 text-[10px] text-comment">
                <Zap size={9} />{formatBytes(bytes)}
              </span>
            )}
          </div>
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
      {expanded && (() => {
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
          <div className="border-t border-border" onClick={(e) => e.stopPropagation()}>
            <>
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
                  {!isSocketEntry && (entry.request.headers?.length || entry.request.body) && (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setAllReq(true)} disabled={allReqOpen} className="text-xs text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsUpDown size={14} /></button>
                      <button onClick={() => setAllReq(false)} disabled={!allReqOpen} className="text-xs text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsDownUp size={14} /></button>
                    </div>
                  )}
                  {entry.request.headers && entry.request.headers.length > 0 && (
                    <CollapsibleSection
                      label="Headers"
                      count={entry.request.headers.length}
                      open={openSections.reqHeaders}
                      onToggle={() => toggle('reqHeaders')}
                      copyValue={entry.request.headers.map((h) => `${h.key}: ${h.value}`).join('\n')}
                    >
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
                  {entry.request.body && (
                    <CollapsibleSection
                      label="Body"
                      open={openSections.reqBody}
                      onToggle={() => toggle('reqBody')}
                      copyValue={entry.request.body}
                    >
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-text bg-bg rounded p-2 max-h-[280px] overflow-y-auto"><Highlight text={entry.request.body ?? ''} query={query} /></pre>
                    </CollapsibleSection>
                  )}
                  {entry.request.fileAttachments && entry.request.fileAttachments.length > 0 && (
                    <FileAttachmentsSection attachments={entry.request.fileAttachments} query={query} />
                  )}
                  {entry.filePath && (
                    <div>
                      <p className="text-[10px] uppercase text-comment tracking-wide mb-1 flex items-center gap-1"><FileText size={9} />Source file</p>
                      <p className="text-[11px] font-mono text-text break-all">
                        <Highlight text={toRelativePath(entry.filePath, projectPath)} query={query} />
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Response tab */}
              {activeTab === 'response' && (
                <div className="px-3 py-2.5 space-y-2">
                  {PluginRenderer
                    ? <PluginRenderer entry={entry} />
                    : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-semibold ${statusBadge(entry.response.status, entry.response.error)}`}>
                            {entry.response.error ? 'Error' : `${entry.response.status ?? '—'} ${entry.response.statusText ?? ''}`}
                          </span>
                          {entry.response.contentType && (
                            <span className="text-xs text-comment font-mono truncate flex-1 min-w-0">{entry.response.contentType}</span>
                          )}
                          {!isSocketEntry && (entry.response.headers?.length || entry.response.body) && (
                            <div className="flex items-center gap-2 ml-auto shrink-0">
                              <button onClick={() => setAllRes(true)} disabled={allResOpen} className="text-[9px] text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsUpDown size={14} /></button>
                              <button onClick={() => setAllRes(false)} disabled={!allResOpen} className="text-[9px] text-comment hover:text-accent disabled:opacity-30 transition-colors"><ChevronsDownUp size={14} /></button>
                            </div>
                          )}
                        </div>
                        {entry.response.error && (
                          <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1.5 break-all">{entry.response.error}</div>
                        )}
                        {entry.response.headers && entry.response.headers.length > 0 && (
                          <CollapsibleSection
                            label="Headers"
                            count={entry.response.headers.length}
                            open={openSections.resHeaders}
                            onToggle={() => toggle('resHeaders')}
                            copyValue={entry.response.headers.map((h) => `${h.key}: ${h.value}`).join('\n')}
                          >
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
                        {entry.response.body && (
                          <CollapsibleSection
                            label="Body"
                            open={openSections.resBody}
                            onToggle={() => toggle('resBody')}
                            copyValue={entry.response.body}
                          >
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-text bg-bg rounded p-2 max-h-[280px] overflow-y-auto"><Highlight text={entry.response?.body ?? ''} query={query} /></pre>
                          </CollapsibleSection>
                        )}
                        {!entry.response.error && !entry.response.body && (!entry.response.headers || entry.response.headers.length === 0) && (
                          <p className="text-[10px] text-comment/60 italic">No response data recorded</p>
                        )}
                      </>
                    )
                  }
                </div>
              )}
            </>
          </div>
        );
      })()}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const GlobalHistorySidebar: React.FC = () => {
  const allEntries = useHistoryStore((s) => s.allEntries);
  const allEntriesLoading = useHistoryStore((s) => s.allEntriesLoading);
  const setAllEntries = useHistoryStore((s) => s.setAllEntries);
  const setAllEntriesLoading = useHistoryStore((s) => s.setAllEntriesLoading);

  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    setAllEntriesLoading(true);
    try {
      const pp = getProjectPathFn ? await getProjectPathFn() : null;
      setProjectPath(pp);
      if (!pp) { setAllEntries([]); return; }
      const settings = await (window as any).electron?.userSettings?.get();
      const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));
      const entries = await readAllHistory(pp, retentionDays);
      setAllEntries(entries);
    } catch {
      setAllEntries([]);
    }
  }, [setAllEntries, setAllEntriesLoading]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const filtered = useMemo(() => {
    let entries = allEntries;

    // Date filter
    if (datePreset !== 'all') {
      const range = getPresetRange(datePreset);
      if (range) {
        entries = entries.filter((e) => e.timestamp >= range.from && e.timestamp <= range.to);
      } else if (datePreset === 'custom') {
        const from = customFrom ? new Date(customFrom).getTime() : 0;
        const to = customTo ? new Date(customTo).getTime() + 86399999 : Date.now();
        entries = entries.filter((e) => e.timestamp >= from && e.timestamp <= to);
      }
    }

    // Text search
    if (query.trim()) {
      const q = query.toLowerCase();
      entries = entries.filter((e) => {
        const url = (e.request.url ?? '').toLowerCase();
        const method = (e.request.method ?? '').toLowerCase();
        const file = (e.filePath ?? '').toLowerCase();
        if (url.includes(q) || method.includes(q) || file.includes(q)) return true;
        if (String(e.response.status ?? '').includes(q)) return true;
        if (e.request.fileAttachments?.some(
          (a) => a.name.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
        )) return true;
        if (e.request.headers?.some(
          (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
        )) return true;
        if (e.request.body) {
          try {
            if (JSON.stringify(JSON.parse(e.request.body)).toLowerCase().includes(q)) return true;
          } catch {
            if (e.request.body.toLowerCase().includes(q)) return true;
          }
        }
        if (e.response.headers?.some(
          (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q),
        )) return true;
        if (e.response.body && e.response.body.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    return entries;
  }, [allEntries, query, datePreset, customFrom, customTo]);

  // Group by date label
  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntryWithFile[]>();
    for (const entry of filtered) {
      const label = getGroupLabel(entry.timestamp);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(entry);
    }
    return map;
  }, [filtered]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (label: string) =>
    setCollapsedGroups((s) => {
      const n = new Set(s);
      n.has(label) ? n.delete(label) : n.add(label);
      return n;
    });

  const guardAttachments = useCallback(async (entry: HistoryEntryWithFile, action: () => Promise<void>) => {
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

  const handleReplay = useCallback(async (entry: HistoryEntryWithFile) => {
    await guardAttachments(entry, async () => {
      try {
        const base = entry.filePath
          ? (entry.filePath.split('/').pop()?.replace(/\.void$/, '') ?? 'replay')
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
  }, [guardAttachments]);

  const handleCopy = useCallback(async (entry: HistoryEntryWithFile) => {
    await guardAttachments(entry, async () => {
      try {
        const curl = buildCurlForEntry(entry, projectPath ?? undefined);
        await navigator.clipboard.writeText(curl);
        setCopiedId(entry.id);
        setTimeout(() => setCopiedId(null), 1500);
      } catch { }
    });
  }, [guardAttachments]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
    setMenuOpen(false);
  }, []);

  /**
   * Export a list of entries as .void files under Exports/global-history/{YYYY-MM-DD}/
   * Returns the root export folder path on success, null on failure.
   */
  const exportEntriesToVoidFiles = async (toExport: HistoryEntryWithFile[]): Promise<string | null> => {
    if (!projectPath || toExport.length === 0) return null;
    try {
      const electron = (window as any).electron;

      // Build Exports/global-history directory hierarchy
      const exportsExists = await electron?.files?.getDirectoryExist(projectPath, 'Exports');
      if (!exportsExists) await electron?.files?.createDirectory(projectPath, 'Exports');
      const exportsPath = await electron?.utils?.pathJoin(projectPath, 'Exports');
      const globalHistExists = await electron?.files?.getDirectoryExist(exportsPath, 'global-history');
      if (!globalHistExists) await electron?.files?.createDirectory(exportsPath, 'global-history');
      const rootFolderPath = await electron?.utils?.pathJoin(exportsPath, 'global-history');

      const pluginExts = useEditorEnhancementStore.getState().voidenExtensions;
      const fullSchema = getSchema([...voidenExtensions, ...pluginExts]);

      // Group by YYYY-MM-DD
      const byDay = new Map<string, HistoryEntryWithFile[]>();
      for (const entry of toExport) {
        const d = new Date(entry.timestamp);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(entry);
      }

      for (const [dayKey, dayEntries] of byDay) {
        const dayExists = await electron?.files?.getDirectoryExist(rootFolderPath, dayKey);
        if (!dayExists) await electron?.files?.createDirectory(rootFolderPath, dayKey);
        const dayFolderPath = await electron?.utils?.pathJoin(rootFolderPath, dayKey);

        for (const entry of dayEntries) {
          const basename = entry.filePath
            ? entry.filePath.split('/').pop()?.replace(/\.void$/, '') ?? 'entry'
            : 'entry';
          const d = new Date(entry.timestamp);
          const timeStr = `${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
          const fileName = `${basename}-${timeStr}.void`;
          const filePath = await electron?.utils?.pathJoin(dayFolderPath, fileName);
          if (filePath) {
            const markdown = buildVoidFileForEntry(entry, fullSchema);
            await electron?.files?.write(filePath, markdown);
          }
        }
      }

      return rootFolderPath;
    } catch {
      return null;
    }
  };

  /** Check all entries for changed/missing attachments. Returns false if user cancels. */
  const guardExportAttachments = useCallback(async (toExport: HistoryEntryWithFile[]): Promise<boolean> => {
    const withAttachments = toExport.filter(
      (e) => e.request.fileAttachments?.some((a) => a.path && a.hash),
    );
    if (withAttachments.length === 0) return true;
    const allChanges: AttachmentChange[] = [];
    for (const e of withAttachments) {
      const changes = await checkAttachmentChanges(e);
      allChanges.push(...changes);
    }
    if (allChanges.length === 0) return true;
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
    return response === 1;
  }, []);

  const handleExportAll = useCallback(async () => {
    if (filtered.length === 0) return;
    setIsBusy(true);
    setMenuOpen(false);
    try {
      const ok = await guardExportAttachments(filtered);
      if (!ok) return;
      const exportedPath = await exportEntriesToVoidFiles(filtered);
      setSelectedIds(new Set());
      setIsSelecting(false);
      if (exportedPath) {
        toast.success(`Exported ${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`, {
          description: exportedPath,
        });
      }
    } finally {
      setIsBusy(false);
    }
  }, [filtered, projectPath, guardExportAttachments]);

  const handleExportSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsBusy(true);
    try {
      const selected = filtered.filter((e) => selectedIds.has(e.id));
      const ok = await guardExportAttachments(selected);
      if (!ok) return;
      const exportedPath = await exportEntriesToVoidFiles(selected);
      setSelectedIds(new Set());
      setIsSelecting(false);
      if (exportedPath) {
        toast.success(`Exported ${selected.length} ${selected.length === 1 ? 'entry' : 'entries'}`, {
          description: exportedPath,
        });
      }
    } finally {
      setIsBusy(false);
    }
  }, [filtered, selectedIds, projectPath, guardExportAttachments]);

  const handleClearAll = useCallback(async () => {
    if (!projectPath || allEntries.length === 0) return;
    if (!window.confirm('Clear all history? This cannot be undone.')) return;
    setIsBusy(true);
    try {
      await clearAllHistory(projectPath);
      setAllEntries([]);
      useHistoryStore.getState().clearEntries();
      setSelectedIds(new Set());
      setIsSelecting(false);
    } finally {
      setIsBusy(false);
    }
  }, [projectPath, allEntries, setAllEntries]);

  const handleClearSelected = useCallback(async () => {
    if (!projectPath || selectedIds.size === 0) return;
    setIsBusy(true);
    try {
      const filePathToIds = new Map<string, string[]>();
      for (const entry of allEntries) {
        if (selectedIds.has(entry.id) && entry.filePath) {
          const ids = filePathToIds.get(entry.filePath) ?? [];
          ids.push(entry.id);
          filePathToIds.set(entry.filePath, ids);
        }
      }
      await removeEntriesFromHistory(projectPath, filePathToIds);
      setAllEntries(allEntries.filter((e) => !selectedIds.has(e.id)));
      // Also update the per-file entries slice if any selected entries belong to the currently loaded file
      const perFileStore = useHistoryStore.getState();
      if (perFileStore.currentFilePath && filePathToIds.has(perFileStore.currentFilePath)) {
        perFileStore.setEntries(
          perFileStore.currentFilePath,
          perFileStore.entries.filter((e) => !selectedIds.has(e.id))
        );
      }
      setSelectedIds(new Set());
      setIsSelecting(false);
    } finally {
      setIsBusy(false);
    }
  }, [projectPath, allEntries, selectedIds, setAllEntries]);

  const presets: { key: DatePreset; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'week', label: 'Week' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">
      {/* Header */}
      <div className="shrink-0 px-3 pt-3 pb-2 space-y-2 border-b border-border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text">Global History</span>
          <Tip label="Refresh" side="bottom">
            <button
              onClick={loadAll}
              disabled={allEntriesLoading}
              className="p-1 rounded hover:bg-muted text-comment hover:text-text transition-colors disabled:opacity-50"
            >
              {allEntriesLoading
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />}
            </button>
          </Tip>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-comment/70 pointer-events-none" />
          <input
            type="text"
            placeholder="Search URL, method, file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full bg-panel pl-6 pr-6 py-1.5 text-xs  border border-border rounded focus:outline-none focus:border-active text-text placeholder:text-comment/60"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-comment/60 hover:text-text"
            >
              <X size={10} />
            </button>
          )}
        </div>

        {/* Date presets */}
        <div className="flex items-center gap-1">
          {presets.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setDatePreset(key);
                setShowCustomDate(key === 'custom');
              }}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors border
                ${datePreset === key
                  ? 'bg-active border-border text-text'
                  : 'bg-transparent border-border text-comment hover:bg-muted/40 hover:text-text'
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {showCustomDate && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex-1 px-2 py-1 text-[10px] bg-muted/40 border border-border rounded focus:outline-none focus:border-active text-text"
            />
            <span className="text-[10px] text-comment">—</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex-1 px-2 py-1 text-[10px] bg-muted/40 border border-border rounded focus:outline-none focus:border-active text-text"
            />
          </div>
        )}
      </div>

      {/* Toolbar row — same pattern as HistorySidebar */}
      {allEntries.length > 0 && (
        <div className="flex items-center px-3 pt-2 pb-0.5 shrink-0 gap-2">
          {isSelecting ? (
            <>
              <button
                onClick={() => {
                  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
                  setSelectedIds(allSelected ? new Set() : new Set(filtered.map((e) => e.id)));
                }}
                className="flex items-center gap-1 text-[10px] text-comment hover:text-text transition-colors"
              >
                {filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id))
                  ? <><CheckSquare size={11} className="text-accent" /><span>Deselect all</span></>
                  : <><Square size={11} /><span>Select all</span></>}
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
                    onClick={handleExportAll}
                    disabled={isBusy || filtered.length === 0}
                    className="w-full text-left px-3 py-1.5 text-text hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-40"
                  >
                    {isBusy ? <Loader2 size={11} className="animate-spin text-accent" /> : <Download size={11} className="text-accent" />} Export all
                  </button>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={() => { handleClearAll(); setMenuOpen(false); }}
                    disabled={isBusy || allEntries.length === 0}
                    className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-40"
                  >
                    <Trash2 size={11} /> Clear all
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
            onClick={handleExportSelected}
            disabled={isBusy}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border text-comment hover:text-text hover:border-border/80 transition-colors disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />} Export ({selectedIds.size})
          </button>
          <button
            onClick={handleClearSelected}
            disabled={isBusy}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
          >
            <Trash2 size={10} /> Clear ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2">
        {allEntriesLoading && allEntries.length === 0 ? (
          <div className="flex items-center justify-center h-24 gap-2 text-comment text-xs">
            <Loader2 size={14} className="animate-spin" />
            Loading history…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-comment text-xs gap-1">
            <p>{allEntries.length === 0 ? 'No history yet.' : 'No matching entries.'}</p>
          </div>
        ) : (
          Array.from(groups.entries()).map(([label, entries]) => {
            const collapsed = collapsedGroups.has(label);
            return (
              <div key={label} className="mb-2">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(label)}
                  className="flex items-center gap-1 w-full px-3 py-1 hover:bg-muted/30 text-left"
                >
                  {collapsed
                    ? <ChevronRight size={10} className="text-comment shrink-0" />
                    : <ChevronDown size={10} className="text-comment shrink-0" />}
                  <span className="text-[10px] uppercase tracking-wide text-comment">
                    {label}
                  </span>
                  <span className="ml-auto text-[10px] text-comment/60">{entries.length}</span>
                </button>

                {!collapsed && entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    query={query}
                    copiedId={copiedId}
                    projectPath={projectPath}
                    isSelected={selectedIds.has(entry.id)}
                    isSelecting={isSelecting}
                    onToggleSelect={handleToggleSelect}
                    onReplay={handleReplay}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Footer count */}
      {!allEntriesLoading && filtered.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 border-t border-border text-[10px] text-comment/60">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          {query || datePreset !== 'all' ? ` (filtered from ${allEntries.length})` : ''}
        </div>
      )}
    </div>
  );
};
