# The `voiden` CLI

The `voiden` command doubles as the app launcher (`voiden ~/Documents` opens that folder in the
GUI) **and** a small, headless command surface — `agent`, `run`, and a hidden `mcp-stdio` — bundled
directly into the Voiden Electron app itself. No separate install, no separate Node runtime: the
packaged app's own binary bundles Node, and `bin/voiden` dispatches straight into it.

This is deliberately a *different, smaller* thing than either of the other two Voiden CLIs in this
repo:

| | What it's for | Install |
|---|---|---|
| **`voiden`** (this doc) | Register a project with an agent editor, and run `.void` files headlessly — the everyday, always-available case | Comes with the Voiden app, nothing extra |
| **`@voiden/mcp`** | Publish `/tool`-tagged requests as a real, standalone, independently-hostable MCP server | `npx @voiden/mcp` |
| **`@voiden/runner`** | The full-power headless runner — CSV export, mail reports, session state, CI/CD flags — for CI servers with no Voiden app installed | `npm install -g @voiden/runner` |

If you just want an agent editor (Claude Code, Codex) to be able to run requests in a project, or
you want to run `.void` files from a terminal without installing anything extra, this CLI is the
one you want. See [mcp-tool-block-spec.md](./mcp-tool-block-spec.md) for the full rationale behind
this three-way split, and [mcp-tool-publish-guide.md](./mcp-tool-publish-guide.md) for `@voiden/mcp`
specifically.

---

## Commands

| Command | Purpose |
|---|---|
| `voiden agent [path]` | Register this project with Claude Code and/or Codex |
| `voiden run <paths...>` | Run `.void` files headlessly and print/return the results |
| `voiden mcp-stdio [path]` | *(hidden — not shown in `--help`)* The stdio MCP server `voiden agent` itself registers |
| `voiden [path]` / `voiden` | Everything else — opens the GUI, exactly as before |
| `voiden -v` / `--version` | Print the installed version |
| `voiden -h` / `--help` | Show the top-level help (GUI usage; `agent`/`run` have their own `--help`) |

`agent`, `run`, and `mcp-stdio` are checked for first, before anything else — `voiden agent ./api`
runs the CLI command; `voiden ./api` (no recognized subcommand) opens `./api` in the GUI, same as
always.

---

## `voiden agent` — register with an agent editor

```
voiden agent [path] [options]

Options:
  --claude          Claude Code only
  --codex           Codex only
  --remove          Remove the registration instead of adding it
```

Writes `.mcp.json` (and the Codex `config.toml` equivalent) so Claude Code / Codex knows to start a
small MCP server for this project and picks up 6 fixed tools:

- `list_void_files` — see which `.void` files exist in the project
- `list_requests` — see what requests a file contains, without running anything
- `run_request` — actually execute a request and return a structured result
- `write_result` — record a result back into the `.void` file as a `response` block
- `list_environments` — discover the env profiles/environments this project has (`.voiden/env-*.yaml`, or a plain `.env` fallback), including nested environments as dotted paths (e.g. `staging.eu`)
- `select_environment` — pick a profile (+ optional environment within it) as the default env for every `run_request` call for the rest of the session — returns variable *keys* only, never values, since `env-*-private.yaml` can hold real secrets

**Examples:**
```bash
voiden agent                    # register this directory, both Claude Code and Codex
voiden agent ./api --claude     # Claude Code only
voiden agent --remove           # undo registration
```

### What actually gets written

```json
{
  "mcpServers": {
    "voiden-mcp": {
      "command": "voiden",
      "args": ["mcp-stdio", "/absolute/path/to/the/project"]
    }
  }
}
```

`command` is `voiden` itself — recursively invoking the same binary with the hidden `mcp-stdio`
subcommand (below). **This never points at `@voiden/mcp`** — that's a separate, standalone server
for publishing `/tool` blocks as an API surface, not what an everyday "let an agent run requests in
this project" session needs. Conflating the two was an earlier design mistake corrected during this
work; see [mcp-tool-block-spec.md](./mcp-tool-block-spec.md)'s "Command surface" section for the
full rationale.

### Two entry points, one implementation

The Voiden app's own Settings → "Claude/Codex integration" toggle does exactly what `voiden agent`
does — same target, same underlying `registerClaudeMcpServer`/`upsertCodexMcpSection` primitives
from `@voiden/executors` — so toggling it in the app and running `voiden agent` from a terminal
never disagree about what gets written under the `.mcp.json`'s `voiden-mcp` key.

CI machines with no Voiden app installed use `voiden-runner mcp install` instead — same
registration, same 6 tools, fully standalone (points at `voiden-runner mcp serve`, not this CLI).

---

## `voiden run` — run `.void` files headlessly

```
voiden run <paths...> [options]

Options:
  -e, --env <path>          Path to a .env or .yaml file for variable substitution
  --environment <name>      Scope --env to one named environment in a multi-environment
                             YAML file (e.g. "dev") instead of merging every environment
                             in it together
  --show-req                Print sent request headers and body for each request
  --show-res                Print response headers and body for each request
  --bail                    Stop immediately on the first failure and exit 1
  --json                    Output results as JSON (suppresses normal output)
```

Accepts files, directories (recursive), or a mix:

```bash
voiden run auth.void
voiden run ./requests/
voiden run ./ --env .env.staging --bail
voiden run ./ --env .voiden/env-public.yaml --environment staging
voiden run ./ --show-req --show-res
```

Non-`--json` output is byte-for-byte the same formatting `voiden-runner run` produces — status
line, method/URL/timing, and (with `--show-req`/`--show-res`) full headers and body — both CLIs
call the exact same `printRequestResult`/`printRunSummary` functions (exported from
`@voiden/runner`'s library surface), so there's one implementation to keep correct, not two that
can quietly drift apart.

```
[1/1] firstrequest.void
  ✓  REST GET    https://echo.voiden.md  200 OK  550ms  434B
       ↳ request:
           url:    https://echo.voiden.md
           method: GET
         headers:
           key1: hello-world
         body:
           { "test": "test" }
       ↳ response:
         headers:
           content-type: application/json; charset=utf-8
         body:
           {"headers":{...},"body":{},"query":{},"method":"GET","path":"/"}

────────────────────────────────────────────────────────────────
  Summary  1 request  ·  1 passed  ·  0 failed  ·  569ms total
────────────────────────────────────────────────────────────────
```

**This is deliberately a lightweight subset**, not a full replacement for `voiden-runner run`. CSV
export, mail reports, session/runtime-variable persistence across runs, and other power-user flags
stay exclusive to the standalone `@voiden/runner` package — install that separately (`npm install
-g @voiden/runner`) for CI pipelines or heavier local use. Both share the exact same execution
engine (`runVoidFile` from `@voiden/runner`), so results never differ between the two — only the
flag surface does.

### Environment variables & multiple profiles

This section is about `voiden run`'s own `--env`/`--environment` flags specifically. An agent
connecting via `voiden agent`/`mcp-stdio` (or `voiden-runner mcp serve`/`mcp install`) has a
separate, tool-based mechanism instead — `list_environments`/`select_environment`, see above —
since there's no `--env` flag to pass in a live MCP session; nothing below applies to that path.

Nothing is auto-loaded — `voiden run` never scans `.voiden/` on its own. Pass `--env <path>`
explicitly, pointing at either format:

**Plain `.env`:**
```
test=hello-world
```

**YAML** — two shapes work:
```yaml
# flat — simplest for a standalone file
test: hello-world
```
```yaml
# nested, matching the app's own .voiden/env-public.yaml shape
dev:
  variables:
    test: hello-world
staging:
  variables:
    test: staging-value
```

For the nested shape, **`--environment <name>` matters**: without it, every top-level environment
in the file gets merged into one flat set (last one processed wins on a key collision) — with it,
only that one named environment's variables are used, the same way the Voiden app itself resolves
one active environment at a time. Point `--env` straight at your real
`.voiden/env-public.yaml`/`env-<profile>-public.yaml` and add `--environment dev` (or whichever
name) to select a specific one; a name that doesn't exist in the file fails with a clear error
listing what's actually available, instead of silently resolving to nothing (or the wrong thing).

A relative `--env` path resolves from wherever you *run the command*, not from the `.void` file's
own directory.

---

## `voiden mcp-stdio` — hidden, internal

```
voiden mcp-stdio [path]
```

Not shown in `--help` — this is what `.mcp.json`'s `command`/`args` actually invoke, not something
to run by hand. Starts a stdio MCP server exposing the same 6 fixed tools `voiden agent` describes
above (`list_void_files`/`list_requests`/`run_request`/`write_result`/`list_environments`/
`select_environment`), via `@voiden/runner`'s own `registerFixedTools()` — reused, not reimplemented.

Deliberately does **not** discover, verify, or serve `/tool` blocks — that's `@voiden/mcp`'s job
alone, a different concern (publishing a capability API) from letting an editor run requests in a
project it already has open.

---

## How it's built

`voiden agent`/`run`/`mcp-stdio` live in `apps/electron/src/voiden-cli.ts` — a normal Forge
`VitePlugin` build entry (`vite.cli.config.ts`), built alongside `main.ts`/`preload.ts`, landing at
`.vite/build/voiden-cli.js` *inside* `app.asar`, next to `main.js` — not shipped as a separate
`extraResource` outside the archive (an earlier approach that couldn't safely resolve its own
`node_modules` at runtime, and needlessly re-bundled every one of `@voiden/runner`'s own
dependencies a second time).

Real npm dependencies (`commander`, `@modelcontextprotocol/sdk`, and everything `@voiden/runner`
itself depends on — `chalk`, `nodemailer`, `yaml`, `zod`, `@grpc/proto-loader`) stay **external**,
resolved from the packaged app's own `node_modules` at runtime — the same convention `main.js`
already uses for its own dependencies. Only `@voiden/runner` and `@voiden/executors` get bundled
in directly (both are workspace-symlinked packages with `"type": "module"` and no `"require"`
export condition — external `require()` calls to either would fail in a packaged, CJS build).
Net effect: the bundle shrank from 2.5MB (everything inlined) to ~650KB.

`bin/voiden` (and `bin/voiden.cmd` on Windows) intercept `agent`/`run`/`mcp-stdio` before the normal
GUI-launch path, dispatching via:

```bash
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_BINARY" "$CLI_JS_PATH" "$@"
```

using `exec` (not a detached background launch) — load-bearing for `mcp-stdio`, which talks
JSON-RPC over its own stdin/stdout to whatever spawned it, and for `run`/`agent`'s exit codes and
printed output to actually reach the caller. This requires the `runAsNode` Electron **fuse**
enabled (`forge.config.ts`'s `FusesPlugin`) — off by default as a hardening measure (blocks
arbitrary Node execution via that env var against a signed binary) — flipped on deliberately for
this, a real, accepted trade-off.

**Local dev**: `bin/voiden` first checks for a dev build (`.vite/build/voiden-cli.js` + the raw
`node_modules/electron` binary, both one level up from the script's own real location) before
falling back to searching for a packaged install — otherwise a `/usr/local/bin/voiden` symlinked
straight at a repo checkout (a common local-dev setup) would silently run whatever's installed at
`/Applications/Voiden.app` instead of the build actually being worked on.

**CLI install self-repair**: `installCli()`'s Settings-button flow creates a *symlink*
(`/usr/local/bin/voiden -> <app>/Contents/Resources/bin/voiden`), so its content already reflects
the latest installed version automatically on every app update — no extra code needed for that. A
genuinely stale *target* (the app moved, was reinstalled elsewhere) is repaired silently on every
app startup via `reconcileCliInstall()`, but only for someone who opted in at least once — it never
installs fresh for a user who's never clicked "Install CLI," so there's no surprise sudo/password
prompt on a first launch.

---

*Last updated: 2026-08-13*
