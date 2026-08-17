/**
 * Tool Registry — lets the plugin that owns the `/tool` block declare its own
 * block→tool-declaration extraction, instead of voiden-runner's core
 * hardcoding knowledge of that block's shape.
 *
 * Mirrors requestContainerRegistry.ts exactly, but for a different purpose:
 * a `/tool` block is not itself a request container (it doesn't have a
 * url/method to expose) — it's a marker attached to a request that already
 * exists in the same section. So instead of a single `{type, urlType,
 * methodType}` definition per protocol, this registry holds *extraction
 * functions* (one per tool-owning plugin, realistically just one today) that
 * each get a section's blocks and return whatever `/tool` declarations they
 * find in it.
 *
 * Plugins call context.registerToolProvider() in their runner.ts onload().
 * Cleared/rebuilt fresh on every loadEnabledPlugins() call, same as the
 * other two registries — a disabled plugin's tools shouldn't linger.
 */

export type ToolParamType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
export type ToolVerifyRole = 'happy-path' | 'error-contract' | 'auth-check'
/** Per-verify-entry, not tool-wide (matches voiden-mcp-blocks-spec.md §1.9's
 *  illustrative shape, where only some entries specify a mode).
 *
 *  `sandbox` is a declarative label, not a redirection mechanism — Voiden
 *  does not substitute or validate any URL for it. It runs exactly like
 *  `live` (this is why the runnable-check below is `mode !== 'none'`, not
 *  `mode === 'live'` — sandbox needs zero special-casing). The *only*
 *  meaning it carries is "the request this entry points at already targets
 *  a sandbox endpoint, by the author's own choice" — same relationship
 *  `cadence` already has to voiden-runner: a tag Voiden reports/filters by,
 *  never interprets. If a row's referenced request doesn't actually target
 *  a sandbox URL, marking it `sandbox` doesn't protect anything — the
 *  author is responsible for that, same as choosing which URL to write in
 *  the request in the first place. */
export type ToolVerifyMode = 'live' | 'sandbox' | 'none'
export type ToolOnFailure = 'withdraw' | 'advertise-degraded'

export interface ToolParamDef {
  name: string
  binds: string
  type: ToolParamType
  required: boolean
  description?: string
  /** Every param is agent-supplied at call time — see toolBlocks.ts's
   *  matching type (the plugin-side source of truth) for the full
   *  reasoning. testValue is what verification substitutes in place of a
   *  live agent call. */
  testValue?: string
}

export interface ToolVerifyEntry {
  /** Defaults to the same file the /tool block lives in when omitted. */
  filePath?: string
  sectionLabel: string
  role: ToolVerifyRole
  /** Free-text tag (e.g. "nightly") — filtered by `voiden-runner tool verify --cadence`, not scheduled by voiden-runner itself. */
  cadence?: string
  /** Defaults to 'live' when omitted. 'none' skips running this specific entry automatically. */
  mode?: ToolVerifyMode
  /** Per-entry, not tool-wide — what happens to the whole tool if THIS
   *  request fails. When entries disagree, the most conservative failed one
   *  wins (any 'withdraw' among failed entries withdraws the tool). Defaults
   *  to 'withdraw' when omitted. */
  onFailure?: ToolOnFailure
}

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** What a tool-owning plugin's extraction function returns — everything
 *  derivable from a section's blocks alone. discoverTools() (toolVerification.ts)
 *  fills in filePath/sectionLabel, which the block itself can't know. */
export interface ToolExtraction {
  name: string
  title?: string
  description: string
  annotations?: ToolAnnotations
  toolBlockUid: string
  /** Best-effort link to the sibling request block's uid — informational only, not used to run the tool (that happens by filePath+sectionLabel). */
  requestUid?: string
  params: ToolParamDef[]
  verifies: ToolVerifyEntry[]
  /** Manual serve override, independent of verification state — set via the
   *  MCP tab's Serve preview. Core never interprets this, just carries it
   *  through; the plugin's own decideServing() is what acts on it. */
  enabled: boolean
  /** Cross-file/cross-section request binding — absent means "not bound,
   *  use the sibling request in this tool's own section" (the original
   *  behavior). Core never interprets this either, purely carried through. */
  requestFilePath?: string
  requestSectionLabel?: string
}

/** Full tool declaration once discovered project-wide. */
export interface ToolDef extends ToolExtraction {
  filePath: string
  sectionLabel?: string
}

export type ToolExtractFn = (blocks: any[]) => ToolExtraction[]

const providers: ToolExtractFn[] = []

export function registerToolProvider(extractFn: ToolExtractFn): void {
  providers.push(extractFn)
}

export function clearToolProviders(): void {
  providers.length = 0
}

/** Runs every registered extraction function against a section's blocks. */
export function extractTools(blocks: any[]): ToolExtraction[] {
  const found: ToolExtraction[] = []
  for (const extractFn of providers) {
    found.push(...extractFn(blocks))
  }
  return found
}

/** Returns whether any tool provider is currently registered — useful for debugging. */
export function hasToolProviders(): boolean {
  return providers.length > 0
}
