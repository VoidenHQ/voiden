/**
 * Pipeline hooks for voiden-history (core feature).
 *
 * pre-processing  (priority 50): captures the active tab's file path and project path.
 * post-processing (priority 50): asks the adapter registry which plugin owns this
 *   request, delegates entry building to it, then persists the result.
 *   Falls back to inline REST-API logic if no adapter is registered yet.
 */

import { FileAttachmentMeta, HistoryEntry } from './types';
import { useHistoryStore } from './historyStore';
import { appendToHistory } from './historyManager';
import { useResponseStore } from '@/core/request-engine/stores/responseStore';
import { historyAdapterRegistry } from './adapterRegistry';

/** Cached between pre-processing and post-processing within a single request */
let cachedFilePath: string | null = null;
let cachedProjectPath: string | null = null;

/**
 * Injected during core init — provides access to the project path getter
 * and the importCurl function without needing the plugin context in React components.
 */
export let getProjectPathFn: (() => Promise<string | null>) | null = null;
export let importCurlFn: ((title: string, curl: string) => Promise<void>) | null = null;
export let importVoidMarkdownFn: ((title: string, markdown: string) => Promise<void>) | null = null;

export function initHistoryContext(
  getProjectPath: () => Promise<string | null>,
  importCurl: (title: string, curl: string) => Promise<void>,
  importVoidMarkdown?: (title: string, markdown: string) => Promise<void>,
) {
  getProjectPathFn = getProjectPath;
  importCurlFn = importCurl;
  if (importVoidMarkdown) importVoidMarkdownFn = importVoidMarkdown;
}

/**
 * Stage 1 hook (pre-processing, priority 50).
 * Captures the current tab's source file path and project root path.
 */
export async function preProcessingHistoryHook(_context: any): Promise<void> {
  cachedFilePath = null;
  cachedProjectPath = null;

  try {
    const tabId = useResponseStore.getState().currentRequestTabId;
    if (!tabId) return;

    const panelData = await (window as any).electron?.state?.getPanelTabs('main');
    if (panelData?.tabs) {
      const tab = (panelData.tabs as any[]).find((t) => t.id === tabId && t.type === 'document');
      cachedFilePath = tab?.source ?? null;
    }

    if (getProjectPathFn) {
      cachedProjectPath = await getProjectPathFn();
    }
  } catch {
    // Swallow errors — history is best-effort
  }
}

/**
 * Stage 8 hook (post-processing, priority 50).
 *
 * Delegates entry building to the registered HistoryAdapter for this request.
 * If no adapter claims the request, falls back to the inline REST-API logic so
 * that history keeps working even if the REST-API plugin hasn't registered yet.
 */
export async function postProcessingHistoryHook(context: any): Promise<void> {
  const filePath = cachedFilePath;
  const projectPath = cachedProjectPath;

  cachedFilePath = null;
  cachedProjectPath = null;

  if (!filePath || !projectPath) return;

  const { requestState, responseState } = context;
  if (!requestState || !responseState) return;

  // Socket protocols (wss/ws/grpc/grpcs) save their own history via saveSessionToHistory
  // when the session ends — skip the REST pipeline entry to avoid duplicates.
  const proto = requestState.protocolType;
  if (proto === 'wss' || proto === 'ws' || proto === 'grpc' || proto === 'grpcs') return;

  try {
    // Respect user settings — history is opt-in (disabled unless explicitly enabled)
    const settings = await (window as any).electron?.userSettings?.get();
    if (!settings?.history?.enabled) return;
    const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));

    const adapter = historyAdapterRegistry.findForContext(context);

    let entry: HistoryEntry;

    if (adapter) {
      // ── Adapter path: plugin owns serialisation ───────────────────────────
      // Inject projectPath so the adapter can resolve project-relative file paths
      const pluginEntry = await adapter.captureEntry({ ...context, _projectPath: projectPath });

      entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        timestamp: Date.now(),
        pluginId: adapter.pluginId,
        meta: pluginEntry.meta,
        requestState: pluginEntry.requestState,
        responseState: pluginEntry.responseState,
        // Adapter may also populate legacy fields for cURL export / search
        ...((pluginEntry as any).request  ? { request:  (pluginEntry as any).request  } : {}),
        ...((pluginEntry as any).response ? { response: (pluginEntry as any).response } : {}),
      };
    } else {
      // ── Fallback path: inline REST-API logic (no adapter registered yet) ──
      entry = await buildFallbackEntry(requestState, responseState, projectPath);
    }

    const updated = await appendToHistory(projectPath, filePath, entry, retentionDays);
    const store = useHistoryStore.getState();
    store.setEntries(filePath, updated.entries);
    // Prepend to global history view so it refreshes without manual reload
    const entryWithFile = { ...entry, filePath };
    store.setAllEntries([entryWithFile, ...store.allEntries.filter((e) => e.id !== entryWithFile.id)]);
  } catch (e) {
    console.error('[history] Failed to save history entry:', e);
  }
}

// ─── Fallback (inline) entry builder ─────────────────────────────────────────
// Kept so that history still works if the REST-API plugin hasn't loaded yet.

async function buildFallbackEntry(requestState: any, responseState: any, projectPath: string | null): Promise<HistoryEntry> {
  const replaceVars = async (text: string): Promise<string> => {
    try {
      return await (window as any).electron?.env?.replaceVariables(text) ?? text;
    } catch {
      return text;
    }
  };

  const rawHeaders = ((requestState.headers ?? []) as any[]).filter((h: any) => h.enabled !== false && h.key);

  // ── Multipart file-attachment metadata ───────────────────────────────────
  // For multipart/form-data requests, capture file metadata instead of raw bytes.
  const isMultipart = ((requestState.content_type ?? requestState.contentType) ?? '').toLowerCase().includes('multipart');
  let fileAttachments: FileAttachmentMeta[] | undefined;

  const bodyParamsList: any[] = Array.isArray(requestState.bodyParams)
    ? requestState.bodyParams
    : Array.isArray(requestState.body_params) ? requestState.body_params : [];

  if (isMultipart && bodyParamsList.length > 0) {
    const fileParams = bodyParamsList.filter((p: any) => p.enabled !== false && p.type === 'file' && p.key);
    if (fileParams.length > 0) {
      fileAttachments = await Promise.all(
        fileParams.map(async (p: any): Promise<FileAttachmentMeta> => {
          const rawPath: string = typeof p.value === 'string'
            ? p.value.replace(/^@/, '')
            : '';

          let absolutePath = rawPath;
          let hashResult: { exists: boolean; hash?: string; size?: number } | null = null;
          if (rawPath) {
            try {
              hashResult = await (window as any).electron?.files?.hash?.(rawPath) ?? null;
              if (!hashResult?.exists && projectPath) {
                const joined = await (window as any).electron?.utils?.pathJoin?.(
                  projectPath,
                  rawPath.replace(/^[\\/]/, ''),
                );
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

  let rawBodyStr: string | undefined;
  if (typeof requestState.body === 'string' && requestState.body) {
    rawBodyStr = requestState.body;
  } else if (requestState.body !== null && requestState.body !== undefined && typeof requestState.body === 'object') {
    try { rawBodyStr = JSON.stringify(requestState.body); } catch { rawBodyStr = undefined; }
  } else if (bodyParamsList.length > 0) {
    const enabledParams = bodyParamsList.filter((p: any) => p.enabled !== false && p.key);
    if (isMultipart) {
      rawBodyStr = enabledParams
        .map((p: any) => p.type === 'file'
          ? `${p.key}=@${(typeof p.value === 'string' ? p.value.replace(/^@/, '') : '').split('/').pop() ?? '(file)'}`
          : `${p.key}=${p.value ?? ''}`)
        .join(' | ');
    } else {
      rawBodyStr = enabledParams
        .map((p: any) => `${p.key}=${p.value ?? ''}`)
        .join('&');
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

  let responseBody: string | undefined;
  if (responseState.body !== null && responseState.body !== undefined) {
    try {
      const raw = typeof responseState.body === 'string'
        ? responseState.body
        : JSON.stringify(responseState.body, null, 2);
      responseBody = raw.length > 102400 ? raw.slice(0, 102400) + '\n… (truncated)' : raw;
    } catch { /* skip */ }
  }

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    timestamp: Date.now(),
    request: {
      method: requestState.method ?? 'GET',
      url: resolvedUrl,
      headers: resolvedHeaders,
      body: resolvedBody,
      contentType: requestState.content_type ?? requestState.contentType ?? undefined,
      ...(fileAttachments?.length ? { fileAttachments } : {}),
    },
    response: {
      status: responseState.status,
      statusText: responseState.statusText,
      contentType: responseState.contentType ?? null,
      timing: responseState.timing ? { duration: responseState.timing.duration } : undefined,
      bytesContent: responseState.bytesContent,
      error: responseState.error ?? null,
      body: responseBody,
      headers: responseState.headers ?? [],
    },
  };
}
