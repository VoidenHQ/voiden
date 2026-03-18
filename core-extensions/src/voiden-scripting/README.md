# Voiden Scripting

Add pre-request and post-response scripts to your API requests in **JavaScript**, **Python**, or **Shell (bash)**. All three languages share the same `voiden.*` API.

Insert scripts with the `/pre-script` and `/post-script` slash commands.

---

## Table of Contents

- [JavaScript](#javascript)
- [Python](#python)
- [Shell (bash)](#shell-bash)
- [API Reference](#api-reference)
- [Notes](#notes)

---

## JavaScript

No `await` needed — env vars and variables are pre-loaded synchronously.

```js
// ── Request (pre-script only) ──────────────────────────────────────────
voiden.request.url    = "https://api.example.com/v2/users";
voiden.request.method = "POST";
voiden.request.body   = JSON.stringify({ name: "Alice" });
voiden.request.headers.push("Authorization", "Bearer " + voiden.env.get("TOKEN"));
voiden.request.queryParams.push({ key: "page", value: "1" });

// Read request fields
const currentUrl = voiden.request.url;
const method     = voiden.request.method;

// ── Response (post-script only) ────────────────────────────────────────
const status     = voiden.response.status;       // e.g. 200
const statusText = voiden.response.statusText;   // e.g. "OK"
const body       = voiden.response.body;         // string
const headers    = voiden.response.headers;      // { "content-type": "..." }
const ms         = voiden.response.time;         // duration in ms
const bytes      = voiden.response.size;         // bytes

// ── Environment ────────────────────────────────────────────────────────
const baseUrl = voiden.env.get("BASE_URL");

// ── Variables (persisted to .voiden/.process.env.json) ────────────────
const token = voiden.variables.get("access_token");
voiden.variables.set("access_token", "new-token-value");

// ── Logging ───────────────────────────────────────────────────────────
voiden.log("Request to: " + voiden.request.url);
voiden.log("info",  "Sending request");
voiden.log("warn",  "Token is expiring soon");
voiden.log("error", "Unexpected status: " + voiden.response.status);

// ── Assertions ────────────────────────────────────────────────────────
voiden.assert(voiden.response.status, "==",       200,    "Status should be 200");
voiden.assert(voiden.response.body,   "contains", "Alice","Body should contain name");
voiden.assert(voiden.response.time,   "<=",       1000,   "Should respond in 1s");

// ── Cancel request (pre-script only) ──────────────────────────────────
if (!voiden.env.get("TOKEN")) {
  voiden.cancel();
}
```

---

## Python

```python
# ── Request (pre-script only) ──────────────────────────────────────────
voiden.request.url    = "https://api.example.com/v2/users"
voiden.request.method = "POST"
voiden.request.body   = '{"name": "Alice"}'
voiden.request.headers.push("Authorization", "Bearer " + voiden.env.get("TOKEN"))
voiden.request.queryParams.push({"key": "page", "value": "1"})

# Read request fields
current_url = voiden.request.url
method      = voiden.request.method

# ── Response (post-script only) ────────────────────────────────────────
status      = voiden.response.status
status_text = voiden.response.statusText
body        = voiden.response.body
headers     = voiden.response.headers   # dict
ms          = voiden.response.time
bytes_size  = voiden.response.size

# ── Environment ────────────────────────────────────────────────────────
base_url = voiden.env.get("BASE_URL")

# ── Variables ─────────────────────────────────────────────────────────
token = voiden.variables.get("access_token")
voiden.variables.set("access_token", "new-token-value")

# ── Logging ───────────────────────────────────────────────────────────
voiden.log("Request to: " + voiden.request.url)
voiden.log("info",  "Sending request")
voiden.log("warn",  "Token expiring")
voiden.log("error", "Unexpected status")

# ── Assertions ────────────────────────────────────────────────────────
# Note: use assert_() in Python to avoid conflict with the built-in assert keyword
voiden.assert_(voiden.response.status, "==",       200,    "Status should be 200")
voiden.assert_(voiden.response.body,   "contains", "Alice","Body should contain name")
voiden.assert_(voiden.response.time,   "<=",       1000,   "Should respond in 1s")

# ── Cancel (pre-script only) ───────────────────────────────────────────
if not voiden.env.get("TOKEN"):
    voiden.cancel()
```

---

## Shell (bash)

> **Important:** bash does not use parentheses for function calls.
> Use `voiden.log "msg"` — **not** `voiden.log("msg")`.

```bash
# ── Request (pre-script only) ──────────────────────────────────────────

# Setter — bash style (recommended)
voiden.request.url    "https://api.example.com/v2/users"
voiden.request.method "POST"
voiden.request.body   '{"name":"Alice"}'

# Setter — JS-like style (also supported)
voiden.request.url    = "https://api.example.com/v2/users"
voiden.request.method = "POST"

# Getter — call with no arguments, capture with $()
current_url=$(voiden.request.url)
method=$(voiden.request.method)

# ── Response (post-script only) ────────────────────────────────────────
status=$(voiden.response.status)
body=$(voiden.response.body)
ms=$(voiden.response.time)

# ── Environment ────────────────────────────────────────────────────────
base_url=$(voiden.env.get "BASE_URL")
token=$(voiden.env.get "TOKEN")

# ── Variables ─────────────────────────────────────────────────────────
saved_token=$(voiden.variables.get "access_token")
voiden.variables.set "access_token" "new-token-value"

# ── Logging ───────────────────────────────────────────────────────────
voiden.log "Request to: $(voiden.request.url)"
voiden.log info  "Sending request"
voiden.log warn  "Token is expiring"
voiden.log error "Unexpected status: $(voiden.response.status)"

# ── Assertions ────────────────────────────────────────────────────────
voiden.assert "$(voiden.response.status)"  "=="       "200"   "Status should be 200"
voiden.assert "$(voiden.response.body)"    "contains" "Alice" "Body should contain name"
voiden.assert "$(voiden.response.time)"    "<="       "1000"  "Should respond in 1s"

# ── Cancel (pre-script only) ───────────────────────────────────────────
if [ -z "$(voiden.env.get "TOKEN")" ]; then
  voiden.cancel
fi
```

---

## API Reference

### `voiden.request` — read/write (pre-script only)

| Property | Type | Description |
|---|---|---|
| `url` | string | Full request URL |
| `method` | string | HTTP method (`GET`, `POST`, etc.) |
| `body` | string | Request body |
| `headers` | array | `[{ key, value, enabled }]` |
| `queryParams` | array | `[{ key, value, enabled }]` |
| `pathParams` | array | `[{ key, value, enabled }]` |

### `voiden.response` — read-only (post-script only)

| Property | Type | Description |
|---|---|---|
| `status` | number | HTTP status code |
| `statusText` | string | Status message (e.g. `"OK"`) |
| `body` | string | Response body |
| `headers` | object | Response headers as `{ key: value }` |
| `time` | number | Response duration in milliseconds |
| `size` | number | Response size in bytes |

### `voiden.env`

| Method | Description |
|---|---|
| `voiden.env.get(key)` | Read a value from the active environment file |

### `voiden.variables`

| Method | Description |
|---|---|
| `voiden.variables.get(key)` | Read a runtime variable |
| `voiden.variables.set(key, value)` | Write a runtime variable (persisted to `.voiden/.process.env.json`) |

### `voiden.log`

```
voiden.log(message)
voiden.log(level, message)
```

Levels: `log` · `info` · `debug` · `warn` · `error`

### `voiden.assert`

```
voiden.assert(actual, operator, expected, message?)
```

| Operator | Description |
|---|---|
| `==` | Loose equality |
| `===` | Strict equality |
| `!=` / `!==` | Not equal |
| `>` `>=` `<` `<=` | Numeric comparison |
| `contains` / `includes` | String or array contains |
| `matches` | Regex match |
| `truthy` / `falsy` | Boolean check |

> In Python, use `voiden.assert_()` to avoid shadowing the built-in `assert` keyword.

### `voiden.cancel`

Cancels the outgoing request. Only meaningful in a pre-script.

```js
voiden.cancel()   // JS / Python
voiden.cancel     // Shell
```

---

## Quick Comparison

| | JavaScript | Python | Shell |
|---|---|---|---|
| Set URL | `voiden.request.url = "..."` | `voiden.request.url = "..."` | `voiden.request.url "..."` |
| Get URL | `voiden.request.url` | `voiden.request.url` | `$(voiden.request.url)` |
| Get env | `voiden.env.get("KEY")` | `voiden.env.get("KEY")` | `$(voiden.env.get "KEY")` |
| Get variable | `voiden.variables.get("k")` | `voiden.variables.get("k")` | `$(voiden.variables.get "k")` |
| Set variable | `voiden.variables.set("k", v)` | `voiden.variables.set("k", v)` | `voiden.variables.set "k" "v"` |
| Log | `voiden.log("msg")` | `voiden.log("msg")` | `voiden.log "msg"` |
| Assert | `voiden.assert(a, op, b)` | `voiden.assert_(a, op, b)` | `voiden.assert "$a" "op" "$b"` |
| Cancel | `voiden.cancel()` | `voiden.cancel()` | `voiden.cancel` |

---

## Notes

- **Variables** persist between requests. Use them to pass data across scripts (e.g. save an auth token in a login script, read it in subsequent requests).
- **Environment** values come from the active environment selected in the sidebar. They are read-only from scripts.
- **Pre-scripts** run before the HTTP request is sent. Modifications to `voiden.request.*` affect the outgoing request.
- **Post-scripts** run after the response is received. `voiden.response.*` is available; `voiden.request.*` is read-only.
- **Shell scripts** require bash. Avoid JS-style function call syntax with parentheses — bash will treat it as a syntax error.
