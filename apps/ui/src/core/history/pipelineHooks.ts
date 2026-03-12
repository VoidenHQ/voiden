/**
 * Pipeline hooks for voiden-history (core feature).
 *
 * pre-processing (priority 50): captures the active tab's file path and project path.
 * post-processing (priority 50): builds a history entry and persists it to disk.
 */

import { HistoryEntry } from './types';
import { useHistoryStore } from './historyStore';
import { appendToHistory } from './historyManager';
import { useResponseStore } from '@/core/request-engine/stores/responseStore';

/** Cached between pre-processing and post-processing within a single request */
let cachedFilePath: string | null = null;
let cachedProjectPath: string | null = null;

/**
 * Injected during core init — provides access to the project path getter
 * and the importCurl function without needing the plugin context in React components.
 */
export let getProjectPathFn: (() => Promise<string | null>) | null = null;
export let importCurlFn: ((title: string, curl: string) => Promise<void>) | null = null;

export function initHistoryContext(
  getProjectPath: () => Promise<string | null>,
  importCurl: (title: string, curl: string) => Promise<void>,
) {
  getProjectPathFn = getProjectPath;
  importCurlFn = importCurl;
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

    // Resolve file path from panel tabs
    const panelData = await (window as any).electron?.state?.getPanelTabs('main');
    if (panelData?.tabs) {
      const tab = (panelData.tabs as any[]).find((t) => t.id === tabId && t.type === 'document');
      cachedFilePath = tab?.source ?? null;
    }

    // Resolve project root
    if (getProjectPathFn) {
      cachedProjectPath = await getProjectPathFn();
    }
  } catch {
    // Swallow errors — history is best-effort
  }
}

/**
 * Stage 8 hook (post-processing, priority 50).
 * Builds a HistoryEntry from pipeline state and appends it to the history file.
 */
export async function postProcessingHistoryHook(context: any): Promise<void> {
  const filePath = cachedFilePath;
  const projectPath = cachedProjectPath;

  // Reset cached values regardless of outcome
  cachedFilePath = null;
  cachedProjectPath = null;

  if (!filePath || !projectPath) return;

  const { requestState, responseState } = context;
  if (!requestState || !responseState) return;

  try {
    // Respect user settings
    const settings = await (window as any).electron?.userSettings?.get();
    if (settings?.history?.enabled === false) return;
    const retentionDays = Math.min(90, Math.max(1, settings?.history?.retention_days ?? 2));

    // Use the platform's secure env:replaceVariables IPC to resolve all {{VAR}} and {{process.xxx}}
    const replaceVars = async (text: string): Promise<string> => {
      try {
        return await (window as any).electron?.env?.replaceVariables(text) ?? text;
      } catch {
        return text;
      }
    };

    const rawHeaders = ((requestState.headers ?? []) as any[]).filter((h) => h.enabled !== false && h.key);

    // Resolve body: string → replace vars; object → JSON.stringify then replace; bodyParams → serialize as form
    let rawBodyStr: string | undefined;
    if (typeof requestState.body === 'string' && requestState.body) {
      rawBodyStr = requestState.body;
    } else if (requestState.body !== null && requestState.body !== undefined && typeof requestState.body === 'object') {
      try { rawBodyStr = JSON.stringify(requestState.body); } catch { rawBodyStr = undefined; }
    } else if (Array.isArray(requestState.bodyParams) && requestState.bodyParams.length > 0) {
      rawBodyStr = (requestState.bodyParams as any[])
        .filter((p) => p.enabled !== false && p.key)
        .map((p) => `${p.key}=${p.value ?? ''}`)
        .join('&');
    }

    const [resolvedUrl, resolvedBody, resolvedHeaders] = await Promise.all([
      replaceVars(requestState.url ?? ''),
      rawBodyStr !== undefined ? replaceVars(rawBodyStr) : Promise.resolve(undefined),
      Promise.all(rawHeaders.map(async (h) => ({
        key:   await replaceVars(h.key),
        value: await replaceVars(h.value ?? ''),
      }))),
    ]);

    // Serialize response body (cap at 100 KB)
    let responseBody: string | undefined;
    if (responseState.body !== null && responseState.body !== undefined) {
      try {
        const raw = typeof responseState.body === 'string'
          ? responseState.body
          : JSON.stringify(responseState.body, null, 2);
        responseBody = raw.length > 102400 ? raw.slice(0, 102400) + '\n… (truncated)' : raw;
      } catch { /* skip */ }
    }

    const entry: HistoryEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      timestamp: Date.now(),
      request: {
        method: requestState.method ?? 'GET',
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: resolvedBody,
        contentType: requestState.contentType ?? undefined,
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

    const updated = await appendToHistory(projectPath, filePath, entry, retentionDays);
    useHistoryStore.getState().setEntries(filePath, updated.entries);
  } catch (e) {
    console.error('[history] Failed to save history entry:', e);
  }
}
