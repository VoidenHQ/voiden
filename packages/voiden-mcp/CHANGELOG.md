# Changelog

All notable changes to `@voiden/mcp` are documented here. This package is
versioned and released independently of the Voiden desktop app.

## v0.0.15 - 2026-09-08

### Fixed
- `--oauth`/`--sso-*`'s OAuth metadata (`.well-known/oauth-protected-resource`,
  `.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`) never actually
  picked up `--tunnel`'s real public URL once it resolved — the Express middleware serving those
  endpoints held a one-time copy of the router built with the pre-tunnel loopback issuer, so it kept
  advertising `http://127.0.0.1:<port>/mcp` as the protected resource indefinitely, even after a real
  tunnel URL existed. OAuth-strict clients that verify the advertised resource matches what they
  actually connected to (confirmed against Cursor: *"Protected resource http://127.0.0.1:3000/mcp
  does not match expected https://\<tunnel\>/mcp"*) correctly refused the connection. Now reads the
  current router on every request instead of a stale copy.
- `/register`, `/authorize`, `/token`, and `/revoke` crashed with
  `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` for any request arriving through `--tunnel` or a reverse
  proxy — the SDK's own per-endpoint rate-limiting middleware refuses to trust `X-Forwarded-For`
  unless Express's `trust proxy` setting says a proxy is expected, which was never set. This broke
  Dynamic Client Registration for every real remote client connecting through a tunnel (testing
  directly against `127.0.0.1` never exercised this path, since no proxy header is added there). Now
  trusts exactly one proxy hop, matching `--tunnel`'s (and a typical `--public-url` reverse proxy's)
  single-hop topology.
- `scripts/smoke-test.mjs`: a failed check called `process.exit()` directly, skipping cleanup of the
  spawned test server(s) entirely — a single failed run left an orphaned `voiden-mcp` process (and
  its restart-supervisor) running indefinitely, fighting later runs for the same port. Failures now
  throw and unwind through one cleanup path that kills every spawned child (server, mock IdP) on
  every exit — success, failure, or an unexpected exception.

## v0.0.14 - 2026-09-08

### Added
- New `--public-url <url>` flag (`VOIDEN_PUBLISH_PUBLIC_URL`) — tells `--oauth` the
  externally-reachable URL clients actually use to reach this server, for anything exposing it
  *other* than `--tunnel` (a manual port forward — VS Code's Ports panel, ngrok — or a reverse
  proxy in front of a `127.0.0.1` bind). Without it, `--oauth`'s advertised issuer/register/
  authorize/token URLs always defaulted to `http://<host>:<port>` — unreachable from wherever the
  connecting client actually is, and the root cause of a generic "couldn't register with sign-in
  service" error that persisted even with `--oauth` genuinely working correctly and reachable
  end-to-end (confirmed via direct probing: `.well-known/oauth-authorization-server`'s
  `registration_endpoint` was advertising `127.0.0.1`, not the real forwarded URL a remote client
  like claude.ai was actually calling through). Also used by `--print-config`'s printed URL when
  set. `--tunnel` is unaffected — it already resolves and advertises its own public URL.

## v0.0.13 - 2026-09-07

### Fixed
- `--http` with no `--oauth`/`--api-key` (i.e. genuinely no auth) returned a confusing `406 Not
  Acceptable` for `.well-known/oauth-protected-resource`/`.well-known/oauth-authorization-server`
  instead of a clean `404` — every path except `/health` fell straight into the raw MCP JSON-RPC
  handler, which rejects anything lacking the right `Accept` header regardless of path. An
  OAuth-aware client checking "does this server require auth?" *before* even looking at how its own
  connector is configured sees that ambiguous non-404 response and can reasonably conclude "might
  need sign-in after all" — surfacing as a client-side warning like "this server requires sign-in,
  but authentication is set to None" even against a server that never asked for auth at all. Also
  fixed the equivalent case for `--api-key` alone (no `--oauth`): those requests were reaching the
  bearer-auth gate and getting a `401` instead of `404`, which is arguably worse — it looks like
  OAuth *is* available when the actual mechanism is a plain static key. Both cases now return a
  plain `404` for `.well-known/*`, the unambiguous "no such thing, don't expect OAuth from me"
  signal. New smoke-test coverage for both.

## v0.0.12 - 2026-09-07

### Fixed
- `--api-key` mode could turn itself on with **no `--api-key` flag present at all** — `VOIDEN_PUBLISH_API_KEY` alone, just being set in the environment, was enough to enable the requirement, since the value-resolution fallback doubled as the enable check. Anyone who'd exported that env var for an earlier `--api-key` session (including by following this package's own docs, which recommend exactly that over a literal CLI value) would then see a completely unrelated, flag-less `voiden-mcp . --http` run silently require a bearer token — surfacing to a connecting client as an unexplained 401/"asked for sign-in" after a hosted MCP server was configured for no auth. `--api-key` (bare or with a value) is now the only thing that turns the requirement on; `VOIDEN_PUBLISH_API_KEY` still supplies the key's *value* once the flag is present, exactly as before, it just no longer enables the mode by itself.

## v0.0.11 - 2026-09-07

### Added
- New `--api-key [key]` flag (`VOIDEN_PUBLISH_API_KEY`) — a static Bearer token in front of the MCP
  endpoint, independent of `--oauth` and needing none of its DCR/authorize/token machinery.
  Combinable with `--oauth`: when both are on, either a valid API key or a completed OAuth handshake
  lets a request through. Pass the flag alone to auto-generate one (persisted to
  `~/.voiden/mcp-api-keys.json`, mode `0600`, keyed by project path, printed at startup); pass a
  value (or set the env var) to set it explicitly.
- New `--sso-authorize-url`/`--sso-token-url`/`--sso-registration-url`/`--sso-revocation-url` flags —
  delegates `--oauth`'s login step to an external IdP instead of auto-approving. Passing
  `--sso-authorize-url`+`--sso-token-url` together is enough to turn OAuth mode on by itself (no
  need to also pass `--oauth`). Requires the upstream IdP to support RFC 7591 Dynamic Client
  Registration at `--sso-registration-url` — an IdP with only one fixed, manually-created app (no
  DCR, e.g. plain "Sign in with Google/GitHub") isn't supported yet; `--sso-client-id`/
  `--sso-client-secret` exist only to fail fast with an explanatory error if that combination is
  attempted. Built on the MCP SDK's `ProxyOAuthServerProvider`, wrapped to persist registered
  clients and locally track issued tokens for verification (see `src/oauthSsoProvider.ts`).
- New `scripts/mock-idp.mjs` — a small, real, standalone OAuth 2.1 + DCR server with an actual login
  form, for testing `--sso-*` locally without a real external IdP. Dev/test tooling only, not part
  of the published package. `npm run smoke-test -- <path> --http --sso` drives the full delegated
  flow against it automatically (including a wrong-password rejection check).

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
