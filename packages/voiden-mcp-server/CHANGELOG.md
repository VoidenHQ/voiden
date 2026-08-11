# Changelog

All notable changes to `@voiden/mcp-server` are documented here. This package is
versioned and released independently of the Voiden desktop app and `@voiden/runner`.

## v0.1.6 - 2026-08-11

### Fixed
- A tool's verification requests now see the project's `.voiden/env-public.yaml`/`env-private.yaml` variables, not just whatever env this server process was started with (e.g. `.mcp.json`'s `env` block) — see `@voiden/runner`'s `2.3.0-beta.8` changelog entry for the underlying fix.

## v0.1.5 - 2026-08-07

### Added
- `source: environment` toolparams can pin their own `envProfile`/`envName` — see `@voiden/runner`'s `2.3.0-beta.6` changelog entry for the underlying fix.

### Fixed
- Verification now sees the same environment-resolved values a real tool call would, instead of always failing for any tool with an environment-sourced param — see `@voiden/runner`'s `2.3.0-beta.6` changelog entry.

## v0.1.4 - 2026-08-06

### Fixed
- Tool call results now report the actually-sent `requestHeaders`/
  `requestBody` instead of the raw, pre-substitution text — see
  `@voiden/runner`'s `2.3.0-beta.5` changelog entry for the underlying fix.

## v0.1.3 - 2026-08-06

### Fixed
- A served `/tool`'s `source: environment` param now resolves from the
  project's `.voiden/env-public.yaml` / `.voiden/env-private.yaml` files —
  see `@voiden/runner`'s `2.3.0-beta.4` changelog entry for the underlying fix.

## v0.1.2 - 2026-08-06

### Fixed
- A tool verifying against a single-request file (no `request-separator`
  blocks) is no longer incorrectly excluded as `missing-section` — see
  `@voiden/runner`'s `2.3.0-beta.3` changelog entry for the underlying fix.

## v0.1.1 - 2026-08-06

Dynamic `/tool` registration — at startup, before connecting, the server now
scans the project for `/tool` blocks (the `voiden-mcp-tool` plugin), verifies
each one (`@voiden/runner`'s `discoverTools`/`verifyTools`), and registers only
the ones that should be served as real, individually-named/described/typed
MCP tools alongside the 4 fixed ones — instead of an agent only ever seeing
the same generic `run_request`/etc regardless of what the project declares.

- A tool's verification policy now actually does something: a `failing` tool
  is withdrawn (hidden from the agent entirely) by default, or served with a
  "⚠ DEGRADED" note in its description if `onFailure: advertise-degraded`.
  Each verification row has its own `mode` (`live` by default, `sandbox`, or
  `none` to skip just that row automatically — e.g. a destructive action you
  don't want re-tested on a loop); siblings on the same tool still run
  normally. `sandbox` is a declarative label only — it runs exactly like
  `live`, with no redirection — meaning the row's referenced request already
  targets a sandbox endpoint by the author's own choice.
- Load-time structural validation (voiden-mcp-blocks-spec.md §1.6) — a tool
  with an unbound/unresolved placeholder, a verification row pointing at a
  nonexistent section, a name collision with another tool, or a
  `readOnlyHint` tool whose request actually mutates is **excluded** from the
  served set entirely, reported distinctly from a verification failure.
  Other valid tools in the same project are unaffected.
- `_meta['md.voiden/verification']` (state, last_verified, commit) is now
  attached to every served tool — a structured, silent channel alongside the
  human-readable description note (nothing currently reads namespaced `_meta`
  today; this is transparency for tooling, not something an agent acts on).
- New `--check` flag (`voiden-mcp-server <project> --check`) — prints what
  would be served/withdrawn/degraded/excluded without starting a live
  session, and exits non-zero if any tool is `failing` or excluded. Useful
  for CI or confirming behavior before connecting an agent.
- Verification is automatic only — the agent has no way to trigger it itself,
  it just finds some tools available and others not.
- Internal refactor: all tool-building (the 4 fixed tools plus /tool
  discovery/validation/verification/registration) moved into `@voiden/runner`'s
  new `mcpServing.ts`, shared with the new `voiden-runner mcp serve` command
  (stdio + HTTP, for CLI-only users with no Voiden app installed). Behavior-
  preserving for existing users of this package — `dynamicTools.ts` is gone
  from this package entirely, fully absorbed into the shared module instead.

## v0.1.0 - 2026-07-24

First release. An MCP (stdio) server exposing `@voiden/runner`'s execution engine
as tools for an AI agent:

- `list_void_files` — list every `.void` file in the project
- `list_requests` — parse a `.void` file's requests (label, uid, method, URL) without running anything
- `run_request` — execute a request or a whole file, returning a structured pass/fail result
- `write_result` — record a `run_request` result back into the `.void` file as a `response` block

Registered automatically by `voiden-runner mcp install` (Claude Code / Codex), or
by the Voiden app's Settings "Claude/Codex integration" toggle.
