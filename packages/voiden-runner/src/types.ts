// ─── Block ────────────────────────────────────────────────────────────────────

export interface Block {
  type: string
  attrs?: Record<string, any>
  content?: Block[] | string
}

// ─── Protocol request / result types (from shared executors package) ──────────

export type {
  WebSocketRequest,
  GrpcRequest,
  RunResult as BaseRunResult,
} from '@voiden/executors'

// ─── Report entries ───────────────────────────────────────────────────────────

export type CliReportEntry =
  | { type: 'assertion'; message: string; passed: boolean; actual?: any; expected?: any; operator?: string }
  | { type: 'log';       message: string; level?: 'info' | 'debug' | 'warn' | 'error' | 'log' }
  | { type: 'section';   title: string;   message?: string }

// ─── Runner-extended result ───────────────────────────────────────────────────
//
// Extends the base RunResult with plugin report entries and legacy assertion
// fields that the CLI output layer uses.

import type { RunResult as _RunResult } from '@voiden/executors'

export interface RunResult extends _RunResult {
  /** Structured entries emitted by plugins during the run */
  reportEntries?: CliReportEntry[]
  /** Sent request headers (key → value map) */
  requestHeaders?: Record<string, string>
  /** Serialised request body that was sent */
  requestBody?: string
  /** Response headers (key → value map) */
  responseHeaders?: Record<string, string>
  /** @deprecated Use reportEntries with type:'assertion' instead */
  assertions?: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any }>
  assertionsPassed?: number
  assertionsFailed?: number
}
