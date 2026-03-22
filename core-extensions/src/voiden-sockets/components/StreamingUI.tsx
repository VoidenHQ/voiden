/**
 * Shared Streaming UI Components
 *
 * Unified components for WebSocket and gRPC message rendering.
 * Used by MessagesNode, gRPCMessageNode, and SocketHistoryRenderer.
 */

import React, { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type StreamDirection = 'sent' | 'received';

export interface StreamMessage {
  direction: StreamDirection;
  ts: number;
  data: any;
  label?: string;       // e.g. "sent", "recv", "request", "response", "Final Response"
  durationLabel?: string; // e.g. "142ms"
  format?: string;       // detected: json, xml, html, text, buffer, binary
  size?: number;         // bytes
}

export interface StreamEvent {
  kind: 'connected' | 'disconnected' | 'error' | 'paused' | 'ended' | 'cancelled' | 'info';
  ts: number;
  message: string;
  details?: string;
}

export type StreamItem =
  | { type: 'message'; item: StreamMessage }
  | { type: 'event'; item: StreamEvent };

// ── Helpers ────────────────────────────────────────────────────────────────────

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function formatDataSimple(data: any): { text: string; isJson: boolean } {
  if (data === undefined || data === null) return { text: '', isJson: false };
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { text: data, isJson: false };
    }
  }
  try {
    return { text: JSON.stringify(data, null, 2), isJson: true };
  } catch {
    return { text: String(data), isJson: false };
  }
}

// ── StreamMessageRow ───────────────────────────────────────────────────────────

export function StreamMessageRow({
  message,
  onCopy,
  isCopied,
}: {
  message: StreamMessage;
  onCopy?: () => void;
  isCopied?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const { text } = formatDataSimple(message.data);
  const isSent = message.direction === 'sent';
  const lines = text.split('\n');
  const isLong = lines.length > 8;

  const label = message.label ?? (isSent ? 'sent' : 'recv');
  const timeStr = formatTime(message.ts);

  return (
    <div className="group relative py-[5px] px-[10px] hover:bg-[rgba(255,255,255,0.04)]">
      {/* Meta line */}
      <div className="flex items-center gap-[5px] mb-[2px]">
        <span
          className="text-[11px] w-[12px] text-center flex-shrink-0"
          style={{ color: isSent ? 'var(--info, #7dc4e4)' : 'var(--success, #7fd0b2)' }}
        >
          {isSent ? '↗' : '↙'}
        </span>
        <span className="text-[11px] text-comment font-mono">
          {label} · {timeStr}
          {message.durationLabel && <span className="text-comment opacity-70"> · {message.durationLabel}</span>}
          {message.format && message.format !== 'text' && <span className="text-comment opacity-70"> · {message.format}</span>}
          {message.size && <span className="text-comment opacity-70"> · {message.size} bytes</span>}
        </span>
      </div>

      {/* Content */}
      <div className="ml-[17px] relative">
        <pre
          className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text
            px-2 py-1.5 rounded
            ${isLong ? 'cursor-pointer' : ''}
            ${isLong && !expanded ? 'overflow-hidden' : ''}`}
          style={{
            background: 'var(--ui-surface, var(--bg-surface, rgba(255,255,255,0.04)))',
            border: '1px solid var(--ui-line, var(--border, rgba(255,255,255,0.06)))',
            ...(isLong && !expanded ? { maxHeight: '72px' } : {}),
          }}
          onClick={() => isLong && setExpanded((v) => !v)}
        >
          {text || <span className="italic text-comment">empty</span>}
        </pre>

        {/* Copy button */}
        {onCopy && (
          <button
            onClick={onCopy}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity
              px-[6px] py-[2px] text-[10px] font-mono text-comment
              bg-bg border border-border rounded cursor-pointer
              hover:text-accent hover:border-accent"
          >
            {isCopied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
          </button>
        )}

        {/* Expand toggle */}
        {isLong && (
          <div
            className="text-[10px] text-comment cursor-pointer hover:text-accent mt-[2px] select-none"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▲ collapse' : `▼ expand (${lines.length} lines)`}
          </div>
        )}
      </div>
    </div>
  );
}

// ── StreamEventRow ─────────────────────────────────────────────────────────────

const EVENT_STYLES: Record<StreamEvent['kind'], { color: string; icon: string }> = {
  connected:    { color: 'var(--success, #7fd0b2)', icon: '◉' },
  disconnected: { color: 'var(--fg-secondary, #7f8aa3)', icon: '○' },
  error:        { color: 'var(--error, #ee8da0)', icon: '✕' },
  paused:       { color: 'var(--fg-secondary, #7f8aa3)', icon: '⏸' },
  ended:        { color: 'var(--fg-secondary, #7f8aa3)', icon: '□' },
  cancelled:    { color: 'var(--fg-secondary, #7f8aa3)', icon: '✕' },
  info:         { color: 'var(--fg-secondary, #7f8aa3)', icon: '⋯' },
};

export function StreamEventRow({ event }: { event: StreamEvent }) {
  const style = EVENT_STYLES[event.kind] || EVENT_STYLES.info;
  const timeStr = event.ts ? formatTime(event.ts) : '';

  return (
    <div
      className="flex items-center gap-[6px] py-1 px-[10px] text-[11px] font-mono"
      style={{ color: style.color }}
    >
      <span className="text-[9px] w-[12px] text-center flex-shrink-0">{style.icon}</span>
      <span className="flex-1 truncate">{event.message}</span>
      {timeStr && <span className="text-[10px] flex-shrink-0 opacity-70">{timeStr}</span>}
    </div>
  );
}

// ── StreamStatsBar ─────────────────────────────────────────────────────────────

export function StreamStatsBar({ items }: { items: StreamItem[] }) {
  let total = 0;
  let sent = 0;
  let received = 0;
  let errors = 0;

  for (const item of items) {
    if (item.type === 'message') {
      total++;
      if (item.item.direction === 'sent') sent++;
      else received++;
    } else if (item.type === 'event' && item.item.kind === 'error') {
      errors++;
    }
  }

  if (total === 0 && errors === 0) return null;

  return (
    <span className="text-[10px] text-comment font-mono flex-shrink-0">
      {total} messages
      {sent > 0 && <> · {sent} ↑</>}
      {received > 0 && <> · {received} ↓</>}
      {errors > 0 && <span style={{ color: 'var(--error, #ee8da0)' }}> · {errors} errors</span>}
    </span>
  );
}

// ── StreamExportMenu ───────────────────────────────────────────────────────────

export function StreamExportMenu({
  onExportJSON,
  onExportCSV,
  hasMessages,
}: {
  onExportJSON: () => void;
  onExportCSV: () => void;
  hasMessages: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!hasMessages) return null;

  return (
    <div className="relative">
      <button
        className="px-2 py-[3px] text-[10px] font-semibold font-mono text-comment
          bg-transparent border-none cursor-pointer rounded
          hover:text-accent hover:bg-[rgba(255,255,255,0.04)]
          transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{ letterSpacing: '0.3px' }}
      >
        Export ↓
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 border border-border rounded overflow-hidden"
          style={{ background: 'var(--bg-secondary, #121c31)' }}
        >
          <button
            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-mono text-comment
              bg-transparent border-none cursor-pointer hover:text-accent hover:bg-[rgba(255,255,255,0.04)]
              transition-colors whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              onExportJSON();
              setOpen(false);
            }}
          >
            <Download size={11} /> JSON
          </button>
          <button
            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-mono text-comment
              bg-transparent border-none cursor-pointer hover:text-accent hover:bg-[rgba(255,255,255,0.04)]
              transition-colors whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              onExportCSV();
              setOpen(false);
            }}
          >
            <Download size={11} /> CSV
          </button>
        </div>
      )}
    </div>
  );
}

// ── Collapsible Stream Header ──────────────────────────────────────────────────

export function StreamHeader({
  expanded,
  onToggle,
  protocol,
  callTypeIcon,
  methodLabel,
  items,
  statusDot,
  statusText,
  actions,
}: {
  expanded: boolean;
  onToggle: () => void;
  protocol: string;
  callTypeIcon?: React.ReactNode;
  methodLabel?: string;
  items: StreamItem[];
  statusDot: 'connected' | 'error' | 'closed' | 'ready' | 'loading';
  statusText: string;
  actions?: React.ReactNode;
}) {
  const dotColors: Record<string, string> = {
    connected: 'var(--success, #7fd0b2)',
    error: 'var(--error, #ee8da0)',
    closed: 'var(--fg-secondary, #7f8aa3)',
    ready: 'var(--info, #7dc4e4)',
    loading: 'var(--warning, #d7b56d)',
  };

  return (
    <div
      className={`flex items-center gap-2 py-[7px] px-[10px] cursor-pointer select-none
        border-b border-border transition-colors
        ${expanded ? 'bg-panel' : 'bg-bg'} hover:bg-panel`}
      onClick={onToggle}
    >
      {/* Chevron */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className="text-comment flex-shrink-0"
        style={{
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s',
        }}
      >
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Call type icon */}
      {callTypeIcon && <span className="flex-shrink-0">{callTypeIcon}</span>}

      {/* Protocol label */}
      <span className="text-[12px] font-bold text-text flex-shrink-0">{protocol}</span>

      {/* Method label */}
      {methodLabel && (
        <span className="text-[11px] text-comment font-mono flex-shrink-0">{methodLabel}</span>
      )}

      {/* Stats */}
      <StreamStatsBar items={items} />

      {/* Spacer */}
      <span className="flex-1" />

      {/* Status */}
      <span className="flex items-center gap-[5px] text-[11px] text-comment font-mono flex-shrink-0">
        <span
          className="w-[6px] h-[6px] rounded-full flex-shrink-0"
          style={{
            background: dotColors[statusDot] || dotColors.closed,
            opacity: statusDot === 'closed' ? 0.5 : 1,
          }}
        />
        {statusText}
      </span>

      {/* Actions */}
      {actions && (
        <span className="flex items-center gap-[2px] ml-2">{actions}</span>
      )}
    </div>
  );
}

// ── Stream Action Button ───────────────────────────────────────────────────────

export function StreamActionBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`px-2 py-[3px] text-[10px] font-semibold font-mono text-comment
        bg-transparent border-none cursor-pointer rounded transition-colors
        ${danger ? 'hover:text-red-400' : 'hover:text-accent'}
        hover:bg-[rgba(255,255,255,0.04)]`}
      onClick={onClick}
      style={{ letterSpacing: '0.3px' }}
    >
      {children}
    </button>
  );
}
