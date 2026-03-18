import React, { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Radio, AlertCircle, Wifi, WifiOff } from 'lucide-react';

interface HistoryEntry {
  request: {
    method: string;
    url: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    grpcMeta?: {
      service: string;
      method: string;
      callType: string;
      package: string;
    };
  };
  response: {
    body?: string;
    error?: string | null;
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

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
      const parsed = JSON.parse(data);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
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

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  direction,
  ts,
  data,
  label,
}: {
  direction: 'sent' | 'received';
  ts: number;
  data: any;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const { text, isJson } = formatData(data);
  const isSent = direction === 'sent';
  const lines = text.split('\n');
  const isLong = lines.length > 8;

  return (
    <div className={`flex flex-col gap-0.5 ${isSent ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-1">
        {isSent ? (
          <ArrowUpRight size={9} className="text-blue-400" />
        ) : (
          <ArrowDownLeft size={9} className="text-green-400" />
        )}
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

// ── System event row ───────────────────────────────────────────────────────────

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
      <span className="flex-1 truncate">{text}</span>
      {ts !== undefined && <span className="text-[9px] text-comment shrink-0">{formatTime(ts)}</span>}
    </div>
  );
}

// ── WebSocket renderer ─────────────────────────────────────────────────────────

function WsRenderer({ messages }: { messages: WsItem[] }) {
  const dataMessages = messages.filter((m) => m.kind === 'sent' || m.kind === 'recv');
  const total = dataMessages.length;

  return (
    <div className="space-y-1.5">
      {messages.map((item, i) => {
        switch (item.kind) {
          case 'system-open':
            return <SystemRow key={i} icon={<Wifi size={9} />} text="Connected" ts={item.ts} variant="success" />;
          case 'system-close':
            return <SystemRow key={i} icon={<WifiOff size={9} />} text={`Closed${item.reason ? ` · ${item.reason}` : ''}${item.code ? ` (${item.code})` : ''}`} ts={item.ts} />;
          case 'system-error':
            return <SystemRow key={i} icon={<AlertCircle size={9} />} text={item.message} ts={item.ts} variant="error" />;
          case 'system-pause':
            return <SystemRow key={i} icon={<Radio size={9} />} text={`Paused${item.reason ? ` · ${item.reason}` : ''}`} ts={item.ts} />;
          case 'sent':
            return <MessageBubble key={i} direction="sent" ts={item.ts} data={item.data} />;
          case 'recv':
            return <MessageBubble key={i} direction="received" ts={item.ts} data={item.data} />;
          default:
            return null;
        }
      })}
      {total === 0 && <p className="text-[10px] text-comment italic px-1">No messages exchanged</p>}
    </div>
  );
}

// ── gRPC renderer ──────────────────────────────────────────────────────────────

function GrpcRenderer({ messages, grpcMeta }: { messages: GrpcItem[]; grpcMeta?: any }) {
  return (
    <div className="space-y-1.5">
      {/* gRPC method info */}
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
          case 'stream-open':
            return <SystemRow key={i} icon={<Wifi size={9} />} text={`Stream opened${item.method ? ` · ${item.method}` : ''}`} ts={item.ts} variant="success" />;
          case 'stream-data':
            return (
              <MessageBubble
                key={i}
                direction={item.type === 'request' ? 'sent' : 'received'}
                ts={item.ts}
                data={item.data}
                label={item.type === 'request' ? 'request' : 'response'}
              />
            );
          case 'stream-response':
            return <MessageBubble key={i} direction="received" ts={item.ts} data={item.data} label="response" />;
          case 'unary-response':
            return <MessageBubble key={i} direction="received" ts={item.ts} data={item.data} label={item.duration ? `response · ${item.duration}ms` : 'response'} />;
          case 'stream-error':
            return (
              <SystemRow
                key={i}
                icon={<AlertCircle size={9} />}
                text={`Error: ${item.error}${item.details ? ` · ${item.details}` : ''}${item.code !== undefined ? ` (${item.code})` : ''}`}
                ts={item.ts}
                variant="error"
              />
            );
          case 'stream-end':
            return <SystemRow key={i} icon={<WifiOff size={9} />} text={`Stream ended${item.reason ? ` · ${item.reason}` : ''}`} ts={item.ts} />;
          case 'stream-cancelled':
            return <SystemRow key={i} icon={<WifiOff size={9} />} text="Stream cancelled" ts={item.ts} />;
          case 'stream-closed':
            return <SystemRow key={i} icon={<WifiOff size={9} />} text="Stream closed" ts={item.ts} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function SocketHistoryRenderer({ entry }: { entry: HistoryEntry }) {
  const method = (entry.request.method ?? '').toUpperCase();
  const isGrpc = method === 'GRPC' || method === 'GRPCS';
  const messages = parseMessages(entry.response.body);

  return (
    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
      {entry.response.error && (
        <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1.5 break-all">
          {entry.response.error}
        </div>
      )}
      {isGrpc ? (
        <GrpcRenderer messages={messages as GrpcItem[]} grpcMeta={entry.request.grpcMeta} />
      ) : (
        <WsRenderer messages={messages as WsItem[]} />
      )}
    </div>
  );
}
