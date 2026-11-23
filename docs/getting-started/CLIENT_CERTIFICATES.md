# Client certificates (mTLS)

Some APIs require the client to present its own certificate during the TLS handshake. Voiden reads certificate profiles from `.voiden/certificates.yaml` in the project and attaches the matching certificate to HTTP, WebSocket and gRPC requests sent from the app. You can edit the profiles in **Settings → Network → Client certificates** or in the file directly. The private key is read and used in the main process only; it never reaches the renderer or plugins.

## Profiles

```yaml
# .voiden/certificates.yaml
profiles:
  payments-mtls:
    hosts: ["*.payments.internal", "api.bank.com:8443"]
    cert: ./certs/{{ENV}}/client.pem     # relative to the project root
    key: ./certs/{{ENV}}/client.key
    ca: ./certs/ca.pem                   # optional
    passphrase: "{{CLIENT_CERT_PASS}}"   # optional, for an encrypted key
  partner-pfx:
    hosts: ["partner.example.com"]
    pfx: ./certs/partner.p12
    passphrase: "{{PARTNER_PFX_PASS}}"
```

- A profile uses either `cert` + `key` (PEM) or `pfx` (PKCS#12). `ca` is optional.
- `cert`, `key`, `pfx`, `ca` and `passphrase` may contain `{{variables}}`, so a profile can switch certificates with the selected environment. The passphrase can also be written directly.
- Relative paths are resolved against the project root.
- The file is local to you: Voiden's `.voiden/` ignore rules keep it out of Git, like private environments. Client certificates usually belong to one person, and the file may hold a passphrase.

## Host matching

`hosts` is a list of patterns, matched case-insensitively:

| Pattern | Matches |
| --- | --- |
| `api.bank.com` | `api.bank.com` on any port |
| `api.bank.com:8443` | `api.bank.com` on port 8443 only (the scheme's default port is used when the URL has none) |
| `*.payments.internal` | any subdomain, such as `a.payments.internal`; not `payments.internal` itself, so list it too if needed |

The first profile with a matching pattern wins. If none matches, the request is sent without a certificate.

## Choosing a certificate per request

Add a `client_certificate` row to a request's Options block:

| Value | Behavior |
| --- | --- |
| `auto` (default) | first profile whose `hosts` match the URL |
| a profile name | always use that profile, regardless of host |
| `none` | never send a certificate, for example to check that the server rejects you |

## Errors

The request fails before it is sent, with a message naming the profile, when `certificates.yaml` is invalid, a referenced file is missing, or the key cannot be loaded (for example a wrong passphrase). A successful response reports the profile used in its request metadata as `clientCertificate`.

## Current limitations

- The `voiden run` CLI does not apply client certificates yet.
- gRPC requests have no Options block, so they always use host matching (`auto`).
- `client_certificate` is read from the request's own Options block; it is not inherited from `.voiden-inherited.void`.
