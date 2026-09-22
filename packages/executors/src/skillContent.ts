/**
 * Standalone skill installed by `voiden-runner mcp install` for CLI-only
 * users (no Voiden app, so none of its richer composed .void-authoring
 * skill is available). Focused on the MCP tools this package ships —
 * list/run/verify/write-back — not on full block-authoring syntax.
 *
 * Named "voiden-mcp" (not "voiden-runner") to match the MCP server's own
 * registered identity (see SERVER_NAME in mcpInstall.ts) — this skill is
 * entirely about MCP tool usage, not the voiden-runner CLI in general.
 */
export const MCP_SKILL_MARKDOWN = `---
name: voiden-mcp
description: Run and verify .void API requests via the voiden-mcp MCP tools — list requests, execute them for real, read structured results, and record them back into the file.
---

# Voiden MCP — Running & Verifying .void Requests

.void files describe HTTP/GraphQL/WebSocket/gRPC requests (see https://docs.voiden.md for the full authoring format, or the Voiden app's own "voiden" skill if it's installed). This skill covers a different, complementary job: **actually executing** those requests and checking the result, instead of only ever generating text that looks correct.

A request block that merely looks well-formed can still be wrong (bad URL, wrong auth, malformed body). Don't stop at "this looks right" when you can check that it *is* right.

## Tools

| Tool | Use it to |
|------|-----------|
| \`list_void_files\` | See which \`.void\` files exist in the project |
| \`list_requests\` | See what requests a file contains (label, request uid, method, URL) without running anything |
| \`run_request\` | Actually execute a request (or a whole file) — makes a real network call and returns a structured result: \`success\`, \`status\`, \`statusText\`, \`durationMs\`, \`body\`, \`error\`, headers |
| \`write_result\` | Record a \`run_request\` result back into the \`.void\` file, as a \`response\` block placed right after the request it belongs to |
| \`list_environments\` | Discover the env profiles/environments this project actually has — not what's "active" in the app UI, see below |
| \`select_environment\` | Pick a profile (+ optional environment within it) as the default env for every \`run_request\` call for the rest of this session |

## Workflow

1. Call \`list_void_files\` / \`list_requests\` to see what's actually in the project before assuming.
2. Call \`run_request\` (with \`sectionLabel\` if you only want one request) to execute it for real.
3. Read the result, don't just assume success:
   - \`success: false\` or a non-2xx \`status\` — read \`error\`/\`body\` for why, fix the request block, and re-run. A request that "looks right" but 404s or 401s is not done.
   - \`success: true\` — sanity-check the response \`body\` actually matches what the request was supposed to do.
4. Optionally call \`write_result\` with the \`requestUid\` and the specific \`results[i].result\` object (not the whole \`run_request\` response) to persist what actually happened into the file. This inserts a \`response\` block (preceded by a "## Response recorded" heading, readable as plain markdown) right after the matching \`request\` block, replacing any previous recorded result for that request. **Never author a \`response\` block by hand** — it's a record of what actually happened, not something to write speculatively. If the project has the \`voiden-rest-api\` plugin installed, it renders with a proper status/body/headers view; otherwise it's still fully readable as raw YAML.

## Environment variables & multiple profiles

Environments live in \`.voiden/\`, split across **profiles** and, inside each profile, multiple **environments**:

- **Profile files**: the default profile is \`env-public.yaml\` / \`env-private.yaml\`. Additional profiles follow \`env-<profileName>-public.yaml\` / \`env-<profileName>-private.yaml\` (e.g. \`env-work-public.yaml\`, \`env-work-private.yaml\`).
- **Environments within a profile**: inside a given \`*-public.yaml\`/\`*-private.yaml\` pair, top-level keys are named environments (e.g. \`dev\`, \`staging\`, \`prod\`), and those can nest further — a child inherits its parent's variables, its own overriding on conflict. \`list_environments\` reports the full hierarchy as dotted paths (e.g. \`staging\`, \`staging.eu\`), not just top-level names.

Call \`list_environments\` to see what's actually there before assuming anything — don't grep \`.voiden/\` by hand. For each profile it reports either its environment hierarchy (profiles with YAML environments defined) or the plain \`.env*\` file(s) it falls back to (profiles with none).

\`select_environment(profile, environment?)\` sets what \`run_request\` uses as its default env for the rest of *this* session — call it once, and every later \`run_request\` call picks it up automatically, no need to keep asking or re-passing \`envVars\` yourself. This is independent of whatever profile/environment the Voiden app UI shows as active — the MCP server process has no visibility into that (separate process, separate state, see the discrepancy note below), so don't try to match it; pick and set your own instead.

- Never silently call \`select_environment\` with a guessed profile/environment, substitute a guessed value into a request, or edit any \`env-*.yaml\` file to invent one. If \`list_environments\` shows more than one profile or environment, ask the user which to use before calling \`select_environment\` — unless they've already told you.
- \`select_environment\`'s response never includes actual variable values, only their keys — \`env-*-private.yaml\` can hold real secrets. Don't print values from any \`*-private.yaml\` file yourself either; only confirm whether a key exists.
- If \`run_request\` still fails with an \`unresolved ...\` error after selecting an environment, don't assume it means "nothing is selected" — the selected environment may genuinely not define that variable, or the profile/environment picked isn't the one the user actually meant. State the actual error rather than guessing the cause.
- If the user says a profile/environment is already active in the app and the error persists anyway, that's a real discrepancy worth surfacing plainly (this session's selected environment is independent of the app UI's "active" state) — don't retry silently hoping it resolves; say so and ask how they'd like to proceed.

## Caveats

- \`write_result\` has no file locking. Don't call it on a file that's open with unsaved edits elsewhere (e.g. in the Voiden app right now) — the next save there can overwrite it, or it can overwrite in-progress edits.
- For CI/CD validation, prefer the plain \`voiden-runner run --json\` CLI command over this agent loop — it's deterministic and doesn't need an LLM in the loop. These tools are for interactive authoring/iteration, not as a CI gate.
`
