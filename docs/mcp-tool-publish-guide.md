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

**Why is there only bearer and OAuth, and why does OAuth auto-approve?** MCP's own [authorization
spec](https://modelcontextprotocol.io/specification/draft/basic/authorization) defines exactly one
authorization mechanism — OAuth 2.1 (PKCE, Dynamic Client Registration/RFC 7591, Protected Resource
Metadata/RFC 9728, Authorization Server Metadata/RFC 8414). A static bearer token isn't part of the
spec at all — every MCP client that supports one (Claude Code, Cursor, Windsurf, VS Code, Codex CLI,
Zed) added it independently, as a raw `Authorization: Bearer <token>` header, because requiring a
full OAuth-capable authorization server to protect a personal/internal tool is overkill. At the wire
level both are the exact same header — the only difference is whether a human pasted the token in
once (static) or a client-driven handshake obtained it dynamically with real expiry/refresh/
revocation (OAuth). "SSO" isn't a third mechanism either — see "Delegating login to an external IdP"
below, it's the same OAuth 2.1 handshake, just pointed at a real identity provider instead of
auto-approving.

Given that, `--oauth`'s auto-approve is a deliberate choice among three real options, not an
oversight:
1. **Don't implement `--oauth` at all** — then any client that mandates the handshake (claude.ai's
   connector UI, notably) can never connect, full stop, regardless of whether auth was wanted.
2. **Build a real credential check into `--oauth` itself** — a password baked into voiden-mcp. This
   means reinventing an identity provider (storage, hashing, rate-limiting) inside a tool whose job
   is serving `/tool` blocks, badly and from scratch — that facility already exists, done properly,
   as `--sso-*` below.
3. **Auto-approve, and say so plainly (what's implemented).** This is a single-operator, self-hosted
   tool — the trust boundary was already "whoever can reach the URL" the moment `--http` ran with no
   auth flags at all. A click-to-consent screen wouldn't change who can get in, it would just look
   like a lock that isn't one — which is worse than being honest that it's protocol compatibility,
   not access control.

That split is also why `--oauth`/`--sso-*` and `--api-key` are separate, composable flags rather than
one setting: "will this client even talk to my server" (protocol compatibility) and "who's allowed
in" (actual access control) are different problems on purpose.

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

### What actually gets called, endpoint by endpoint

This is the exact sequence a client like claude.ai's connector UI runs through, and what each
endpoint actually returns — useful for comparing against `curl` output when something's not
working, or against a real IdP's own trace if you're debugging `--sso-*` against it.

**1. `.well-known/oauth-protected-resource`** (RFC 9728) — the client's first, unauthenticated call
to `/mcp` gets a `401` whose `WWW-Authenticate` header points here. It tells the client which
authorization server protects this resource:
```json
GET <url>/.well-known/oauth-protected-resource/mcp

{ "resource": "<url>/mcp", "authorization_servers": ["<url>/"] }
```
Notice `authorization_servers` points back at **voiden-mcp itself**, even under `--sso-*` — see the
façade note below for why.

**2. `.well-known/oauth-authorization-server`** (RFC 8414) — the actual endpoint URLs:
```json
GET <url>/.well-known/oauth-authorization-server

{
  "issuer": "<url>/",
  "authorization_endpoint": "<url>/authorize",
  "token_endpoint": "<url>/token",
  "registration_endpoint": "<url>/register",
  "revocation_endpoint": "<url>/revoke"
}
```
If any of these show `127.0.0.1` instead of your real URL, that's the `--public-url` bug described
above, not a client-side problem.

**3. `POST /register`** (RFC 7591 DCR) — the client registers itself and gets back a fresh
`client_id` per connection (not something anyone typed in):
```json
POST <url>/register
{ "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"], "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
  "client_name": "claude-ai" }

→ 201
{ "client_id": "0f50c68e-5c7f-4283-bf42-e89d5817d7fb", "client_id_issued_at": 1234567890, ...(echoed back)... }
```

**4. `GET /authorize?...`** — the browser lands here with `client_id`, PKCE `code_challenge`,
`redirect_uri`, `state`. What happens next is the one place `--oauth` and `--sso-*` actually diverge:
- **`--oauth`**: responds `200` with the "Voiden MCP — authorizing…" auto-approve page, which
  immediately redirects to `<redirect_uri>?code=...&state=...` — no login, no interaction.
- **`--sso-*`**: responds with a real `3xx` redirect whose `Location` is your **actual**
  `--sso-authorize-url` (e.g. the mock IdP's own `/authorize`) — this is the moment the browser
  visibly leaves `voiden-mcp` and lands on a real login form. Once that IdP issues its own code and
  redirects back, `voiden-mcp` is the one that ultimately redirects the browser onward to the
  client's `redirect_uri` with a code.

**5. `POST /token`** — the client exchanges the code (PKCE `code_verifier` checked against the
original `code_challenge`) for a bearer token:
```json
POST <url>/token
grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&code_verifier=...

→ 200
{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "..." }
```
Under `--sso-*`, this call is itself proxied to the real `--sso-token-url` — the `access_token` the
client receives back is the upstream IdP's real token, not a separately-minted one; `voiden-mcp`
just also records its metadata (clientId/scopes/expiresAt) locally so it can verify that exact token
on later `/mcp` requests without re-contacting the IdP every time.

**The `--sso-*` façade, in one sentence**: the client only ever talks to and discovers `voiden-mcp`'s
own endpoints (step 1–2 above never mention the real IdP at all) — `voiden-mcp` is what forwards
registration and token exchange server-side and redirects the browser to the real IdP only at step 4,
which is also why the real IdP's URL never needs to be (and shouldn't be) publicly reachable itself
unless the connecting client's browser is on a different machine than the IdP.

If the client you're connecting accepts a raw command/args (not just a fixed "URL + optional
header" connector field), the existing `mcp-remote` bridge — see "Importing an MCP server config
into Voiden" below — still works with `--api-key` (below) as its `--header`. But if all you need is
a static secret, not real OAuth, `--api-key` skips the extra tool entirely.

### Setting up and testing `--oauth` against every MCP client

**1. Host it.** `--tunnel` gives the public HTTPS URL `--oauth` needs (a loopback bind also works,
but only for a client running on the same machine):
```bash
voiden-mcp . --http --tunnel --oauth --print-config
```
Note the printed `https://xxxx.trycloudflare.com` URL — call it `<url>` below.

**2. Sanity-check the metadata before touching any client.** This catches the most common failure
mode (a client rejecting the connection because the advertised resource doesn't match what it
actually connected to) before you waste time in five different apps:
```bash
curl -s <url>/.well-known/oauth-authorization-server | python3 -m json.tool   # issuer/*_endpoint should all show <url>, never 127.0.0.1
curl -s -D - -o /dev/null <url>/mcp | grep -i www-authenticate                # resource_metadata= should also show <url>
```

**3. Fastest generic check — MCP Inspector**, no app install needed:
```bash
npx @modelcontextprotocol/inspector
```
Open the URL it prints, paste `<url>/mcp` as the server URL, connect. It drives the full DCR →
authorize → token exchange for you and lists the tools once authenticated — confirms the whole
handshake works before you touch any specific client.

**4. Per-client setup**, once the above passes:

| Client | Where to add it | What you should see |
|---|---|---|
| **Claude Desktop / claude.ai** | Settings → Connectors → Add custom connector → paste `<url>/mcp` | The "Voiden MCP — authorizing…" page flashes and redirects with **no login prompt** — that's the auto-approve behavior working as designed |
| **Claude Code / VS Code** | `.mcp.json` / `.vscode/mcp.json`: `{"type": "http", "url": "<url>/mcp"}` (no `headers` needed) | A browser opens automatically on first connection, redirects straight back |
| **Cursor** | `mcp.json`: `{"url": "<url>/mcp"}` | Same auto-redirect. If it instead rejects with a resource-mismatch error, re-run step 2 — Cursor verifies the resource metadata strictly and will (correctly) refuse a stale/mismatched one |
| **Codex CLI** | `config.toml`: `[mcp_servers.voiden]` with `url = "<url>/mcp"`, then run `codex mcp login voiden` explicitly | OAuth isn't automatic here — you must run the login command yourself after adding the server |
| **Windsurf** | Its MCP server settings UI, same `<url>/mcp` | Auto-redirect, same as Cursor/Claude Code |
| **Zed** | Needs the `mcp-remote` bridge (no native OAuth support yet) — see "Importing an MCP server config into Voiden" below for the bridge shape | Browser opens via the bridge's own loopback redirect |

**5. Clean up between attempts.** State persists across restarts by design (that's a feature, not a
bug — see "Registered clients and issued tokens persist" above), which means a stale registration
from an earlier test can otherwise mask whether a fix actually worked:
```bash
rm ~/.voiden/mcp-oauth.json
```

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
- **It's one shared secret, not per-user auth.** Everyone holding the key gets identical, full tool
  access — there's no concept of separate accounts, scopes, or revoking one person without
  revoking everyone. If you need to actually distinguish *who* is connecting, that's what
  "Delegating login to an external IdP" below is for.

**Where the header actually goes is client-specific** — this trips people up more than the flag
itself:

- **Claude Desktop's native connector picker** (Settings → Connectors → Add custom connector) only
  takes a URL — there's no field for a custom header. It expects either no auth or a real OAuth
  handshake, so `--api-key` alone can't be used through that UI at all. **The symptom**: pasting an
  `--api-key`-only URL there shows "Authentication required" and then errors on Connect — that's not
  a bug, it's this UI having no way to ever supply the key. Use `--oauth` (or `--sso-*`) if you want
  this specific entry point to work, or use the JSON config below instead.
- **Claude Desktop's JSON config** (Settings → Developer → Edit Config, i.e.
  `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) only supports local
  `command`/`args` stdio entries, not a native `url`+`headers` shape. This is where the key actually
  goes — bridge it through `mcp-remote`:
  ```json
  {
    "mcpServers": {
      "my-tool": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "https://<your-url>/mcp", "--header", "Authorization: Bearer <your-key>"]
      }
    }
  }
  ```
  Merge this into the file's existing `mcpServers` object rather than replacing the whole file if
  other servers are already configured. **Fully quit Claude Desktop (Cmd+Q, not just closing the
  window) and reopen it** — it only reads this file on startup, so a running instance won't pick up
  the change. If you'd already added a broken connector through the native picker above, remove it
  first (Settings → Connectors) to avoid a duplicate, non-working entry alongside the working one.
- **A `command`/`args` entry shows up in a different place than a native connector, too** — don't go
  looking for it on the Settings → Connectors page, that page only lists native URL+OAuth
  connectors. This one appears in the **tool/attachment picker inside an actual chat** (the
  plug/puzzle-piece icon near the message box) once Claude Desktop has restarted and successfully
  launched it. Check Claude Desktop's own per-server log if it's not appearing —
  `~/Library/Logs/Claude/mcp-server-<name>.log` on macOS — a `tools/list` request that gets a real
  response there confirms the connection itself is fine even if the UI hasn't shown it yet.

**Summary — which entry point you get depends entirely on the auth mode**, using two side-by-side
entries under the same `claude_desktop_config.json`'s `mcpServers` as a concrete example:

| | `--oauth` / `--sso-*` | `--api-key` |
|---|---|---|
| Where you add it | Settings → Connectors → Add custom connector (paste the bare URL) | `claude_desktop_config.json`, a `command`/`args` entry bridged through `mcp-remote` |
| Example | Just `https://<url>/mcp` pasted into the picker — no config file, no `mcp-remote`, that's the entire point of `--oauth` support | `{"voiden-mcp": {"command": "npx", "args": ["-y", "mcp-remote", "https://<url>/mcp", "--header", "Authorization: Bearer <key>"]}}` |
| Where it shows up once connected | Settings → Connectors page | The in-chat tool/attachment picker |
| Requires a restart to pick up | No — the picker connects live | Yes — full Cmd+Q + reopen, config is only read at startup |
- **Claude Code's `.mcp.json` and VS Code's `.vscode/mcp.json`** support a native remote HTTP entry
  with a `headers` object, so no bridge is needed:
  ```json
  {
    "mcpServers": {
      "my-tool": {
        "type": "http",
        "url": "https://<your-url>/mcp",
        "headers": { "Authorization": "Bearer <your-key>" }
      }
    }
  }
  ```
- **Any other client with a plain "URL + header" connector field** — same header name/value pair as
  above: `Authorization: Bearer <your-key>`.

Note that `--print-config` currently prints only `{"url": "..."}`, not the header — add it yourself
using whichever shape above matches your client.

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

**If you're also gating this with `--api-key`, set a fixed value — don't rely on auto-generate.**
Bare `--api-key` (no value) normally auto-generates a key and persists it to
`~/.voiden/mcp-api-keys.json` so it survives restarts — but a CI job's home directory doesn't
survive between runs. In an ephemeral job (or any container that gets rebuilt on deploy), that
means a brand-new random key every run, silently invalidating whatever key you already handed to an
MCP client. Instead:

1. Generate the key once, yourself: `openssl rand -base64 32`.
2. Store that exact string as a secret on whatever's running the server — a GitHub Actions
   repo/environment secret, a GitLab CI variable, or the Environment Variables dashboard on
   Render/Railway/Fly.io for an always-on target — named `VOIDEN_PUBLISH_API_KEY`.
3. Pass the bare `--api-key` flag on the command line to turn the check on, and let it read the
   value from that env var (never as a literal `--api-key <value>` argument — visible to anything
   that can read the process's argv):
   ```yaml
   env:
     VOIDEN_PUBLISH_API_KEY: ${{ secrets.VOIDEN_PUBLISH_API_KEY }}
   run: npx @voiden/mcp ./api --http --tunnel --api-key
   ```
4. Hand the resulting URL (from `--tunnel`'s printed URL, or the platform's stable URL for an
   always-on host) plus that same fixed key to whichever MCP client needs to connect — see "Where
   the header actually goes is client-specific" above for the exact config shape per client.

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
