/**
 * gRPC Messages Node
 *
 * Handles all gRPC call types with specialized UI for each:
 * - Unary: Single request/response with loading state
 * - Server Streaming: Request input + streaming responses
 * - Client Streaming: Multiple request inputs + final response
 * - Bidirectional: Full duplex streaming
 *
 * Expected IPC events:
 *   grpc-stream-open, grpc-stream-data, grpc-stream-response, 
 *   grpc-stream-error, grpc-stream-end, grpc-stream-cancelled
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PluginContext } from "@voiden/sdk";
import {
    Play, Square, X, Send, Loader2, AlertCircle,
    ArrowRight, ArrowDown, ArrowUp, ArrowLeftRight,
    Copy, Download, Check, Clock
} from "lucide-react";
import { saveSessionToHistory } from '../lib/historyHelper';

// Module-level deduplication: prevents multiple component instances (e.g. during
// React remount or keep-alive cache churn) from saving the same session twice.
const savedGrpcSessions = new Set<string>(); // grpcIds whose session has been saved this lifecycle

export interface GrpcMessagesAttrs {
    grpcId?: string | null;
    callType?: 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional_streaming' | null;
    service?: string | null;
    method?: string | null;
    target?: string | null;
    url?: string | null;
    package?: string | null;
    /** JSON-serialised Array<{ key: string; value: string }> — connection metadata headers */
    headers?: string | null;
    /** Absolute path of the .proto file used for this session — stored in history for void export */
    protoFilePath?: string | null;
    /** Absolute path of the source .void file — used for history tagging */
    sourceFilePath?: string | null;
    /** JSON-serialised ProtoService[] — stored so history can restore the full services list */
    protoServices?: string | null;
}

type GrpcMessageItem =
    | { kind: "stream-open"; ts: number; grpcId: string; target?: string; method?: string; callType?: string }
    | { kind: "stream-data"; ts: number; grpcId: string; data: any; type: 'request' | 'response' }
    | { kind: "stream-response"; ts: number; grpcId: string; data: any }
    | { kind: "stream-error"; ts: number; grpcId: string; error: string; code?: number; details?: string }
    | { kind: "stream-end"; ts: number; grpcId: string; reason?: string }
    | { kind: "stream-cancelled"; ts: number; grpcId: string }
    | { kind: "unary-response"; ts: number; grpcId: string; data: any; duration?: number }
    | { kind: "stream-closed"; ts: number; grpcId: string; };

function formatTime(ts: number) {
    try {
        return new Date(ts).toLocaleTimeString();
    } catch {
        return "";
    }
}

function formatDuration(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatJson(data: any): string {
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
}

export const createGrpcMessagesNode = (NodeViewWrapper: any, context: PluginContext) => {
    const GrpcMessagesComponent = ({ node }: any) => {
        const attrs = (node.attrs || {}) as GrpcMessagesAttrs;

        const [grpcId, setGrpcId] = React.useState<string | null>(attrs.grpcId || null);
        const [callType, setCallType] = React.useState<string | null>(attrs.callType || null);
        const [connected, setConnected] = React.useState<boolean>(false);
        const [loading, setLoading] = React.useState<boolean>(false);
        const [service, setService] = React.useState<string | null>(attrs.service || null);
        const [method, setMethod] = React.useState<string | null>(attrs.method || null);
        const [target, setTarget] = React.useState<string | null>(attrs.target || null);
        const [unaryError, setUnaryError] = React.useState<boolean>(false);

        const [messages, setMessages] = React.useState<GrpcMessageItem[]>([]);
        const [requestInput, setRequestInput] = React.useState<string>("{}");
        const [messageFormat, setMessageFormat] = React.useState<'json' | 'text'>('json');
        const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);
        const [streamEnded, setStreamEnded] = React.useState<boolean>(false);

        const listRef = React.useRef<HTMLDivElement | null>(null);
        const firstLoad = React.useRef<boolean>(false);
        const connectCalledRef = React.useRef<boolean>(false);
        const ipcListenersSetupRef = React.useRef<boolean>(false);

        // Refs for use inside IPC callbacks (avoid stale closure)
        const messagesRef = React.useRef<GrpcMessageItem[]>([]);
        React.useEffect(() => { messagesRef.current = messages; }, [messages]);
        const sessionStartRef = React.useRef<number | null>(null);
        const savedRef = React.useRef<boolean>(false);
        const isReplayRef = React.useRef<boolean>(false);
        const lastErrorRef = React.useRef<string | null>(null);

        const parsedHeaders: Array<{ key: string; value: string }> = React.useMemo(() => {
            try { return JSON.parse(attrs.headers || '[]'); } catch { return []; }
        }, [attrs.headers]);

        const handleLangChange = (value: 'text' | 'json') => {
            setMessageFormat(value);
            setRequestInput(value === 'text' ? '' : '{}');
        };
        
        // Auto-scroll to bottom
        React.useEffect(() => {
            const el = listRef.current;
            if (!el) return;
            el.scrollTop = el.scrollHeight;
        }, [messages.length]);

        const connectGrpc = React.useCallback(async () => {
            if (!grpcId || connectCalledRef.current) return;

            connectCalledRef.current = true;
            firstLoad.current = true;

            try {
                const result = await (window as any).electron.request.connectGrpc(grpcId);
                if (result?.wasClosed) {
                    savedRef.current = true;
                    isReplayRef.current = true;
                    connectCalledRef.current = false;
                    setConnected(false);
                    return;
                }
                setConnected(true);
            } catch (error) {
                console.error('Failed to connect to gRPC:', error);
                setMessages((prev) => [
                    ...prev,
                    {
                        kind: "stream-error",
                        ts: Date.now(),
                        grpcId: grpcId,
                        error: `Connection failed: ${error}`
                    },
                ]);
                // Set stream as ended on connection failure
                setStreamEnded(true);
                firstLoad.current = false;
                connectCalledRef.current = false; // Reset on error
            }
        }, [grpcId]);

        // Wire up gRPC-specific IPC listeners
        React.useEffect(() => {
            if (ipcListenersSetupRef.current) return;

            const listen = (window as any)?.electron?.request?.listenSecure;
            if (!listen) {
                setMessages((prev) => [
                    ...prev,
                    { kind: "stream-error", ts: Date.now(), grpcId: "", error: "IPC not available" },
                ]);
                return;
            }

            ipcListenersSetupRef.current = true;

            const offOpen = listen("grpc-stream-open", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    setGrpcId(d.grpcId);
                    setConnected(true);
                    setLoading(false);
                    setCallType(d.callType);
                    setTarget(d.target);
                    setMethod(d.method);
                    // Reset stream ended flag when connection opens
                    setStreamEnded(false);
                    if (!sessionStartRef.current) sessionStartRef.current = Date.now();
                    if (isReplayRef.current) {
                        isReplayRef.current = false;
                    } else {
                        savedRef.current = false;
                    }
                    lastErrorRef.current = null;
                    setMessages((prev) => [
                        ...prev,
                        {
                            kind: "stream-open",
                            ts: Date.now(),
                            grpcId: d.grpcId,
                            target: d.target,
                            method: d.method,
                            callType: d.callType
                        }
                    ]);
                }
            });

            const offData = listen("grpc-stream-data", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    // Clear loading for unary response
                    if (d.type === 'response' && callType === 'unary') {
                        setLoading(false);
                    }
                    setMessages((prev) => [
                        ...prev,
                        {
                            kind: "stream-data",
                            ts: Date.now(),
                            grpcId: d.grpcId,
                            data: d.data,
                            type: d.type || 'response'
                        }
                    ]);
                }
            });

            const offResponse = listen("grpc-stream-response", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    setLoading(false);
                    setMessages((prev) => [
                        ...prev,
                        { kind: "stream-response", ts: Date.now(), grpcId: d.grpcId, data: d.data }
                    ]);
                }
            });

            const offError = listen("grpc-stream-error", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    // Set all states synchronously to ensure UI updates immediately
                    setLoading(false);
                    setConnected(false);
                    setStreamEnded(true);  // CRITICAL: Set stream as ended
                    // Set error flag for unary calls
                    if (callType === 'unary') {
                        setUnaryError(true);
                    }
                    const errItem: GrpcMessageItem = {
                        kind: "stream-error",
                        ts: Date.now(),
                        grpcId: d.grpcId,
                        error: d.error || "gRPC error",
                        code: d.code,
                        details: d.details,
                    };
                    setMessages((prev) => [...prev, errItem]);
                    // Track error — save will happen on the terminal close/end/cancelled event
                    lastErrorRef.current = d.error || 'gRPC error';
                }
            });

            const offEnd = listen("grpc-stream-end", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    setConnected(false);
                    setStreamEnded(true);
                    const endItem: GrpcMessageItem = { kind: "stream-end", ts: Date.now(), grpcId: d.grpcId, reason: d.reason };
                    setMessages((prev) => [...prev, endItem]);

                    const endGrpcId = d.grpcId as string;
                    if (!savedRef.current && !savedGrpcSessions.has(endGrpcId)) {
                        savedRef.current = true;
                        savedGrpcSessions.add(endGrpcId);
                        const endError = lastErrorRef.current;
                        lastErrorRef.current = null;
                        saveSessionToHistory(context, {
                            method: attrs.url?.startsWith('grpcs://') ? 'GRPCS' : 'GRPC',
                            url: attrs.target || attrs.url || '',
                            headers: parsedHeaders,
                            messages: [...messagesRef.current, endItem],
                            error: endError ?? undefined,
                            sessionStart: sessionStartRef.current ?? undefined,
                            sessionEnd: Date.now(),
                            sourceFilePath: attrs.sourceFilePath || null,
                            grpcService: attrs.service || null,
                            grpcMethod: attrs.method || null,
                            grpcCallType: attrs.callType || null,
                            grpcPackage: attrs.package || null,
                            protoFilePath: attrs.protoFilePath || null,
                            protoServices: (() => { try { const s = attrs.protoServices; return s ? (typeof s === 'string' ? JSON.parse(s) : s) : null; } catch { return null; } })(),
                        });
                    }
                }
            });

            const offCancelled = listen("grpc-stream-cancelled", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    setConnected(false);
                    setStreamEnded(true);
                    const cancelItem: GrpcMessageItem = { kind: "stream-cancelled", ts: Date.now(), grpcId: d.grpcId };
                    setMessages((prev) => [...prev, cancelItem]);

                    const cancelGrpcId = d.grpcId as string;
                    if (!savedRef.current && !savedGrpcSessions.has(cancelGrpcId)) {
                        savedRef.current = true;
                        savedGrpcSessions.add(cancelGrpcId);
                        lastErrorRef.current = null;
                        saveSessionToHistory(context, {
                            method: attrs.url?.startsWith('grpcs://') ? 'GRPCS' : 'GRPC',
                            url: attrs.target || attrs.url || '',
                            headers: parsedHeaders,
                            messages: [...messagesRef.current, cancelItem],
                            error: 'Cancelled',
                            sessionStart: sessionStartRef.current ?? undefined,
                            sessionEnd: Date.now(),
                            sourceFilePath: attrs.sourceFilePath || null,
                            grpcService: attrs.service || null,
                            grpcMethod: attrs.method || null,
                            grpcCallType: attrs.callType || null,
                            grpcPackage: attrs.package || null,
                            protoFilePath: attrs.protoFilePath || null,
                            protoServices: (() => { try { const s = attrs.protoServices; return s ? (typeof s === 'string' ? JSON.parse(s) : s) : null; } catch { return null; } })(),
                        });
                    }
                }
            });

            const offClosed = listen("grpc-stream-closed", (_e: any, d: any) => {
                if (!grpcId || d.grpcId === grpcId) {
                    setConnected(false);
                    setStreamEnded(true);
                    const closedItem: GrpcMessageItem = { kind: "stream-closed", ts: Date.now(), grpcId: d.grpcId };
                    setMessages((prev) => [...prev, closedItem]);

                    const closedGrpcId = d.grpcId as string;
                    if (!savedRef.current && !savedGrpcSessions.has(closedGrpcId)) {
                        savedRef.current = true;
                        savedGrpcSessions.add(closedGrpcId);
                        const closedError = lastErrorRef.current;
                        lastErrorRef.current = null;
                        saveSessionToHistory(context, {
                            method: attrs.url?.startsWith('grpcs://') ? 'GRPCS' : 'GRPC',
                            url: attrs.target || attrs.url || '',
                            headers: parsedHeaders,
                            messages: [...messagesRef.current, closedItem],
                            error: closedError ?? undefined,
                            sessionStart: sessionStartRef.current ?? undefined,
                            sessionEnd: Date.now(),
                            sourceFilePath: attrs.sourceFilePath || null,
                            grpcService: attrs.service || null,
                            grpcMethod: attrs.method || null,
                            grpcCallType: attrs.callType || null,
                            grpcPackage: attrs.package || null,
                            protoFilePath: attrs.protoFilePath || null,
                            protoServices: (() => { try { const s = attrs.protoServices; return s ? (typeof s === 'string' ? JSON.parse(s) : s) : null; } catch { return null; } })(),
                        });
                    }
                }
            });

            return () => {
                try { offOpen && offOpen(); } catch { }
                try { offData && offData(); } catch { }
                try { offResponse && offResponse(); } catch { }
                try { offError && offError(); } catch { }
                try { offEnd && offEnd(); } catch { }
                try { offCancelled && offCancelled(); } catch { }
                try { offClosed && offClosed() } catch { }
                ipcListenersSetupRef.current = false;
            };
        }, [grpcId]);

        // Initial connection effect
        React.useEffect(() => {
            if (!grpcId) return;
            
            // For unary calls, skip connection - it happens on first send
            if (callType === 'unary') {
                firstLoad.current = true;
                return;
            }
            
            // For streaming calls, connect as usual
            if (!connected && !connectCalledRef.current) {
                connectGrpc();
            }
        }, [grpcId, connected, callType, connectGrpc]);

        // Send message for streaming calls
        const handleSendMessage = React.useCallback(() => {
            const sendGrpcMessage = (window as any)?.electron?.request?.sendGrpcMessage;
            if (!sendGrpcMessage) {
                setMessages((prev) => [
                    ...prev,
                    { kind: "stream-error", ts: Date.now(), grpcId: grpcId || "", error: "IPC not available" }
                ]);
                return;
            }

            // Check if we can send messages based on current state
            const canSend = callType === "unary" 
                ? !loading  // For unary, only need to not be loading
                : connected && !streamEnded;  // For streaming, need to be connected and stream not ended
            
            if (!grpcId || !canSend) {
                setMessages((prev) => [
                    ...prev,
                    { kind: "stream-error", ts: Date.now(), grpcId: grpcId || "", error: "Cannot send: Not connected or stream ended" }
                ]);
                return;
            }

            if (callType === 'unary') {
                try {
                    const payload = messageFormat === 'json'
                        ? JSON.parse(requestInput)
                        : requestInput;

                    setMessages((prev) => [
                        ...prev,
                        { kind: "stream-data", ts: Date.now(), grpcId, data: payload, type: 'request' }
                    ]);

                    setUnaryError(false); // Clear error state on new request
                    setLoading(true); // Show loading state
                    sendGrpcMessage(grpcId, payload);

                } catch (err: any) {
                    setMessages(prev => [
                        ...prev,
                        { kind: "stream-error", ts: Date.now(), grpcId, error: err.message }
                    ]);
                }

                return;
            }

            if (!requestInput.trim()) return;

            try {
                const payload = messageFormat === 'json' ? JSON.parse(requestInput) : requestInput;

                setMessages((prev) => [
                    ...prev,
                    { kind: "stream-data", ts: Date.now(), grpcId, data: payload, type: 'request' }
                ]);

                sendGrpcMessage(grpcId, payload);
                setRequestInput(messageFormat === 'json' ? '{}' : '');
            } catch (err: any) {
                setMessages((prev) => [
                    ...prev,
                    { kind: "stream-error", ts: Date.now(), grpcId, error: `Invalid JSON: ${err.message}` }
                ]);
            }
        }, [requestInput, grpcId, connected, messageFormat, callType, streamEnded, loading]);

        // End client stream
        const handleEndStream = React.useCallback(() => {
            const endGrpcStream = (window as any)?.electron?.request?.endGrpc;
            if (!endGrpcStream || !grpcId) return;

            // Only allow ending stream if connected and not already ended
            if (connected && !streamEnded) {
                endGrpcStream(grpcId);
            }
        }, [grpcId, connected, streamEnded]);

        // Cancel gRPC call
        const handleCancel = React.useCallback(() => {
            const cancelGrpc = (window as any)?.electron?.request?.cancelGrpc;
            if (!cancelGrpc || !grpcId) return;
            
            // Only allow cancellation if connected and not ended
            if (connected && !streamEnded) {
                cancelGrpc(grpcId);
            }
        }, [grpcId, connected, streamEnded]);

        // Copy message
        const handleCopyMessage = async (item: GrpcMessageItem, index: number) => {
            try {
                let textToCopy = '';

                if (item.kind === 'stream-data' || item.kind === 'stream-response' || item.kind === 'unary-response') {
                    textToCopy = formatJson(item.data);
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

        // Export to JSON
        const handleExportJSON = () => {
            try {
                const exportData = messages.map(msg => ({
                    ...msg,
                    timestamp: new Date(msg.ts).toISOString(),
                }));

                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `grpc-messages-${Date.now()}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Export failed:', err);
            }
        };

        // Export to CSV
        const handleExportCSV = () => {
            try {
                const csvRows: string[] = [];

                // Header
                csvRows.push('Timestamp,ISO Time,Kind,Type,Data,Error,Code,Details,Reason,Method,Call Type,Target');

                // Data rows
                messages.forEach(msg => {
                    const timestamp = msg.ts;
                    const isoTime = new Date(msg.ts).toISOString();
                    const kind = msg.kind;

                    let type = '';
                    let data = '';
                    let error = '';
                    let code = '';
                    let details = '';
                    let reason = '';
                    let method = '';
                    let callTypeVal = '';
                    let targetVal = '';

                    if (msg.kind === 'stream-data') {
                        type = msg.type;
                        data = JSON.stringify(msg.data).replace(/"/g, '""');
                    } else if (msg.kind === 'stream-response' || msg.kind === 'unary-response') {
                        data = JSON.stringify(msg.data).replace(/"/g, '""');
                    } else if (msg.kind === 'stream-error') {
                        error = msg.error.replace(/"/g, '""');
                        code = msg.code ? String(msg.code) : '';
                        details = msg.details ? msg.details.replace(/"/g, '""') : '';
                    } else if (msg.kind === 'stream-end') {
                        reason = msg.reason ? msg.reason.replace(/"/g, '""') : '';
                    } else if (msg.kind === 'stream-open') {
                        method = msg.method || '';
                        callTypeVal = msg.callType || '';
                        targetVal = msg.target || '';
                    }

                    csvRows.push(
                        `${timestamp},"${isoTime}","${kind}","${type}","${data}","${error}","${code}","${details}","${reason}","${method}","${callTypeVal}","${targetVal}"`
                    );
                });

                const csvContent = csvRows.join('\n');
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `grpc-messages-${Date.now()}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('CSV export failed:', err);
            }
        };

        // Get call type icon
        const getCallTypeIcon = () => {
            switch (callType) {
                case 'unary':
                    return <ArrowRight size={14} className="text-blue-400" />;
                case 'server_streaming':
                    return <ArrowDown size={14} className="text-green-400" />;
                case 'client_streaming':
                    return <ArrowUp size={14} className="text-purple-400" />;
                case 'bidirectional_streaming':
                    return <ArrowLeftRight size={14} className="text-orange-400" />;
                default:
                    return null;
            }
        };

        // Status pill
        const statusPill = () => {
            let color = "bg-border";
            let text = "Disconnected";

            if (callType === 'unary') {
                // Unary-specific status
                if (loading) {
                    color = "bg-yellow-500";
                    text = "Sending...";
                } else if (unaryError) {
                    color = "bg-red-500";
                    text = "Error";
                } else {
                    color = "bg-blue-500";
                    text = "Ready to Send";
                }
            } else {
                // Streaming call status
                if (loading) {
                    color = "bg-yellow-500";
                    text = "Loading...";
                } else if (connected && !streamEnded) {
                    color = "bg-green-500";
                    text = "Connected";
                } else if (streamEnded) {
                    color = "bg-gray-500";
                    text = "Ended";
                }
            }

            return (
                <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
                        <span className="text-xs font-mono">{text}</span>
                    </div>
                    {grpcId && (
                        <div className="text-[11px] text-comment font-mono">
                            id: {grpcId.slice(0, 8)}
                        </div>
                    )}
                    <div className="flex">
                        {target && method && (
                            <div className="text-[11px] text-comment font-mono">
                                {target}/{method}
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        // Render individual message
        const renderMessage = (msg: GrpcMessageItem, idx: number) => {
            const time = formatTime(msg.ts);
            const lineBase = "flex items-start gap-2 px-3 py-2 text-sm group relative";
            const isCopied = copiedIndex === idx;

            switch (msg.kind) {
                case "stream-open":
                    return null;

                case "stream-data":
                    const isRequest = msg.type === 'request';
                    const arrowIcon = isRequest ? <ArrowUp size={16} /> : <ArrowDown size={16} />;
                    const borderColor = isRequest ? "border-blue-400" : "border-green-400";

                    return (
                        <div key={idx} className={`${lineBase} flex items-center  border-l-2 ${borderColor}`}>
                            <div className="mt-1">{arrowIcon}</div>
                            <div className="flex-1">
                                <div className="text-xs text-comment mb-1">
                                    {time} • {isRequest ? 'Request' : 'Response'}
                                </div>
                                <pre className="whitespace-pre-wrap break-words font-mono text-xs bg-editor p-2 rounded">
                                    {formatJson(msg.data)}
                                </pre>
                            </div>
                            <button
                                onClick={() => handleCopyMessage(msg, idx)}
                                className="p-1 hover:bg-active rounded"
                            >
                                {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                            </button>
                        </div>
                    );

                case "stream-response":
                case "unary-response":
                    return (
                        <div key={idx} className={`${lineBase} border-l-2 flex items-center border-purple-400`}>
                            <ArrowDown size={16} className="mt-1" />
                            <div className="flex-1">
                                <div className="text-xs text-comment mb-1">
                                    {time} • Final Response
                                    {msg.kind === 'unary-response' && msg.duration && ` • ${formatDuration(msg.duration)}`}
                                </div>
                                <pre className="whitespace-pre-wrap break-words font-mono text-xs bg-editor p-2 rounded">
                                    {formatJson(msg.data)}
                                </pre>
                            </div>
                            <button
                                onClick={() => handleCopyMessage(msg, idx)}
                                className=" p-1 hover:bg-active rounded"
                            >
                                {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                            </button>
                        </div>
                    );

                case "stream-error":
                    return (
                        <div key={idx} className={`${lineBase} text-red-400 flex items-center  border-l-2 border-red-400`}>
                            <AlertCircle size={16} className="mt-1 flex-shrink-0" />
                            <div className="text-xs space-y-1 flex-1">
                                <div>Error : {msg.error}</div>
                                {msg.code && (
                                    <div className="text-red-400/80">Code: {msg.code}</div>
                                )}
                                {msg.details && (
                                    <div className="text-red-300/70">Detail : {msg.details}</div>
                                )}
                                <div className="text-xs">{time} </div>
                            </div>
                            <button
                                onClick={() => handleCopyMessage(msg, idx)}
                                className=" p-1 hover:bg-active rounded"
                            >
                                {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                            </button>
                        </div>
                    );

                case "stream-end":
                    return (
                        <div key={idx} className={`${lineBase} text-yellow-400 flex items-center  border-l-2 border-yellow-400`}>
                            <Square size={16} className="mt-1" />
                            <div className="flex-1">
                                <div className="font-mono font-semibold">STREAM ENDED</div>
                                <div className="text-xs text-comment">
                                    {time}
                                    {msg.reason && ` • ${msg.reason}`}
                                </div>
                            </div>
                        </div>
                    );

                case "stream-cancelled":
                    return (
                        <div key={idx} className={`${lineBase} text-gray-400 border-l-2 border-gray-400`}>
                            <X size={16} className="mt-1" />
                            <div className="flex-1">
                                <div className="font-mono font-semibold">CANCELLED</div>
                                <div className="text-xs text-comment">{time}</div>
                            </div>
                        </div>
                    );

                case "stream-closed":
                    return (
                        <div key={idx} className={`${lineBase} text-gray-400 border-l-2 border-gray-400`}>
                            <X size={16} className="mt-1" />
                            <div className="flex-1">
                                <div className="font-mono font-semibold">CLOSED</div>
                                <div className="text-xs text-comment">{time}</div>
                            </div>
                        </div>
                    );
                default:
                    return null;
            }
        };

        // Show input UI based on call type - FIXED VERSION
        const showInputUI = React.useCallback(() => {
            // If stream has ended, don't show input
            if (streamEnded) return false;
            
            // For unary calls, always show input (validation happens on send)
            if (callType === 'unary') {
                return true;
            }
            
            // For non-unary calls, need to be connected
            if (callType !== 'unary' && !connected) return false;
            
            return true;
        }, [callType, connected, streamEnded]);

        // Determine if messages can be sent - FIXED VERSION
        const canSendMessages = React.useMemo(() => {
            if (callType === "unary") {
                return !loading; // For unary, only check loading state
            }
            // For streaming calls, need to be connected and stream not ended
            return connected && !streamEnded;
        }, [callType, connected, streamEnded, loading]);

        // Show a clear error if we never received/parsed a grpcId
        if (!grpcId) {
            return (
                <NodeViewWrapper>
                    <div className="h-full bg-bg flex flex-col items-center justify-center border border-stone-700/80 rounded p-6" style={{ height: '83vh' }}>
                        <div className="flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle size={16} />
                            <span>Incorrect information or URL provided</span>
                        </div>
                        <div className="text-xs text-comment mt-2 text-center">
                            gRPC connection could not be initialized because no identifier was provided.
                        </div>
                    </div>
                </NodeViewWrapper>
            );
        }

        if (!firstLoad.current && callType !== 'unary') {
            return (
                <NodeViewWrapper>
                    <div className="h-full bg-bg flex flex-col" style={{ height: '88vh' }}>
                        {/* Top bar */}
                        <div className="flex items-center justify-between bg-bg border-b border-stone-700/80 px-3 py-2">
                            <div className="flex flex-col items-start gap-2">
                                <span className="text-sm flex gap-1 font-semibold">
                                    {callType && (
                                        <div className="flex items-center gap-1 text-xs text-comment">
                                            {getCallTypeIcon()}
                                        </div>
                                    )}
                                    <span>gRPC </span>
                                </span>
                                {service && method && (
                                    <span className="text-xs text-comment font-mono">
                                        {service}.{method}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Middle content */}
                        <div className="flex-1 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-3">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-text"></div>
                                <div className="text-comment text-sm">Making connection...</div>
                            </div>
                        </div>
                    </div>
                </NodeViewWrapper>
            );
        }

        return (
            <NodeViewWrapper className="grpc-messages-node" contentEditable={false}>
                <div className="flex flex-col border border-stone-700/80 rounded" style={{ height: '83vh' }}>
                    {/* Header */}
                    <div className="flex items-center justify-between bg-bg border-b border-stone-700/80 px-3 py-2">
                        <div className="h-full justify-between flex flex-col items-start gap-2">
                            <span className="text-sm flex gap-1 font-semibold">
                                {callType && (
                                    <div className="flex items-center gap-1 text-xs text-comment">
                                        {getCallTypeIcon()}
                                    </div>
                                )}
                                <span>gRPC </span>
                            </span>
                            {service && method && (
                                <span className="text-[11px] text-comment font-mono">
                                    {service}.{method}
                                </span>
                            )}
                        </div>
                        {statusPill()}

                    </div>

                    {/* Message list */}
                    <div
                        ref={listRef}
                        className="flex-1 bg-editor overflow-y-auto"
                    >
                        {messages.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-comment">
                                {callType === 'unary' 
                                    ? "Ready to send. Enter your request below and click Send to test the connection."
                                    : "Waiting for connection..."}
                            </div>
                        ) : (
                            <div className="py-2">
                                {messages.map(renderMessage)}
                                {/* Show loading indicator for unary calls after last message */}
                                {callType === 'unary' && loading && (
                                    <div className="flex items-start gap-2 px-3 py-2 text-sm border-l-2 border-yellow-400">
                                        <Loader2 size={16} className="mt-1 animate-spin text-yellow-400" />
                                        <div className="flex-1">
                                            <div className="text-xs text-comment mb-1">
                                                Waiting for response...
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Input section (for streaming calls) - FIXED: uses showInputUI() */}
                    {showInputUI() && (
                        <div className="border-t border-stone-700/80 bg-bg">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-stone-700/80">
                                <select
                                    value={messageFormat}
                                    onChange={(e) => handleLangChange(e.target.value as 'json' | 'text')}
                                    className="bg-bg text-text border border-stone-700/80 rounded px-2 py-1 text-sm"
                                    disabled={!canSendMessages}
                                >
                                    <option value="json">JSON</option>
                                    <option value="text">Text</option>
                                </select>
                                <div className="flex gap-2">
                                    {callType !== 'unary'  && (
                                        <button
                                            onClick={handleEndStream}
                                            disabled={!canSendMessages}
                                            className="px-3 py-1 rounded text-sm font-medium border border-stone-700/80 hover:bg-active disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            End
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!canSendMessages}
                                        className="px-3 py-1 rounded text-sm font-medium border border-stone-700/80 hover:bg-active disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                    >
                                        <Send size={14} />
                                        Send
                                    </button>
                                </div>
                            </div>
                            <div className="p-3">
                                {context.ui.components.CodeEditor && (
                                    <context.ui.components.CodeEditor
                                        lang={messageFormat}
                                        value={requestInput}
                                        onChange={(val: string) => setRequestInput(val)}
                                        readOnly={!canSendMessages}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Footer actions */}
                    <div className="border-t border-stone-700/80 px-3 py-2 flex justify-between items-center">
                        <div className="flex gap-2">
                            {connected && !streamEnded && callType !== 'unary' && (
                                <button
                                    onClick={handleCancel}
                                    className="flex items-center gap-1 px-2 py-1 hover:bg-active rounded transition-colors text-sm"
                                >
                                    <X size={14} className="text-red-400" />
                                    Cancel
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            {messages.length > 0 && (
                                <>
                                    <button
                                        onClick={handleExportJSON}
                                        className="flex items-center gap-1 px-2 py-1 hover:bg-active rounded transition-colors text-sm"
                                    >
                                        <Download size={14} />
                                        JSON
                                    </button>
                                    <button
                                        onClick={handleExportCSV}
                                        className="flex items-center gap-1 px-2 py-1 hover:bg-active rounded transition-colors text-sm"
                                    >
                                        <Download size={14} />
                                        CSV
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </NodeViewWrapper>
        );
    };

    return Node.create({
        name: "grpc-messages-node",
        group: "block",
        atom: true,

        addAttributes() {
            return {
                grpcId: { default: null },
                callType: { default: null },
                service: { default: null },
                method: { default: null },
                target: { default: null },
                url: { default: null },
                package: { default: null },
                headers: { default: null },
                protoFilePath: { default: null },
                sourceFilePath: { default: null },
                /** JSON-serialised ProtoService[] — stored so history can restore the full services list */
                protoServices: { default: null },
            };
        },

        parseHTML() {
            return [{ tag: 'div[data-type="grpc-messages-node"]' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ["div", { "data-type": "grpc-messages-node", ...HTMLAttributes }];
        },

        addNodeView() {
            return ReactNodeViewRenderer(GrpcMessagesComponent);
        },
    });
};