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
- **Environments within a profile**: inside a given \`*-public.yaml\`/\`*-private.yaml\` pair, top-level keys are named environments (e.g. \`dev\`, \`staging\`, \`prod\`), each with its own \`variables:\` map.

Which profile *and* which environment inside it is active is UI state inside the Voiden app — none of the MCP tools expose a "get active environment" call, and there's no reliable way to introspect either from disk. Treat both as unknown by default, especially once a project has more than one profile file or more than one environment key.

- If \`run_request\` fails with an \`unresolved ...\` error, don't assume it means "nothing is active" — it can mean the active environment doesn't define that variable, the active profile isn't the one the user meant, or the app's active selection differs from what the MCP server process sees (they're separate processes with separate state). State the actual error rather than guessing the cause.
- Never silently pick a profile or environment, substitute a guessed value into the request, or edit any \`env-*.yaml\` file to invent a value. Instead:
  1. List the profile files present in \`.voiden/\` (matching \`env-*-public.yaml\`/\`env-*-private.yaml\`) to get profile names — the default profile has no suffix.
  2. Ask the user which **profile** to use.
  3. Once the profile is picked, list the top-level environment keys in its \`*-public.yaml\` and ask which **environment** to use if more than one exists.
  4. Only then re-run the request.
- Never print values from any \`*-private.yaml\` file. Only confirm whether a key exists.
- If the user says a profile/environment is already active in the app and the error persists anyway, that's a real discrepancy worth surfacing plainly (the MCP server process doesn't see the same "active" state as the app UI) — don't retry silently hoping it resolves; say so and ask how they'd like to proceed.

## Caveats

- \`write_result\` has no file locking. Don't call it on a file that's open with unsaved edits elsewhere (e.g. in the Voiden app right now) — the next save there can overwrite it, or it can overwrite in-progress edits.
- For CI/CD validation, prefer the plain \`voiden-runner run --json\` CLI command over this agent loop — it's deterministic and doesn't need an LLM in the loop. These tools are for interactive authoring/iteration, not as a CI gate.
`
