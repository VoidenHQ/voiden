# MCP Tool Block — Status &amp; Spec

Source: MCP kickoff meeting notes + follow-up review of `@voiden/mcp-server` (the original,
pre-split package), `@voiden/runner`, and the `voiden-mcp-tool` plugin (branch `mcp-tool`, merged
to `beta` in `41bec4c`/`dd369dd`, shipped as `@voiden/mcp-server` 0.1.6 + plugin v0.1.0). The
command surface below went through several passes — a 2-package split (`@voiden/server` +
`@voiden/mcp-host`), then a further redesign that folds project registration into the `voiden`
CLI itself and retires `@voiden/mcp-host` outright. See "Implementation status" at the bottom for
the full history.

---

## Command surface — ✅ implemented: three independent things, not one

Resolved a real ambiguity from spec review: **publishing `/tool` blocks as a server is not the
same concern as registering a project with an agent editor.** The first is "discover, verify,
then become a long-running MCP server with health checks, graceful shutdown, an optional tunnel,
and cadence-aware re-verification, until stopped" — a real, independent runtime. The second is
"write `.mcp.json` so Claude Code/Codex knows what command to run" — pure setup, no server
involved. Conflating them into one package/command surface (as an earlier pass did) kept
reproducing the same confusion, so they now live in three separate places, each with exactly one
job:

| Surface | Purpose |
|---|---|
| **`@voiden/mcp`** ([src](../packages/voiden-mcp/src)) | The package that actually runs the `/tool`-block server. No subcommand, no verb — `voiden-mcp [path] [options]` discovers every `/tool` block under `path`, verifies it, and serves everything that passes (stdio by default, `--http` for a real network endpoint), with `/health`, graceful shutdown, `--tunnel`, and a cadence-aware `--scheduler`. This is what you'd deploy standalone (Dockerfile, systemd unit, PaaS build step) for publishing an agent-callable API surface. It is **not** what an everyday agent-editor session talks to — see below. |
| **`voiden agent` / `voiden run` / `voiden mcp-stdio`** ([src/voiden-cli.ts](../apps/electron/src/voiden-cli.ts)) | Bundled directly into the Voiden Electron app's own `voiden` binary — a normal Forge `VitePlugin` build entry (`vite.cli.config.ts`) alongside `main.ts`/`preload.ts`, landing at `.vite/build/voiden-cli.js` inside `app.asar` (not a separate `extraResource` outside it), launched via `ELECTRON_RUN_AS_NODE=1` — no separate Node install needed. Real npm dependencies (`commander`, `@modelcontextprotocol/sdk`, and everything `@voiden/runner` itself pulls in) stay external, resolved from the packaged app's own `node_modules` at runtime, the same convention `main.js` already uses for its own dependencies — only `@voiden/runner`/`@voiden/executors` get bundled in (workspace-symlinked, ESM-only packages, both fatal to an external `require()`). `voiden agent [path]` registers this project with Claude Code/Codex, pointing `.mcp.json` at `voiden mcp-stdio` (itself) — **not** at `@voiden/mcp`. `voiden run <paths...>` runs `.void` files headlessly (a lightweight subset of `@voiden/runner`'s own `run`). `voiden mcp-stdio [path]` is hidden (not in `--help`) — it's what `.mcp.json` actually invokes: a stdio MCP server exposing just the 4 fixed tools (`list_void_files`/`list_requests`/`run_request`/`write_result`), via `@voiden/runner`'s `registerFixedTools()`. Deliberately does **not** discover/verify/serve `/tool` blocks — that's `@voiden/mcp`'s job alone, for a different purpose (publishing a capability API, not letting an editor run requests in this project). |
| **`@voiden/runner`** ([src](../packages/voiden-runner/src)) | Stays a standalone, independently-installable package for CI servers — untouched by the redesign above. Its own `mcp install/uninstall/status/serve` commands are the CI equivalent of `voiden agent`/`mcp-stdio`: `voiden-runner mcp serve` already implements the same 4-fixed-tools (+ `/tool` blocks) server standalone, no Electron app required, so `voiden-runner mcp install` now registers against `voiden-runner mcp serve` by default instead of `@voiden/mcp` — CI machines never need `@voiden/mcp` installed just to let an agent run requests. |

The old `@voiden/mcp-host` package (registration-only, `init` as its one public command) has been
**retired entirely** — deleted from the monorepo. Its job (writing `.mcp.json`) is now done two
ways depending on context: `voiden agent` for anyone with the Voiden app installed (most users —
the app already bundles Node via Electron, so there's nothing extra to install), and
`voiden-runner mcp install` for CI-only/no-app environments. Both call the same underlying
`registerClaudeMcpServer`/`upsertCodexMcpSection`/`installMcpIntegration` primitives from
`@voiden/executors`, just with a different `serverCommand` target — two entry points, one
implementation, no third package needed to bridge them.

The app's own Settings "Claude/Codex integration" toggle (`apps/electron/src/main/ipc/mcp.ts`)
does exactly what `voiden agent` does — same target, same primitives — so a user flipping that
toggle and a user running `voiden agent` from the terminal never disagree about what gets written
under the same `.mcp.json` key.

**Deliberately deferred, not part of this pass:** `voiden-runner`'s `tool list/verify` commands
are untouched.

---

## ✅ Done

| Capability | Where |
|---|---|
| `/tool` block marks an existing request as a named, typed, agent-callable capability — it does not turn into a self-registering tool inside the request itself | `voiden-mcp-tool` plugin owns `tool`/`toolparams`/`toolverifies`; core has no hardcoded knowledge of the block shape ([mcpToolCapability.ts](../packages/voiden-runner/src/mcpToolCapability.ts)) |
| One combined server built from every `/tool` block across a project, not per-request | `buildMcpServer()` → `planServedTools()` scans **all** `.void` files under the project root ([mcpServing.ts:195](../packages/voiden-runner/src/mcpServing.ts#L195)) |
| Publish with a path param, over HTTP with a port | `voiden-mcp [path] --http --port <n>` and `voiden-runner mcp serve [path] --http --port <n>` (same underlying logic) |
| 4 fixed tools every project gets (list void files, list requests, run request, write result) | `registerFixedTools()` ([mcpServing.ts:87](../packages/voiden-runner/src/mcpServing.ts#L87)) — served by `@voiden/mcp`, `voiden-runner mcp serve`, **and** the bundled `voiden mcp-stdio` |
| Verification withdraws a failing tool by default, or serves it flagged `degraded` | `onFailure: 'withdraw' \| 'advertise-degraded'` on the tool block, surfaced via `ServeDecision.descriptionNote` |
| Assertions from the request feed verification automatically | Plugin's health check reads `metadata.assertionResults` from the run result (via `simple-assertions`); falls back to status-code-only if the request has no assertions |
| Multiple tools per `.void` file | `discoverTools()` walks every section of every file independently, one tool block each |
| `--check` dry-run mode | `voiden-mcp --check` and `voiden-runner mcp serve --check` report served/withdrawn/degraded/excluded without starting a live session |
| CI-usable discovery/verification | `voiden-runner tool list` / `voiden-runner tool verify [--cadence] [--json] [--write]` |
| `@voiden/mcp` — the package that actually runs the `/tool`-block server, not a subcommand of a bigger CLI | [voiden-mcp/src](../packages/voiden-mcp/src) |
| `voiden agent`/`run`/`mcp-stdio` bundled into the Voiden app's own `voiden` binary — replaces the retired `@voiden/mcp-host` | [apps/electron/src/voiden-cli.ts](../apps/electron/src/voiden-cli.ts), dispatched from [bin/voiden](../apps/electron/bin/voiden) via `ELECTRON_RUN_AS_NODE=1` |
| `--port`/`--host`/`--env`/`--check` with `VOIDEN_PUBLISH_*` env-var fallbacks | `voiden-mcp/src/lib.ts`, `resolveString`/`resolveBool` helpers |
| `/health` endpoint + SIGTERM/SIGINT graceful shutdown for `--http`; stdio server closed cleanly too | same file, `runPublish()` |
| CI-environment detection warning (`GITHUB_ACTIONS`/`GITLAB_CI`/`CI`) when `--http` has no `--tunnel` | same file, `isRunningInCi()` |
| `--tunnel` — real `cloudflared` quick-tunnel spawn, clear error if the peer binary is missing | same file, `spawnTunnel()` |
| Pre-flight `unresolved-environment-param` check + `--strict` — excludes (or aborts on) a served tool whose `source: environment` param can't resolve anywhere, instead of silently sending a literal `{{token}}` | same file, `findUnresolvedEnvironmentParams()` — best-effort, see note in Pending #7 |
| **Cadence-aware `--scheduler`** — re-verification interval is *derived* from the shortest declared `cadence` across every served tool's verify entries (`hourly`→60min, `daily`→1440min, `weekly`→10080min, `monthly`→43200min), not one fixed number for every tool | same file, `computeCadenceIntervalMinutes()`; `--scheduler-interval-minutes` (or `VOIDEN_PUBLISH_SCHEDULER_INTERVAL_MINUTES`) still available to override the derived value explicitly |

---

## Concept: how a param actually resolves (source vs. binds)

Came up repeatedly enough during spec review to write down once, precisely — this is already
implemented behavior (not a Pending item), just under-documented. Full plain-language version
for the docs site lives in [mcp-tool-publish-guide.md](./mcp-tool-publish-guide.md); this is the
compressed internal version.

A `.void` request is a complete, already-written, independently-runnable document — a `/tool`
block doesn't replace or generate it, it decorates it. To let an agent vary specific values per
call, those spots in the request are marked with a `{{token}}` — the same substitution mechanism
Voiden already uses everywhere for env vars like `{{BASE_URL}}`, not something invented for
tools. A `toolparams` row has two fields that do two different jobs, and both are required:

- **`source`** — *who supplies the value*: `agent` (the MCP tool-call arguments, fresh per call)
  or `environment` (resolved from `.voiden/env-*.yaml`, falling back to the serving process's own
  env — see Pending #7 — never shown to the agent).
- **`binds`** — *where the resolved value gets substituted* — the exact `{{token}}` name in the
  request text. Needed regardless of `source`: a request can have several values (several body
  fields, headers, query/path segments), and `source` alone carries no location information —
  Voiden doesn't parse the body as a schema and match field names, the request is opaque text to
  the substitution layer. `binds` is the only address that says which token a given row controls.

This is source-type-agnostic and location-agnostic — the same mechanism covers header values,
query strings, path segments, JSON/form body fields, Multipart Table Block field values, and the
Binary File Block's `@filename` reference (e.g. `@{{upload_path}}`) identically, because all of
them are just text with an optional token in it. A param's `type` still defaults to `string` even
for a file/binary token, since an agent can only ever pass a string (a path, URL, or base64
blob) as a tool-call argument — never a raw binary value — and that string is what gets
substituted into the `@{{token}}`/multipart slot as text.

One real limitation this implies for Pending #2 (auto-populate): the scan can only extract
`{{token}}`s that already exist in the request. A hardcoded value with no token in it (e.g. a
Binary File Block written as `@./sample.png`, or a body field with a literal value) has nothing to
extract — making it agent-controllable still requires templating that spot in the request first,
same as it would without auto-populate.

---

## 🚧 Pending

### 1. Periodic cadence scheduler — ✅ done
`--scheduler` (on by default, `--http` only) re-runs `planServedTools` on an interval derived from
the shortest declared `cadence` across every served tool's verify entries — a tool tagged `hourly`
and one tagged `monthly` no longer share a single fixed interval; the scheduler computes the
tightest one actually needed and uses that. `--scheduler-interval-minutes` (or
`VOIDEN_PUBLISH_SCHEDULER_INTERVAL_MINUTES`) still overrides the derived value explicitly when
set. Verified with a real fixture across three cases: cadence-derived (a `daily` verify entry →
1440 minutes), explicit override wins over the derived value, and the no-cadence-declared fallback
(60 minutes, same as before).

- Still open: stdio mode has no scheduler support at all (one persistent `McpServer` for the
  process lifetime, and the registered-tool handles aren't returned by `registerToolsFromDecisions`
  to hot-swap) — `voiden-mcp` prints a warning and falls back to verify-once-at-startup there.
- Constrain `cadence` to an enum (`hourly | daily | weekly | monthly`) in the block schema/UI
  instead of free text — still todo, plugin-side. (The scheduler's own lookup already
  case-normalizes and only recognizes these four values; anything else is silently ignored for
  interval-derivation purposes, same as an absent `cadence`.)

### 2. Auto-populate tool params from the request
Nothing today reads the request to prefill `toolparams` — rows are hand-typed, including the
`binds` placeholder name.

- Extend "Insert Tool Declaration" to read the target request's URL/headers/body, extract every
  `{{placeholder}}`, and pre-fill one param row each (default source: agent-supplied; auto-flip
  to environment if the name matches a known env var).
- Add a "re-sync from request" action so params don't drift after the request changes.
- Show a full request preview when picking/binding a request into a tool block.

### 3. Cross-file request binding
A `/tool` block can currently only pair with the request physically in the *same section of
the same file* it's declared in. Verify entries already support an override `filePath` — the
primary tool→request link doesn't.

- Add optional `requestFilePath` (+ `requestSectionLabel`) attrs on the `tool` block. When set,
  discovery resolves the target request from that file/section instead of assuming co-location —
  lets tools live in a dedicated catalog file separate from the APIs they wrap.
- Add a `dangling-request-reference` validation check, mirroring the existing `missing-section`
  check already run for verify entries.

### 4. Static vs. dynamic exposure mode — 🟡 flag exists, dynamic explicitly stubbed
`voiden-mcp --mode static|dynamic` is a real, validated flag now
([voiden-mcp/src/lib.ts](../packages/voiden-mcp/src/lib.ts)). `static` (the default) works exactly
as before. Passing `--mode dynamic` fails fast with a clear error instead of pretending to work —
implementing the 2-tool `search_tools`/`call_tool` mode hit a real architectural boundary:
dispatching a call by tool name means re-running that specific `ToolDef`'s param resolution +
request execution, and that logic (the `Ep()`-equivalent handler-building step) lives inside the
`voiden-mcp-tool` plugin's own `registerServedTools` implementation, not core —
`registerToolsFromDecisions()` registers tools directly onto an `McpServer`, it doesn't hand back
a callable `(name, args) => result` map core could wrap in 2 tools instead of N.

Closing this needs a new optional method on `McpToolCapabilityProvider` (e.g. `callTool(tool,
args, opts)`) that the plugin implements by reusing its existing per-tool handler logic, plus a
core dispatcher in `mcpServing.ts`/`voiden-mcp` that calls it for `call_tool`'s handler. The
core-side half is straightforward; the plugin-side half needs the actual `voiden-mcp-tool` plugin
source, which isn't in this repo (cloned separately, gitignored under `plugins/`) — cross-repo
follow-up.

### 5. Production-ops surface for `voiden-mcp --http` — ✅ done
`/health` (served/withdrawn counts, `lastVerifiedAt`, process uptime), SIGTERM/SIGINT graceful
shutdown (closes the HTTP server, kills any `--tunnel` child process, closes the stdio server
too where applicable), and an `uncaughtException` handler that logs and exits nonzero (so an
external supervisor like pm2/systemd can restart the process — actual restart is the
supervisor's job, not this server's) are all implemented and manually verified working —
`curl /health` returns real counts, `SIGTERM` exits cleanly, `--tunnel` with `cloudflared`
missing fails fast with a clear message instead of hanging.

### 6. Cut over the CLI surface to `@voiden/mcp` (server) + bundled `voiden agent`/`run` (registration) — ✅ done
`@voiden/mcp-host` — the earlier standalone registration-only package — has been **retired**, not
merely deprioritized. Registration now happens two ways: `voiden agent` (bundled into the Voiden
app's own `voiden` binary, the primary path for anyone with the app installed) and
`voiden-runner mcp install` (for CI/no-app environments). Both point `.mcp.json` at a lightweight
4-fixed-tools stdio server — `voiden mcp-stdio` for the bundled path, `voiden-runner mcp serve`
for the standalone path — **never** at `@voiden/mcp`. `@voiden/mcp` is reserved exclusively for
publishing `/tool` blocks as a real, independently-hostable capability server; conflating the two
(as the original `@voiden/mcp-host publish` wrapper did) reproduced the exact ambiguity this
redesign was meant to resolve.

Neither surface shells out to a different package's CLI or duplicates the other's logic — the
actual discover/verify/serve implementation lives once, in `@voiden/mcp/src/lib.ts` (and
`voiden-runner mcp serve`'s own copy of the same call sequence), calling straight into
`@voiden/runner`'s library exports (`planServedTools`/`registerFixedTools`/
`registerToolsFromDecisions`/etc.). The bundled `voiden mcp-stdio` command reuses the exact same
`registerFixedTools()` — it just never calls `planServedTools`/`registerToolsFromDecisions`, so it
never touches `/tool` blocks at all.

This resolves the "is `publish` an action or a server" ambiguity from spec review, and the
follow-up "what does `.mcp.json` actually point at" ambiguity: `@voiden/mcp` is a real,
independent, standalone-deployable package whose only job is running the `/tool`-block server;
`voiden agent`/`voiden-runner mcp install` are registration-only, and what they register is a
different, much smaller server whose only job is the 4 fixed tools.

**Explicitly deferred**: `voiden-runner`'s own `tool list/verify` commands were left in place, not
touched by this pass.

### 7. `voiden-mcp`-time host/config detection & pre-flight checks — ✅ done (one documented gap)
Reality check established in discussion: GitHub Actions / GitLab CI jobs are ephemeral with no
public inbound networking — `voiden-mcp --http` binding a port inside a bare CI job is unreachable
from outside that job, not a config problem but an architectural one. `voiden-mcp` makes this
legible instead of silently binding a dead port, and catches missing env resolution before a
broken request goes out. All of the below is implemented in
[voiden-mcp/src/lib.ts](../packages/voiden-mcp/src/lib.ts) and manually verified against a real
project (`--check` correctly discovered/verified/excluded real tools; `--strict` aborted with
exit 1; `--tunnel` with `cloudflared` missing failed fast with a clear message).

- **No new Voiden-specific config file.** `voiden-mcp` takes CLI flags, each with a documented
  environment-variable fallback of the same name — every CI/CD platform (GitHub Actions,
  GitLab CI, anything else) already has its own native way to set env vars/secrets on a job, so
  that's what users configure in *their* pipeline, not a file Voiden invents:

  | Flag | Env var fallback | Default | What it controls |
  |---|---|---|---|
  | `--port` | `VOIDEN_PUBLISH_PORT` | `3000` | The TCP port the HTTP MCP server binds to — where the `/mcp` JSON-RPC endpoint and `/health` (Pending #5) listen. Irrelevant outside `--http`; stdio has no port. |
  | `--host` | `VOIDEN_PUBLISH_HOST` | `127.0.0.1` | The network interface that port binds to. `127.0.0.1` = this machine only. `0.0.0.0` = reachable from the network — a real exposure risk, opt-in only (already warned on today). |
  | `--mode` | `VOIDEN_PUBLISH_MODE` | `static` (Pending #4) | How many tools get registered. `static` = every verified `/tool` block individually named/typed. `dynamic` = just 2 fixed tools (`search_tools`/`call_tool`), so 1500+ published endpoints don't blow up the agent's context window. |
  | `--tunnel` | `VOIDEN_PUBLISH_TUNNEL` | `false` — **optional**, see note below | Whether `voiden-mcp` additionally wraps `host:port` in a public `cloudflared` quick tunnel and prints that URL. Only needed when the machine `voiden-mcp` runs on has no reachable public IP of its own. |
  | `--scheduler` | `VOIDEN_PUBLISH_SCHEDULER` | `true` (Pending #1, now cadence-derived) | Whether verification keeps re-running — on an interval derived from each tool's declared `cadence` — after the server is up, live withdrawing/re-adding/degrading tools as their real status changes — vs. verifying once at startup and never again. |
  | `--scheduler-interval-minutes` | `VOIDEN_PUBLISH_SCHEDULER_INTERVAL_MINUTES` | derived from cadence (Pending #1) | Explicit override — when set, wins over the cadence-derived interval entirely. |

  Precedence: CLI flag > env var > built-in default. A GitHub Actions step or GitLab CI job just
  sets whichever of these it needs via its own `env:`/`variables:` block (or secrets manager) and
  runs `voiden-mcp <path> --http`, same as any other CLI tool — nothing to author in the repo
  itself beyond the pipeline file the user already owns.
- **CI-environment auto-detection** — check `GITHUB_ACTIONS` / `GITLAB_CI` / `CI` env vars at
  startup. If detected and `--http` is bound to `127.0.0.1` with no `--tunnel`, print a warning
  that this port won't be reachable outside the job, instead of starting silently.
- **`--tunnel` is optional, not the normal path — it exists only for hosts with no public IP of
  their own.** If `voiden-mcp --http` runs on something with a real, reachable public/static IP (a
  VPS, a cloud instance, a self-hosted runner with inbound networking allowed) — `--host 0.0.0.0
  --port <n>` alone is enough; callers just hit `http://<that-ip>:<n>/mcp` directly, no tunnel
  involved. `--tunnel` is specifically for the case where the machine has *no* public IP at all
  (an ephemeral CI job runner, a laptop behind NAT) and still wants a public HTTPS URL without
  owning a domain or configuring port-forwarding/firewall rules. When set, `voiden-mcp` spawns a
  `cloudflared tunnel --url http://<host>:<port>` quick tunnel (no account/signup needed) and
  prints the resulting public URL, torn down by the same SIGTERM/graceful-shutdown handling as
  Pending #5. For a CI job specifically, this URL only lives as long as the job runs — it's the
  realistic "no domain, straight from CI" path, not an always-on substitute for real hosting.
- **Decided: `cloudflared` is a peer binary, not bundled.** `voiden-mcp` shells out to whatever
  `cloudflared` it finds on `PATH` — it isn't downloaded or shipped as part of installing
  `@voiden/mcp`/`@voiden/runner`. Docs for `--tunnel` say plainly: install `cloudflared`
  yourself first (a one-line install on every OS, and already on most CI base images or a single
  extra step to add). If `--tunnel` is passed and `cloudflared` isn't on `PATH`, `voiden-mcp` fails
  fast with a clear "cloudflared not found — install it, see <docs link>" error instead of a
  confusing spawn failure. Keeps `@voiden/mcp` itself small and not tied to a third party's binary
  release cycle; `--tunnel` staying optional (see above) means most users never need it installed
  at all.
- **Pre-flight env-resolution check** — before registering any tool (or before printing the
  `--check` report), every `source: environment` param on every to-be-served tool is checked:
  does its `binds` key exist in `--env`/process env, or does the project have *any*
  `.voiden/env-*.yaml` at all? Anything that resolves to neither becomes a new validation failure,
  excluding that tool from the served set by default, or aborting entirely under `--strict` —
  instead of shipping a request with a literal unresolved `{{token}}` in it.
  **Documented limitation**: this is best-effort, not a full replication of the `voiden-mcp-tool`
  plugin's own per-param `envProfile`/`envName` environment selection (which lives in the plugin,
  not core) — it only catches the unambiguous case (no env file in the project *and* no matching
  key in the serving process's own env). A multi-environment project where a specific tool's param
  doesn't resolve in the *particular* named environment it targets, while some `.voiden/env-*.yaml`
  file exists, isn't caught here. Confirmed working against a real project during manual testing:
  a genuinely-broken param in a test fixture was correctly flagged and excluded.
- **Explicitly out of scope**: `voiden-mcp` does not deploy to a PaaS (Railway/Render/Fly/etc.)
  itself — that stays the surrounding CI pipeline's own job. Its responsibility ends at "produce a
  correctly verified, running MCP HTTP server on this port, plus a public tunnel URL if asked."

---

## Summary

| # | Gap | Status | Package |
|---|---|---|---|
| 1 | Cadence scheduler (auto re-verify on a timer) | ✅ done — interval derived from each served tool's declared cadence; stdio still unsupported | `@voiden/mcp` |
| 2 | Auto-populate params from the bound request | ⬜ not started — plugin UI work | `voiden-mcp-tool` plugin (UI) |
| 3 | Cross-file request binding | ⬜ not started — plugin work | `voiden-mcp-tool` plugin + `@voiden/runner` discovery |
| 4 | Static/dynamic exposure mode | 🟡 flag + static done; dynamic stubbed, needs plugin-side `callTool` | `@voiden/mcp` + `voiden-mcp-tool` plugin |
| 5 | Health check / graceful shutdown for `--http` | ✅ done | `@voiden/mcp` |
| 6 | `@voiden/mcp` (server, no verb) + bundled `voiden agent`/`run`/`mcp-stdio` (registration, folded into the Voiden app) — `@voiden/mcp-host` retired | ✅ done; `voiden-runner`'s own `tool` CLI deliberately untouched | `@voiden/mcp` + `apps/electron` + `@voiden/runner` |
| 7 | Host/config detection, `--tunnel`, pre-flight env checks | ✅ done (pre-flight check is best-effort, see Pending #7) | `@voiden/mcp` |

---

## Resolved decisions

Every decision point raised during spec review, settled:

- `@voiden/mcp` is the only package that runs the `/tool`-block server — no subcommand, no verb.
  `@voiden/mcp-host` (registration-only) has been retired entirely, not just deprioritized.
- Project registration (`.mcp.json`/`config.toml`) is now `voiden agent` (bundled in the Voiden
  app) for app users, and `voiden-runner mcp install` for CI/no-app users — both point at a
  lightweight 4-fixed-tools server, never at `@voiden/mcp`.
- No standalone `uninstall`/`status` for `voiden agent` — `voiden agent --remove` covers uninstall;
  `@voiden/mcp --check` covers server status (Pending #6).
- `--tunnel` is optional — only needed on hosts with no public IP of their own; a real
  public/static IP just binds `--host 0.0.0.0 --port <n>` directly (Pending #7).
- `cloudflared` is a peer binary, not bundled — `--tunnel` shells out to it and fails fast with an
  install pointer if it's missing (Pending #7).
- The scheduler's re-verification interval is derived from declared `cadence`, not a single fixed
  number applied uniformly to every tool — an explicit `--scheduler-interval-minutes` still wins
  when a caller wants to override that (Pending #1).

## Implementation status

**Pass 1** (2026-08-12): `init`/`publish` command surface (Pending #6), production-ops surface
(Pending #5), and host/config detection + pre-flight checks (Pending #7) implemented and
manually verified against a real project — live verification, `--check`, `--strict`, `/health`,
graceful shutdown, missing-`cloudflared` failure path. `--scheduler` (Pending #1) and `--mode`
(Pending #4) landed partially, each with a documented gap rather than a silent shortcut.

**Pass 2** (same day): split into 2 packages, per review — `publish` isn't an action that sends
files to a server, invoking it *is* the server, so the runtime lived in its own package,
`@voiden/mcp-host` (registration) + `@voiden/server` (the runtime).

**Pass 3** (same day): directory names renamed to match their npm package names, after an initial
pass had left them mismatched.

**Pass 4** (2026-08-12, same day): a further redesign folded project registration into the Voiden
app's own `voiden` CLI, retired `@voiden/mcp-host` entirely, and renamed `@voiden/server` to
`@voiden/mcp` (its final name — the package that discovers/verifies/serves `/tool` blocks).
Rationale, in the order it was worked out:

- `@voiden/mcp` is exclusively for publishing `/tool` blocks as a real, hostable server — never
  what an everyday agent-editor session's `.mcp.json` points at.
- `voiden agent [path]` (bundled in `apps/electron`) registers a project the same way
  `@voiden/mcp-host init` used to, but points `.mcp.json` at `voiden mcp-stdio` (a hidden command,
  also bundled) instead of at `@voiden/mcp` — a small, fast, dependency-light 4-fixed-tools stdio
  server, not the tool-publishing runtime.
- `voiden run <paths...>` (also bundled) is a lightweight subset of `@voiden/runner run`, for
  users who want to run `.void` files without installing the standalone runner package.
- `@voiden/runner` stays fully standalone, unaffected — including its own pre-existing
  `mcp serve`, which already implements the same 4-fixed-tools (+ `/tool` blocks) server without
  any dependency on the Electron app; `voiden-runner mcp install`'s default registration target
  was corrected to point at `mcp serve` instead of `@voiden/mcp` (an inconsistency caught during
  verification — the previous default silently expected `@voiden/mcp` to be installed for what is
  meant to be a self-contained CI story).
- `@voiden/mcp`'s scheduler became genuinely cadence-aware in this pass (Pending #1) — the
  re-verification interval is derived from the shortest declared `cadence` across a server's
  served tools, not a single fixed number, with an explicit override still available.

Verified end-to-end, not just typechecked: the bundled `voiden-cli.js` was built via
`scripts/build-electron-cli.mjs` (Vite `build.ssr`, chosen after raw esbuild's Yarn-PnP
auto-detection produced false positives against an unrelated stray `.pnp.cjs` elsewhere on the
machine); `voiden agent`, `voiden run`, and `voiden mcp-stdio` were each run directly with `node`
against a real project, then again through the real `bin/voiden` bash script dispatched against a
simulated packaged `.app` layout — including a genuine `@modelcontextprotocol/sdk` client
connecting over stdio and calling `list_void_files` for real data. `forge.config.ts`'s
`generateAssets` hook now rebuilds the CLI bundle on every package/make and ships `cli/` as an
`extraResource`, matching the existing plugin-bundle build pattern.

Changed files (this pass):
- [packages/voiden-mcp/](../packages/voiden-mcp) — renamed from `packages/voiden-server`; added `computeCadenceIntervalMinutes()` to `lib.ts`
- `packages/voiden-mcp-host/` — deleted entirely
- `apps/electron/src/cli/index.ts` — new: `agent`/`run`/hidden `mcp-stdio` (renamed to `src/voiden-cli.ts` in Pass 5, see below)
- `scripts/build-electron-cli.mjs` — new: Vite SSR bundle of the CLI entry (deleted in Pass 5, see below)
- [apps/electron/forge.config.ts](../apps/electron/forge.config.ts) — `cli` added to `extraResource`; CLI bundle build wired into `generateAssets`
- [apps/electron/bin/voiden](../apps/electron/bin/voiden), [bin/voiden.cmd](../apps/electron/bin/voiden.cmd) — dispatch `agent`/`run`/`mcp-stdio` via `ELECTRON_RUN_AS_NODE=1` before falling through to the GUI launch
- [apps/electron/src/main/ipc/mcp.ts](../apps/electron/src/main/ipc/mcp.ts) — Settings toggle now points at the same bundled `mcp-stdio` target as `voiden agent`, not `@voiden/mcp`
- [packages/executors/src/mcpInstall.ts](../packages/executors/src/mcpInstall.ts) — `defaultServerCommand` now falls back to `voiden-runner mcp serve`, not `@voiden/mcp`
- [packages/voiden-runner/src/index.ts](../packages/voiden-runner/src/index.ts) — `mcp install`'s description/local-server-testing text corrected to match
- `plugins/voiden-mcp-client/` — `/mcp` slash trigger renamed to `/mcp-client` (`src/plugin.ts`, `src/skill.md`, `src/help/index.tsx`, `manifest.json`)
- `.github/workflows/release-mcp-server.yml` — deleted (published the now-retired `@voiden/mcp-host`)
- `.github/workflows/release-server.yml` → `release-mcp.yml` — renamed, references updated to `@voiden/mcp`/`voiden-mcp`

Not yet done, still real work: per-tool-cadence-aware scheduling for **stdio** mode specifically
(HTTP is done), dynamic mode's `call_tool` dispatch (needs a plugin-side
`McpToolCapabilityProvider.callTool`), and Pending #2/#3 in full.

**Pass 5** (2026-08-13): Pass 4's bundling approach for `voiden-cli.js` didn't survive contact
with real packaging — three real problems, caught by testing an actual `electron-forge package`
build instead of trusting the Pass 4 simulation (which stood in a plain `node` symlink for the
Electron binary, silently sidestepping all three):

- **`forge.config.ts`'s `FusesPlugin` had `RunAsNode: false`** (the hardened-secure default) —
  the packaged, signed binary ignores `ELECTRON_RUN_AS_NODE` entirely with that fuse disabled, so
  the whole dispatch mechanism would have been inert in a real build. Flipped to `true`,
  deliberately — a real trade-off (reopens the specific thing that fuse blocks: arbitrary Node
  execution via that env var against the signed binary), made because the alternative (a fully
  separate Node runtime shipped alongside the app, or routing through GUI-app IPC) was
  disproportionate for this.
- **`cli/voiden-cli.js` shipped as an `extraResource`**, which lands as a real sibling file next
  to `app.asar` — not inside it — so it could never safely `require()` anything from the app's own
  `node_modules` (which live inside the asar). This made Pass 4's "just bundle absolutely
  everything" approach (`ssr.noExternal: true`) load-bearing rather than a size optimization: the
  CLI had no working alternative to full bundling once shipped outside the archive.
- Full bundling meant `voiden-cli.js` re-embedded `@voiden/runner`'s *entire* dependency tree
  (`@modelcontextprotocol/sdk`, `chalk`, `nodemailer`, `yaml`, `zod`, `@grpc/proto-loader`) a
  second time, on top of copies already present in the app's own `node_modules` for other reasons
  — real, avoidable duplication, not just an abstract concern.

Fixed by folding the CLI into the app's own Forge/Vite build pipeline instead of a bespoke
side-script, mirroring exactly how `main.js`/`preload.js` already handle their own dependencies:

- `src/cli/index.ts` → `src/voiden-cli.ts` (flat entry, matching `main.ts`/`preload.ts`'s own
  convention) — now a normal `VitePlugin` `build` array entry (`vite.cli.config.ts`, modeled on
  `vite.main.config.ts`), landing at `.vite/build/voiden-cli.js` — a sibling of `main.js`, inside
  `app.asar`.
- `vite.base.config.ts`'s `workspacePackages`/`resolve.alias` (previously just
  `@voiden/executors`, the one other package needing this treatment) gained `@voiden/runner` —
  same two reasons: a workspace symlink (breaks `@electron/asar` if externalized) and
  `"type": "module"` with no `"require"` export condition (breaks a CJS `require()` if
  externalized). Everything else `@voiden/runner` depends on stays external/real, resolved from
  the packaged app's own `node_modules` exactly like `main.js`'s dependencies already are —
  nothing else needed bundling a second time.
- `bin/voiden`/`bin/voiden.cmd` now point at
  `Resources/app.asar/.vite/build/voiden-cli.js` (mac) / `resources\app.asar\.vite\build\voiden-cli.js`
  (Windows), with the bash/batch-level file-existence pre-check removed — bash/batch can't see
  inside an asar archive (only Electron's own patched `fs`/`require` can), so that check would
  always have reported "missing" even when the file was genuinely present.
- `scripts/build-electron-cli.mjs` and the `generateAssets` hook's manual build step deleted —
  Forge's own `VitePlugin` builds `voiden-cli.js` automatically now, same as `main.js`/`preload.js`
  always have. `cli` removed from `extraResource` (nothing left to ship there).

Result: `voiden-cli.js` shrank from 2.5MB (everything inlined) to 636KB (only the two
workspace-symlinked packages inlined, everything else external) — a real, measured reduction, not
just a smaller number from removing something unused. Verified against an actual
`electron-forge package` build (`FusesPlugin`'s `RunAsNode: true` applied, `voiden-cli.js`
confirmed present inside the real `app.asar` at the expected path): `voiden agent`, `voiden run`,
and a genuine `@modelcontextprotocol/sdk` client calling `voiden mcp-stdio` over stdio all
verified working through the real, packaged, fuse-enabled `Voiden.app` and the real `bin/voiden`
script — not a simulation this time. (The renderer build was temporarily disabled for this one
verification run only, to work around an unrelated pre-existing failure — `is-plain-obj` missing
from hoisted `node_modules`, needed by `unified`/`markdownConverter.ts` — and restored immediately
after; that failure is real but out of scope for this pass.)

---

*Last updated: 2026-08-13*
