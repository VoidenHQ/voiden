/**
 * History Adapter Registry
 *
 * Plugins register a HistoryAdapter to own their request/response data in history.
 * Core only knows about the standardised HistoryEntryMeta (for the card header).
 * Everything else (viewers, export, serialisation) is delegated to the plugin.
 */

import React from 'react';

// ─── Shared meta shape (shown in the entry card header) ──────────────────────

export interface HistoryEntryMeta {
  /** Human-readable label, e.g. "GET /users" or "ws://chat.example.com" */
  label: string;
  /** HTTP verb or equivalent, e.g. "GET", "POST" */
  method?: string;
  /** Full request URL */
  url: string;
  /** True = request reached the server without a network error */
  connectionMade: boolean;
  /** HTTP status code or protocol-equivalent */
  statusCode?: number;
  statusText?: string;
  /** Network / protocol error message (null if none) */
  error?: string | null;
  /** Round-trip time in milliseconds */
  duration?: number;
  /** Response size in bytes */
  bytesContent?: number;
}

// ─── What captureEntry must return ───────────────────────────────────────────

export interface HistoryPluginEntry {
  /** Standard header data for the entry card */
  meta: HistoryEntryMeta;
  /** Plugin-owned request state — opaque to core, passed to RequestViewer & exportToVoid */
  requestState: unknown;
  /** Plugin-owned response state — opaque to core, passed to ResponseViewer & exportToVoid */
  responseState: unknown;
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface HistoryAdapter {
  /** Must match the plugin's extension ID */
  pluginId: string;

  /**
   * Return true if this adapter owns the request described by pipelineContext.
   * Called once per request during post-processing.
   */
  canHandle(pipelineContext: any): boolean;

  /**
   * Serialise request + response data into a storable entry.
   * Responsible for: variable resolution, file → string, 100 KB cap, etc.
   */
  captureEntry(pipelineContext: any): Promise<HistoryPluginEntry> | HistoryPluginEntry;

  /**
   * Convert a stored entry to a .void markdown string for export.
   * If omitted, export is silently skipped for this entry.
   */
  exportToVoid?(entry: any): Promise<string> | string;

  /** Component shown in the "Request" tab of the expanded entry card */
  RequestViewer: React.FC<{ requestState: unknown }>;

  /**
   * Component shown in the "Response" tab.
   * null → core will not render a response tab (useful for one-shot protocols).
   * requestState is passed as context (e.g. to distinguish WS vs gRPC).
   */
  ResponseViewer: React.FC<{ responseState: unknown; requestState?: unknown }> | null;
}

// ─── Registry singleton ───────────────────────────────────────────────────────

class HistoryAdapterRegistry {
  private adapters = new Map<string, HistoryAdapter>();

  register(adapter: HistoryAdapter): void {
    this.adapters.set(adapter.pluginId, adapter);
  }

  unregister(pluginId: string): void {
    this.adapters.delete(pluginId);
  }

  /** Find the first adapter whose canHandle() returns true for this context */
  findForContext(pipelineContext: any): HistoryAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      try {
        if (adapter.canHandle(pipelineContext)) return adapter;
      } catch {
        /* never let a bad adapter break history */
      }
    }
    return undefined;
  }

  /** Direct lookup by pluginId — used at render/export time */
  get(pluginId: string): HistoryAdapter | undefined {
    return this.adapters.get(pluginId);
  }

  /** Called during plugin system reload */
  clear(): void {
    this.adapters.clear();
  }
}

export const historyAdapterRegistry = new HistoryAdapterRegistry();
