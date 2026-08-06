/**
 * voiden-runner — core runner
 *
 * Flow for each section in a .void file:
 *   1. loadEnabledPlugins() — derives the list from core-plugins-registry.json
 *      a. Parser plugins (graphql, sockets, rest-api) load their runner.ts and
 *         call context.onBuildRequest() to register block→request builders with
 *         the shared RequestOrchestrator from @voiden/executors
 *      b. Hook plugins (scripting, faker, auth, assertions) load their plugin.ts and
 *         call context.pipeline.registerHook() to wire into the shared pipeline
 *   2. For each section:
 *      a. normalizeBlocks() fills in default attr values from registered schemas
 *      b. Build a headless editor shim ({ getJSON() }) that returns the blocks
 *      c. requestOrchestrator.executeRequest(editor, cliElectron) runs the full
 *         chain — identical to how the Electron app uses requestOrchestrator
 *   3. Map PipelineResponse → RunResult
 */

import { readFileSync } from 'fs'
import { requestOrchestrator, classifyBlockVersion, parseVoidFileSections } from '@voiden/executors'
import type { PipelineResponse } from '@voiden/executors'
import { createCliElectron } from './cliElectron.js'
import { loadEnabledPlugins } from './plugins/loader.js'
import { getInstalledPluginInfo } from './plugins/versionInfo.js'
import { normalizeBlocks } from './blockSchemaRegistry.js'
import { findRequestBlock as findRegisteredRequestBlock, getRequestContainerDef } from './requestContainerRegistry.js'
import { extractRuntimeVarRows, captureRuntimeVars } from './runtimeVars.js'
import type { CaptureRequest, CaptureResponse } from './runtimeVars.js'
import type { RunResult } from './types.js'

// ─── Declared plugin+version check (tagged blocks only — legacy files with no
// pluginId attr are skipped entirely, unchanged behaviour) ────────────────────
//
// Runs before a section is executed. Any non-"ok" status — missing, disabled,
// or a different version than what saved the block — stops execution with a
// specific, actionable error instead of the generic "no plugin could build a
// request" fallback in the shared orchestrator. This is what makes execution
// deterministic: a file always runs against the exact plugin version it was
// authored with, never silently against whatever happens to be installed.
function checkBlockVersions(blocks: any[]): void {
  for (const block of blocks) {
    const pluginId = block?.attrs?.pluginId
    const pluginVersion = block?.attrs?.pluginVersion
    if (!pluginId || !pluginVersion) continue

    const installed = getInstalledPluginInfo(pluginId)
    const status = classifyBlockVersion({ pluginId, pluginVersion, blockType: block.type }, installed)
    if (status === 'ok') continue

    throw new Error(formatVersionError(block.type, pluginId, pluginVersion, status, installed))
  }
}

function formatVersionError(
  blockType: string,
  pluginId: string,
  pluginVersion: string,
  status: 'not-installed' | 'disabled' | 'version-mismatch',
  installed: { version?: string; enabled?: boolean } | undefined,
): string {
  switch (status) {
    case 'not-installed':
      return (
        `Block "${blockType}" requires plugin "${pluginId}" v${pluginVersion}, which is not installed.\n` +
        `  Run: voiden-runner plugin install ${pluginId}@${pluginVersion}`
      )
    case 'disabled':
      return (
        `Plugin "${pluginId}" is installed but disabled.\n` +
        `  Run: voiden-runner plugin enable ${pluginId}`
      )
    case 'version-mismatch':
      return (
        `Block "${blockType}" requires ${pluginId} v${pluginVersion}, but v${installed?.version} is installed.\n` +
        `  Run: voiden-runner plugin install ${pluginId}@${pluginVersion}`
      )
  }
}

// ─── Raw request extraction from blocks (used for error reporting) ────────────
//
// Extracts the unresolved URL, method, headers and body directly from the
// normalised block tree — before env/process-var substitution happens.
// This lets us show the user what was attempted even when the request threw
// before requestMeta was populated (e.g. invalid URL after unresolved {{KEY}}).

export interface RawRequestInfo {
  url:     string
  method:  string
  headers: Record<string, string>
  body?:   string
}

/** Public alias — lets callers (e.g. the MCP server's list_requests tool) preview
 *  a section's method/url without executing anything. */
export function getRequestPreview(blocks: any[]): RawRequestInfo {
  return extractRawRequest(blocks)
}

/**
 * Finds the block that represents "the request" in a section, whichever
 * protocol it belongs to. Backed by requestContainerRegistry.ts, populated
 * by each protocol plugin's own context.registerRequestContainer() call —
 * exported so callers that only need the block's `uid` (e.g. the MCP
 * server's list_requests tool) share this same registry instead of
 * hardcoding their own list of protocol block types.
 */
export function findRequestBlock(blocks: any[]): any | undefined {
  return findRegisteredRequestBlock(blocks)
}

function extractRawRequest(blocks: any[]): RawRequestInfo {
  let url    = ''
  let method = 'GET'

  const req = findRequestBlock(blocks)
  if (req) {
    const cfg = getRequestContainerDef(req.type)
    if (cfg && Array.isArray(req.content)) {
      for (const node of req.content) {
        if (cfg.methodType && node.type === cfg.methodType && typeof node.content === 'string') method = node.content.trim()
        if (node.type === cfg.urlType && typeof node.content === 'string') url = node.content.trim()
      }
      if (cfg.defaultMethod) method = cfg.defaultMethod
    }
  }

  const headers: Record<string, string> = {}
  const ht = blocks.find((b: any) => b.type === 'headers-table')
  if (ht && Array.isArray(ht.content)) {
    for (const child of ht.content) {
      if (child.type === 'table' && Array.isArray(child.rows)) {
        for (const r of child.rows) {
          if (Array.isArray(r.row) && r.row.length >= 2) {
            const k = String(r.row[0] ?? '').trim()
            const v = String(r.row[1] ?? '').trim()
            if (k) headers[k] = v
          }
        }
      }
    }
  }

  const jb  = blocks.find((b: any) => b.type === 'json_body')
  const body = jb?.attrs?.body ? String(jb.attrs.body) : undefined

  return { url, method, headers, body }
}

// ─── Block → document JSON (headless editor shim) ─────────────────────────────
//
// Converts the flat array of blocks for a section into a TipTap-like JSON
// document so that pipeline hooks (e.g. voiden-scripting's preProcessingHook)
// can call editor.getJSON() and find script blocks by traversing .content.

function blocksToDoc(blocks: any[]): any {
  return { type: 'doc', content: blocks }
}

// ─── PipelineResponse → RunResult ────────────────────────────────────────────

function toRunResult(response: PipelineResponse, url: string, startMs: number): RunResult {
  const durationMs = response.elapsedTime ?? (Date.now() - startMs)

  let body: string | undefined
  if (response.body) {
    body = typeof response.body === 'string'
      ? response.body
      : JSON.stringify(response.body)
  }

  // Flatten header arrays → plain objects for CSV / mail report consumers
  const requestHeaders: Record<string, string> | undefined =
    response.requestHeaders?.length
      ? Object.fromEntries(response.requestHeaders.map(h => [h.key, h.value]))
      : response.requestMeta?.headers?.length
        ? Object.fromEntries((response.requestMeta.headers as { key: string; value: string }[]).map(h => [h.key, h.value]))
        : undefined

  const responseHeaders: Record<string, string> | undefined =
    response.headers?.length
      ? Object.fromEntries(response.headers.map(h => [h.key, h.value]))
      : undefined

  const result: RunResult = {
    protocol:       response.protocol  ?? 'rest',
    method:         response.requestMeta?.method,
    url:            response.requestMeta?.url ?? response.url ?? url,
    success:        !response.error && response.statusCode > 0,
    status:         response.statusCode || undefined,
    statusText:     response.statusMessage || undefined,
    durationMs,
    size:           response.bytesContent || undefined,
    body,
    error:          response.error,
    requestHeaders,
    requestBody:    response.requestBody,
    responseHeaders,
  }

  if (response.metadata?.reportEntries) {
    result.reportEntries = response.metadata.reportEntries
  }

  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunOptions {
  env?:         Record<string, string>
  verbose?:     boolean
  skipPlugins?: ReadonlySet<string>
  /** Shared in-memory runtime variables map ({{process.xxx}}). Mutated in place after each section. */
  runtimeVars?: Record<string, any>
  /**
   * Already-loaded plugin list from a prior loadEnabledPlugins() call.
   * When provided, plugin loading is skipped — use this to load once per session
   * when running multiple files.
   */
  activePlugins?: string[]
  /** Run only the section whose request-separator label matches exactly, instead of every section in the file. */
  sectionLabel?: string
}

export interface SectionResult {
  label?: string
  result: RunResult
}

export interface RunFileResult {
  results:       SectionResult[]
  activePlugins: string[]
}

export async function runVoidFile(
  filePath: string,
  options: RunOptions = {},
): Promise<RunFileResult> {
  const env         = options.env ?? {}
  const verbose     = options.verbose ?? false
  const skipPlugins = options.skipPlugins ?? new Set<string>()
  const runtimeVars = options.runtimeVars ?? {}

  // Use pre-loaded plugins if provided (multi-file session), otherwise load fresh.
  const activePlugins = options.activePlugins ?? await loadEnabledPlugins(verbose, skipPlugins)

  const content     = readFileSync(filePath, 'utf-8')
  const allSections = parseVoidFileSections(content)
  // A file with no request-separators has no real "sections" to disambiguate
  // between — it's just one request. Only apply the label filter when
  // there's more than one section to choose from; a single-section file
  // always means "run the one request present", regardless of what
  // sectionLabel was asked for (including none, or a stale/mismatched one).
  const sections    = (options.sectionLabel && allSections.length > 1)
    ? allSections.filter(s => s.label === options.sectionLabel)
    : allSections

  if (options.sectionLabel && allSections.length > 1 && sections.length === 0) {
    return {
      results: [{
        result: {
          protocol:  'unknown',
          url:       '',
          success:   false,
          durationMs: 0,
          error:     `No section labelled "${options.sectionLabel}" found in ${filePath}`,
        },
      }],
      activePlugins,
    }
  }

  if (sections.length === 0) {
    return {
      results: [{
        result: {
          protocol:  'unknown',
          url:       '',
          success:   false,
          durationMs: 0,
          error:     `No void blocks found in ${filePath}`,
        },
      }],
      activePlugins,
    }
  }

  // CLI IPC adapter — pass runtimeVars so preSendProcess can substitute {{process.xxx}}
  const ipcAdapter = createCliElectron(env, runtimeVars)

  const results: SectionResult[] = []

  for (const section of sections) {
    const { blocks } = section
    const startMs    = Date.now()

    // 1. Normalise blocks against registered schemas (headless equivalent of
    //    TipTap schema normalisation — fills missing attrs with declared defaults).
    const normalizedBlocks = normalizeBlocks(blocks)

    // 2. Headless editor shim so parser plugins and pipeline hooks can call
    //    editor.getJSON() and traverse the document like the Electron app does.
    const doc    = blocksToDoc(normalizedBlocks)
    const editor = { getJSON: () => doc }

    // 3. Inject CLI env + runtime vars so scripting hooks can access them via
    //    editor.__cliEnv  (→ voiden.env.get)
    //    editor.__cliVars (→ voiden.variables.get/set — mutating this mutates runtimeVars)
    ;(editor as any).__cliEnv  = env
    ;(editor as any).__cliVars = runtimeVars   // shared reference — mutations propagate

    // Extract raw request info before executing — used to populate failure
    // results when the pipeline catches the error internally (e.g. unresolved
    // {{KEY}} → invalid URL → fetch fails before requestMeta is populated).
    const raw = extractRawRequest(normalizedBlocks)

    // 4. Run the full pipeline via the shared orchestrator.
    //    The pipeline executor catches network errors internally and returns a
    //    failed PipelineResponse rather than throwing, so we handle both paths.
    let response: PipelineResponse
    try {
      checkBlockVersions(normalizedBlocks)
      response = await requestOrchestrator.executeRequest(editor, ipcAdapter)
    } catch (err: any) {
      results.push({
        label: section.label,
        result: {
          protocol:       'rest',
          method:         raw.method,
          url:            raw.url,
          success:        false,
          durationMs:     Date.now() - startMs,
          error:          err?.message ?? String(err),
          requestHeaders: Object.keys(raw.headers).length ? raw.headers : undefined,
          requestBody:    raw.body,
        },
      })
      continue
    }

    const runResult = toRunResult(response, response.url ?? '', startMs)

    // If the request failed before it was sent (empty URL / no requestMeta),
    // fill in the raw block values so the CLI can show what was attempted.
    if (!runResult.success && !runResult.url && raw.url) {
      runResult.url    = raw.url
      runResult.method = runResult.method ?? raw.method
      if (!runResult.requestHeaders && Object.keys(raw.headers).length) {
        runResult.requestHeaders = raw.headers
      }
      if (!runResult.requestBody && raw.body) {
        runResult.requestBody = raw.body
      }
    }
    results.push({ label: section.label, result: runResult })

    // 5. Capture runtime variables from this section's blocks.
    //    Extracts {{$res.body.xxx}} / {{$req.headers.xxx}} expressions from
    //    runtime-variables blocks and writes the captured values into runtimeVars.
    //    These are immediately available to the next section via {{process.xxx}}.
    const captureRows = extractRuntimeVarRows(normalizedBlocks)
    if (captureRows.length > 0) {
      // Pass req and res as separate objects; include the raw header list on the
      // response side so duplicate set-cookie headers are not collapsed.
      const captureReq: CaptureRequest = {
        url:             runResult.url,
        method:          runResult.method,
        requestHeaders:  runResult.requestHeaders,
        requestBody:     runResult.requestBody,
      }
      const captureRes: CaptureResponse = {
        status:             runResult.status,
        statusText:         runResult.statusText,
        responseHeaders:    runResult.responseHeaders,
        responseHeaderList: response.headers,
        body:               runResult.body,
        durationMs:         runResult.durationMs,
        size:               runResult.size,
      }
      captureRuntimeVars(captureRows, captureReq, captureRes, runtimeVars)
    }
  }

  return { results, activePlugins }
}
