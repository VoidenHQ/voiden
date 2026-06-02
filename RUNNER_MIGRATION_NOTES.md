# Voiden Runner — Migration & Implementation Notes

Feed this document to a future Claude session when moving `voiden-runner` and
`core-extensions` to the new repo.  It describes every change made, why it was
made, and what the new repo must replicate.

---

## Quick reference — files changed

### `core-extensions/`

| File | What changed |
|------|-------------|
| `package.json` | Added `./registry` subpath export |
| `src/simple-assertions/runner.ts` | Added priority-50 post-processing hook → `reportEntries` |
| `src/simple-assertions/lib/pipelineHook.ts` | Guarded `window` reference (Node.js compat) |
| `src/voiden-scripting/runner.ts` | **Complete rewrite** — uses headless engine, no `pipelineHooks.ts` |
| `src/voiden-scripting/lib/scriptEngine.ts` | Exported `workerSource`, `nodeHostWrapperSource`, `pythonWrapperSource`, `buildBashScript` |
| `src/voiden-scripting/lib/headlessScriptEngine.ts` | **New file** — subprocess-based execution without IPC |
| `src/voiden-scripting/lib/pipelineHooks.ts` | No change (Electron only — not used by runner) |
| `src/voiden-scripting/lib/vdApi.ts` | Guarded all `window` references (Node.js compat) |
| `src/voiden-scripting/lib/types.ts` | Added `modifiedVariables` to `ScriptExecutionResult` |

### `packages/executors/`

| File | What changed |
|------|-------------|
| `src/pipeline/types.ts` | Added `requestHeaders` and `requestBody` to `PipelineResponse` |
| `src/pipeline/executor.ts` | Populates `requestHeaders` / `requestBody` in returned `PipelineResponse` |

### `packages/voiden-runner/` — new files

| File | Purpose |
|------|---------|
| `src/runtimeVars.ts` | Runtime variable capture, `{{process.xxx}}` substitution |
| `src/report/csv.ts` | CSV report export |
| `src/report/mail.ts` | HTML email report via SMTP (nodemailer) |

### `packages/voiden-runner/` — modified files

| File | What changed |
|------|-------------|
| `src/index.ts` | All new CLI flags, spinner, `runtimeVars` wiring |
| `src/runner.ts` | `runtimeVars` threading, section-level capture, `editor.__cliVars` injection |
| `src/cliElectron.ts` | `preSendProcess` now substitutes `{{process.xxx}}`; accepts `runtimeVars` |
| `src/types.ts` | Added `requestHeaders`, `requestBody`, `responseHeaders` to `RunResult` |
| `src/plugins/loader.ts` | Added `skipPlugins` parameter |
| `src/plugins/registry.ts` | Simplified — imports from `@voiden/core-extensions/registry`, unified `RUNNER_IDS` |
| `src/headlessContext.ts` | Updated to use new `@voiden/executors` API |
| `package.json` | Added `nodemailer` dependency |

---

## Section 1 — Build fixes (apply first)

### 1.1 `core-extensions/package.json` — `./registry` subpath export

**Why:** `voiden-runner` uses `"moduleResolution": "NodeNext"` (strict ESM).
The core-extensions dist was compiled with bundler-style resolution, so
`dist/index.d.ts` re-exports as `export * from './registry'` (no `.js`
extension). NodeNext cannot resolve that chain — `coreExtensions` appears
as missing even though the file exists.

**Fix:** Add to `core-extensions/package.json` exports:

```json
"./registry": {
  "types":   "./dist/registry.d.ts",
  "import":  "./dist/registry.js",
  "default": "./dist/registry.js"
}
```

Then in `voiden-runner/src/plugins/registry.ts`:

```ts
// Before
import { coreExtensions } from '@voiden/core-extensions'
// After
import { coreExtensions } from '@voiden/core-extensions/registry'
```

### 1.2 `headlessContext.ts` — wrong relative import path

The file imported `'../parserRegistry.js'` instead of `'./parserRegistry.js'`.
One level up puts it outside `src/`. Fix: change to `'./parserRegistry.js'`.

### 1.3 `window` guards in lib files

Both `pipelineHook.ts` and `vdApi.ts` reference `window.electron.*`.
In Node.js `window` is not defined — this throws `ReferenceError` inside
try-catch blocks, silently aborting hooks and returning no assertion results.

**Fix — one-liner pattern applied everywhere:**

```ts
// Before
(window as any).electron?.env?.replaceVariables

// After
(typeof window !== 'undefined' ? (window as any) : undefined)?.electron?.env?.replaceVariables
```

Apply this to every `(window as any)` occurrence in:
- `src/simple-assertions/lib/pipelineHook.ts` (1 occurrence)
- `src/voiden-scripting/lib/vdApi.ts` (5 occurrences)
- `src/voiden-scripting/lib/scriptEngine.ts` — `preloadEnvAndVariables()` and
  the three `execute*Script` functions that call `window.electron.ipc.invoke`

---

## Section 2 — Assertion pipeline (both plugins)

### Problem

Plugins stored assertion results in `responseState.metadata.assertionResults`
(simple-assertions) and `responseState.metadata.scriptAssertionResults`
(voiden-scripting). The runner only reads `metadata.reportEntries`. The gap
meant all assertions were silently dropped.

### Fix — `simple-assertions/runner.ts`

Add a **priority-50 post-processing hook** (runs after the assertion evaluator
at priority 15) that converts `assertionResults` → `reportEntries`:

```ts
context.pipeline.registerHook('post-processing', async (ctx: any) => {
  const data = ctx.responseState?.metadata?.assertionResults
  if (!data?.results?.length) return
  if (!ctx.responseState.metadata) ctx.responseState.metadata = {}
  if (!Array.isArray(ctx.responseState.metadata.reportEntries))
    ctx.responseState.metadata.reportEntries = []

  for (const r of data.results) {
    const label = r.assertion?.description?.trim()
      || `${r.assertion?.field} ${r.assertion?.operator} ${r.assertion?.expectedValue}`.trim()
    ctx.responseState.metadata.reportEntries.push({
      type: 'assertion', message: label || 'Assertion',
      passed: r.passed, actual: r.actualValue,
      expected: r.assertion?.expectedValue, operator: r.assertion?.operator,
    })
  }
}, 50)
```

### Fix — `voiden-scripting/runner.ts`

Add a **priority-60 post-processing hook** that converts `scriptAssertionResults`,
`preScriptLogs`, `postScriptLogs`, and script errors into `reportEntries`:

```ts
context.pipeline.registerHook('post-processing', (ctx: any) => {
  const rs = ctx.responseState
  if (!rs?.metadata) return
  if (!Array.isArray(rs.metadata.reportEntries)) rs.metadata.reportEntries = []

  // assertions
  for (const r of rs.metadata.scriptAssertionResults?.results ?? []) {
    rs.metadata.reportEntries.push({ type: 'assertion', message: r.message, passed: r.passed,
      actual: r.actualValue, expected: r.expectedValue, operator: r.operator })
  }
  // logs
  for (const log of [...(rs.metadata.preScriptLogs ?? []), ...(rs.metadata.postScriptLogs ?? [])]) {
    const msg = Array.isArray(log.args)
      ? log.args.map((a: any) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      : String(log.args ?? '')
    if (msg) rs.metadata.reportEntries.push({ type: 'log', message: msg, level: log.level ?? 'log' })
  }
  // errors
  for (const k of ['preScriptError', 'postScriptError']) {
    if (rs.metadata[k]) rs.metadata.reportEntries.push({ type: 'log', message: `Script error: ${rs.metadata[k]}`, level: 'error' })
  }
}, 60)
```

---

## Section 3 — Headless script execution (voiden-scripting)

### Problem

The existing `scriptEngine.ts` dispatches to three paths — all via
`window.electron.ipc.invoke`. In Node.js there is no IPC, so:

- JavaScript fell through to `executeScriptInProcess` (worked after window fix)
- Python returned `"Python execution bridge unavailable"`
- Shell returned `"Shell execution bridge unavailable"`
- `vd.env.get()` and `vd.variables.get()` always returned `undefined`

### Fix — `scriptEngine.ts` exports

Export four previously-private identifiers so the headless engine can
reuse the same wrapper sources:

```ts
export const workerSource = `...`
export const nodeHostWrapperSource = `...`
export const pythonWrapperSource = `...`
export function buildBashScript(params: { ... }): string { ... }
```

### Fix — `headlessScriptEngine.ts` (new file)

`src/voiden-scripting/lib/headlessScriptEngine.ts` — pure subprocess executor,
no IPC, no DOM, no Electron:

| Language | Execution path |
|----------|---------------|
| JavaScript | In-process `AsyncFunction` — zero subprocess overhead |
| Node worker | `node -e <nodeHostWrapperSource>`, JSON piped on stdin |
| Python | `python3 -c <pythonWrapperSource>`, JSON piped on stdin. `getPythonBin()` detects availability at startup. |
| Shell | `buildBashScript` written to tmpdir, `bash wrapper.sh` executed |

All three subprocess modes use the same stdin/stdout JSON protocol as the
Electron IPC path — the wrapper sources are identical.

Public API:

```ts
export function getPythonBin(): string | null
export function isNodeAvailable(): boolean
export function loadHeadlessVariables(): Record<string, any>

export async function executeHeadlessScript(
  scriptBody: string,
  language: 'javascript' | 'python' | 'shell',
  request: any,
  response: any,
  envVars?: Record<string, string>,
  variables?: Record<string, any>,
  useWorker?: boolean,   // for JS: force node subprocess instead of in-process
): Promise<ScriptExecutionResult>
```

### Fix — `voiden-scripting/runner.ts` complete rewrite

No longer imports `pipelineHooks.ts`. Registers four inline pipeline hooks:

| Priority | Stage | Action |
|----------|-------|--------|
| 5 | pre-processing | Capture `editor.getJSON()` → `cachedDoc`; read `editor.__cliEnv` → `cliEnv`; stash `editor.__cliVars` reference in `requestState.metadata._cliVarsRef` |
| 15 | pre-send | Extract `pre_script` from `cachedDoc`; call `executeHeadlessScript`; apply request mutations; write `vd.variables.set()` changes back to `cliVarsRef` |
| 25 | post-processing | Extract `post_script`; call `executeHeadlessScript`; apply response mutations; write variable mutations back |
| 60 | post-processing | Merge all results → `reportEntries` |

**Variable flow:**
- `vd.env.get('KEY')` → reads from `cliEnv` (the `--env` file map)
- `vd.variables.get('KEY')` → reads merged `{ ...loadHeadlessVariables(), ...cliVarsRef }`
- `vd.variables.set('KEY', val)` → mutates `cliVarsRef` (which is `runtimeVars` from the runner — shared reference)

### Fix — `types.ts` — `modifiedVariables` on `ScriptExecutionResult`

```ts
export interface ScriptExecutionResult {
  // ... existing fields ...
  modifiedVariables?: Record<string, any>  // variables mutated by vd.variables.set()
}
```

---

## Section 4 — Request/response data capture

### `PipelineResponse` — new fields

In `packages/executors/src/pipeline/types.ts`:

```ts
export interface PipelineResponse {
  // ... existing fields ...
  requestHeaders?: Array<{ key: string; value: string }>  // headers actually sent
  requestBody?:    string                                  // body actually sent
}
```

In `packages/executors/src/pipeline/executor.ts`, populate both fields in the
returned object (REST path and WS/gRPC path):

```ts
requestHeaders: requestState.headers.filter(h => h.enabled !== false),
requestBody:    requestState.body,
```

### `RunResult` — new fields

In `packages/voiden-runner/src/types.ts`:

```ts
export interface RunResult extends _RunResult {
  requestHeaders?:  Record<string, string>
  requestBody?:     string
  responseHeaders?: Record<string, string>
  // ...
}
```

In `runner.ts → toRunResult()`, extract from `PipelineResponse`:

```ts
const requestHeaders = response.requestHeaders?.length
  ? Object.fromEntries(response.requestHeaders.map(h => [h.key, h.value]))
  : response.requestMeta?.headers?.length
    ? Object.fromEntries(response.requestMeta.headers.map(h => [h.key, h.value]))
    : undefined

const responseHeaders = response.headers?.length
  ? Object.fromEntries(response.headers.map(h => [h.key, h.value]))
  : undefined
```

---

## Section 5 — Runtime variables

### Overview

Runtime variables let requests chain — a value extracted from one response
is available in subsequent requests as `{{process.KEY}}`.

**In Electron:** saved to `~/.voiden/.process.env.json` between requests.
**In runner:** kept in-memory only — never written to disk.

### New file: `runtimeVars.ts`

Three responsibilities:

**1. Block extraction** — `extractRuntimeVarRows(blocks: any[]): RuntimeVarRow[]`
- Finds `runtime-variables` blocks (supports both `attrs.rows` and TipTap table)
- Returns `{ key, value: '{{$res.body.access_token}}', enabled }` rows

**2. Capture** — `captureRuntimeVars(rows, req, res, vars)`
- Evaluates `{{$res.xxx}}` / `{{$req.xxx}}` expressions using dot-notation path
- Supports nested JSON, key-value arrays (headers), array index (`items[0]`)
- Mutates `vars` in place — shared reference propagates to next request

**3. Substitution** — `applyProcessVarsToState(state, vars)`
- Replaces `{{process.KEY}}` in URL, headers, query params, path params, body
- Preserves object type for single-template body expressions
- Returns a shallow copy — original `requestState` is not mutated

### `cliElectron.ts` changes

```ts
// Accept runtimeVars
export function createCliElectron(
  env:         Record<string, string>,
  runtimeVars: Record<string, any> = {},
) {
  return {
    // ...
    runtime: {
      // Was a no-op. Now actually substitutes {{process.xxx}}.
      preSendProcess: (state) =>
        Promise.resolve(applyProcessVarsToState(state, runtimeVars)),
      // ...
    }
  }
}
```

### `runner.ts` changes

```ts
export interface RunOptions {
  env?:         Record<string, string>
  verbose?:     boolean
  skipPlugins?: ReadonlySet<string>
  runtimeVars?: Record<string, any>   // shared map, mutated in place
}
```

Per section:
1. `createCliElectron(env, runtimeVars)` — wires process var substitution
2. `editor.__cliVars = runtimeVars` — scripting hooks read/write this
3. After response: `captureRuntimeVars(rows, runResult, runResult, runtimeVars)`

### `index.ts` changes

```ts
// One shared map per `voiden-runner run` invocation
const runtimeVars: Record<string, any> = {}

// Passed to every file in the run
await runVoidFile(file, { env, verbose, skipPlugins, runtimeVars })
```

---

## Section 6 — New CLI flags

All flags added to `voiden-runner run`:

| Flag | Behaviour |
|------|-----------|
| `--bail` | Stop on first failure, exit 1 (existing, improved messaging) |
| `--stop-on-failure` | Alias for `--bail` — more descriptive for CI/CD scripts |
| `--fail-on-error` | Run all files, exit 1 at the end if any failed |
| `--no-scripts` | Skip `voiden-scripting` plugin — prevents pre/post script execution |
| `--verbose` | Print script logs, plugin messages, section dividers |
| `--json` | Machine-readable JSON output (suppresses normal output) |
| `--csv <path>` | Export full report to CSV. Pass `.` for current dir + auto-timestamp filename |
| `--mail-to <address>` | Send HTML report email (requires `--mail-smtp`) |
| `--mail-from <address>` | Sender address |
| `--mail-subject <text>` | Subject line (auto-generated by default) |
| `--mail-smtp <host>` | SMTP hostname |
| `--mail-smtp-port <n>` | SMTP port (587 default, 465 with `--mail-smtp-secure`) |
| `--mail-smtp-secure` | Use TLS |
| `--mail-smtp-user <u>` | SMTP username |
| `--mail-smtp-pass <p>` | SMTP password |

**Spinner:** progress indicator shown during each file's execution. Clears
before printing results. Suppressed when stdout is not a TTY or `--json` is set.

---

## Section 7 — CSV and email report modules

### `src/report/csv.ts`

Columns: `File`, `Protocol`, `Method`, `URL`, `Success`, `Status`,
`StatusText`, `DurationMs`, `SizeBytes`, `Error`, `RequestHeaders`,
`RequestBody`, `ResponseHeaders`, `ResponseBody`, `AssertionsPassed`,
`AssertionsFailed`, `AssertionDetail`

Returns the resolved output path (handles directory input by auto-generating
`voiden-report-<timestamp>.csv` inside it).

### `src/report/mail.ts`

Dependency: `nodemailer` (add to `package.json` dependencies).

HTML email with dark-themed per-request cards showing: protocol/method/URL,
status, duration, error, assertions (pass/fail list), request headers,
request body, response headers, response body.

`sendMailReport(results, totalMs, opts: MailReportOptions): Promise<void>`

---

## Section 8 — SDK requirements for the new repo

When `voiden-runner` lives in its own repo, it depends on three external packages:

### `@voiden/sdk` (already published)

**Required exports (all currently available):**

```ts
import type { RestApiRequestState } from '@voiden/sdk'
```

No new exports needed from the SDK itself. The runner only uses
`RestApiRequestState` as a type for `cliElectron.ts`.

---

### `@voiden/executors` (must be published as a standalone package)

This package currently lives at `packages/executors/` in the main monorepo.
It must be extracted and published to npm as `@voiden/executors`.

**Required exports:**

```ts
// Pipeline execution
import { executeRequestPipeline } from '@voiden/executors'
import type { ExecutorOptions }   from '@voiden/executors'
import { hookRegistry, HookRegistry } from '@voiden/executors'
import { PipelineStage }          from '@voiden/executors'
import type { PipelineResponse, RestApiRequestState, RestApiResponseState,
              PreProcessingContext, RequestCompilationContext,
              PreSendContext, PostProcessingContext } from '@voiden/executors'

// Orchestration
import { RequestOrchestrator, requestOrchestrator } from '@voiden/executors'
import type { RequestBuildHandler, ResponseProcessHandler, HeadlessEditor } from '@voiden/executors'

// Protocol executors
import { executeWebSocket, executeGrpc }   from '@voiden/executors'
import { executeSecureRequest, replaceEnvVars } from '@voiden/executors'
import type { SecureRequestAdapter, SecureHandoffResult,
              WebSocketRequest, GrpcRequest, RunResult } from '@voiden/executors'
```

**New fields added to `PipelineResponse` (must be in the published version):**

```ts
interface PipelineResponse {
  // ... existing ...
  requestHeaders?: Array<{ key: string; value: string }>
  requestBody?:    string
}
```

**`package.json` exports** needed:

```json
{
  "exports": {
    ".": {
      "types":  "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

---

### `@voiden/core-extensions` (must be published as a standalone package)

This package currently lives at `core-extensions/` in the main monorepo.
It must be extracted and published to npm as `@voiden/core-extensions`.

**Required subpath exports in `package.json`:**

```json
{
  "exports": {
    ".": {
      "types":   "./dist/index.d.ts",
      "import":  "./dist/index.js"
    },
    "./registry": {
      "types":   "./dist/registry.d.ts",
      "import":  "./dist/registry.js",
      "default": "./dist/registry.js"
    },
    "./voiden-rest-api/runner": {
      "types":   "./dist/voiden-rest-api/runner.d.ts",
      "import":  "./dist/voiden-rest-api/runner.js"
    },
    "./voiden-graphql/runner": {
      "types":   "./dist/voiden-graphql/runner.d.ts",
      "import":  "./dist/voiden-graphql/runner.js"
    },
    "./voiden-sockets/runner": {
      "types":   "./dist/voiden-sockets/runner.d.ts",
      "import":  "./dist/voiden-sockets/runner.js"
    },
    "./voiden-scripting/runner": {
      "types":   "./dist/voiden-scripting/runner.d.ts",
      "import":  "./dist/voiden-scripting/runner.js"
    },
    "./simple-assertions/runner": {
      "types":   "./dist/simple-assertions/runner.d.ts",
      "import":  "./dist/simple-assertions/runner.js"
    },
    "./voiden-faker/runner": {
      "types":   "./dist/voiden-faker/runner.d.ts",
      "import":  "./dist/voiden-faker/runner.js"
    },
    "./voiden-advanced-auth/runner": {
      "types":   "./dist/voiden-advanced-auth/runner.d.ts",
      "import":  "./dist/voiden-advanced-auth/runner.js"
    }
  }
}
```

**The `./registry` subpath is new** — it was added in this session. It exports
`coreExtensions: ExtensionMetadata[]` and `ExtensionMetadata` interface from
`registry.ts` with no React/DOM dependencies.

**Runner files that must be present in the published dist:**

Each extension needs a `runner.ts` alongside its `plugin.ts`. The runner files
must be built and included in the `files` array in `package.json`:

```json
"files": ["dist/**"]
```

Since `dist/**` covers everything, no additional changes are needed once each
`runner.ts` is compiled.

**`voiden-scripting/runner.ts` is a complete rewrite** — it no longer uses
`pipelineHooks.ts` (which depends on `window`). The new version is
self-contained and uses `./lib/headlessScriptEngine.js` via lazy import.
The `headlessScriptEngine.ts` file is an internal lib file, not a public
subpath export — but it is included in the dist via `dist/**`.

**`voiden-scripting/lib/scriptEngine.ts` now exports four additional symbols:**
`workerSource`, `nodeHostWrapperSource`, `pythonWrapperSource`, `buildBashScript`.
These are used internally by `headlessScriptEngine.ts`.

**`voiden-scripting/lib/types.ts` interface change:**
```ts
interface ScriptExecutionResult {
  // new field
  modifiedVariables?: Record<string, any>
}
```

---

## Section 9 — Rules: what not to touch

- **Never modify `plugin.ts` files** inside `core-extensions/src/*/`. These are
  Electron UI plugins. All runner-specific code goes in `runner.ts` files.
- **Never modify `pipelineHooks.ts`** in `voiden-scripting/lib/`. That module
  is Electron-only. The runner has its own hook logic in `runner.ts`.
- **`registry.ts`** in `core-extensions/src/` is auto-generated. Run
  `yarn generate-registry` to update it — never edit manually.
- **Runtime variables are never persisted to disk** by the runner. The
  `~/.voiden/.process.env.json` file is read-only from the runner's perspective.
  Variable capture only writes to the in-memory `runtimeVars` map.

---

## Section 10 — Prebuild order

```json
"prebuild": "cd ../../core-extensions && tsc && cd ../packages/executors && tsc"
```

In the new repo, the build order must be:
1. Build `@voiden/sdk` (external — already published)
2. Build `@voiden/executors`
3. Build `@voiden/core-extensions`
4. Build `@voiden/runner`

Steps 2–3 are now automated by the `prebuild` script.
