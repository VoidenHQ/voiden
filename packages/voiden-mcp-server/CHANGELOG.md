# Changelog

All notable changes to `@voiden/mcp-server` are documented here. This package is
versioned and released independently of the Voiden desktop app and `@voiden/runner`.

## v0.1.0 - 2026-07-24

First release. An MCP (stdio) server exposing `@voiden/runner`'s execution engine
as tools for an AI agent:

- `list_void_files` — list every `.void` file in the project
- `list_requests` — parse a `.void` file's requests (label, uid, method, URL) without running anything
- `run_request` — execute a request or a whole file, returning a structured pass/fail result
- `write_result` — record a `run_request` result back into the `.void` file as a `response` block

Registered automatically by `voiden-runner mcp install` (Claude Code / Codex), or
by the Voiden app's Settings "Claude/Codex integration" toggle.
