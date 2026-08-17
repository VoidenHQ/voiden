import type { RequestAuth } from '../pipeline/types.js'

/** Fully materialized outgoing request, right before it is sent. */
export interface SecureAuthApplyContext {
  method: string
  url: string
  /** Mutated in place by apply() — e.g. to set Authorization / X-Amz-Date. */
  headers: Record<string, string>
  payload: Uint8Array
  /** Whatever this provider's resolveConfig() returned for this request. */
  config: unknown
  resolveVar: (text: string) => Promise<string>
  now: () => Date
}

export interface SecureAuthApplyResult {
  /**
   * Force manual redirect handling for this response. NOTE: executeSecureRequest
   * decides fetchOptions.redirect before apply() runs (driven by the static
   * forcesManualRedirect flag), so this field is not currently consumed — it is
   * reserved for a future per-request override, not dead code.
   */
  redirect?: 'manual'
  /** Header names (case-insensitive) to redact as '[REDACTED]' in requestMeta.headers. */
  sensitiveHeaders?: string[]
}

export interface SecureAuthProvider {
  /** Human-readable id, also used in generic error messages (e.g. "AWS SigV4"). */
  id: string
  /** requestState.auth.type values this provider handles (aliases included). */
  authTypes: string[]
  /**
   * True if a followed redirect could invalidate this provider's signature (changed
   * host/path/query). When true, executeSecureRequest always uses redirect: 'manual'
   * for requests using this provider, regardless of adapter.followRedirects.
   * Defaults to false.
   */
  forcesManualRedirect?: boolean
  /**
   * False if this provider cannot sign a multipart/form-data body (no deterministic
   * payload bytes). executeSecureRequest rejects such requests before building the
   * FormData / reading files. Defaults to true.
   */
  supportsMultipartBody?: boolean
  /**
   * Resolve + validate this provider's config from requestState.auth (variable
   * templates included). Runs once, right after the request body is materialized.
   * Throw to fail the request before any body-building or network I/O.
   */
  resolveConfig(auth: RequestAuth, resolveVar: (text: string) => Promise<string>): Promise<unknown>
  /**
   * Optional pre-flight check against the final outgoing URL, run once right after
   * the URL is materialized (before protocol handoff / body building).
   */
  validateUrl?(url: string, config: unknown): void
  /** Sign / mutate the fully materialized request. Runs once, right before fetch. */
  apply(context: SecureAuthApplyContext): SecureAuthApplyResult | Promise<SecureAuthApplyResult>
}
