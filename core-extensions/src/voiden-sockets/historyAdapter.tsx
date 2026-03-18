/**
 * Socket History Adapter
 *
 * Registered with core's historyAdapterRegistry on plugin load.
 * Owns everything history-related for WebSocket and gRPC sessions.
 *
 *   - canHandle()      — always false (sockets save history directly at session end, not via pipeline)
 *   - captureEntry()   — unused for sockets (placeholder to satisfy the interface)
 *   - exportToVoid()   — produces a .void markdown string using socket nodes (socket-request, proto, headers-table)
 *   - RequestViewer    — React component showing connection URL, headers, gRPC meta
 *   - ResponseViewer   — React component rendering the message log (WS bubbles or gRPC stream items)
 */

import React, { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Radio, AlertCircle, Wifi, WifiOff } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SocketRequestState {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  grpcMeta?: {
    service?: string;
    method?: string;
    callType?: string;
    package?: string;
    protoFilePath?: string;
    services?: any[];
  };
}

export interface SocketResponseState {
  body?: string;
  error?: string | null;
  timing?: { duration?: number };
}

// ─── Message type helpers ─────────────────────────────────────────────────────

type WsItem =
  | { kind: 'system-open'; ts: number; url?: string | null }
  | { kind: 'system-close'; ts: number; code?: number; reason?: string }
  | { kind: 'system-error'; ts: number; message: string }
  | { kind: 'system-pause'; ts: number; reason?: string }
  | { kind: 'sent'; ts: number; data: any }
  | { kind: 'recv'; ts: number; data: any };

type GrpcItem =
  | { kind: 'stream-open'; ts: number; target?: string; method?: string; callType?: string }
  | { kind: 'stream-data'; ts: number; data: any; type: 'request' | 'response' }
  | { kind: 'stream-response'; ts: number; data: any }
  | { kind: 'stream-error'; ts: number; error: string; code?: number; details?: string }
  | { kind: 'stream-end'; ts: number; reason?: string }
  | { kind: 'stream-cancelled'; ts: number }
  | { kind: 'stream-closed'; ts: number }
  | { kind: 'unary-response'; ts: number; data: any; duration?: number };

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function formatData(data: any): { text: string; isJson: boolean } {
  if (data === undefined || data === null) return { text: '', isJson: false };
  if (typeof data === 'string') {
    try {
      return { text: JSON.stringify(JSON.parse(data), null, 2), isJson: true };
    } catch {
      return { text: data, isJson: false };
    }
  }
  return { text: JSON.stringify(data, null, 2), isJson: true };
}

function parseMessages(body: string | undefined): any[] {
  if (!body) return [];
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function MessageBubble({ direction, ts, data, label }: {
  direction: 'sent' | 'received';
  ts: number;
  data: any;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const { text } = formatData(data);
  const isSent = direction === 'sent';
  const lines = text.split('\n');
  const isLong = lines.length > 8;

  return (
    <div className={`flex flex-col gap-0.5 ${isSent ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-1">
        {isSent ? <ArrowUpRight size={9} className="text-blue-400" /> : <ArrowDownLeft size={9} className="text-green-400" />}
        <span className="text-[9px] text-comment font-mono">{label ?? (isSent ? 'sent' : 'recv')} · {formatTime(ts)}</span>
      </div>
      <div
        className={`relative rounded px-2 py-1.5 text-[10px] font-mono break-all max-w-full w-full
          ${isSent ? 'bg-blue-500/10 text-blue-200 border border-blue-500/20' : 'bg-green-500/10 text-green-200 border border-green-500/20'}
          ${isLong ? 'cursor-pointer' : ''}`}
        onClick={() => isLong && setExpanded((v) => !v)}
      >
        <pre className={`whitespace-pre-wrap break-all text-[10px] leading-relaxed ${isLong && !expanded ? 'line-clamp-4' : ''}`}>
          {text || <span className="italic text-comment">empty</span>}
        </pre>
        {isLong && (
          <span className="text-[9px] text-comment absolute bottom-1 right-2">
            {expanded ? '▲ collapse' : '▼ expand'}
          </span>
        )}
      </div>
    </div>
  );
}

function SystemRow({ icon, text, ts, variant = 'default' }: {
  icon: React.ReactNode;
  text: string;
  ts?: number;
  variant?: 'default' | 'error' | 'success';
}) {
  const color = variant === 'error' ? 'text-red-400' : variant === 'success' ? 'text-green-400' : 'text-comment';
  return (
    <div className={`flex items-center gap-1.5 py-1 px-1 text-[9px] font-mono ${color}`}>
      {icon}
      <span className="flex-1">{text}</span>
      {ts !== undefined && <span className="text-[9px] text-comment shrink-0">{formatTime(ts)}</span>}
    </div>
  );
}

function WsRenderer({ messages }: { messages: WsItem[] }) {
  const dataMessages = messages.filter((m) => m.kind === 'sent' || m.kind === 'recv');
  return (
    <div className="space-y-1.5">
      {messages.map((item, i) => {
        switch (item.kind) {
          case 'system-open': return <SystemRow key={i} icon={<Wifi size={9} />} text="Connected" ts={item.ts} variant="success" />;
          case 'system-close': return <SystemRow key={i} icon={<WifiOff size={9} />} text={`Closed${item.reason ? ` · ${item.reason}` : ''}${item.code ? ` (${item.code})` : ''}`} ts={item.ts} />;
          case 'system-error': return <SystemRow key={i} icon={<AlertCircle size={9} />} text={item.message} ts={item.ts} variant="error" />;
          case 'system-pause': return <SystemRow key={i} icon={<Radio size={9} />} text={`Paused${item.reason ? ` · ${item.reason}` : ''}`} ts={item.ts} />;
          case 'sent': return <MessageBubble key={i} direction="sent" ts={item.ts} data={item.data} />;
          case 'recv': return <MessageBubble key={i} direction="received" ts={item.ts} data={item.data} />;
          default: return null;
        }
      })}
      {dataMessages.length === 0 && <p className="text-[10px] text-comment italic px-1">No messages exchanged</p>}
    </div>
  );
}

function GrpcRenderer({ messages, grpcMeta }: { messages: GrpcItem[]; grpcMeta?: SocketRequestState['grpcMeta'] }) {
  return (
    <div className="space-y-1.5">
      {grpcMeta?.service && (
        <div className="text-[9px] font-mono text-comment bg-muted/40 rounded px-2 py-1 flex items-center gap-1.5 flex-wrap">
          <span className="text-accent">{grpcMeta.package ? `${grpcMeta.package}.${grpcMeta.service}` : grpcMeta.service}</span>
          <span>/</span>
          <span className="text-text">{grpcMeta.method}</span>
          {grpcMeta.callType && (
            <span className="ml-auto bg-muted/60 rounded px-1 py-0.5 text-[8px] uppercase tracking-wide">{grpcMeta.callType}</span>
          )}
        </div>
      )}
      {messages.map((item, i) => {
        switch (item.kind) {
          case 'stream-open': return <SystemRow key={i} icon={<Wifi size={9} />} text={`Stream opened${item.method ? ` · ${item.method}` : ''}`} ts={item.ts} variant="success" />;
          case 'stream-data': return <MessageBubble key={i} direction={item.type === 'request' ? 'sent' : 'received'} ts={item.ts} data={item.data} label={item.type === 'request' ? 'request' : 'response'} />;
          case 'stream-response': return <MessageBubble key={i} direction="received" ts={item.ts} data={item.data} label="response" />;
          case 'unary-response': return <MessageBubble key={i} direction="received" ts={item.ts} data={item.data} label={item.duration ? `response · ${item.duration}ms` : 'response'} />;
          case 'stream-error': return <SystemRow key={i} icon={<AlertCircle size={9} />} text={`Error: ${item.error}${item.details ? ` · ${item.details}` : ''}${item.code !== undefined ? ` (${item.code})` : ''}`} ts={item.ts} variant="error" />;
          case 'stream-end': return <SystemRow key={i} icon={<WifiOff size={9} />} text={`Stream ended${item.reason ? ` · ${item.reason}` : ''}`} ts={item.ts} />;
          case 'stream-cancelled': return <SystemRow key={i} icon={<WifiOff size={9} />} text="Stream cancelled" ts={item.ts} />;
          case 'stream-closed': return <SystemRow key={i} icon={<WifiOff size={9} />} text="Stream closed" ts={item.ts} />;
          default: return null;
        }
      })}
    </div>
  );
}

// ─── RequestViewer ────────────────────────────────────────────────────────────

export const SocketRequestViewer: React.FC<{ requestState: unknown }> = ({ requestState }) => {
  const req = requestState as SocketRequestState | null;
  if (!req) return <p style={{ fontSize: 11, color: 'var(--color-comment)', padding: 8 }}>No request data.</p>;

  const isGrpc = /^GRPCS?$/.test(req.method ?? '');

  return (
    <div style={{ padding: '8px 12px', fontSize: 11 }}>
      <div style={{
        fontFamily: 'monospace', fontSize: 11,
        background: 'rgba(255,255,255,0.04)', borderRadius: 4,
        padding: '6px 8px', wordBreak: 'break-all',
        color: 'var(--color-text)', marginBottom: 8,
      }}>
        <span style={{ color: 'var(--color-accent)', marginRight: 6 }}>{req.method}</span>
        {req.url}
      </div>

      {isGrpc && req.grpcMeta?.service && (
        <div style={{
          fontFamily: 'monospace', fontSize: 10,
          background: 'rgba(255,255,255,0.04)', borderRadius: 4,
          padding: '4px 8px', marginBottom: 8, color: 'var(--color-comment)',
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--color-accent)' }}>
            {req.grpcMeta.package ? `${req.grpcMeta.package}.${req.grpcMeta.service}` : req.grpcMeta.service}
          </span>
          <span>/</span>
          <span style={{ color: 'var(--color-text)' }}>{req.grpcMeta.method}</span>
          {req.grpcMeta.callType && (
            <span style={{ marginLeft: 'auto', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {req.grpcMeta.callType}
            </span>
          )}
        </div>
      )}

      {req.headers && req.headers.length > 0 && (
        <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
          <div style={{ fontSize: 10, color: 'var(--color-comment)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 4 }}>
            Headers ({req.headers.length})
          </div>
          {req.headers.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'var(--color-comment)', minWidth: 120, flexShrink: 0 }}>{h.key}</span>
              <span style={{ color: 'var(--color-text)', wordBreak: 'break-all' }}>{h.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── ResponseViewer ───────────────────────────────────────────────────────────

export const SocketResponseViewer: React.FC<{ responseState: unknown; requestState?: unknown }> = ({ responseState, requestState }) => {
  const res = responseState as SocketResponseState | null;
  const req = requestState as SocketRequestState | null;
  if (!res) return <p style={{ fontSize: 11, color: 'var(--color-comment)', padding: 8 }}>No response data.</p>;

  const method = (req?.method ?? '').toUpperCase();
  const isGrpc = /^GRPCS?$/.test(method);
  const messages = parseMessages(res.body);

  return (
    <div style={{ padding: '8px 12px' }}>
      {res.error && (
        <div style={{
          fontSize: 10, color: '#f87171',
          background: 'rgba(248,113,113,0.1)',
          borderRadius: 4, padding: '6px 8px',
          wordBreak: 'break-all', marginBottom: 8,
        }}>
          {res.error}
        </div>
      )}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
        {isGrpc
          ? <GrpcRenderer messages={messages as GrpcItem[]} grpcMeta={req?.grpcMeta} />
          : <WsRenderer messages={messages as WsItem[]} />
        }
      </div>
    </div>
  );
};

// ─── exportToVoid ─────────────────────────────────────────────────────────────

async function exportToVoid(entry: any): Promise<string> {
  const req = (entry.requestState ?? entry.request) as SocketRequestState | undefined;
  if (!req) return '';

  const method = (req.method ?? '').toUpperCase();
  const isGrpc = /^GRPCS?$/.test(method);

  const socketRequestContent: any[] = [
    {
      type: 'smethod',
      attrs: { method, importedFrom: '', visible: true },
      content: [{ type: 'text', text: method }],
    },
    {
      type: 'surl',
      content: [{ type: 'text', text: req.url }],
    },
  ];

  if (isGrpc) {
    const grpcMeta = req.grpcMeta ?? {};
    const protoFilePath = grpcMeta.protoFilePath ?? null;
    const protoFileName = protoFilePath ? protoFilePath.split('/').pop() ?? null : null;
    socketRequestContent.push({
      type: 'proto',
      attrs: {
        fileName: protoFileName,
        filePath: protoFilePath,
        packageName: grpcMeta.package || null,
        services: grpcMeta.services ?? [],
        selectedService: grpcMeta.service || null,
        selectedMethod: grpcMeta.method || null,
        callType: grpcMeta.callType || null,
      },
    });
  }

  const docContent: any[] = [
    { type: 'socket-request', content: socketRequestContent },
  ];

  if (req.headers && req.headers.length > 0) {
    docContent.push({
      type: 'headers-table',
      content: [{
        type: 'table',
        content: req.headers.map((h) => ({
          type: 'tableRow',
          attrs: { disabled: false },
          content: [h.key, h.value].map((col) => ({
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: col ? [{ type: 'text', text: col }] : [] }],
          })),
        })),
      }],
    });
  }

  const doc = { type: 'doc', content: docContent };

  // @ts-ignore - Path resolved at runtime in app context
  const { prosemirrorToMarkdown } = await import(/* @vite-ignore */ '@/core/file-system/hooks/useFileSystem');
  // @ts-ignore - Path resolved at runtime in app context
  const { getSchema } = await import(/* @vite-ignore */ '@tiptap/core');
  // @ts-ignore - Path resolved at runtime in app context
  const { voidenExtensions } = await import(/* @vite-ignore */ '@/core/editors/voiden/extensions');
  // @ts-ignore - Path resolved at runtime in app context
  const { useEditorEnhancementStore } = await import(/* @vite-ignore */ '@/plugins');
  const pluginExts = useEditorEnhancementStore.getState().voidenExtensions;
  const fullSchema = getSchema([...voidenExtensions, ...pluginExts]);

  return prosemirrorToMarkdown(JSON.stringify(doc), fullSchema);
}

// ─── Adapter export ───────────────────────────────────────────────────────────

export const socketHistoryAdapter = {
  pluginId: 'voiden-sockets',

  /** Sockets bypass the request pipeline and save history at session end — never called via pipeline. */
  canHandle(_ctx: any): boolean {
    return false;
  },

  /** Not used — sockets save entries directly via historyHelper. */
  async captureEntry(_ctx: any) {
    return {
      meta: { label: '', url: '', connectionMade: false },
      requestState: {},
      responseState: {},
    };
  },

  exportToVoid,

  RequestViewer: SocketRequestViewer,
  ResponseViewer: SocketResponseViewer,
};
