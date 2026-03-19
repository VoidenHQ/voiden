## Extension: Voiden Scripting

Provides `pre_script` and `post_script` blocks for JavaScript execution before/after requests. Insert with `/pre-script` and `/post-script` slash commands.

### pre_script — Pre-Request Script

Runs before the request is sent. Use to modify request data or set variables.

```yaml
---
type: pre_script
attrs:
  uid: "uid"
  body: |
    // Set a timestamp header
    vd.request.setHeader("X-Timestamp", new Date().toISOString());

    // Read and modify a variable
    const userId = vd.variables.get("USER_ID");
    vd.request.setHeader("X-User", userId);

    // Cancel the request conditionally
    // vd.cancel();
---
```

### post_script — Post-Response Script

Runs after the response is received. Use to extract values, run assertions, or log data.

```yaml
---
type: post_script
attrs:
  uid: "uid"
  body: |
    // Extract a token from the response and save it
    const token = vd.response.json().access_token;
    vd.variables.set("ACCESS_TOKEN", token);

    // Log response info
    vd.log("Status:", vd.response.status());

    // Assert a condition
    vd.assert(vd.response.status() === 200, "Expected 200 OK");
---
```

### vd API Reference

#### Request (pre_script only)

| Method | Description |
|--------|-------------|
| `vd.request.getUrl()` | Get the request URL |
| `vd.request.setUrl(url)` | Set/override the URL |
| `vd.request.getMethod()` | Get HTTP method |
| `vd.request.setMethod(method)` | Set HTTP method |
| `vd.request.getHeader(name)` | Get a request header |
| `vd.request.setHeader(name, value)` | Set a request header |
| `vd.request.getBody()` | Get request body (string) |
| `vd.request.setBody(body)` | Set request body — **must be a string** (stringify JSON first) |

#### Response (post_script only)

| Method | Description |
|--------|-------------|
| `vd.response.status()` | HTTP status code (number) |
| `vd.response.body()` | Response body as string |
| `vd.response.json()` | Parse response body as JSON |
| `vd.response.getHeader(name)` | Get a response header |

#### Environment & Variables

| Method | Description |
|--------|-------------|
| `vd.env.get(name)` | Get active environment variable value |
| `vd.variables.get(name)` | Get a Voiden runtime variable |
| `vd.variables.set(name, value)` | Set a Voiden runtime variable (persists across requests) |

#### Utilities

| Method | Description |
|--------|-------------|
| `vd.log(...args)` | Log output to Script Logs panel |
| `vd.assert(condition, message)` | Throw if condition is false |
| `vd.cancel()` | Cancel the request (pre_script only) |

### Common Patterns

```javascript
// pre_script: Set JSON body (must stringify)
const payload = { name: "John", timestamp: Date.now() };
vd.request.setBody(JSON.stringify(payload));

// pre_script: Add auth from variable
vd.request.setHeader("Authorization", "Bearer " + vd.variables.get("TOKEN"));

// post_script: Save token from login response
const { access_token, refresh_token } = vd.response.json();
vd.variables.set("ACCESS_TOKEN", access_token);
vd.variables.set("REFRESH_TOKEN", refresh_token);

// post_script: Chain requests by saving an ID
const user = vd.response.json();
vd.variables.set("CREATED_USER_ID", user.id);
```
