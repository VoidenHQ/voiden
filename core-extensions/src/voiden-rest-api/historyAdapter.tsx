/**
 * REST-API History Adapter
 *
 * Registered with core's historyAdapterRegistry on plugin load.
 * Owns everything history-related for REST / HTTP / GraphQL query+mutation requests:
 *   - canHandle()      — claims the entry if the response protocol is http/rest/graphql-query
 *   - captureEntry()   — resolves variables, serialises the entry (converts File → "@filename")
 *   - exportToVoid()   — produces a .void markdown string using plugin-owned nodes
 *   - RequestViewer    — React component for the "Request" tab in the history entry card
 *   - ResponseViewer   — React component for the "Response" tab
 */

import React, { useState } from 'react';

// ─── Adapter contract types (mirrors adapterRegistry — defined locally to avoid cross-rootDir import) ──

interface HistoryEntryMeta {
  label: string;
  method?: string;
  url: string;
  connectionMade: boolean;
  statusCode?: number;
  statusText?: string;
  error?: string | null;
  duration?: number;
  bytesContent?: number;
}

interface HistoryPluginEntry {
  meta: HistoryEntryMeta;
  requestState: unknown;
  responseState: unknown;
}

interface HistoryAdapter {
  pluginId: string;
  canHandle(pipelineContext: any): boolean;
  captureEntry(pipelineContext: any): Promise<HistoryPluginEntry> | HistoryPluginEntry;
  exportToVoid?(entry: any): Promise<string> | string;
  RequestViewer: React.FC<{ requestState: unknown }> | null;
  ResponseViewer: React.FC<{ responseState: unknown }> | null;
}

// ─── Types (mirrors RestApiRequestState / RestApiResponseState) ───────────────

interface FileAttachmentMeta {
  key: string;
  name: string;
  path?: string;
  size?: number;
  hash?: string;
  mimeType?: string;
}

interface SerializedRequestState {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  contentType?: string;
  fileAttachments?: FileAttachmentMeta[];
}

interface SerializedResponseState {
  status?: number;
  statusText?: string;
  contentType?: string | null;
  duration?: number;
  bytesContent?: number;
  error?: string | null;
  body?: string;
  headers: Array<{ key: string; value: string }>;
}

// ─── Viewer helpers ───────────────────────────────────────────────────────────

const KVList: React.FC<{ items: Array<{ key: string; value: string }> }> = ({ items }) => (
  <div style={{ fontFamily: 'monospace', fontSize: 11, overflowX: 'auto' }}>
    {items.map((h, i) => (
      <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span style={{ color: 'var(--color-comment)', minWidth: 120, flexShrink: 0 }}>{h.key}</span>
        <span style={{ color: 'var(--color-text)', wordBreak: 'break-all' }}>{h.value}</span>
      </div>
    ))}
  </div>
);

const BodyBlock: React.FC<{ body: string }> = ({ body }) => (
  <pre style={{
    fontFamily: 'monospace',
    fontSize: 11,
    overflowX: 'auto',
    maxHeight: 280,
    overflowY: 'auto',
    margin: 0,
    padding: '6px 8px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--color-text)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }}>
    {body}
  </pre>
);

const Section: React.FC<{ label: string; count?: number; children: React.ReactNode }> = ({ label, count, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-comment)', fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          padding: '4px 0', width: '100%', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 8 }}>{open ? '▼' : '▶'}</span>
        {label}{count !== undefined ? ` (${count})` : ''}
      </button>
      {open && children}
    </div>
  );
};

// ─── RequestViewer ────────────────────────────────────────────────────────────

export const RestApiRequestViewer: React.FC<{ requestState: unknown }> = ({ requestState }) => {
  const req = requestState as SerializedRequestState | null;
  if (!req) return <p style={{ fontSize: 11, color: 'var(--color-comment)', padding: 8 }}>No request data.</p>;

  return (
    <div style={{ padding: '8px 12px', fontSize: 11 }}>
      {/* Full URL */}
      <div style={{
        fontFamily: 'monospace', fontSize: 11,
        background: 'rgba(255,255,255,0.04)', borderRadius: 4,
        padding: '6px 8px', wordBreak: 'break-all',
        color: 'var(--color-text)', marginBottom: 8,
      }}>
        {req.url}
      </div>

      {/* Headers */}
      {req.headers && req.headers.length > 0 && (
        <Section label="Headers" count={req.headers.length}>
          <KVList items={req.headers} />
        </Section>
      )}

      {/* File attachments (multipart) */}
      {req.fileAttachments && req.fileAttachments.length > 0 && (
        <Section label="Files" count={req.fileAttachments.length}>
          <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {req.fileAttachments.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: 'var(--color-comment)', minWidth: 100, flexShrink: 0 }}>{a.key}</span>
                <span style={{ color: 'var(--color-text)', wordBreak: 'break-all' }}>@{a.name}</span>
                {a.size !== undefined && (
                  <span style={{ color: 'var(--color-comment)', marginLeft: 'auto', flexShrink: 0, fontSize: 10 }}>
                    {a.size < 1024 ? `${a.size} B` : a.size < 1048576 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / 1048576).toFixed(1)} MB`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Body (non-multipart only) */}
      {req.body && !req.fileAttachments?.length && (
        <Section label="Body">
          <BodyBlock body={req.body} />
        </Section>
      )}
    </div>
  );
};

// ─── ResponseViewer ───────────────────────────────────────────────────────────

export const RestApiResponseViewer: React.FC<{ responseState: unknown }> = ({ responseState }) => {
  const res = responseState as SerializedResponseState | null;
  if (!res) return <p style={{ fontSize: 11, color: 'var(--color-comment)', padding: 8 }}>No response data.</p>;

  const statusColor = res.error || !res.status
    ? '#f87171'
    : res.status < 300 ? '#4ade80'
    : res.status < 400 ? '#fbbf24'
    : '#f87171';

  return (
    <div style={{ padding: '8px 12px', fontSize: 11 }}>
      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: statusColor }}>
          {res.error ? 'Error' : `${res.status ?? '—'} ${res.statusText ?? ''}`}
        </span>
        {res.contentType && (
          <span style={{ fontFamily: 'monospace', color: 'var(--color-comment)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {res.contentType}
          </span>
        )}
      </div>

      {/* Error */}
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

      {/* Response headers */}
      {res.headers && res.headers.length > 0 && (
        <Section label="Headers" count={res.headers.length}>
          <KVList items={res.headers} />
        </Section>
      )}

      {/* Response body */}
      {res.body && (
        <Section label="Body">
          <BodyBlock body={res.body} />
        </Section>
      )}

      {!res.error && !res.body && (!res.headers || res.headers.length === 0) && (
        <p style={{ fontSize: 10, color: 'var(--color-comment)', fontStyle: 'italic' }}>No response data recorded.</p>
      )}
    </div>
  );
};

// ─── captureEntry ─────────────────────────────────────────────────────────────

async function captureEntry(pipelineContext: any): Promise<HistoryPluginEntry & {
  request: any;
  response: any;
}> {
  const { requestState, responseState, _projectPath: projectPath = null } = pipelineContext;

  const replaceVars = async (text: string): Promise<string> => {
    try {
      return await (window as any).electron?.env?.replaceVariables(text) ?? text;
    } catch {
      return text;
    }
  };

  // ── Resolve request fields ─────────────────────────────────────────────────

  const rawHeaders = ((requestState.headers ?? []) as any[]).filter((h: any) => h.enabled !== false && h.key);

  // content_type is the field name from getRequestFromJson; contentType is a legacy alias
  const isMultipart = ((requestState.content_type ?? requestState.contentType) ?? '').toLowerCase().includes('multipart');
  const bodyParamsList: any[] = Array.isArray(requestState.bodyParams)
    ? requestState.bodyParams
    : Array.isArray(requestState.body_params) ? requestState.body_params : [];

  // ── Capture file attachment metadata for multipart requests ────────────────

  let fileAttachments: FileAttachmentMeta[] | undefined;
  if (isMultipart && bodyParamsList.length > 0) {
    const fileParams = bodyParamsList.filter((p: any) => p.enabled !== false && p.type === 'file' && p.key);
    if (fileParams.length > 0) {
      fileAttachments = await Promise.all(
        fileParams.map(async (p: any): Promise<FileAttachmentMeta> => {
          const rawPath: string = p.value instanceof File
            ? p.value.name
            : typeof p.value === 'string' ? p.value.replace(/^@/, '') : '';

          let absolutePath = rawPath;
          let hashResult: { exists: boolean; hash?: string; size?: number } | null = null;
          if (rawPath) {
            try {
              hashResult = await (window as any).electron?.files?.hash?.(rawPath) ?? null;
              if (!hashResult?.exists && projectPath) {
                // rawPath may be project-relative (e.g. "\docs\photo.jpg" or "photo.jpg")
                // — try joining with the project root to get the absolute path
                const joined = await (window as any).electron?.utils?.pathJoin?.(
                  projectPath,
                  rawPath.replace(/^[/\\]+/, ''),
                ) ?? null;
                if (joined) {
                  const joinedResult = await (window as any).electron?.files?.hash?.(joined) ?? null;
                  if (joinedResult?.exists) {
                    absolutePath = joined;
                    hashResult = joinedResult;
                  }
                }
              }
            } catch { /* best-effort */ }
          }

          const meta: FileAttachmentMeta = {
            key: p.key,
            name: rawPath.split(/[/\\]/).pop() ?? rawPath,
            path: absolutePath || undefined,
            mimeType: p.contentType ?? p.mimeType ?? undefined,
          };
          if (hashResult?.exists) {
            meta.hash = hashResult.hash;
            meta.size = hashResult.size;
          }
          return meta;
        }),
      );
    }
  }

  // ── Build raw body string ──────────────────────────────────────────────────

  let rawBodyStr: string | undefined;
  if (typeof requestState.body === 'string' && requestState.body) {
    rawBodyStr = requestState.body;
  } else if (requestState.body !== null && requestState.body !== undefined && typeof requestState.body === 'object') {
    try { rawBodyStr = JSON.stringify(requestState.body); } catch { /* skip */ }
  } else if (bodyParamsList.length > 0) {
    const enabledParams = bodyParamsList.filter((p: any) => p.enabled !== false && p.key);
    if (isMultipart) {
      // Pipe-separated summary: file params show @basename, text params show value
      rawBodyStr = enabledParams
        .map((p: any) => {
          if (p.type === 'file') {
            const rawPath = p.value instanceof File
              ? p.value.name
              : typeof p.value === 'string' ? p.value.replace(/^@/, '') : '';
            const basename = rawPath.split(/[/\\]/).pop() ?? '(file)';
            return `${p.key}=@${basename}`;
          }
          return `${p.key}=${p.value ?? ''}`;
        })
        .join(' | ');
    } else {
      rawBodyStr = enabledParams.map((p: any) => `${p.key}=${p.value ?? ''}`).join('&');
    }
  }

  const [resolvedUrl, resolvedBody, resolvedHeaders] = await Promise.all([
    replaceVars(requestState.url ?? ''),
    rawBodyStr !== undefined ? replaceVars(rawBodyStr) : Promise.resolve(undefined),
    Promise.all(rawHeaders.map(async (h: any) => ({
      key:   await replaceVars(h.key),
      value: await replaceVars(h.value ?? ''),
    }))),
  ]);

  // ── Serialise response body (cap at 100 KB) ────────────────────────────────

  let responseBody: string | undefined;
  if (responseState.body !== null && responseState.body !== undefined) {
    try {
      const raw = typeof responseState.body === 'string'
        ? responseState.body
        : JSON.stringify(responseState.body, null, 2);
      responseBody = raw.length > 102400 ? raw.slice(0, 102400) + '\n… (truncated)' : raw;
    } catch { /* skip */ }
  }

  // ── Build meta ─────────────────────────────────────────────────────────────

  const meta: HistoryEntryMeta = {
    label: `${requestState.method ?? 'GET'} ${resolvedUrl}`,
    method: requestState.method ?? 'GET',
    url: resolvedUrl,
    connectionMade: !responseState.error,
    statusCode: responseState.status,
    statusText: responseState.statusText,
    error: responseState.error ?? null,
    duration: responseState.timing?.duration,
    bytesContent: responseState.bytesContent,
  };

  // ── Plugin-owned states ────────────────────────────────────────────────────

  const serializedRequest: SerializedRequestState = {
    method: requestState.method ?? 'GET',
    url: resolvedUrl,
    headers: resolvedHeaders,
    body: resolvedBody,
    contentType: requestState.content_type ?? requestState.contentType ?? undefined,
    ...(fileAttachments?.length ? { fileAttachments } : {}),
  };

  const serializedResponse: SerializedResponseState = {
    status: responseState.status,
    statusText: responseState.statusText,
    contentType: responseState.contentType ?? null,
    duration: responseState.timing?.duration,
    bytesContent: responseState.bytesContent,
    error: responseState.error ?? null,
    body: responseBody,
    headers: responseState.headers ?? [],
  };

  return {
    meta,
    requestState: serializedRequest,
    responseState: serializedResponse,
    // Also populate legacy fields so cURL export and full-text search keep working
    request: {
      method: serializedRequest.method,
      url: serializedRequest.url,
      headers: serializedRequest.headers,
      body: serializedRequest.body,
      contentType: serializedRequest.contentType,
      ...(fileAttachments?.length ? { fileAttachments } : {}),
    },
    response: {
      status: serializedResponse.status,
      statusText: serializedResponse.statusText,
      contentType: serializedResponse.contentType,
      timing: serializedResponse.duration !== undefined ? { duration: serializedResponse.duration } : undefined,
      bytesContent: serializedResponse.bytesContent,
      error: serializedResponse.error,
      body: serializedResponse.body,
      headers: serializedResponse.headers,
    },
  };
}

// ─── exportToVoid ─────────────────────────────────────────────────────────────

async function exportToVoid(entry: any): Promise<string> {
  const req = (entry.requestState ?? entry.request) as SerializedRequestState | undefined;
  if (!req) return '';

  const content: any[] = [];

  content.push({
    type: 'method',
    attrs: { method: req.method },
    content: [{ type: 'text', text: req.method }],
  });

  content.push({
    type: 'url',
    content: [{ type: 'text', text: req.url }],
  });

  if (req.headers && req.headers.length > 0) {
    content.push({
      type: 'headers-table',
      content: [{
        type: 'table',
        content: req.headers.map((hdr) => ({
          type: 'tableRow',
          attrs: { disabled: false },
          content: [hdr.key, hdr.value].map((col) => ({
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: col ? [{ type: 'text', text: col }] : [] }],
          })),
        })),
      }],
    });
  }

  const isMultipart = (req.contentType ?? '').toLowerCase().includes('multipart');

  if (isMultipart && req.fileAttachments?.length) {
    // ── Multipart body: build multipart-table node with fileLink nodes ────────
    const makeCell = (content: any[]) => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: 'paragraph', content }],
    });

    const fileKeySet = new Set(req.fileAttachments.map((a: FileAttachmentMeta) => a.key));
    const rows: any[] = [];

    // File rows — each attachment gets a fileLink node in the value cell
    for (const att of req.fileAttachments) {
      const resolvedPath = att.path ?? att.name;
      rows.push({
        type: 'tableRow',
        attrs: { disabled: false },
        content: [
          makeCell(att.key ? [{ type: 'text', text: att.key }] : []),
          makeCell([{
            type: 'fileLink',
            attrs: { filePath: resolvedPath, filename: att.name, isExternal: true },
          }]),
        ],
      });
    }

    // Text rows — parsed from pipe-separated body summary: key=@basename | textkey=value
    if (req.body) {
      for (const field of req.body.split(' | ')) {
        const eqIdx = field.indexOf('=');
        if (eqIdx === -1) continue;
        const key = field.slice(0, eqIdx).trim();
        if (fileKeySet.has(key)) continue; // already added as file row
        const val = field.slice(eqIdx + 1).trim().replace(/^@/, '');
        rows.push({
          type: 'tableRow',
          attrs: { disabled: false },
          content: [
            makeCell(key ? [{ type: 'text', text: key }] : []),
            makeCell(val ? [{ type: 'text', text: val }] : []),
          ],
        });
      }
    }

    if (rows.length > 0) {
      content.push({
        type: 'multipart-table',
        content: [{ type: 'table', content: rows }],
      });
    }
  } else if (req.body) {
    const ct = (req.contentType ?? '').toLowerCase();
    const trimmed = req.body.trim();
    if (ct.includes('xml') || (!ct && trimmed.startsWith('<'))) {
      content.push({
        type: 'xml_body',
        attrs: { importedFrom: '', body: req.body, contentType: req.contentType ?? 'application/xml' },
      });
    } else {
      let body = req.body;
      try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* keep as-is */ }
      content.push({
        type: 'json_body',
        attrs: { importedFrom: '', body, contentType: req.contentType ?? 'application/json' },
      });
    }
  }

  const doc = { type: 'doc', content };

  // Dynamic import — prosemirrorToMarkdown lives in the app, not this package
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

export const restApiHistoryAdapter: HistoryAdapter = {
  pluginId: 'voiden-rest-api',

  canHandle(ctx: any): boolean {
    const proto = ctx?.responseState?.protocol;
    if (!proto) return false;
    if (proto === 'rest' || proto === 'http' || proto === 'https') return true;
    if (
      proto === 'graphql' &&
      (ctx?.responseState?.operationType === 'query' || ctx?.responseState?.operationType === 'mutation')
    ) return true;
    return false;
  },

  captureEntry,
  exportToVoid,

  RequestViewer: null,
  ResponseViewer: null,
};
