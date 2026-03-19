## Extension: Voiden Advanced Auth

Provides the `auth` block for all authentication types. Place it inside or alongside a `request` block.

### auth — Authentication Block

```yaml
---
type: auth
attrs:
  uid: "uid"
  authType: bearer      # see types below
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [token, "{{API_TOKEN}}"]
---
```

### Auth Types

#### inherit / none

```yaml
attrs:
  authType: inherit   # use parent/collection auth
# or
  authType: none      # no authentication
content: []
```

#### bearer — Bearer Token

```yaml
attrs:
  authType: bearer
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [token, "{{API_TOKEN}}"]
```
Sends: `Authorization: Bearer <token>`

#### basic — Username + Password

```yaml
attrs:
  authType: basic
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [username, "{{API_USERNAME}}"]
      - attrs: { disabled: false }
        row: [password, "{{API_PASSWORD}}"]
```
Sends: `Authorization: Basic <base64(user:pass)>`

#### apiKey — API Key

```yaml
attrs:
  authType: apiKey
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [key, X-API-Key]
      - attrs: { disabled: false }
        row: [value, "{{API_KEY}}"]
      - attrs: { disabled: false }
        row: [add_to, header]   # header or query
```

#### oauth2 — OAuth 2.0

```yaml
attrs:
  authType: oauth2
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [access_token, "{{OAUTH_TOKEN}}"]
      - attrs: { disabled: false }
        row: [token_type, Bearer]
      - attrs: { disabled: false }
        row: [header_prefix, Bearer]
```

#### oauth1 — OAuth 1.0a

```yaml
attrs:
  authType: oauth1
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [consumer_key, "{{CONSUMER_KEY}}"]
      - attrs: { disabled: false }
        row: [consumer_secret, "{{CONSUMER_SECRET}}"]
      - attrs: { disabled: false }
        row: [access_token, "{{ACCESS_TOKEN}}"]
      - attrs: { disabled: false }
        row: [token_secret, "{{TOKEN_SECRET}}"]
      - attrs: { disabled: false }
        row: [signature_method, HMAC-SHA1]   # HMAC-SHA1, HMAC-SHA256, PLAINTEXT
```

#### digest — HTTP Digest

```yaml
attrs:
  authType: digest
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [username, "{{USERNAME}}"]
      - attrs: { disabled: false }
        row: [password, "{{PASSWORD}}"]
```

#### awsSignature — AWS Signature v4

```yaml
attrs:
  authType: awsSignature
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [access_key, "{{AWS_ACCESS_KEY}}"]
      - attrs: { disabled: false }
        row: [secret_key, "{{AWS_SECRET_KEY}}"]
      - attrs: { disabled: false }
        row: [region, us-east-1]
      - attrs: { disabled: false }
        row: [service, execute-api]
      - attrs: { disabled: false }
        row: [session_token, "{{AWS_SESSION_TOKEN}}"]   # optional
```

#### ntlm — NTLM

```yaml
attrs:
  authType: ntlm
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [username, "DOMAIN\\user"]
      - attrs: { disabled: false }
        row: [password, "{{PASSWORD}}"]
      - attrs: { disabled: false }
        row: [domain, MYDOMAIN]
      - attrs: { disabled: false }
        row: [workstation, my-pc]
```

#### hawk — Hawk

```yaml
attrs:
  authType: hawk
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [id, "{{HAWK_ID}}"]
      - attrs: { disabled: false }
        row: [key, "{{HAWK_KEY}}"]
      - attrs: { disabled: false }
        row: [algorithm, sha256]
```

#### netrc

```yaml
attrs:
  authType: netrc
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [machine, api.example.com]
      - attrs: { disabled: false }
        row: [login, "{{USERNAME}}"]
      - attrs: { disabled: false }
        row: [password, "{{PASSWORD}}"]
```

### Auth Field Reference

| `authType` | Required rows | Optional rows |
|------------|--------------|---------------|
| `inherit` / `none` | — | — |
| `bearer` | `token` | — |
| `basic` | `username`, `password` | — |
| `apiKey` | `key`, `value`, `add_to` | — |
| `oauth2` | `access_token` | `token_type`, `header_prefix` |
| `oauth1` | `consumer_key`, `consumer_secret`, `access_token`, `token_secret` | `signature_method` |
| `digest` | `username`, `password` | — |
| `awsSignature` | `access_key`, `secret_key`, `region`, `service` | `session_token` |
| `ntlm` | `username`, `password` | `domain`, `workstation` |
| `hawk` | `id`, `key` | `algorithm` |
| `netrc` | `machine`, `login`, `password` | — |

**Always use `{{VARIABLE_NAME}}` for credentials — never hardcode secrets in `.void` files.**
