---
  id: mcp-tool-publish-guide
  title: Publishing Tools as an MCP Server
  sidebar_label: Publish (MCP)
---

> **Draft for the docs site.** This describes `@voiden/mcp` (the `/tool`-block server runtime) and
> the bundled `voiden agent`/`run`/`mcp-stdio` commands (project registration, shipped inside the
> Voiden app itself). `--http`, `/health`, graceful shutdown, `--tunnel`, `--check`,
> `--dynamic-tools`, `--print-config`, and the per-entry-cadence `--scheduler` (stdio included, via an
> auto-restart-on-change supervisor) are all implemented and verified against a real deploy — see
> [mcp-tool-block-spec.md](./mcp-tool-block-spec.md) for full status. For every field on a `/tool`
> block itself, see the [field reference](./mcp-tool-block-reference.md). Written in the
> voice/format of the live docs site so it can be dropped in as-is.

# Publishing Tools as an MCP Server <span className="doc-beta-badge">Beta</span>

A [`/tool` block](./core-features-section/voiden-blocks/tool.md) marks a request as an
agent-callable capability — see the [field reference](./mcp-tool-block-reference.md) for every
field on the block itself, its Parameters table, and its Verification table. Publishing that as a
real, running MCP server is a separate concern from letting an agent editor simply run requests in
a project — they're two different surfaces, each with exactly one job:

| Surface | What it does |
|---|---|
| **`@voiden/mcp`** | The package that actually runs the `/tool`-block server. No subcommand — `voiden-mcp [path]` discovers every `.void` file with a `/tool` block under `path`, verifies each one, and stands up a new MCP server exposing everything that passes, over stdio by default or `--http` for a real network endpoint. This is what you'd deploy standalone (a Dockerfile, a systemd unit, a PaaS build step) to publish an agent-callable API surface, and it's also what you'd run directly for local testing. |
| **`voiden agent`** | Bundled into the Voiden app's own `voiden` command (nothing extra to install if you already have the app) — registers *this project* with an agent editor, writing `.mcp.json` (and the Codex equivalent) pointing at a small, built-in 6-tool server (`list_void_files`, `list_requests`, `run_request`, `write_result`, `list_environments`, `select_environment`), **not** at `@voiden/mcp`. `voiden agent --remove` undoes registration. CI-only environments without the app use `voiden-runner mcp install` instead — same registration, same 6 tools, standalone. |

`@voiden/mcp` doesn't send anything "to" a server — running it *is* the server starting. It's
reserved for publishing `/tool` blocks specifically; an everyday "let Claude Code/Codex run
requests in this project" registration never touches it. See
[mcp-tool-block-spec.md](./mcp-tool-block-spec.md)'s "Command surface" section for the full
rationale, including why an earlier draft's registration-only `@voiden/mcp-host` package was
retired in favor of bundling `voiden agent` into the app itself.

---

## How a param actually resolves

This is the part that trips people up, so — slowly, with an example.

A `.void` request is a complete, already-written document. Before any tool exists, it's just a
normal request you could run yourself:

```
POST /users
{ "email": "a@b.com", "name": "Bob", "currency": "USD" }
```

To let an agent supply a *different* email and name each time it calls this, without touching
`currency` (which should never change), specific spots in the request get marked with a
`{{token}}` — the same substitution Voiden already uses for `{{BASE_URL}}` and other env vars
everywhere else, not a new mechanism invented for tools:

```
POST /users
{ "email": "{{customer_email}}", "name": "{{customer_name}}", "currency": "USD" }
```

Every param row is agent-supplied — there's no separate "environment"-sourced kind of param. A
row's job is just to say **where** a value goes: `binds` is the exact `{{token}}` name in the
request it fills in, required, because a request can have several fields and the request body is
opaque text to Voiden — not a schema it matches param names against. An empty `binds` has no
`{{token}}` to attach to, so it does nothing.

If a value should come from the environment instead of an agent — a base URL, an API key that
should stay invisible to the agent entirely — **don't give it a param row at all.** Leave that
spot in the request as a normal `{{ENV_VAR}}`; it resolves the same way any other environment
variable in any Voiden request already does, completely independent of the tool's params table.
The params table's only job is the agent-facing surface — what the agent can see and set.

That raises an obvious question: if every param is agent-only, what proves the request actually
works during **verification**, when there's no live agent call to supply anything? Each param row
has an optional **Test value** — used only by verification, in place of a real agent call,
substituted the same way an agent's argument would be. Never shown to or sent by the agent
itself. A required param with no test value just can't be exercised by live verification — the
request fails on the unresolved `{{token}}`, correctly, the same way any other missing
substitution would.

This is identical across every part of a request — header value, query string, path segment,
JSON/form body field, a [Multipart Table Block](./core-features-section/voiden-blocks/rest-blocks/multipart-table-block.md)
field, or a [Binary File Block](./core-features-section/voiden-blocks/rest-blocks/binary-file-block.md)'s
`@filename` reference (written as `@{{upload_path}}`) — because all of them are just text with an
optional token in it. A param's type is still `string` even for a file, since an agent can only
ever pass a string (a path, URL, or base64 blob) as a tool argument, never raw binary.

One limitation worth knowing: a param can only bind to a token that's *already* in the request.
A hardcoded value with no `{{token}}` — a fixed file path, a literal body value — has nothing to
attach a param to. Making it agent-controllable means templating that spot in the request first.

---

## Hosting a published server

`voiden-mcp --http` binds an MCP server to a `host:port` on whatever machine runs it. A few flags
control what that actually means in practice:

| Flag | What it controls |
|---|---|
| `--port` | The TCP port the server listens on. |
| `--host` | Which network interface — `127.0.0.1` (this machine only, default) vs `0.0.0.0` (reachable from the network — real exposure risk, opt-in only). |
| `--dynamic-tools` | Off by default — every verified tool registers as its own named tool. Pass this to expose just 2 fixed tools instead — `search_tools`/`call_tool` — so a large published surface (hundreds+ of tools) doesn't overwhelm an agent's context window. |
| `--print-config` | Once the server is actually up (after `--tunnel` resolves, if used), prints a ready-to-paste `{"mcpServers": {...}}` entry to the log — the exact shape Claude Desktop/Claude Code/Cursor read from their own config. Pasting it into a Voiden `.void` file also works — the editor recognizes this shape and fills in an mcp-connection block from it directly. stdio prints the `command`/`args` to reproduce this exact invocation; `--http` prints the real listening or tunnel URL, never a guess (a `0.0.0.0` bind prints a placeholder instead of a URL nothing outside this machine could actually use). |
| `--tunnel` | **Optional** — only needed when the machine running the server has no public IP of its own (an ephemeral CI job, a laptop behind NAT). Wraps the server in a public `cloudflared` quick tunnel and prints the URL, live only as long as the process runs. If you're hosting on something with a real public/static IP already (a VPS, a cloud instance), skip this — `--host 0.0.0.0 --port <n>` alone is reachable directly. Requires `cloudflared` installed on `PATH`; not bundled. |
| `--public-url <url>` | **Optional** — tells `--oauth` the externally-reachable URL clients actually use to reach this server, when something *other* than `--tunnel` is exposing it (a manual port forward — VS Code's Ports panel, ngrok — or a reverse proxy in front of a `127.0.0.1` bind). Without it, `--oauth`'s advertised issuer/register/authorize/token URLs default to `http://<host>:<port>`, unreachable from outside this machine — the exact cause of a generic "couldn't register with sign-in service" error for a client connecting through such a forward. Not needed with `--tunnel`, which already knows its own public URL. |
| `--oauth` | **Optional**, off by default. Without it, `--http`/`--tunnel` are completely unauthenticated — anyone who can reach the URL has full tool access, same as always. Pass this to require OAuth 2.1 (Dynamic Client Registration, authorization, bearer tokens) in front of the MCP endpoint instead — needed for clients that mandate an OAuth handshake before they'll connect at all (claude.ai's connector UI, some CLI agent tools) rather than just accepting a URL and a static header. See "Connecting OAuth-strict clients" below. |
| `--api-key [key]` | **Optional**, off by default, independent of `--oauth` (combine both and either credential works). A static Bearer token, no OAuth handshake involved — pass a value to set it explicitly, or pass the flag alone to auto-generate one (persisted under `~/.voiden/mcp-api-keys.json`, printed at startup). See "A static API key" below. |
| `--sso-authorize-url` / `--sso-token-url` / `--sso-registration-url` / `--sso-revocation-url` | **Optional.** Passing `--sso-authorize-url`+`--sso-token-url` together turns OAuth mode on by itself (no need to also pass `--oauth`) and points its login step at an external IdP you run, instead of auto-approving. See "Delegating login to an external IdP" below. |
| `--scheduler` | Whether verification keeps re-running after the server is up (withdrawing/re-adding/degrading tools live as their real status changes), instead of verifying once at startup only. On by default. `--scheduler-interval-minutes` (default `1`) controls how often the scheduler *checks* what's due — not how often things actually re-verify, which is each `toolverifies` entry's own declared [`cadence`](./mcp-tool-block-reference.md#verification-table-toolverifies-rows) (`hourly`/`daily`/`weekly`/`monthly`). Works over stdio too now, not just `--http` — a change in served state restarts the process (a clean, logged, planned restart, not a crash) so a reconnecting client picks up the new tool list; needs the auto-restart supervisor active, which is on by default (`--no-restart` disables it, and disables this). |
| `--no-restart` | Disables the auto-restart supervisor that's on by default for a long-running server — normally a crash gets retried automatically (capped, so a persistent problem doesn't loop forever) and, over stdio, a scheduled verification change triggers a clean restart so the tool list stays current. Pass this to run as a single unsupervised process instead — e.g. when something *else* already supervises it (systemd, pm2, Docker `--restart=always`) and two layers of restart logic would just fight each other. |

Each flag has a matching environment-variable fallback (`VOIDEN_PUBLISH_PORT`,
`VOIDEN_PUBLISH_HOST`, `VOIDEN_PUBLISH_DYNAMIC_TOOLS`, `VOIDEN_PUBLISH_PRINT_CONFIG`,
`VOIDEN_PUBLISH_TUNNEL`, `VOIDEN_PUBLISH_PUBLIC_URL`, `VOIDEN_PUBLISH_OAUTH`,
`VOIDEN_PUBLISH_API_KEY`, `VOIDEN_PUBLISH_SSO_AUTHORIZE_URL`, `VOIDEN_PUBLISH_SSO_TOKEN_URL`,
`VOIDEN_PUBLISH_SSO_REGISTRATION_URL`, `VOIDEN_PUBLISH_SSO_REVOCATION_URL`,
`VOIDEN_PUBLISH_SCHEDULER`, `VOIDEN_PUBLISH_SCHEDULER_INTERVAL_MINUTES`)
— CLI flag wins, then env var, then the default above. Nothing Voiden-specific to configure in the
repo; a CI/CD platform's own way of setting env vars/secrets is enough. `voiden-mcp --version`
prints the installed package version; `voiden-mcp --check` is a dry run — discovers, validates,
and verifies without starting a live server, printing exactly what would/wouldn't be served and
why.

### Connecting OAuth-strict clients (claude.ai, CLI agents)

Some MCP clients refuse to connect to an HTTP server at all until it completes a full OAuth 2.1
handshake — Dynamic Client Registration, then an authorization + token exchange — even if the
server itself doesn't otherwise need one. claude.ai's connector UI is one; some CLI-based agent
tools that open a local browser and wait on a loopback redirect (the same pattern `gh auth login`/
`gcloud auth login` use) are others. Without `--oauth`, those clients fail immediately with
something like *"Couldn't register with \<name\>'s sign-in service"* — there's nothing at
`/register` for them to talk to.

`--oauth` adds that layer: `.well-known/oauth-protected-resource`,
`.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`, `/revoke`, and a
bearer-token check in front of the MCP endpoint (`/health` stays open). A few things worth knowing:

- **`/authorize` auto-approves — there's no login page to click through.** voiden-mcp is a
  single-operator, locally-run tool: whoever can reach the URL already has full tool access with
  `--oauth` off, exactly as without it. OAuth here exists to satisfy clients that require the
  protocol shape, not to add a new identity check — a click-to-approve step wouldn't change that
  trust boundary. You'll still see a brief "Voiden MCP — authorizing…" landing page in a
  browser-driven flow, it just redirects on its own with no interaction needed.
- **Registered clients and issued tokens persist** to `~/.voiden/mcp-oauth.json` (permissions
  `0600`) — a crash-recovery restart or a normal stop/start won't force every connected client to
  re-authenticate.
- **Needs a real, externally-reachable URL — `--tunnel`, or `--public-url` for anything else.** An
  OAuth issuer must be HTTPS or loopback (RFC 8414), so `--oauth` on its own (no `--tunnel`, no
  `--public-url`) requires staying on the default `127.0.0.1`/`localhost` bind, and only advertises
  that loopback address as the issuer/register/authorize/token URLs. `--tunnel` fixes this
  automatically (it knows its own `cloudflared` URL). **If you're exposing the server some other
  way — a manual port forward (VS Code's Ports panel, ngrok), a reverse proxy, anything
  `--tunnel` didn't set up itself — pass `--public-url <the-url-clients-actually-use>` explicitly.**
  Without it, the server keeps advertising `http://127.0.0.1:<port>/register` etc., which is not
  reachable from wherever the connecting client actually is — this is *the* cause of a generic
  "couldn't register with sign-in service" error that persists even though `--oauth` itself is
  working correctly (confirm with `curl <forwarded-url>/.well-known/oauth-authorization-server` —
  if `registration_endpoint` says `127.0.0.1`, that's the bug, and `--public-url` is the fix).

If the client you're connecting accepts a raw command/args (not just a fixed "URL + optional
header" connector field), the existing `mcp-remote` bridge — see "Importing an MCP server config
into Voiden" below — still works with `--api-key` (below) as its `--header`. But if all you need is
a static secret, not real OAuth, `--api-key` skips the extra tool entirely.

### A static API key

For clients that accept a plain "URL + header" connector, or a raw command/args config (`mcp-remote
<url> --header "Authorization: Bearer <key>"`), a shared secret is simpler than the full OAuth
dance above — no browser, no handshake, just a Bearer token you generate once and hand out:

```bash
voiden-mcp . --http --tunnel --api-key
# → 🔑 API key required — pass "Authorization: Bearer <generated-key>"
```

- **Independent of `--oauth`, and combinable with it** — `--api-key` alone needs none of the
  `.well-known`/`/register`/`/authorize`/`/token` machinery, just a bearer check in front of the MCP
  endpoint. Pass both `--oauth` and `--api-key` together and *either* a valid API key *or* a
  completed OAuth handshake lets a request through — useful if you want to hand some people a quick
  key while others go through full OAuth/SSO.
- **Auto-generated and persisted** when you pass the flag with no value — stored under
  `~/.voiden/mcp-api-keys.json` (mode `0600`), keyed by project path, so a restart doesn't silently
  rotate a key you've already shared. Pass `--api-key <value>` (or set `VOIDEN_PUBLISH_API_KEY`) to
  set it explicitly instead — prefer the env var over a literal CLI value, which is visible to
  anything that can read this process's argv (`ps`).

### Delegating login to an external IdP

`--oauth` on its own auto-approves — see "Connecting OAuth-strict clients" above for why that's a
deliberate choice, not an oversight, given the underlying trust model. If you want an actual login
in front of it instead, point it at your own identity provider:

```bash
voiden-mcp . --http --tunnel \
  --sso-authorize-url https://your-idp.example.com/oauth/authorize \
  --sso-token-url https://your-idp.example.com/oauth/token \
  --sso-registration-url https://your-idp.example.com/oauth/register
```

Passing `--sso-authorize-url`+`--sso-token-url` together is enough to turn OAuth mode on by itself —
no need to also pass `--oauth`. Once set, the MCP client's browser gets redirected to *your*
`--sso-authorize-url` for the actual login (your IdP's real login page, your users, your rules) —
our server only mints its own token afterward, once your IdP confirms who they are. This is the
same generic `/authorize` + `/token` flow every OAuth-capable MCP client already expects — nothing
about the client side changes, only what happens inside those two endpoints.

**Requirement**: your IdP must support Dynamic Client Registration (RFC 7591) at
`--sso-registration-url` — this is what lets any MCP client that connects register itself against
your IdP automatically, the same way it would against our own built-in `--oauth`. Many
enterprise IdPs (Okta, Auth0, Keycloak, etc.) support this when configured for it. **Not supported
yet**: an IdP with only one fixed, manually-created app and no DCR — this is how plain "Sign in with
Google/GitHub" work, and needs a fundamentally different design (a broker holding one shared app,
bridging every MCP client's own dynamic registration through it). `--sso-client-id`/
`--sso-client-secret` exist only so passing them without `--sso-registration-url` fails with an
explanatory error instead of silently doing nothing.

`--sso-revocation-url` is optional — pass it if your IdP has a revocation endpoint.

**Testing this locally, without a real IdP yet**: `packages/voiden-mcp/scripts/mock-idp.mjs` is a
small, real, standalone OAuth 2.1 + DCR server with an actual login form (default credentials
`testuser`/`testpass123`, overridable via `--user`/`--pass`) — everything in-memory, meant purely
for testing, never published. Run it, then point `voiden-mcp` at it exactly as you would a real IdP:

```bash
node packages/voiden-mcp/scripts/mock-idp.mjs --port 4001
# in another terminal:
voiden-mcp . --http --tunnel \
  --sso-authorize-url http://127.0.0.1:4001/authorize \
  --sso-token-url http://127.0.0.1:4001/token \
  --sso-registration-url http://127.0.0.1:4001/register
```
Connecting a real MCP client will land its browser on the mock IdP's login page — wrong credentials
are genuinely rejected there, right ones issue a real token. `npm run smoke-test -- <path> --http
--sso` automates this exact flow (including the wrong-password check) end to end.

### Running it from CI/CD

GitHub Actions and GitLab CI jobs are ephemeral with no public inbound networking — a port bound
inside a bare job isn't reachable from outside it. That's not a Voiden limitation, it's true of
every CI provider. Two real options:

- **Ephemeral / preview**: add `--tunnel` — gives a public URL for the job's lifetime, good for
  PR-preview or verification runs, gone once the job ends.
- **Always-on**: CI can't host a persistent server itself — it can only *deploy to* one (a
  self-hosted runner you control, or a platform like Railway/Render/Fly.io that keeps the process
  alive and gives you its own public URL). `voiden-mcp` doesn't do that deploy step itself; it
  stops at "produce a correctly verified, running MCP server on this port."

```yaml
# .github/workflows/publish-mcp.yml (illustrative)
- name: Run MCP server
  env:
    VOIDEN_PUBLISH_PORT: 3000
    # any {{ENV_VAR}} your requests use directly (not a tool param — see
    # "How a param actually resolves" above)
    STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
  run: npx @voiden/mcp ./api --http --tunnel
```

`@voiden/mcp` is the only supported way to do this — it's reserved for publishing `/tool` blocks
specifically. Registering a project so an agent editor can just *run* requests in it (no `/tool`
publishing involved) is a different, much lighter command — `voiden agent` (bundled in the app)
or `voiden-runner mcp install` (standalone, for CI/no-app environments) — see
[mcp-tool-block-spec.md](./mcp-tool-block-spec.md)'s "Command surface" section.

### Worked example: deploying to Render

An always-on host, walked through end to end — [Render](https://render.com)'s free tier needs no
card and gives a stable HTTPS URL automatically, which is why it's used here, but nothing below is
Render-specific beyond the two build/start commands; the same shape works on Railway, Fly.io, a
VPS, or any platform that runs an arbitrary start command and injects a `$PORT`.

1. **Push a repo with your `.void` files.** Just the files themselves — no `package.json`
   required, `npm install` creates a minimal one automatically if none exists.
2. **New → Web Service on Render**, pointed at that repo.
3. **Build Command:**
   ```
   npm install @voiden/mcp@latest
   ```
   Deliberately **not** `npm install -g` — Render's build container doesn't run as root, so a
   global install fails with an `EACCES`/`ENOENT` trying to write to the system `node_modules`
   path. A local install (no `-g`) works because it writes inside your own project directory,
   which the build user *can* write to.
4. **Start Command:**
   ```
   npx voiden-mcp . --http --port $PORT --host 0.0.0.0
   ```
   Two details that matter: `npx` (not a bare `voiden-mcp`) finds the local, non-global install
   from step 3; `$PORT` (not a hardcoded number) is what Render actually assigns and routes to —
   hardcoding a port here means Render can never reach it.
5. **Deploy.** You'll get a URL like `https://your-app.onrender.com` — the actual MCP endpoint is
   `https://your-app.onrender.com/mcp`; `/health` is also live for a quick check.

Two mistakes worth calling out because they produce the exact same confusing symptom — the server
starts fine, logs `N tool(s) served`, but `N` is `0` and nothing in the startup log says why
(exclusion reasons are only printed by `--check`'s report, not during a normal `--http` startup —
run `voiden-mcp . --check` locally against the same commit if this happens to you, it'll name the
excluded tools and the exact reason):

- **A cross-file `requestFilePath`/verify `filePath` still holding an absolute path from wherever
  it was originally authored.** The file picker saves these relative to the project root now, but
  anything saved before that fix (or hand-typed) needs the same treatment manually — see
  [path portability](./mcp-tool-block-reference.md#a-note-on-path-portability). Concretely: open
  the `.void` file's raw YAML and make sure the path is just the filename (`firstrequest.void`),
  not `/Users/you/wherever/firstrequest.void`.
- **A relative path with a leading slash**, e.g. `/firstrequest.void`. This looks relative but
  isn't — a leading `/` means "filesystem root" on Linux, which doesn't exist in your deploy the
  way it might coincidentally resolve to something on your own machine. A true relative path has
  **no** leading slash.

### Importing an MCP server config into Voiden

The other direction of the same loop: paste a server's `mcpServers` (Claude Desktop, Cursor,
Windsurf, Claude Code's `.mcp.json`) or `servers` (VS Code's `.vscode/mcp.json`) config JSON
anywhere in a `.void` file, and Voiden fills in an mcp-connection block from it automatically — no
manual URL/header typing. This works for `--print-config`'s own output, and for any other MCP
server's config you're handed, not just Voiden-published ones:

- **Every server in the pasted config becomes its own block** — paste a config with 3 servers,
  get 3 connection blocks, not just the first with the rest silently dropped.
- **Headers** import whether they're a plain object map (`{"Authorization": "Bearer ..."}`) or an
  array of `{name, value}` objects — both shapes are recognized.
- **`mcp-remote`-wrapped entries import too.** A config like
  `{"command": "npx", "args": ["-y", "mcp-remote", "<url>", "--header", "Authorization: Bearer ..."]}`
  looks like a local process, but `mcp-remote` is a stdio↔HTTP bridge, not an actual local server —
  the real URL and headers are recovered from its `args` and applied exactly like a native `"url"`
  entry.
- **A genuinely local server** (spawns its own process, e.g. `{"command": "node", "args":
  ["server.js"]}`) can't become a block — there's no local-process transport on the mcp-connection
  block — and shows a toast explaining why instead of silently doing nothing.

---

## Verification

A tool is only served if it passes verification — each `/tool` block's **Verification** table
points at other requests as proof it still works (`happy-path` / `error-contract` / `auth-check`
roles), including running any assertions already on those requests. A failing tool is withdrawn
from what's served by default, or kept and flagged `degraded` in its description, per the tool's
own on-failure policy. With `--scheduler` on, each entry keeps re-running independently on its own
declared `cadence` for the life of the published server, not just once at startup — see the
[Verification table reference](./mcp-tool-block-reference.md#verification-table-toolverifies-rows)
for the full field list, including exactly which `cadence` values are recognized.

---

## FAQ

**Why do I still need `binds` — isn't declaring a param enough?**
A request can have several fields, and the request body is opaque text to Voiden — not a schema
it matches param names against. `binds` is the only thing that tells Voiden *where* in the
request a param's value actually goes.

**Do I need to buy a domain to publish a server?**
No. `--tunnel` gives a public URL with zero domain and zero signup when there's no public IP
otherwise. If the machine already has a public IP, you don't need a domain *or* a tunnel — just
bind the port directly.

**Can GitHub or GitLab host the server by themselves, with nothing else?**
No — their CI jobs have no public inbound networking and are torn down when the job ends. `
--tunnel` from within a job gives a URL that lives as long as that job does; an always-on server
needs a real compute target (a self-hosted runner or a platform like Railway/Fly.io) that CI
deploys to, not CI itself acting as the host.

**A param verifies fine locally but fails once published — why?**
Almost always a missing **Test value**. Verification has no live agent call to supply a param's
value, so it substitutes that param's Test value instead — if it's empty, the request goes out
with a literal unresolved `{{token}}` in it and fails, correctly. Add a Test value on that param
row to give verification something real to send.

**Can I keep a value hidden from the agent entirely, like an API key?**
Yes — just don't give it a param row. Leave that spot in the request as a plain `{{ENV_VAR}}`; it
resolves from the environment the same way any other Voiden request's env vars do, with the
params table never involved. Every declared *param*, by contrast, is always agent-facing — see
["How a param actually resolves"](#how-a-param-actually-resolves) above.

**Does where I host `voiden-mcp` matter to Voiden?**
No — it's a plain npm package with no Voiden-specific hosting logic in it, the same as any other
CLI tool (`http-server`, say). `voiden-mcp <path> --http` behaves identically on a laptop, a VM,
inside Docker, or on a PaaS. Voiden gives you the tool to run the server; where you run it is
entirely yours to choose.

**I see `0 tool(s) served` and no explanation — why?**
The most common cause by far: a cross-file `requestFilePath` or verify `filePath` pointing at a
path that doesn't exist on the machine actually running the server (see the
[worked Render example](#worked-example-deploying-to-render) above for the two specific ways this
happens). Run `voiden-mcp <path> --check` — unlike a normal `--http` startup, it prints exactly
which tools were excluded and why, one line per reason.

**I typed a `cadence` value and it doesn't seem to be respected — why?**
Only `hourly`, `daily`, `weekly`, and `monthly` are recognized (case-insensitive); anything else —
a typo, or a value that isn't one of those four — silently falls back to `hourly` with no warning.
The editor's Verification table now locks this field to those four values specifically so a typo
can't happen going forward, but a `.void` file saved before that fix (or edited by hand) can still
hold a stray value — check the raw block if a cadence you set doesn't match the re-verify log
lines you're seeing.

**Does the scheduler work over stdio, or only `--http`?**
Both now. Over `--http`, a changed served-state just updates what the next request sees. Over
stdio there's no way to hot-swap a single long-lived connection's tool list, so instead the process
does a clean, logged restart when something changes — a reconnecting client picks up the new list.
This needs the auto-restart supervisor active, which is on by default; `--no-restart` disables
both the crash-retry behavior and this.
