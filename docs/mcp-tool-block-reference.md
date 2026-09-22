---
  id: mcp-tool-block-reference
  title: /tool Block Field Reference
  sidebar_label: /tool Block Reference
---

# `/tool` Block Field Reference <span className="doc-beta-badge">Beta</span>

Every field on a [`/tool` block](./core-features-section/voiden-blocks/tool.md), its **Parameters**
table, and its **Verification** table — what each one does, what values it accepts, and what
happens if you leave it out. For the concepts behind `source`/`binds` and how to actually publish
what you build here, see [Publishing Tools as an MCP Server](./mcp-tool-publish-guide.md).

A `/tool` block never generates or replaces a request — it decorates one that already exists and
already runs on its own. Everything below configures *how that decoration works*, not the request
itself.

---

## The tool block itself

| Field | Type | Required | Default | What it does |
|---|---|---|---|---|
| `name` | string | ✅ | — | The MCP tool name an agent actually calls. Must be unique across every tool served by the same `@voiden/mcp` instance — a duplicate anywhere in the project excludes **every** tool sharing that name (`duplicate-name` check, below). |
| `title` | string | — | empty | Human-readable display title, shown in UIs that render one; has no effect on the MCP protocol name. |
| `description` | string | recommended | empty | What the agent sees as the tool's description — this is what an agent actually reads to decide whether/how to call it, so treat it like a docstring, not a label. |
| `annotations` | object | — | `{}` | Standard MCP [tool annotations](https://modelcontextprotocol.io/), advisory only — Voiden doesn't enforce them, they're metadata the calling agent can use to decide how cautiously to call the tool. Four booleans, all optional: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Setting `readOnlyHint: true` on a request that actually mutates (`POST`/`PUT`/`PATCH`/`DELETE`) is flagged by the `readonly-mutating` validation check. |
| `enabled` | boolean | — | `true` | Manual on/off switch, independent of verification. `false` withdraws the tool regardless of how it verifies — the one override that isn't a verification outcome. |
| `requestFilePath` | string | — | this tool's own file | Cross-file binding: which `.void` file the request this tool wraps actually lives in. Empty/absent means "the request in this tool's own file." **Store this relative to the project root**, e.g. `api/users.void`, not an absolute OS path — an absolute path only works on the exact machine it was saved on (see [path portability](#a-note-on-path-portability) below). |
| `requestSectionLabel` | string \| `null` | — | not bound | Cross-section binding, paired with `requestFilePath`. **Absent** (not even `""`) means "not bound — use the sibling request in this tool's own section," the original default behavior. Once set to any value (including `""`, meaning "the file's first/unlabeled section"), the tool is considered *bound*, and a target that doesn't resolve is a `dangling-request-reference` validation failure, not a silent fallback. |
| `requestUid` | string | internal | — | Links the tool block to the sibling request in its own section when not cross-file-bound. Managed automatically by the editor — not meant to be hand-typed. |
| `uid`, `pluginId`, `pluginVersion` | string | internal | — | Bookkeeping the editor manages itself. `uid` is what verify-entry caching keys off internally; the other two identify which plugin/version wrote the block. Leave these alone. |

### A note on path portability

`requestFilePath` (and `toolverifies`' own `filePath`, below) used to be saved as whatever
absolute path the OS file picker returned — which only worked on the machine that picked it.
Both are now saved **relative to the project root** by the file picker, and resolved back to
absolute wherever they're actually read — in the app, or by `@voiden/mcp`/`@voiden/runner` on a
different machine entirely (a cloud VM, a teammate's laptop). Absolute paths saved before this
fix still work unchanged (resolution is a no-op on an already-absolute path) — nothing needs
migrating, but a **relative path must have no leading slash**: `firstrequest.void`, not
`/firstrequest.void` — a leading slash means "filesystem root," which is absolute, not relative
to the project.

---

## Parameters table (`toolparams` rows)

Every row is agent-facing — part of the tool's callable schema, supplied fresh on every call. A
row does nothing unless the request actually contains the `{{token}}` it names in `binds` — see
["How a param actually resolves"](./mcp-tool-publish-guide.md#how-a-param-actually-resolves) for
the full explanation, including how a value meant to stay hidden from the agent (an API key, say)
doesn't get a param row at all — it's left as a plain `{{ENV_VAR}}` in the request instead,
resolved completely independently of this table.

| Field | Type | Required | Default | What it does |
|---|---|---|---|---|
| `name` | string | ✅ | — | The argument name the agent sees in the tool's schema. Doesn't have to match `binds`. |
| `binds` | string | ✅ | — | The exact `{{token}}` name in the request this param controls — the only thing that tells Voiden *where* the value goes. A `binds` value with no matching `{{token}}` anywhere in the bound request is an `unbound-param` validation failure. |
| `type` | enum | — | `string` | `string \| number \| integer \| boolean \| object \| array` — the JSON-Schema type advertised to the agent for this argument. Still `string` even for a file/binary token (an agent can only ever pass a string — a path, URL, or base64 blob — never raw binary). |
| *(Mand.)* → `required` | boolean | — | `false` | Whether the agent must supply this argument on every call. |
| `description` | string | — | empty | Shown to the agent as this argument's description — what it should pass here, and why. |
| `testValue` (Test value) | string | — | empty | What **verification** substitutes for this param, since there's no live agent call happening then — never shown to or sent by the agent itself, purely a stand-in for proving the request works. A required param with no `testValue` can't be exercised by live verification: the request fails on the unresolved `{{token}}`, correctly, rather than silently skipping the check. |

A `{{token}}` that appears in the bound request but has **no** param row declaring it as its
`binds` is the reverse problem — `unresolved-placeholder` — it can only ever resolve if it
happens to be a real environment variable outside Voiden's knowledge, which is almost never
intended.

---

## Verification table (`toolverifies` rows)

A tool is only *served* if it passes verification — each row is one real request run as proof the
tool still works, not just a static description trusted at face value.

| Field | Type | Required | Default | What it does |
|---|---|---|---|---|
| `filePath` | string | — | this tool's own file | Which `.void` file the verification request lives in. Empty/absent means "this tool's own file." Same project-root-relative convention as `requestFilePath` above — **a separate field from it**, easy to miss when hand-editing (fixing the tool's own `requestFilePath` doesn't also fix a verify row's `filePath`). |
| `sectionLabel` | string | — | — | Which section within that file to run. A file with no request-separators has only one section — any label (or none) targets it; that leniency doesn't apply once a file has more than one, where the label must match exactly. A non-matching label is a `missing-section` validation failure. |
| `role` | enum | ✅ | `happy-path` | `happy-path` — a normal successful call. `error-contract` — proves the API's *documented* failure mode still behaves as expected (e.g. a 404 for a bad id), not itself a sign anything is broken. `auth-check` — runs before every other role's entries; if it fails, every dependent entry is skipped and reported as an auth failure rather than run and misreported as broken. |
| `cadence` | enum | — | `hourly` | `hourly \| daily \| weekly \| monthly` — how often this specific entry actually re-runs once the server's `--scheduler` is live, independent of every other entry's cadence. **Only these four exact values are recognized** (case-insensitive) — the field used to be free text and any other value (a typo, or a plausible-looking one like `nightly`) silently fell back to hourly with no warning; the editor now locks this to a dropdown so that can't happen for anything saved going forward. |
| `mode` | enum | — | `live` | `live` — actually runs the request. `sandbox` — a declarative label only; Voiden runs it exactly like `live`, no redirection to a sandbox environment happens automatically. `none` — never automatically run (e.g. a destructive request you verify manually) — a tool with only `mode: none` entries reports as `unverified`, not failing. |
| `onFailure` | enum | — | `withdraw` | Per-entry, not tool-wide. `withdraw` — a failing entry pulls the whole tool from what's served. `advertise-degraded` — the tool stays served but its description notes it's degraded. When entries disagree, the most conservative wins: any failed `withdraw` entry withdraws the tool even if every other entry says `advertise-degraded`. |

Verification reads real signal from the request it runs: any [assertions](./core-features-section/voiden-blocks/simple-assertions.md)
already on that request are checked (`metadata.assertionResults`), falling back to plain
transport-level success (no error, no 4xx/5xx) only when the request has no assertions attached.

With `--scheduler` on (the default), each entry keeps re-running on its own declared cadence for
the life of the published server — you'll see one log line per actual re-run: `✓ verify "tool_name"
[role, cadence: daily] — passed`. A cached, not-yet-due entry doesn't re-run or log anything on a
given scheduler tick — only entries whose cadence window has actually elapsed do.

---

## Validation checks that can exclude a tool

Run once at discovery (and again on every scheduled re-check). Any of these excludes the tool from
what's served, with the reason printed — nothing fails silently:

| Check | Fires when |
|---|---|
| `unbound-param` | A param's `binds` names a `{{token}}` that doesn't appear anywhere in the request it decorates. |
| `unresolved-placeholder` | The request contains a `{{token}}` with no param row declaring it via `binds`. |
| `missing-section` | A `toolverifies` row's `sectionLabel` doesn't match any real section in its target file. |
| `dangling-request-reference` | The tool is bound (`requestSectionLabel` set) to a file/section that doesn't actually exist — including a `requestFilePath` that can't be read at all (missing file, or an absolute path from a different machine). |
| `duplicate-name` | Two or more tools anywhere in the project share the same `name` — every one of them is excluded, not just the second. |
| `readonly-mutating` | The tool's `annotations.readOnlyHint` is `true` but its request actually uses `POST`/`PUT`/`PATCH`/`DELETE`. |

A tool that passes all of the above but fails **live verification** is withdrawn or degraded per
its `toolverifies` rows' `onFailure`, not excluded outright the way a structural failure is — the
distinction matters: structural issues mean the block is misconfigured, verification failures mean
the API itself isn't currently healthy.

---

*Last updated: 2026-08-13*
