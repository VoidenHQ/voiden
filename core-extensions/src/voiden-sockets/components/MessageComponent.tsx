import { CornerDownLeft, CornerDownRight } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';

interface WebSocketMessagesProps {
    wsId?: string | null;
    url?: string | null;
}

type ChatItem =
    | { kind: "system-open"; ts: number; wsId: string; url?: string | null }
    | { kind: "system-close"; ts: number; wsId: string; code?: number; reason?: string; wasClean?: boolean }
    | { kind: "system-error"; ts: number; wsId?: string; message: string; code?: any; cause?: any; name?: string }
    | { kind: "recv"; ts: number; wsId: string; data: any }
    | { kind: "sent"; ts: number; wsId: string; data: any };

type MessageFormat = 'text' | 'json' | 'html' | 'xml';

function formatTime(ts: number) {
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString();
    } catch {
        return "";
    }
}

function dataToRenderableText(data: any): string {
    if (typeof data === "string") return data;
    if (data?.type === "Buffer" && Array.isArray(data.data)) {
        try {
            const uint8 = new Uint8Array(data.data);
            const text = new TextDecoder().decode(uint8);
            return text;
        } catch {
            return `[Buffer ${data.data.length} bytes]`;
        }
    }
    if (data instanceof ArrayBuffer) {
        try {
            const text = new TextDecoder().decode(new Uint8Array(data));
            return text;
        } catch {
            return `[ArrayBuffer ${data.byteLength} bytes]`;
        }
    }
    if (ArrayBuffer.isView(data)) {
        try {
            const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            const text = new TextDecoder().decode(uint8);
            return text;
        } catch {
            return `[TypedArray ${data.byteLength} bytes]`;
        }
    }
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

export const createWebsocketMessagesComponent = (props: any) => {
    return () => {
        return <WebSocketMessages {...props} />;
    };
}

export default function WebSocketMessages(context: any) {
    const [wsId, setWsId] = useState<string | null>(null);
    const [connected, setConnected] = useState<boolean>(false);
    const [hasError, setHasError] = useState<boolean>(false);
    const [url, setUrl] = useState<string | null>(null);
    const [items, setItems] = useState<ChatItem[]>([]);
    const [messageFormat, setMessageFormat] = useState<MessageFormat>('text');
    const [messageContent, setMessageContent] = useState<string>('');

    const listRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const handleLangChange = (value: MessageFormat) => {
        setMessageFormat(value);
        setMessageContent('');
    }
    // Auto-scroll to bottom on new items
    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [items.length]);

    // Wire up event listeners for WebSocket events
    useEffect(() => {
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
                setHasError(false);
                if (d?.url && !url) setUrl(d.url);
                setItems((prev) => [...prev, { kind: "system-open", ts: Date.now(), wsId: d.wsId, url: d?.url }]);
            }
        });

        const offMsg = listen("ws-message", (_e: any, d: any) => {
            if (!wsId || d.wsId === wsId) {
                setItems((prev) => [...prev, { kind: "recv", ts: Date.now(), wsId: d.wsId, data: d.data }]);
            }
        });

        const offErr = listen("ws-error", (_e: any, d: any) => {
            if (!wsId || d.wsId === wsId) {
                setHasError(true);
                setItems((prev) => [
                    ...prev,
                    {
                        kind: "system-error",
                        ts: Date.now(),
                        wsId: d?.wsId,
                        message: d?.message || "Connection error",
                        code: d?.code,
                        cause: d?.cause,
                        name: d?.name,
                    },
                ]);
            }
        });

        const offClose = listen("ws-close", (_e: any, d: any) => {
            if (!wsId || d.wsId === wsId) {
                setConnected(false);
                setItems((prev) => [
                    ...prev,
                    {
                        kind: "system-close",
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
            try { offMsg && offMsg(); } catch { }
            try { offErr && offErr(); } catch { }
            try { offClose && offClose(); } catch { }
        };
    }, [wsId, url]);

    const formatMessage = (content: string, format: MessageFormat): string => {
        try {
            switch (format) {
                case 'json':
                    const parsed = JSON.parse(content);
                    return JSON.stringify(parsed);
                case 'text':
                case 'html':
                case 'xml':
                default:
                    return content;
            }
        } catch {
            return content;
        }
    };

    const prettifyContent = () => {
        try {
            if (messageFormat === 'json') {
                const parsed = JSON.parse(messageContent);
                setMessageContent(JSON.stringify(parsed, null, 2));
            } else if (messageFormat === 'html' || messageFormat === 'xml') {
                // Basic prettify for HTML/XML
                const formatted = messageContent
                    .replace(/></g, '>\n<')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .join('\n');
                setMessageContent(formatted);
            }
        } catch (err) {
            console.error('Failed to prettify:', err);
        }
    };

    const handleSend = useCallback(() => {
        const sendMessage = (window as any)?.electron?.request?.sendMessage;
        if (!sendMessage) {
            setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "IPC not available (sendMessage missing)" }]);
            return;
        }
        if (!wsId) {
            setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "Not connected (Id missing)" }]);
            return;
        }

        const content = messageContent.trim();
        if (content.length === 0) return;

        const formattedMessage = formatMessage(content, messageFormat);

        setItems((prev) => [...prev, { kind: "sent", ts: Date.now(), wsId, data: formattedMessage }]);
        setMessageContent('');

        try {
            sendMessage(wsId, formattedMessage);
            setMessageContent('');
        } catch (err: any) {
            setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), wsId, message: err?.message || "Failed to send message" }]);
        }
    }, [messageContent, wsId, messageFormat]);

    const statusPill = () => {
        let color = "bg-gray-400";
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
            <span className="flex flex-col justify-center items-end gap-2 text-xs text-text">
                <div className='flex items-center gap-1'>
                    <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
                    <span className="font-mono">{text}</span>
                </div>
                <div className='flex gap-2 '>
                    {url && <span className="font-mono text-[11px] opacity-70">• {url}</span>}
                    {wsId && <span className="font-mono text-[11px] opacity-70">• id:{wsId.slice(0, 8)}</span>}
                </div>
            </span>
        );
    };

    const renderItem = (it: ChatItem, idx: number) => {
        const time = formatTime(it.ts);
        const lineBase = "flex items-start gap-2 px-3 py-1.5 text-sm";

        switch (it.kind) {
            case "system-open":
                return (
                    <div key={idx} className={`${lineBase} text-green-500`}>
                        <span>✓</span>
                        <div className="flex-1">
                            <div className="font-mono">CONNECTED</div>
                            <div className="text-xs text-gray-500">
                                {time} {it.url ? `• ${it.url}` : ""}
                            </div>
                        </div>
                    </div>
                );
            case "system-close":
                return (
                    <div key={idx} className={`${lineBase} text-yellow-500`}>
                        <span>○</span>
                        <div className="flex-1">
                            <div className="font-mono">DISCONNECTED</div>
                            <div className="text-xs text-gray-500">
                                {time}
                                {typeof it.code === "number" ? ` • code ${it.code}` : ""}
                                {it.reason ? ` • ${it.reason}` : ""}
                                {typeof it.wasClean === "boolean" ? ` • clean:${it.wasClean}` : ""}
                            </div>
                        </div>
                    </div>
                );
            case "system-error":
                return (
                    <div key={idx} className={`${lineBase} text-red-500`}>
                        <span>⚠</span>
                        <div className="flex-1">
                            <div className="font-mono">ERROR</div>
                            <div className="text-xs text-gray-500 break-all">
                                {time} • {it.message}
                                {it.code ? ` • code:${it.code}` : ""}
                                {it.cause ? ` • cause:${it.cause}` : ""}
                                {it.name ? ` • name:${it.name}` : ""}
                            </div>
                        </div>
                    </div>
                );
            case "sent":
                return (
                    <div key={idx} className={`${lineBase} flex justify-start items-center`}>
                        <CornerDownRight size={10}></CornerDownRight>
                        <div className="flex-1">
                            <pre className="whitespace-pre-wrap  break-words font-mono text-xs p-2 rounded border border-border">{dataToRenderableText(it.data)}</pre>
                            <div className="text-xs text-gray-500 mt-1">{time} • sent</div>
                        </div>
                    </div>
                );
            case "recv":
                return (
                    <div key={idx} className={`${lineBase} flex justify-end items-center`}>
                        <div className="flex-1">
                            <pre className="whitespace-pre-wrap tex-text break-words font-mono text-xs p-2 rounded border border-border">{dataToRenderableText(it.data)}</pre>
                            <div className="text-xs text-gray-500 mt-1">{time} • received</div>
                        </div>
                        <CornerDownLeft size={10}></CornerDownLeft>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto border border-border  overflow-hidden shadow-sm flex flex-col" style={{ height: '88vh' }}>
            {/* Header bar */}
            <div className="flex items-center justify-between border-b border-border  px-3 py-2">
                <div className="flex-1 flex items-center justify-between gap-2">
                    <span className="text-sm text-text font-semibold">WebSocket Messages</span>
                    {statusPill()}
                </div>
            </div>

            {/* Message list - scrollable */}
            <div
                ref={listRef}
                className="bg-white overflow-y-auto flex-1"
            >
                {items.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500">
                        Waiting for <span className="font-mono">ws-open</span> event…
                    </div>
                ) : (
                    <div className="py-1">{items.map(renderItem)}</div>
                )}
            </div>

            {/* Input section - at bottom */}
            <div className="bg-gray-50 border-t border-gray-300">
                {/* Format selector and prettify button */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                    <select
                        value={messageFormat}
                        onChange={(e) => handleLangChange(e.target.value as MessageFormat)}
                        className="bg-bg text-text border border-border rounded px-2 py-1 text-sm appearnce-none pr-6"
                    >
                        {(['text', 'json', 'html', 'xml'] as MessageFormat[]).map((format) => (
                            <option key={format} value={format}>
                                {format.toUpperCase()}
                            </option>
                        ))}
                    </select>
                    <div className="px-3 pb-3">
                        <button
                            className={`w-full ${(!connected || !wsId) && 'cursor-not-allowed'} px-4 py-2 rounded text-sm font-medium transition-colors bg-bg`}
                            onClick={handleSend}
                            disabled={!connected || !wsId}
                            title={connected ? "Send message (Ctrl+Enter)" : "Not connected"}
                        >
                            SEND
                        </button>
                    </div>
                </div>

                {/* Code editor textarea */}
                <div className="p-3">
                    {
                        context.ui.components.CodeEditor && (
                            <context.ui.components.CodeEditor
                                lang={messageFormat === 'json' ? 'json' : messageFormat === 'html' ? 'html' : messageFormat === 'xml' ? 'xml' : 'plaintext'}
                                onChange={(val: string) => setMessageContent(val)}
                                readOnly={!connected||!wsId}
                             vv
                                style={{ minHeight: '100px', height: 'auto' }}
                            />
                        ) 
                    }
                </div>

                {/* Send button */}

            </div>
        </div>
    );
}