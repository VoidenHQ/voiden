# Changelog

All notable changes to `@voiden/mcp` are documented here. This package is
versioned and released independently of the Voiden desktop app.

## v0.0.10 - 2026-09-07

### Added
- New `--oauth` flag (`VOIDEN_PUBLISH_OAUTH`) for `--http` — adds a full OAuth 2.1 authorization
  server in front of the MCP endpoint (Dynamic Client Registration, `.well-known` metadata,
  `/authorize`, `/token`, `/revoke`, bearer-token verification) for MCP clients that require an
  OAuth handshake before connecting at all (e.g. claude.ai's connector UI, CLI agents doing an
  RFC 8252 loopback-redirect flow). Previously `--http`/`--tunnel` had no OAuth support whatsoever,
  so such clients failed immediately with "Couldn't register with \<name\>'s sign-in service" —
  there was nothing at `/register` to talk to. Off by default; `--http`/`--tunnel` without
  `--oauth` are unchanged and stay just as unauthenticated as before. `/authorize` auto-approves
  (no login/consent page) — this doesn't add a new identity check, since anyone reaching the URL
  already has full access either way; it exists to satisfy clients that require the protocol shape.
  Registered clients and issued tokens persist to `~/.voiden/mcp-oauth.json` (mode `0600`) so a
  crash-recovery restart doesn't force reconnecting clients to re-authenticate.

## v0.0.9 - 2026-08-17

### Fixed
- `0.0.8` was published with an unresolved `"@voiden/runner": "workspace:*"` dependency — that protocol is Yarn-only, so `npm install @voiden/mcp@latest` failed outright with `EUNSUPPORTEDPROTOCOL`. Caused by publishing directly with a plain `npm publish` instead of through `release-mcp.yml`, which exists specifically to pin this dependency to the exact already-published `@voiden/runner` version before publishing (see that workflow's own comments). `0.0.8` has been deprecated on npm; this release pins correctly. Going forward, releases should go through the GitHub Actions workflow, not a local `npm publish`.

## v0.0.8 - 2026-08-14

### Fixed
- A live server (`--http` or stdio) now reports `/tool` blocks that were **discovered but excluded** — e.g. a cross-file `requestFilePath` pointing at an absolute path that only resolves on the machine the `.void` file was authored on, so it silently fails to resolve anywhere else it's deployed. Previously only `--check` printed exclusion reasons; a live server just said `N tool(s) served`, making "tools found but excluded" and "project genuinely has zero /tool blocks" look identical, with no way to tell them apart from the logs.
- New `--verbose` flag (`VOIDEN_PUBLISH_VERBOSE`) actually surfaces plugin-load diagnostics — previously `loadEnabledPlugins()` was always called with `verbose: false` and there was no flag to change that, so a plugin failing to import/initialize (e.g. `voiden-mcp-tool`, the plugin that understands `/tool` blocks at all) did so completely silently: no console output, no exit code change, just an empty tool list indistinguishable from an empty project.
- When `voiden-mcp-tool` isn't active (disabled, missing bundled runner, or a load-time error) the server now says so loudly at startup instead of just serving 0 tools with no explanation.
