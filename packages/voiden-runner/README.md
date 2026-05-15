# @voiden/runner

Headless CLI runner for [Voiden](https://voiden.app) — execute `.void` files
outside the app, in terminals, and CI/CD pipelines.

`.void` files are created and edited inside the **Voiden desktop app**.
This package runs them anywhere Node.js ≥ 18 is available: local terminals,
GitHub Actions, GitLab CI, Docker, and more.

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
  - [run](#run)
  - [env](#env)
  - [session](#session)
  - [report](#report)
  - [plugin](#plugin)
- [Environment variables](#environment-variables)
- [Runtime variables](#runtime-variables)
- [Sessions & Persistence](#sessions--persistence)
- [Plugins](#plugins)
  - [voiden-scripting](#voiden-scripting)
  - [simple-assertions](#simple-assertions)
  - [voiden-faker](#voiden-faker)
  - [voiden-advanced-auth](#voiden-advanced-auth)
  - [voiden-graphql](#voiden-graphql)
- [Output formats](#output-formats)
- [Reports — CSV and email](#reports--csv-and-email)
- [Exit codes](#exit-codes)
- [CI/CD](#cicd)
- [Supported protocols](#supported-protocols)

---

## Installation

```bash
npm install -g @voiden/runner
```

Requires Node.js 18 or later.

---

## Quick start

```bash
# Run a single file
voiden-runner run auth.void

# Run an entire folder recursively
voiden-runner run ./requests/

# With environment variable substitution
voiden-runner run ./requests/ --env .env.staging

# Stop on first failure (CI-friendly)
voiden-runner run ./tests/ --env .env.ci --stop-on-failure

# Export report to CSV + send by email
# SMTP settings (host, user, etc.) are read from your .env file
voiden-runner run ./tests/ \
  --env .env.staging \
  --csv ./results/report.csv \
  --mail-to team@company.com
```

---

## Commands

### `run`

```
voiden-runner run <paths...> [options]
```

`<paths...>` accepts any mix of files, directories (recursive), and glob patterns.

**Options**

| Flag | Description |
|---|---|
| `-e, --env <path>` | Standard `.env` file (`KEY=VALUE`) — merged on top of system env |
| `--env-var <k=v>` | Individual environment variable override (can be used multiple times) |
| `--bail` | Stop on first failure, exit 1 |
| `--stop-on-failure` | Alias for `--bail` (shell `set -e` friendly) |
| `--fail-on-error` | Run all files first, then exit 1 if any failed |
| `--show-req` | Print sent request headers and body for each request |
| `--show-res` | Print response headers and body for each request |
| `--verbose` | Print script logs, plugin messages, and section dividers |
| `--json` | Machine-readable JSON output (suppresses normal output) |
| `--no-session` | Completely stateless run (do not load/save results or runtime variables) |
| `--output-json <file>` | Write the full result object to a JSON file — pass the whole response data to the next CLI or script |
| `--csv <path>` | Export full report to a CSV file. Use `.` for the current directory (auto-generates filename) |
| `--mail` | Send HTML summary + attached CSV using `VOIDEN_MAIL_TO` (requires `--csv`) |
| `--mail-to <address>` | Send HTML summary + attached CSV to this address (requires `--csv`) |
| `--mail-from <address>` | Sender address (default: `VOIDEN_MAIL_FROM` env) |
| `--mail-subject <text>` | Email subject (default: `VOIDEN_MAIL_SUBJECT` env or auto-summary) |
| `--smtp-host <host>` | SMTP server host (default: `VOIDEN_SMTP_HOST` env) |
| `--smtp-port <port>` | SMTP server port (default: `VOIDEN_SMTP_PORT` env) |
| `--smtp-secure` | Use TLS for SMTP (default: `VOIDEN_SMTP_SECURE` env) |
| `--smtp-user <user>` | SMTP username (default: `VOIDEN_SMTP_USER` env) |
| `--smtp-pass <pass>` | SMTP password (default: `VOIDEN_SMTP_PASS` env) |

### Environment Variables

```
voiden-runner session status
voiden-runner session vars
voiden-runner session clear
```

`status` shows counts of stored variables and results. `vars` lists all currently
stored runtime variables and their values. `clear` wipes all session
state (results and runtime variables).

### `report`

```
voiden-runner report generate [--csv <path>] [--mail] [--mail-to <address>]
voiden-runner report clear
```

`generate` (alias `gen`) creates a combined report from all accumulated results 
in the current session. `clear` wipes the results history only (runtime 
variables are preserved).

Accepts all mail and SMTP options listed above.

### `plugin`

```
voiden-runner plugin install [names...] [--all]
voiden-runner plugin uninstall <name>
voiden-runner plugin enable  [name] [--all]
voiden-runner plugin disable [name] [--all]
voiden-runner plugin list
```

Plugin state is persisted to `~/.voiden/plugins.json` and survives across sessions.
Core plugins are **enabled by default** but can be disabled individually or all at once.
Community plugins must be installed before they can be enabled.

**`install` Options**

| Flag | Description |
|---|---|
| `--all` | Install all core plugins (makes them explicit in the store). Community plugins must be installed by name. |

**`enable` Options**

| Flag | Description |
|---|---|
| `--all` | Re-enable all disabled plugins (core and community). |

**`disable` Options**

| Flag | Description |
|---|---|
| `--all` | Disable all plugins (core and community). |

---

## Environment variables

Use `{{KEY}}` anywhere in a `.void` file — URL, headers, query params, body,
assertion expected values.

### Sources (lowest → highest priority)

1. **System environment** — `process.env`, including CI/CD platform variables
   (GitHub Actions secrets, GitLab CI variables, etc.) — always available, no
   flag needed
2. **`--env` file** — standard `.env` file, overrides system variables
3. **`--env-var` overrides** — per-run inline overrides, highest priority

### `--env` file format

Standard `KEY=VALUE` format only — one variable per line:

```env
# .env.staging
BASE_URL=https://staging.api.example.com
API_KEY=sk-staging-abc123
USER_ID=42
```

```bash
voiden-runner run ./requests/ --env .env.staging
```

### CI/CD — no `--env` file needed

CI/CD platform variables are injected into `process.env` automatically and are
available as `{{KEY}}` without any `--env` file:

```yaml
# GitHub Actions
- run: voiden-runner run tests/
  env:
    BASE_URL: ${{ vars.BASE_URL }}       # → {{BASE_URL}}
    API_KEY:  ${{ secrets.API_KEY }}     # → {{API_KEY}}

# GitLab CI — CI_* variables available automatically
api-tests:
  script: voiden-runner run tests/      # {{CI_COMMIT_SHA}}, {{API_KEY}} etc. just work
```

Available inside scripts as `voiden.env.get('KEY')`.

---

## Runtime variables

Runtime variables let requests **chain** — a value extracted from one response
becomes available in the next request as `{{process.KEY}}`.

### How it works

1. Add a **runtime-variables block** to a `.void` file (use `/runtime-variables`
   slash command in the Voiden app).
2. Each row maps a **variable name** to a **capture expression** — a
   `{{$res.xxx}}` or `{{$req.xxx}}` path into the request or response.
3. After the request completes, the runner evaluates every enabled row and
   stores the captured values **in memory** for the rest of the run.
4. In any subsequent request (same file or later files), use `{{process.KEY}}`
   to substitute the captured value.

### Capture expression syntax

| Expression | Captures |
|---|---|
| `{{$res.body.access_token}}` | JSON field from response body |
| `{{$res.body.data.items[0].id}}` | Nested path with array index |
| `{{$res.headers.X-Request-Id}}` | Response header |
| `{{$res.status}}` | HTTP status code |
| `{{$res.statusText}}` | HTTP status text |
| `{{$res.time}}` | Response time in ms |
| `{{$req.headers.Authorization}}` | Header from the sent request |
| `{{$req.url}}` | Final URL (after variable substitution) |

### Substitution syntax

Use `{{process.KEY}}` in URLs, headers, query params, body, and path params:

```
GET {{process.baseUrl}}/users/{{process.userId}}
Authorization: Bearer {{process.token}}
```

### Script access

Inside pre-request and post-response scripts:

```javascript
// Read a runtime variable
const token = voiden.variables.get('token')

// Write a runtime variable (available to all subsequent requests in this run)
voiden.variables.set('token', voiden.response.body.access_token)
```

### Persistence

By default, runtime variables are **persisted to disk** at `~/.voiden/.process.env.json`.
This allows you to share state across multiple `voiden-runner` commands.

- **To disable persistence** (keep variables in-memory only for a single run), use the `--no-session` flag.
- **To clear variables**, delete the `.process.env.json` file or use `voiden-runner session clear`.

The `.void` files themselves are never modified. This ensures that your source
files remain clean while still allowing for stateful execution chains.

### Example — auth chain

**1. `login.void`** — POST /auth/login

```
runtime-variables block:
  token  →  {{$res.body.access_token}}
  userId →  {{$res.body.user.id}}
```

**2. `get-profile.void`** — GET /users/{{process.userId}}

```
Authorization: Bearer {{process.token}}
```

Run them in order:

```bash
voiden-runner run login.void get-profile.void --env .env
```

The `token` and `userId` captured from `login.void` are automatically available
in `get-profile.void`.

---

## Sessions & Persistence

By default, `voiden-runner` operates in a **stateful session**. This means it
persists captured runtime variables and run results across multiple command 
invocations until you explicitly clear them.

### 1. Persistent State
Captured variables stay active until you clear the session. This is ideal for 
multi-step workflows:

```bash
voiden-runner run login.void        # captures token
voiden-runner run get-profile.void  # uses {{process.token}} automatically
```

### 2. Accumulated Results & Reporting

Every time you call `run`, the results are appended to a session results file.
This allows you to generate a single report for a series of separate runs.

```bash
voiden-runner run login.void
voiden-runner run users.void
voiden-runner run posts.void

# Generate a combined CSV report for all 3 runs
voiden-runner report --csv ./session-report.csv

# Email the combined report
voiden-runner report --mail-to qa@company.com
```

### Managing the Session

Use the `session` command to check status or wipe all state.

```bash
# See how many variables and results are stored
voiden-runner session status

# Wipe everything (results and runtime variables)
voiden-runner session clear
```

---

## Plugins

All core plugins are **enabled by default** — no `plugin install` step is needed.
They can be disabled individually (`plugin disable <name>`) or all at once (`plugin disable --all`).
The `plugin install` command is only required for community plugins.

### `voiden-scripting`

Executes **pre-request** (`pre_script`) and **post-response** (`post_script`)
scripts embedded in the `.void` file.

**Languages supported in the runner:**

| Language | How it runs |
|---|---|
| JavaScript | In-process `AsyncFunction` — zero overhead |
| Python | `python3` subprocess (detected at startup; clear error if missing) |
| Shell (bash) | `bash` subprocess with temp file isolation |

**voiden API inside scripts**

| Property / Method | Description |
|---|---|
| `voiden.request.url` | Request URL (read/write in pre-script) |
| `voiden.request.method` | HTTP method (read/write in pre-script) |
| `voiden.request.headers` | Headers array `[{key, value}]` (read/write) |
| `voiden.request.body` | Request body string (read/write) |
| `voiden.request.queryParams` | Query params array (read/write) |
| `voiden.request.pathParams` | Path params array (read/write) |
| `voiden.response` | Response object (post-script only) |
| `voiden.response.status` | HTTP status code |
| `voiden.response.body` | Parsed response body |
| `voiden.response.headers` | Response headers `{key: value}` |
| `voiden.env.get('KEY')` | Read from `--env` file |
| `voiden.variables.get('KEY')` | Read a runtime variable |
| `voiden.variables.set('KEY', val)` | Write a runtime variable (available to next request) |
| `voiden.assert(actual, op, expected, msg?)` | Emit a pass/fail assertion |
| `voiden.log(level?, ...args)` | Emit a log line (`--verbose` to see them) |
| `voiden.cancel()` | Cancel the request from a pre-script |

**Assertion operators:** `==` `===` `!=` `!==` `>` `>=` `<` `<=`
`contains` `includes` `matches` (regex) `truthy` `falsy`
`eq` `neq` `gte` `lte` `greater` `less`

**Example — pre-script adds a timestamp header:**

```javascript
voiden.request.headers.push({ key: 'X-Run-Ts', value: String(Date.now()), enabled: true })
voiden.log('info', 'Added X-Run-Ts')
```

**Example — post-script asserts and captures a token:**

```javascript
const body = voiden.response.body
voiden.assert(voiden.response.status, '==', 200, 'status is 200')
voiden.assert(body.access_token, 'truthy', null, 'token present')
voiden.variables.set('token', body.access_token)
```

---

### `simple-assertions`

Evaluates assertion rows from an `assertions-table` block against the response.

**Field path syntax** (the `field` column):

| Path | Resolves to |
|---|---|
| `status` | HTTP status code |
| `statusText` | HTTP status text |
| `responseTime` | Response time in ms |
| `header.<Name>` | A response header value |
| `body.data.id` | JSON path into the parsed body |
| `body.items[0].name` | Array index access |

**Operators:** `equals` `notEquals` `contains` `notContains` `startsWith`
`endsWith` `greaterThan` `lessThan` `gte` `lte` `isEmpty` `isNotEmpty`
`isNull` `isNotNull` `matches` `exists` `notExists`

Assertion results appear under the request result line and in CSV/email reports.

---

### `voiden-faker`

Replaces `{{$faker.category.method(args)}}` patterns before the request is sent.

```
{{$faker.person.firstName()}}
{{$faker.internet.email()}}
{{$faker.string.uuid()}}
{{$faker.number.int({"min":1,"max":100})}}
```

---

### `voiden-advanced-auth`

Reads the `auth` block and injects authentication into the request.

**Auth types in the runner:** `bearer` `basic` `apiKey` (header or query)

OAuth 2.0, OAuth 1.0, AWS SigV4, Digest, NTLM — require the desktop app and
emit a warning when encountered in the runner.

`{{KEY}}` patterns in token/key/value fields are resolved from system env and the `--env` file.

---

### `voiden-graphql`

Rewrites `gqlquery` + `gqlvariables` blocks as a standard GraphQL-over-HTTP
POST (`Content-Type: application/json`, body `{query, variables}`).

---

## Output formats

### Default (human-readable)

```
  voiden-runner · 3 files · 5 plugins active
────────────────────────────────────────────────────────────────

[1/3] auth.void
  ✓  REST POST  https://api.example.com/auth  200 OK  342ms  1.2KB

[2/3] users.void
  ✓  REST GET   https://api.example.com/users  200 OK  128ms
       assertions: 3 passed
       ✓  status is 200
       ✓  body has items
       ✓  items count > 0

[3/3] delete-missing.void
  ✗  REST DELETE  https://api.example.com/users/999  404 Not Found  89ms
       assertions: 1 passed · 1 failed
       ✗  status is 200  (got 404, expected == 200)

────────────────────────────────────────────────────────────────
  Summary  3 requests  ·  2 passed  ·  1 failed  ·  559ms total
────────────────────────────────────────────────────────────────
```

### `--json`

```json
{
  "summary": { "total": 3, "passed": 2, "failed": 1, "totalDurationMs": 559, "activePlugins": ["..."] },
  "requests": [
    {
      "file": "/path/to/auth.void",
      "protocol": "rest", "method": "POST", "url": "...",
      "success": true, "status": 200, "durationMs": 342,
      "requestHeaders": { "Content-Type": "application/json" },
      "requestBody": "{\"email\":\"...\"}",
      "responseHeaders": { "content-type": "application/json" },
      "body": "{\"access_token\":\"...\"}",
      "reportEntries": []
    }
  ]
}
```

---

## Reports — CSV and email

### CSV

```bash
# Write to a specific file
voiden-runner run ./tests/ --csv ./results/report.csv

# Write to the current directory (auto-generates filename: voiden-report-<timestamp>.csv)
voiden-runner run ./tests/ --csv .
```

CSV columns: `File`, `Protocol`, `Method`, `URL`, `Success`, `Status`,
`StatusText`, `DurationMs`, `SizeBytes`, `Error`, `RequestHeaders`,
`RequestBody`, `ResponseHeaders`, `ResponseBody`, `AssertionsPassed`,
`AssertionsFailed`, `AssertionDetail`

### Email

```bash
voiden-runner run ./tests/ \
  --env .env.ci \
  --mail-to qa@company.com
```

Sends a dark-themed HTML report with per-request cards showing request/response
headers, bodies, and assertion results. Subject line is auto-generated from the
pass/fail summary unless `--mail-subject` is provided.

**SMTP Configuration**

The runner reads SMTP settings from your `.env` file (passed via `--env`) or
the system environment.

| Variable | Description |
|---|---|
| `VOIDEN_SMTP_HOST` | **Required** for email. SMTP server hostname (e.g., `smtp.gmail.com`). |
| `VOIDEN_SMTP_PORT` | SMTP port. Defaults to `587` (or `465` if secure). |
| `VOIDEN_SMTP_SECURE` | Set to `true` to use TLS/SSL (port 465). |
| `VOIDEN_SMTP_USER` | SMTP login username. |
| `VOIDEN_SMTP_PASS` | SMTP login password. |

---

## Exit codes

| Code | Condition |
|---|---|
| `0` | Run completed — unless `--fail-on-error` or `--bail`/`--stop-on-failure` is set |
| `1` | Any request failed and `--fail-on-error`, `--bail`, or `--stop-on-failure` is set |
| `1` | Usage error (bad flag, no files found, missing SMTP config, etc.) |

When exiting with code `1` due to failures, a final message is printed:

```
  ✗  Run failed — 3 requests failed. Exiting with code 1.
     (use this exit code in your shell script to abort on failure)
```

This exit code works universally — bash (`$?`), PowerShell (`$LASTEXITCODE`),
`set -e`, `&&`/`||` chains, GitHub Actions, GitLab CI, Jenkins, CircleCI, and
any other CI/CD system.

## Passing results to other CLI commands

### `--output-json <file>`

Writes the full result — the whole response object and array — to a JSON file.
Normal terminal output still shows. The next CLI, script, or tool reads the file
and gets everything: status, headers, body, assertions, duration.

```bash
# Write results to a file, then pass the whole object to the next tool
voiden-runner run auth.void --output-json result.json
my-deploy-cli --data result.json

# Chain multiple runs — each appends its own file
voiden-runner run login.void  --output-json login.json
voiden-runner run users.void  --output-json users.json
my-report-tool login.json users.json
```

The JSON structure written to the file is the same as `--json` stdout output:

```json
{
  "summary": { "total": 1, "passed": 1, "failed": 0, "totalDurationMs": 342 },
  "requests": [
    {
      "file": "/path/to/auth.void",
      "protocol": "rest",
      "method": "POST",
      "url": "https://api.example.com/auth",
      "success": true,
      "status": 200,
      "durationMs": 342,
      "body": "{\"access_token\":\"sk-abc\",\"user\":{\"id\":42}}",
      "requestHeaders": { "Content-Type": "application/json" },
      "responseHeaders": { "content-type": "application/json" }
    }
  ]
}
```

### `--json` stdout pipe

Use `--json` to pipe the same structure directly to another command:

```bash
voiden-runner run auth.void --json | jq .
voiden-runner run tests/ --json | my-cli --stdin
voiden-runner run tests/ --json > results.json && python3 analyse.py results.json
```

### Runtime variable chaining

Variables captured via `{{$res.body.xxx}}` blocks persist to
`~/.voiden/.process.env.json` between separate `voiden-runner run` calls —
no piping or files needed:

```bash
voiden-runner run login.void      # captures token via runtime-variables block
voiden-runner run users.void      # uses {{process.token}} automatically
```

---

## CI/CD

Works on every CI/CD platform that supports Node.js — GitHub Actions, GitLab CI,
CircleCI, Jenkins, Azure Pipelines, Bitbucket Pipelines, and more. Install once,
run anywhere:

```bash
npm install -g @voiden/runner   # bash / macOS / Linux
npm install -g @voiden/runner   # PowerShell / Windows cmd — identical
```

**Windows (cmd.exe / PowerShell)**

```batch
:: cmd.exe
voiden-runner run tests\ --env .env.ci --stop-on-failure
if %ERRORLEVEL% neq 0 exit /b 1
```

```powershell
# PowerShell
voiden-runner run tests/ --env .env.ci --stop-on-failure
if ($LASTEXITCODE -ne 0) { exit 1 }
```

### GitHub Actions

```yaml
jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - run: npm install -g @voiden/runner

      - name: Write env
        run: |
          echo "BASE_URL=${{ secrets.BASE_URL }}" >> .env.ci
          echo "API_KEY=${{ secrets.API_KEY }}"   >> .env.ci

      - name: Run tests
        run: |
          voiden-runner run ./tests/ \
            --env .env.ci \
            --stop-on-failure \
            --json | tee results.json

      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: api-test-results, path: results.json }
```

### GitLab CI

```yaml
api-tests:
  image: node:20
  script:
    - npm install -g @voiden/runner
    - echo "BASE_URL=$BASE_URL" >> .env.ci
    - echo "API_KEY=$API_KEY"   >> .env.ci
    - voiden-runner run ./tests/ --env .env.ci --stop-on-failure
```

### With scripting enabled

If your `.void` files use `voiden-scripting` blocks and you trust the content:

```bash
# JavaScript only (no Python/Shell risk)
voiden-runner run ./tests/ --env .env.ci --stop-on-failure

# With Python — ensure python3 is available in the runner image
# python3 --version   →  Python 3.x.x
voiden-runner run ./tests/ --env .env.ci --stop-on-failure
```

### Request chaining in CI

Variables captured via runtime-variable blocks are shared across all files in a
single `voiden-runner run` invocation:

```bash
# login.void captures {{token}}, get-users.void uses {{process.token}}
voiden-runner run login.void get-users.void create-post.void \
  --env .env.ci \
  --stop-on-failure
```

---

## Supported protocols

| Protocol | Block types |
|---|---|
| REST (HTTP/HTTPS) | `method`, `url`, `headers-table`, `query-table`, `json_body`, … |
| WebSocket (`ws://` / `wss://`) | `socket-request`, `surl`, `smethod` |
| gRPC (`grpc://` / `grpcs://`) | `socket-request`, `proto`, `grpc-messages-node` |
| GraphQL | `gqlquery`, `gqlvariables` |
