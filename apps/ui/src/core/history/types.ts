export interface HistoryRequestEntry {
  method: string;
  url: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  contentType?: string;
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

export interface HistoryEntry {
  id: string;
  timestamp: number;
  request: HistoryRequestEntry;
  response: HistoryResponseEntry;
}

export interface HistoryFile {
  version: string;
  filePath: string;
  entries: HistoryEntry[];
}
