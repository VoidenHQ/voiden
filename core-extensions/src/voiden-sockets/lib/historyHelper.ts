/**
 * History save utility for WSS / gRPC sessions.
 * Called from MessagesNode and gRPCMessageNode when a session ends.
 *
 * Requires context.history.save to be available (injected by the app via PluginContext).
 * Respects the global history enabled/disabled setting.
 */

export interface SessionHistoryOptions {
  /** "WSS" | "GRPCS" | "GRPC" */
  method: string;
  /** WebSocket URL or gRPC target */
  url: string;
  /** Connection/metadata headers */
  headers: Array<{ key: string; value: string }>;
  /** Full message log — will be JSON-serialised and capped at 100 KB */
  messages: any[];
  /** Optional terminal error message */
  error?: string | null;
  /** Session open timestamp (ms) */
  sessionStart?: number;
  /** Session close timestamp (ms) */
  sessionEnd?: number;
  /** Absolute path of the source .void file */
  sourceFilePath: string | null;
  // ── gRPC-specific fields ─────────────────────────────────────────────────────
  grpcService?: string | null;
  grpcMethod?: string | null;
  grpcCallType?: string | null;
  grpcPackage?: string | null;
  /** Absolute path to the .proto file used for this session */
  protoFilePath?: string | null;
  /** Parsed proto services — stored in history for void file reconstruction */
  protoServices?: any[] | null;
}

function serializeHistoryPayload(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractRequestBody(messages: any[]): string | undefined {
  const requestMessages = messages.filter((msg: any) => {
    if (msg?.kind === 'sent') return true;
    return msg?.kind === 'stream-data' && msg?.type === 'request';
  });

  if (requestMessages.length === 0) return undefined;

  const payloads = requestMessages
    .map((msg: any) => msg?.data)
    .filter((payload: any) => payload !== undefined);

  if (payloads.length === 0) return undefined;
  if (payloads.length === 1) return serializeHistoryPayload(payloads[0]);
  return serializeHistoryPayload(payloads);
}

export async function saveSessionToHistory(
  context: any,
  opts: SessionHistoryOptions,
): Promise<void> {
  try {
    let sourceFilePath = opts.sourceFilePath;
    if (!sourceFilePath) {
      try {
        const panelData = await (window as any).electron?.state?.getPanelTabs?.('main');
        const activeTabId = panelData?.activeTabId;
        const activeTab = (panelData?.tabs as any[] | undefined)?.find(
          (tab: any) => tab?.id === activeTabId && tab?.type === 'document',
        );
        sourceFilePath = activeTab?.source ?? null;
      } catch { /* best-effort */ }
    }

    if (!sourceFilePath) return;

    const settings = await (window as any).electron?.userSettings?.get();
    if (!settings?.history?.enabled) return;

    // Serialise the message log (cap at 100 KB to avoid bloating history files)
    let bodyStr: string | undefined;
    try {
      const raw = JSON.stringify(opts.messages, null, 2);
      bodyStr = raw.length > 102400 ? raw.slice(0, 102400) + '\n… (truncated)' : raw;
    } catch { /* skip */ }

    const requestBody = extractRequestBody(opts.messages);

    const timing =
      opts.sessionStart && opts.sessionEnd
        ? { duration: opts.sessionEnd - opts.sessionStart }
        : undefined;

    // Relativize proto file path if it's inside the active project directory
    let protoFilePathForHistory = opts.protoFilePath || undefined;
    if (protoFilePathForHistory) {
      try {
        const projectDir = await (window as any).electron?.directories?.getActive();
        if (projectDir && protoFilePathForHistory.startsWith(projectDir)) {
          const sep = projectDir.endsWith('/') ? '' : '/';
          protoFilePathForHistory = protoFilePathForHistory.slice(projectDir.length + sep.length);
        }
      } catch { /* best-effort */ }
    }

    const grpcMeta = (opts.grpcService || opts.grpcMethod)
      ? {
          service: opts.grpcService ?? '',
          method: opts.grpcMethod ?? '',
          callType: opts.grpcCallType ?? '',
          package: opts.grpcPackage ?? '',
          ...(protoFilePathForHistory ? { protoFilePath: protoFilePathForHistory } : {}),
          ...(opts.protoServices?.length ? { services: opts.protoServices } : {}),
        }
      : undefined;

    const resolvedMethod = opts.url.startsWith('grpc://')
      ? 'GRPC'
      : opts.url.startsWith('grpcs://')
        ? 'GRPCS'
        : opts.method;

    const requestState = {
      method: resolvedMethod,
      url: opts.url,
      headers: opts.headers,
      ...(requestBody ? { body: requestBody } : {}),
      ...(grpcMeta ? { grpcMeta } : {}),
    };

    const responseState = {
      body: bodyStr,
      error: opts.error ?? null,
      timing,
    };

    await context.history?.save(
      {
        pluginId: 'voiden-sockets',
        meta: {
          label: `${resolvedMethod} ${opts.url}`,
          method: resolvedMethod,
          url: opts.url,
          connectionMade: !opts.error,
          error: opts.error ?? null,
          duration: timing?.duration,
        },
        requestState,
        responseState,
        // Legacy fields kept for backward compat with old stored entries and cURL builder
        request: {
          method: resolvedMethod,
          url: opts.url,
          headers: opts.headers,
          ...(requestBody ? { body: requestBody } : {}),
          contentType: 'application/json',
          ...(grpcMeta ? { grpcMeta } : {}),
        },
        response: {
          body: bodyStr,
          error: opts.error ?? null,
          contentType: 'application/json',
          timing,
        },
      },
      sourceFilePath,
    );
  } catch (e) {
    console.error('[sockets history] Failed to save session history:', e);
  }
}
