# Changelog

All notable changes to `@voiden/runner` are documented here. This package is
versioned and released independently of the Voiden desktop app.

## v2.3.0-beta.13 - 2026-08-21

### Fixed
- `linkedBlock`/`linkedFile` imports (a shared headers/auth/body block reused across requests, or a whole section imported from another file) now resolve when running headlessly — previously only the Voiden app resolved these (built on `window.electron`, React Query, and a live editor), so a request that only got its headers/auth/body from an imported block silently sent without them when run via `voiden-runner` or `voiden-mcp` — no error, just an empty header set. `@voiden/executors` bumped to `0.1.8`, which adds the resolver (`resolveLinkedBlocks`/`resolveLinkedFiles`); `originalFile` paths resolve against a new `projectRoot` (matching the Tool block's own `requestFilePath` convention — the `run` command defaults it to `process.cwd()`, `mcp`/`tool` commands pass their existing project directory through).
- Multipart file uploads (`multipart-table`, including `fileLink`/file attachments) and raw binary request bodies (`restFile`) are now supported when running headlessly — previously unsupported outright rather than just import-broken, even though the network layer (`@voiden/executors`' `secureRequest.ts`) already fully handled multipart `FormData` and binary uploads. Fixed upstream in `plugin-voiden-rest-api`'s `runner.ts` (now reuses the app's own `requestBuilder.ts` body-building logic instead of the headless parser only ever handling json/xml/yml bodies), re-bundled here.

## v2.3.0-beta.8 - 2026-08-11

### Fixed
- `voiden-mcp-tool`'s `planServedTools()` now resolves the project's `.voiden/env-public.yaml`/`env-private.yaml` before running verification, not just before registering an already-served tool's real calls — previously only `registerServedTools()` applied that merge, so a tool whose own request or verify-target request needed a variable that already lives in the project's env file (but wasn't separately handed to the headless process's own env, e.g. via `.mcp.json`'s `env` block) would fail verification and get wrongly withdrawn, even though calling it afterward would have resolved fine. Same class of gap as beta.6's `source: environment` fix, this time for the general env merge rather than declared toolparams. Fixed upstream in `plugin-voiden-mcp-tool`'s `toolCapability.ts`, re-bundled here.

## v2.3.0-beta.7 - 2026-08-11

### Fixed
- `mcp install`/`mcp uninstall` no longer corrupt `~/.codex/config.toml` — the section-matching regex stopped at the first `[` it saw, which was the `args = [...]` array inside the `[mcp_servers.voiden-mcp]` table itself, so it never consumed that line. A re-install left the old `args` array orphaned as a dangling, unparseable line; an uninstall left it behind entirely, breaking the file for Codex on next launch. Bumps `@voiden/executors` to `0.1.6` for the underlying fix.

## v2.3.0-beta.6 - 2026-08-07

### Added
- `source: environment` toolparams can now pin their own `envProfile`/`envName`, resolving that exact profile/environment regardless of how many the project has — previously this only ever auto-resolved when the project had exactly one environment, and silently resolved nothing otherwise. Params without either field keep the old single-environment auto-detect behavior, so existing tools need no changes.

### Fixed
- A tool's verification requests now see the same environment-resolved values a real agent call would — `source: environment` params were previously only resolved for actual tool calls, never for verification, so any tool using one would always fail verification (and get withdrawn) even though the tool itself worked fine when called directly.

## v2.3.0-beta.5 - 2026-08-06

### Fixed
- `run_request`/served `/tool` results now report the actually-sent
  `requestHeaders`/`requestBody` (post `{{...}}` substitution) instead of
  the raw, pre-substitution block text — bumps `@voiden/executors` to
  `0.1.5` for the underlying pipeline executor fix. Previously, whenever a
  header or body value contained a template placeholder, the result always
  echoed back the literal `{{token}}` text regardless of whether it actually
  resolved correctly — the request sent was always right, only what got
  reported about it was wrong. Affects every caller of the shared pipeline
  executor, not just `/tool`-served requests.

## v2.3.0-beta.4 - 2026-08-06

### Fixed
- A served `/tool`'s `source: environment` param now actually resolves from
  the project's `.voiden/env-public.yaml` / `.voiden/env-private.yaml` files
  (private overrides public), not just the bare `@voiden/mcp-server` process's
  own OS environment. Deliberately simplified vs. the app's full environment
  system — no profiles, no hierarchical/child environments, no "active
  environment" selection (nothing to select from headlessly) — only resolves
  when a project has exactly one environment defined; ambiguous otherwise.

## v2.3.0-beta.3 - 2026-08-06

### Fixed
- A verify entry (or a tool's own home section) targeting a file with no
  `request-separator` blocks — i.e. a file that's just one request, with no
  real "sections" to disambiguate between — no longer requires its
  `sectionLabel` to exactly match anything. Previously an unlabeled first
  section's real label (`undefined`, from `parseVoidFileSections()`) never
  matched a saved label like `"Request 1"`, so any tool verifying against
  such a file was incorrectly excluded as `missing-section` even though the
  target was unambiguous. `runVoidFile()`, and both the headless and
  Electron-app tool-capability implementations, now treat a single-section
  file as always resolving to its one request regardless of what
  `sectionLabel` (or none) was given.

## v2.3.0-beta.2 - 2026-08-06

Published out of lockstep with the desktop app (still `2.3.0-beta.1`) — this
is an early test release of the `/tool` MCP-serving work below, ahead of the
next full app release.

### Added
- `voiden-runner tool list` / `voiden-runner tool verify` — discovers `/tool` blocks (the `voiden-mcp-tool` plugin) project-wide and runs their verification requests, reporting `verified`/`unverified`/`failing` per tool. `--cadence` filters which verify entries run; `--json` for machine-readable output; `--write` (opt-in) records the last-computed status back into each `/tool` block. Structural problems (unbound/unresolved placeholders, a verify entry pointing at a missing section, duplicate tool names, a read-only tool on a mutating request) exclude a tool from the report entirely, reported distinctly from a verification failure.
- `voiden-runner mcp serve [path]` — serves the project as a live MCP server: the same `list_void_files`/`list_requests`/`run_request`/`write_result` tools `@voiden/mcp-server` exposes, plus declared `/tool` capabilities that pass verification. Defaults to stdio; `--http [--port <n>] [--host <addr>]` serves streamable-HTTP instead, bound to `127.0.0.1` only unless `--host` explicitly opts into wider exposure. `--check` prints served/withdrawn/degraded/excluded without starting a live server.
- New public exports (`discoverTools`, `validateTools`, `verifyTools`, `buildMcpServer`, `registerFixedTools`, `registerDynamicTools`, `planServedTools`, and their types) — the same functions `@voiden/mcp-server` now imports rather than maintaining its own copy of this logic.

## v2.2.0 - 2026-07-23

### Added
- Deterministic exit codes for `run`: `0` success, `1` one or more requests failed (assertions/errors, or `--bail`/`--fail-on-error` — unchanged from prior releases), `2` the runner could not execute the run at all (bad CLI args, missing files, missing plugins, invalid env). Previously every non-success path exited `1`, so CI couldn't tell "the API broke" from "the pipeline is misconfigured." See [CI/CD Integration](https://docs.voiden.md/docs/developer-tools/voiden-runner/ci-cd) for the full table.
- `schemaVersion` field on the `--json` and `--output-json` payloads for `run` and `report generate` — a stable, versioned contract for tooling that parses runner output. Currently `"1"`.

## v2.1.1 - 2026-06-25

### Fixed
- A 0-byte file left behind by a failed or interrupted plugin runner download is no longer treated as an installed runner — `hasCoreRunner`/`hasCommunityRunner` now check file size, so the loader falls back to the bundled copy (or re-downloads) instead of importing an empty module
- Bundled runner assets (`bundled-runners/**`) are now included in the published npm package — `plugin install`/`plugin update` for bundled core plugins no longer requires a network download on a fresh install

## v2.1.0 - 2026-06-24

First release published under the `@voiden/runner` name and versioned in lockstep with the desktop app (previously `0.1.0-beta.x`).

### Fixed
- Set-cookie capture in runtime variables no longer lags one request behind — `byPath` can now navigate `set-cookie.<name>.value`, duplicate `set-cookie` headers are preserved instead of being collapsed, and variable capture now runs before post-request hooks so scripts see the current response's values
- Restored plugin registry modules (`registryCache.ts`, `updateCheck.ts`) that had gone missing from the package, breaking `plugin list`/`plugin update`
- Dropped a stale `@voiden/core-extensions` build dependency that no longer exists in the reworked plugin architecture
- Fixed `npm publish` metadata so the package publishes correctly under the `@voiden` npm scope
