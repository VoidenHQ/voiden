import { HistoryEntryMeta } from './adapterRegistry';

/**
 * Metadata captured for a file attached via multipart/form-data.
 * Raw file content is NOT stored — only enough info to detect changes and warn on replay.
 */
export interface FileAttachmentMeta {
  /** Multipart form field name */
  key: string;
  /** Original filename */
  name: string;
  /** Absolute file path at time of capture (used for change detection on replay) */
  path?: string;
  /** File size in bytes at capture time */
  size?: number;
  /** SHA-256 hex digest of the file at capture time — used for change detection on replay */
  hash?: string;
  /** MIME type */
  mimeType?: string;
}

// ─── Legacy shapes (kept for backward compat with old stored entries) ─────────

export interface HistoryRequestEntry {
  method: string;
  url: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  contentType?: string;
  /**
   * File attachments from multipart/form-data requests.
   * Only metadata is stored (no content) so replays can warn if a file has changed.
   */
  fileAttachments?: FileAttachmentMeta[];
  /**
   * gRPC session metadata (only present for GRPC/GRPCS entries).
   * Used to reconstruct the proto node when exporting to .void file.
   */
  grpcMeta?: {
    service: string;
    method: string;
    callType: string;
    package: string;
    /** Relative path if proto is inside the project, absolute if outside */
    protoFilePath?: string;
    /** Parsed proto services — used to populate proto node on replay */
    services?: Array<{
      name: string;
      methods: Array<{ name: string; request: string; response: string; callType: string }>;
    }>;
  };
}

export interface HistoryResponseEntry {
  status?: number;
  statusText?: string;
  contentType?: string | null;
  timing?: { duration: number };
  bytesContent?: number;
  error?: string | null;
  /** Serialized response body (capped at 100 KB to avoid bloating history files) */
  body?: string;
  /** Response headers */
  headers?: Array<{ key: string; value: string }>;
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  timestamp: number;

  // ── New adapter-based fields (present on entries created after the refactor) ──

  /** ID of the plugin adapter that owns this entry */
  pluginId?: string;
  /** Standardised metadata for the entry card header */
  meta?: HistoryEntryMeta;
  /** Plugin-owned request state — opaque to core */
  requestState?: unknown;
  /** Plugin-owned response state — opaque to core */
  responseState?: unknown;

  // ── Legacy fields (entries written before the refactor, and REST API entries
  //    that still populate these for cURL export / full-text search) ──────────

  /** Plugin ID that saved this entry (e.g. 'voiden-rest-api'). Set by context.history.save(). */
  source?: string;
  request?: HistoryRequestEntry;
  response?: HistoryResponseEntry;
}

export interface HistoryFile {
  version: string;
  filePath: string;
  entries: HistoryEntry[];
}

/** HistoryEntry annotated with its source .void file path — used in the global history view */
export interface HistoryEntryWithFile extends HistoryEntry {
  filePath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns display meta for an entry.
 * Prefers the adapter-populated `meta` field; falls back to legacy `request`/`response`.
 */
export function getEntryMeta(entry: HistoryEntry): HistoryEntryMeta {
  if (entry.meta) return entry.meta;
  return {
    label: `${entry.request?.method ?? 'GET'} ${entry.request?.url ?? ''}`,
    method: entry.request?.method,
    url: entry.request?.url ?? '',
    connectionMade: !entry.response?.error,
    statusCode: entry.response?.status,
    statusText: entry.response?.statusText,
    error: entry.response?.error ?? null,
    duration: entry.response?.timing?.duration,
    bytesContent: entry.response?.bytesContent,
  };
}

/** Returns the pluginId for an entry, defaulting to the REST API plugin. */
export function getEntryPluginId(entry: HistoryEntry): string {
  return entry.pluginId ?? 'voiden-rest-api';
}
