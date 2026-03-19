/**
 * Messages Node
 *
 * Lightweight chat-style viewer for interactions.
 * - Listens for ws-open, ws-message, ws-close, ws-error (via window.electron.request.listenSecure)
 * - Shows a simple "chat" with input + SEND button and a running message/event log
 * - Distinguishes events with icons and colors
 * - NEW: Copy individual messages & Export all to CSV
 *
 * Expected globals from preload:
 *   window.electron.request.listenSecure(eventName, (e, d) => {...})
 *   window.electron.request.sendMessage(wsId, data)
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PluginContext } from "@voiden/sdk";
import { Play, Square, X, CornerDownLeft, CornerDownRight, Copy, Download, Check, AlertCircle } from "lucide-react";
import { saveSessionToHistory } from '../lib/historyHelper';

// What we accept as node attributes
export interface MessagesAttrs {
  wsId?: string | null;
  url?: string | null;
  /** JSON-serialised Array<{ key: string; value: string }> — connection headers */
  headers?: string | null;
  /** Absolute path of the source .void file — used for history tagging */
  sourceFilePath?: string | null;
}

type ChatItem =
  | { kind: "system-open"; ts: number; wsId: string; url?: string | null }
  | { kind: "system-pause"; ts: number; wsId: string; url?: string | null, code?: number, reason?: string, message?: string }
  | { kind: "system-close"; ts: number; wsId: string; code?: number; reason?: string; wasClean?: boolean }
  | { kind: "system-error"; ts: number; wsId?: string; message: string; code?: any; cause?: any; name?: string }
  | { kind: "recv"; ts: number; wsId: string; data: any }
  | { kind: "sent"; ts: number; wsId: string; data: any };

function formatTime(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  } catch {
    return "";
  }
}

function formatFullDateTime(ts: number) {
  try {
    const d = new Date(ts);
    return d.toISOString();
  } catch {
    return "";
  }
}

// Enhanced data renderer
interface RenderResult {
  text: string;
  type: 'text' | 'json' | 'xml' | 'html' | 'binary' | 'base64' | 'buffer' | 'error';
  isFormatted: boolean;
  originalSize?: number;
}

function dataToRenderableText(data: any): RenderResult {
  if (data === null) {
    return { text: 'null', type: 'text', isFormatted: false };
  }
  if (data === undefined) {
    return { text: 'undefined', type: 'text', isFormatted: false };
  }

  if (typeof data === 'string') {
    return analyzeAndFormatString(data);
  }

  if (data?.type === "Buffer" && Array.isArray(data.data)) {
    return handleBufferData(data.data);
  }

  if (data instanceof ArrayBuffer) {
    const uint8 = new Uint8Array(data);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
      return analyzeAndFormatString(text);
    } catch {
      return {
        text: `[ArrayBuffer ${data.byteLength} bytes]`,
        type: 'binary',
        isFormatted: false,
        originalSize: data.byteLength
      };
    }
  }

  if (ArrayBuffer.isView(data)) {
    const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
      return analyzeAndFormatString(text);
    } catch {
      return {
        text: `[${data.constructor.name} ${data.byteLength} bytes]`,
        type: 'binary',
        isFormatted: false,
        originalSize: data.byteLength
      };
    }
  }

  if (typeof data === 'object') {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      return {
        text: jsonString,
        type: 'json',
        isFormatted: true,
        originalSize: jsonString.length
      };
    } catch {
      return {
        text: `[Object: ${Object.prototype.toString.call(data)}]`,
        type: 'error',
        isFormatted: false
      };
    }
  }

  return {
    text: String(data),
    type: 'text',
    isFormatted: false
  };
}

function analyzeAndFormatString(str: string): RenderResult {
  const trimmed = str.trim();

  if (!trimmed) {
    return { text: '(empty string)', type: 'text', isFormatted: false };
  }

  // Try JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const formatted = JSON.stringify(parsed, null, 2);
      return {
        text: formatted,
        type: 'json',
        isFormatted: true,
        originalSize: str.length
      };
    } catch { }
  }

  // Try XML/HTML
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return {
      text: str,
      type: trimmed.toLowerCase().includes('<!doctype html') || trimmed.toLowerCase().includes('<html') ? 'html' : 'xml',
      isFormatted: false,
      originalSize: str.length
    };
  }

  return {
    text: str,
    type: 'text',
    isFormatted: false,
    originalSize: str.length
  };
}

function handleBufferData(bufferData: number[]): RenderResult {
  const uint8 = new Uint8Array(bufferData);

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
    const result = analyzeAndFormatString(text);
    return {
      ...result,
      originalSize: bufferData.length
    };
  } catch {
    if (bufferData.length <= 1024) {
      const hex = Array.from(uint8)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      return {
        text: `[Buffer ${bufferData.length} bytes - Hex]\n${hex}`,
        type: 'buffer',
        isFormatted: true,
        originalSize: bufferData.length
      };
    } else {
      const base64 = btoa(String.fromCharCode(...uint8));
      return {
        text: `[Buffer ${bufferData.length} bytes - Base64]\n${base64}`,
        type: 'buffer',
        isFormatted: true,
        originalSize: bufferData.length
      };
    }
  }
}

type MessageFormat = 'text' | 'json' | 'html' | 'xml';

// Module-level deduplication: prevents multiple component instances (e.g. during
// React remount or keep-alive cache churn) from connecting or saving the same session twice.
export const activeWsConnections = new Set<string>(); // wsIds currently being connected
const savedWsSessions = new Set<string>(); // wsIds whose session has been saved this lifecycle

/** Closes all active WS connections — called before initiating a new one. */
export async function closeAllActiveWsConnections(): Promise<void> {
  const ids = Array.from(activeWsConnections);
  await Promise.all(ids.map(async (id) => {
    try {
      await (window as any)?.electron?.request?.closeWss({ wsId: id, code: 4000, reason: 'Reconnecting' });
    } catch { /* best-effort */ }
  }));
}

// Factory function to create the node with context components
export const createMessagesNode = (NodeViewWrapper: any, context: PluginContext) => {
  const MessagesComponent = ({ node }: any) => {
    const attrs = (node.attrs || {}) as MessagesAttrs;
    const [wsId, setWsId] = React.useState<string | null>(attrs.wsId || null);
    const [connected, setConnected] = React.useState<boolean>(false);
    const [isPaused, setIsPaused] = React.useState<boolean>(false);
    const [hasError, setHasError] = React.useState<boolean>(false);
    const [url, setUrl] = React.useState<string | null>(attrs.url || null);
    const [items, setItems] = React.useState<ChatItem[]>([]);
    const isConnected = React.useRef<boolean>(false);

    // Refs for use inside IPC callbacks (avoid stale closure)
    const itemsRef = React.useRef<ChatItem[]>([]);
    React.useEffect(() => { itemsRef.current = items; }, [items]);
    const sessionStartRef = React.useRef<number | null>(null);
    const savedRef = React.useRef<boolean>(false); // prevent duplicate saves per session
    const isReplayRef = React.useRef<boolean>(false); // true while replaying a closed session's events
    const lastErrorRef = React.useRef<string | null>(null); // last ws-error message, included in ws-close save

    const parsedHeaders: Array<{ key: string; value: string }> = React.useMemo(() => {
      try { return JSON.parse(attrs.headers || '[]'); } catch { return []; }
    }, [attrs.headers]);

    const [messageFormat, setMessageFormat] = React.useState<MessageFormat>('text');
    const [messageContent, setMessageContent] = React.useState<string>("");
    const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

    const handleLangChange = (value: MessageFormat) => {
      setMessageFormat(value);
      setMessageContent('');
    }

    const handleMessageChange = (value: string) => {
      setMessageContent(value);
    }

    // Copy individual message
    const handleCopyMessage = async (item: ChatItem, index: number) => {
      try {
        let textToCopy = '';

        if (item.kind === 'sent' || item.kind === 'recv') {
          const result = dataToRenderableText(item.data);
          textToCopy = result.text;
        } else if (item.kind === 'system-error') {
          textToCopy = `ERROR: ${item.message}`;
        } else {
          textToCopy = JSON.stringify(item, null, 2);
        }

        await navigator.clipboard.writeText(textToCopy);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    };

    // Export all messages to CSV
    const handleExportCSV = () => {
      try {
        // CSV header
        const headers = ['Timestamp', 'Type', 'Direction', 'Content', 'Format', 'Size'];
        const rows = [headers];

        // Convert each item to CSV row
        items.forEach(item => {
          const timestamp = formatFullDateTime(item.ts);
          let type = item.kind;
          let direction = '';
          let content = '';
          let format = '';
          let size = '';

          if (item.kind === 'sent' || item.kind === 'recv') {
            direction = item.kind === 'sent' ? 'Outgoing' : 'Incoming';
            const result = dataToRenderableText(item.data);
            content = result.text.replace(/"/g, '""'); // Escape quotes
            format = result.type;
            size = result.originalSize ? `${result.originalSize} bytes` : '';
          } else if (item.kind === 'system-error') {
            content = item.message.replace(/"/g, '""');
          } else if (item.kind === 'system-open') {
            content = `Connected to ${item.url || 'WebSocket'}`;
          } else if (item.kind === 'system-close') {
            content = `Closed: ${item.reason || 'Unknown reason'} (code: ${item.code})`;
          } else if (item.kind === 'system-pause') {
            content = `Paused: ${item.reason || 'Unknown reason'}`;
          }

          rows.push([
            timestamp,
            type,
            direction,
            `"${content}"`,
            format,
            size
          ]);
        });

        // Convert to CSV string
        const csvContent = rows.map(row => row.join(',')).join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `websocket-messages-${Date.now()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to export CSV:', err);
        setItems((prev) => [
          ...prev,
          { kind: "system-error", ts: Date.now(), message: `Export failed: ${err}` }
        ]);
      }
    };

    // Export all messages to JSON
    const handleExportJSON = () => {
      try {
        const exportData = items.map(item => {
          const base = {
            ...item,
            timestamp: formatFullDateTime(item.ts),
            kind: item.kind,
          };

          if (item.kind === 'sent' || item.kind === 'recv') {
            const result = dataToRenderableText(item.data);
            return {
              ...base,
              data: result.text,
              dataType: result.type,
              dataSize: result.originalSize
            };
          }

          return base;
        });

        const jsonContent = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `websocket-messages-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to export JSON:', err);
      }
    };

    // Auto-scroll to bottom on new items
    const listRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [items.length]);

    // Wire up IPC listeners
    React.useEffect(() => {
      const listen = (window as any)?.electron?.request?.listenSecure;
      if (!listen) {
        setItems((prev) => [
          ...prev,
          { kind: "system-error", ts: Date.now(), message: "IPC not available (window.electron.request.listenSecure missing)" },
        ]);
        return;
      }

      const offOpen = listen("ws-open", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setWsId(d.wsId);
          setConnected(true);
          setIsPaused(false);
          setHasError(false);
          if (d?.url && !url) setUrl(d.url);
          if (!sessionStartRef.current) sessionStartRef.current = Date.now();
          // Don't reset for replayed ws-open events (session already closed)
          if (isReplayRef.current) {
            isReplayRef.current = false; // consume the replay flag
          } else {
            savedRef.current = false;
            savedWsSessions.delete(d.wsId); // new live session — allow saving
          }
          lastErrorRef.current = null;
          setItems((prev) => [...prev, { kind: "system-open", ts: Date.now(), wsId: d.wsId, url: d?.url }]);
        }
      });

      const offMsg = listen("ws-message", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setWsId(d.wsId);
          setConnected(true);
          setHasError(false);
          setItems((prev) => [...prev, { kind: "recv", ts: Date.now(), wsId: d.wsId, data: d.data }]);
        }
      });

      const offSent = listen("ws-message-sent", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setWsId(d.wsId);
          setConnected(true);
          setHasError(false);
          setItems((prev) => [...prev, { kind: "sent", ts: Date.now(), wsId: d.wsId, data: d.data }]);
        }
      });

      const offErr = listen("ws-error", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          // Handle cleanup warning separately (don't set hasError)
          if (d?.code === 'CLEANUP_WARNING') {
            setItems((prev) => [
              ...prev,
              {
                kind: "system-error",
                ts: Date.now(),
                wsId: d?.wsId,
                message: d?.message || "Message history cleanup pending",
                code: d?.code,
              },
            ]);
          } else {
            setHasError(true);
            const errorItem: ChatItem = {
              kind: "system-error",
              ts: Date.now(),
              wsId: d?.wsId,
              message: d?.message || "Connection error",
              code: d?.code,
              cause: d?.cause,
              name: d?.name,
            };
            setItems((prev) => [...prev, errorItem]);
            setConnected(false);
            isConnected.current = false;
            lastErrorRef.current = d?.message || 'Connection error';
          }
        }
      });

      const offClose = listen("ws-close", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setConnected(false);
          setIsPaused(false);
          const closeItem: ChatItem = {
            kind: "system-close",
            ts: Date.now(),
            wsId: d.wsId,
            code: d.code,
            reason: d.reason,
            wasClean: d.wasClean,
          };
          setItems((prev) => [...prev, closeItem]);
          isConnected.current = false;

          const wsIdValue = d.wsId as string;
          if (!savedRef.current && !savedWsSessions.has(wsIdValue)) {
            savedRef.current = true;
            savedWsSessions.add(wsIdValue);
            activeWsConnections.delete(wsIdValue);
            saveSessionToHistory(context, {
              method: 'WSS',
              url: attrs.url || '',
              headers: parsedHeaders,
              messages: [...itemsRef.current, closeItem],
              error: lastErrorRef.current ?? undefined,
              sessionStart: sessionStartRef.current ?? undefined,
              sessionEnd: Date.now(),
              sourceFilePath: attrs.sourceFilePath || null,
            });
            lastErrorRef.current = null;
          }
        }
      });

      const offPause = listen("ws-pause", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setConnected(false);
          setIsPaused(true);
          setItems((prev) => [
            ...prev,
            {
              kind: "system-pause",
              ts: Date.now(),
              wsId: d.wsId,
              code: d.code,
              reason: d.reason,
              wasClean: d.wasClean,
            },
          ]);
        }
      });

      return () => {
        try { offOpen && offOpen(); } catch { }
        try { offSent && offSent(); } catch { }
        try { offMsg && offMsg(); } catch { }
        try { offErr && offErr(); } catch { }
        try { offClose && offClose(); } catch { }
        try { offPause && offPause(); } catch { }
      };
    }, []);

    const connectWebSocket = React.useCallback(async () => {
      if (isConnected.current || !wsId) return;
      // Module-level guard: only one component instance may connect per wsId at a time
      if (activeWsConnections.has(wsId)) return;
      activeWsConnections.add(wsId);
      isConnected.current = true;

      try {
        const result = await (window as any)?.electron?.request?.connectWss(wsId);
        
        // Check if the connection is paused
        if (result?.wasPaused) {
          isConnected.current = false;
          activeWsConnections.delete(wsId);
          setConnected(false);
          // Paused messages will be replayed via IPC events
          return;
        }

        // Check if the connection was previously closed
        if (result?.wasClosed) {
          isConnected.current = false;
          activeWsConnections.delete(wsId);
          setConnected(false);
          // Mark as replay so ws-open doesn't reset savedRef, and ws-close doesn't save again
          savedRef.current = true;
          isReplayRef.current = true;
        }
        // else: connection is live — leave activeWsConnections entry until ws-close fires
      } catch (error) {
        isConnected.current = false;
        activeWsConnections.delete(wsId);
        console.error(`Failed to connect WebSocket ${wsId}:`, error);
        setItems((prev) => [
          ...prev,
          {
            kind: "system-error",
            ts: Date.now(),
            wsId,
            message: `Failed to connect: ${error}`
          },
        ]);
      }
    }, [wsId]);

    const handleConnect = async () => {
      if (connected) {
        await (window as any)?.electron?.request?.pauseWss({ wsId, reason: "User paused" });
        isConnected.current = false;
      } else if (isPaused) {
        await (window as any)?.electron?.request?.resumeWss?.(wsId);
        isConnected.current = true;
        setIsPaused(false);
      }
    };

    const handleClose = async () => {
      if (!wsId) return;
      await (window as any)?.electron?.request?.closeWss({ wsId, code: 4000, reason: "User closed connection" });
      isConnected.current = false;
      setConnected(false);
      setIsPaused(false);
    };

    React.useEffect(() => {
      connectWebSocket();
    }, [wsId]);

    const handleSend = React.useCallback(() => {
      const sendMessage = (window as any)?.electron?.request?.sendMessage;
      if (!sendMessage) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "IPC not available (sendMessage missing)" }]);
        return;
      }
      if (!wsId) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "Not connected (Id missing)" }]);
        return;
      }
      const text = messageContent ?? "";
      if (text.trim().length === 0) return;
      setItems((prev) => [...prev, { kind: "sent", ts: Date.now(), wsId, data: text }]);
      setMessageContent("");
      try {
        sendMessage(wsId, text);
      } catch (err: any) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), wsId, message: err?.message || "Failed to send message" }]);
      }
    }, [messageContent, wsId]);

    const statusPill = () => {
      let color = "bg-border";
      let text = "Disconnected";
      if (connected) {
        color = "bg-green-500";
        text = "Connected";
      }
      if (hasError) {
        color = "bg-red-500";
        text = connected ? "Error (Connected)" : "Error";
      }
      return (
        <div className="flex gap-2">
          <span className="flex flex-col items-end text-xs text-comment">
            <div className="flex justify-center items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
              <span className="font-mono">{text}</span>
            </div>
            <div className="flex justify-center items-center gap-2">
              {url && <span className="font-mono text-[11px] opacity-70">• {url}</span>}
              {wsId && <span className="font-mono text-[11px] opacity-70">• id:{wsId.slice(0, 8)}</span>}
            </div>
          </span>

        </div>
      );
    };

    const renderItem = (it: ChatItem, idx: number) => {
      const time = formatTime(it.ts);
      const lineBase = "flex items-start gap-2 px-3 py-1.5 text-sm group relative";
      const isCopied = copiedIndex === idx;

      switch (it.kind) {
        case "system-open":
          return (
            <div key={idx} className={`${lineBase} text-green-400`}>
              <span>●</span>
              <div className="flex-1">
                <div className="font-mono">CONNECTED</div>
                {it.url && <div className="text-xs text-comment">{time} • {it.url}</div>}
              </div>
            </div>
          );
        case "system-pause":
          return (
            <div key={idx} className={`${lineBase} text-yellow-400`}>
              <span>○</span>
              <div className="flex-1">
                <div className="font-mono">PAUSED</div>
                <div className="text-xs text-comment">
                  {time}
                  {typeof it.code === "number" ? ` • code ${it.code}` : ""}
                  {it.reason ? ` • ${it.reason}` : ""}
                </div>
              </div>
            </div>
          );
        case "system-error":
          const isCleanupWarning = it.code === 'CLEANUP_WARNING';
          return (
            <div key={idx} className={`${lineBase} ${isCleanupWarning ? 'text-yellow-400' : 'text-red-400'}`}>
              <span>{isCleanupWarning ? 'ℹ' : '⚠'}</span>
              <div className="flex-1">
                <div className="font-mono">{isCleanupWarning ? 'INFO' : 'ERROR'}</div>
                <div className="text-xs text-comment">
                  {time} • {it.message}
                  {!isCleanupWarning && it.code ? ` • code:${it.code}` : ""}
                  {it.cause ? ` • cause:${it.cause}` : ""}
                </div>
              </div>
              <button
                onClick={() => handleCopyMessage(it, idx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-active rounded"
                title={isCleanupWarning ? "Copy info" : "Copy error"}
              >
                {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </div>
          );
        case "system-close":
          return (
            <div key={idx} className={`${lineBase} text-red-400`}>
              <span>⚠</span>
              <div className="flex-1">
                <div className="font-mono">CLOSED</div>
                <div className="text-xs text-comment">
                  {time} • {it.reason}
                  {it.code ? ` • code:${it.code}` : ""}
                </div>
              </div>
            </div>
          );
        case "sent":
          const sentResult = dataToRenderableText(it.data);
          return (
            <div key={idx} className={`${lineBase} flex justify-start items-center text-text bg-bg`}>
              <span><CornerDownRight size={14} /></span>
              <div className="flex-1">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">{sentResult.text}</pre>
                <div className="text-xs text-comment">
                  {time} • sent
                  {sentResult.type !== 'text' && ` • ${sentResult.type}`}
                  {sentResult.originalSize && ` • ${sentResult.originalSize} bytes`}
                </div>
              </div>
              <button
                onClick={() => handleCopyMessage(it, idx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-active rounded"
                title="Copy message"
                id="ws-button"
              >
                {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </div>
          );
        case "recv":
          const recvResult = dataToRenderableText(it.data);
          return (
            <div key={idx} className={`${lineBase} flex justify-end items-center text-text`}>
              <button
                onClick={() => handleCopyMessage(it, idx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-active rounded"
                title="Copy message"
                id="ws-button"
              >
                {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
              <div className="flex-1">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">{recvResult.text}</pre>
                <div className="text-xs text-comment">
                  {time} • received
                  {recvResult.type !== 'text' && ` • ${recvResult.type}`}
                  {recvResult.originalSize && ` • ${recvResult.originalSize} bytes`}
                </div>
              </div>
              <span><CornerDownLeft size={14} /></span>
            </div>
          );
        default:
          return null;
      }
    };

    if (!wsId) {
      return (
        <NodeViewWrapper>
          <div className="h-full bg-bg flex flex-col items-center justify-center border border-stone-700/80 rounded p-6" style={{ height: '83vh' }}>
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              <span>Incorrect information or URL provided</span>
            </div>
            <div className="text-xs text-comment mt-2 text-center">
              WebSocket connection could not be initialized because no identifier was provided.
            </div>
          </div>
        </NodeViewWrapper>
      );
    }

    return (
      <NodeViewWrapper className="messages-node" style={{ userSelect: "text" }} contentEditable={false}>
        <div className="flex flex-col" style={{ height: '83vh' }}>

          {/* Header bar */}
          <div className="flex items-center justify-between bg-bg border-b !border-solid !border-[rgba(0,0,0,0.2)] px-2 py-1.5">
            <div className="flex-1 flex justify-between items-center gap-2">
              <span className="text-sm font-semibold">WSS/gRPC</span>
              {statusPill()}

            </div>
          </div>

          {/* Input + SEND */}
          {
            connected && (
              <div className="bg-bg px-2 py-2">
                <div className="bg-gray-50 border-t border-stone-700/80">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-stone-700/80">
                    <select
                      value={messageFormat}
                      onChange={(e) => handleLangChange(e.target.value as MessageFormat)}
                      className="bg-bg text-text border border-stone-700/80 rounded px-2 py-1 text-sm appearnce-none pr-6"
                    >
                      {(['text', 'json', 'html', 'xml'] as MessageFormat[]).map((format) => (
                        <option key={format} value={format}>
                          {format.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <button
                      className="px-2 py-1 rounded text-sm font-medium transition-colors border-stone-700/80 border disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      onClick={handleSend}
                      disabled={!messageContent.trim()}
                      title="Send message"
                    >
                      SEND
                    </button>
                  </div>

                  <div
                    className="p-3 border-stone-700/80 border"
                    onKeyDown={(e) => e.stopPropagation()}
                    onKeyUp={(e) => e.stopPropagation()}

                    onClick={(e) => e.stopPropagation()}
                  >
                    {context.ui.components.CodeEditor && (
                      <context.ui.components.CodeEditor
                        lang={messageFormat === 'json' ? 'json' : messageFormat === 'html' ? 'html' : messageFormat === 'xml' ? 'xml' : 'plaintext'}
                        onChange={(val: string) => {
                          handleMessageChange(val)
                        }}
                        value={messageContent}
                        readOnly={!connected || !wsId}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          }

          {/* Message list */}
          <div
            ref={listRef}
            className="bg-editor flex-1"
            style={{
              overflowY: "auto",
            }}
          >
            {items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-comment">
                Waiting for <span className="font-mono">ws-open</span>…
              </div>
            ) : (
              <div className="py-1">{items.map(renderItem)}</div>
            )}
          </div>
          <div className="border border-stone-700/80 w-full flex justify-between px-3 py-2">

            <div className="flex gap-4">
              {wsId && connected && (
                <div onClick={handleConnect} id="ws-button" className="flex items-center cursor-pointer">
                  <span className="flex p-1 hover:bg-active rounded transition-colors items-center gap-1 text-sm">
                    <Square className={"text-yellow-500"} size={14} /> Pause
                  </span>
                </div>
              )}
              {wsId && isPaused && (
                <div onClick={handleConnect} id="ws-button" className="flex items-center cursor-pointer">
                  <span className="flex p-1 hover:bg-active rounded transition-colors items-center gap-1 text-sm">
                    <Play className={"text-green-500"} size={14} /> Resume
                  </span>
                </div>
              )}
              {(connected || isPaused) && wsId && (
                <div onClick={handleClose} id="ws-button" className="flex items-center cursor-pointer">
                  <span className="flex p-1 hover:bg-active rounded transition-colors items-center gap-1 text-sm text-text">
                    <X className={"text-red-500"} size={14} /> Disconnect
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <div className="flex gap-2">
                  <button
                    id="ws-button"
                    onClick={handleExportJSON}
                    className="p-1 flex items-center hover:bg-active rounded transition-colors"
                    title="Export all as JSON"
                  >
                    <Download size={14} className="text-text" />
                    <span className="text-sm ml-1">JSON</span>
                  </button>
                  <button
                    id="ws-button"
                    onClick={handleExportCSV}
                    className="p-1 flex items-center hover:bg-active rounded transition-colors"
                    title="Export all as CSV"
                  >
                    <Download size={14} className="text-text" />
                    <span className="text-sm ml-1">CSV</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "messages-node",

    group: "block",

    atom: true,

    addAttributes() {
      return {
        wsId: { default: null },
        url: { default: null },
        headers: { default: null },
        sourceFilePath: { default: null },
      };
    },

    parseHTML() {
      return [
        {
          tag: 'div[data-type="messages-node"]',
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "messages-node", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(MessagesComponent);
    },
  });
};
