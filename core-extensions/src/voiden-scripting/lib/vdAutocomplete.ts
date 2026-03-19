/**
 * Inline ghost-text suggestions for the `voiden` scripting API.
 *
 * Triggers on `voiden.` for JS, Python, and Shell (all three share the same
 * dot-notation API). Shell also exposes `voiden_*` function aliases and
 * `$VOIDEN_*` env vars — those are handled by separate trigger patterns below.
 *
 * Self-limiting: only activates on those exact prefixes so it won't
 * interfere with JSON body editors or other CodeMirror instances.
 */

import { keymap, EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { Extension, RangeSetBuilder, StateField, EditorState, Prec } from '@codemirror/state';

// ─── voiden. completions (JS / Python / Shell) ───────────────────────────────

interface VdCompletion {
  /** Dot-separated path after "voiden." (e.g. "request.url") */
  path: string;
  type: string;
  detail: string;
  info: string;
  boost?: number;
  postOnly?: boolean;
}

const VD_COMPLETIONS: VdCompletion[] = [
  // ── Top-level ──────────────────────────────────────────────
  { path: 'request',   type: 'keyword',  detail: 'object',   info: 'Request data (url, method, headers, body, queryParams, pathParams)', boost: 100 },
  { path: 'response',  type: 'keyword',  detail: 'object',   info: 'Response data (status, statusText, headers, body, time, size)', boost: 99, postOnly: true },
  { path: 'env',       type: 'keyword',  detail: 'object',   info: 'Environment access (get)', boost: 98 },
  { path: 'variables', type: 'keyword',  detail: 'object',   info: 'Runtime variable access (get, set)', boost: 97 },
  { path: 'log',       type: 'function', detail: 'levelOrMessage, ...args', info: 'Log output. Examples: voiden.log("hello"), voiden.log("warn", "rate limited")', boost: 96 },
  { path: 'assert',    type: 'function', detail: 'actual, operator, expectedValue, message?', info: 'Assertion API. Example: voiden.assert(response.status, "==", 200, "Status OK")', boost: 91 },
  { path: 'cancel',    type: 'function', detail: '()',        info: 'Cancel the request (pre-script only)', boost: 90 },

  // ── voiden.request.* ──────────────────────────────────────
  { path: 'request.url',         type: 'property', detail: 'string',              info: 'Request URL — read/write' },
  { path: 'request.method',      type: 'property', detail: 'string',              info: 'HTTP method (GET, POST, etc.) — read/write' },
  { path: 'request.headers',     type: 'property', detail: 'map | {key,value}[]', info: 'Request headers — read/write. Shell: voiden.request.headers() getter, export VOIDEN_REQUEST_HEADERS setter' },
  { path: 'request.headers.push', type: 'method',  detail: '{key, value, enabled?}', info: 'Append a header. Example: voiden.request.headers.push({ key: "X-Trace", value: "abc" })' },
  { path: 'request.body',        type: 'property', detail: 'any',                 info: 'Request body — read/write' },
  { path: 'request.queryParams', type: 'property', detail: 'map | {key,value}[]', info: 'Query params — read/write' },
  { path: 'request.queryParams.push', type: 'method', detail: '{key, value, enabled?}', info: 'Append a query param. Example: voiden.request.queryParams.push({ key: "page", value: "1" })' },
  { path: 'request.pathParams',  type: 'property', detail: 'map | {key,value}[]', info: 'Path params — read/write' },
  { path: 'request.pathParams.push', type: 'method', detail: '{key, value, enabled?}', info: 'Append a path param. Example: voiden.request.pathParams.push({ key: "id", value: "123" })' },

  // ── voiden.response.* ─────────────────────────────────────
  { path: 'response.status',     type: 'property', detail: 'number', info: 'HTTP status code (e.g. 200, 404)', postOnly: true },
  { path: 'response.statusText', type: 'property', detail: 'string', info: 'HTTP status text (e.g. "OK", "Not Found")', postOnly: true },
  { path: 'response.headers',    type: 'property', detail: 'Record<string,string>', info: 'Response headers object', postOnly: true },
  { path: 'response.body',       type: 'property', detail: 'any',    info: 'Parsed response body (JSON object, string, etc.)', postOnly: true },
  { path: 'response.time',       type: 'property', detail: 'number', info: 'Response time in milliseconds', postOnly: true },
  { path: 'response.size',       type: 'property', detail: 'number', info: 'Response size in bytes', postOnly: true },

  // ── voiden.env.* ─────────────────────────────────────────
  { path: 'env.get', type: 'method', detail: 'key: string → any', info: 'Read value from active environment. Usage: voiden.env.get("API_KEY")', boost: 89 },

  // ── voiden.variables.* ────────────────────────────────────
  { path: 'variables.get', type: 'method', detail: 'key: string → any', info: 'Get a runtime variable. Usage: voiden.variables.get("token")', boost: 88 },
  { path: 'variables.set', type: 'method', detail: 'key: string, value: any', info: 'Set a runtime variable. Usage: voiden.variables.set("token", value)', boost: 87 },
];

// ─── Shell-only completions ($VOIDEN_ env vars) ──────────────────────────────

interface VdShellEnvCompletion {
  name: string;   // suffix after $VOIDEN_, e.g. "REQUEST_URL"
  detail: string;
  info: string;
}

const VD_SHELL_ENV_COMPLETIONS: VdShellEnvCompletion[] = [
  { name: 'REQUEST_URL',          detail: 'string', info: 'Request URL (read/write via: export VOIDEN_REQUEST_URL="...")' },
  { name: 'REQUEST_METHOD',       detail: 'string', info: 'HTTP method (read/write via: export VOIDEN_REQUEST_METHOD="...")' },
  { name: 'REQUEST_BODY',         detail: 'string', info: 'Request body (read/write via: export VOIDEN_REQUEST_BODY="...")' },
  { name: 'REQUEST_HEADERS',      detail: 'JSON',   info: 'Request headers as JSON array (read/write via export)' },
  { name: 'REQUEST_QUERY_PARAMS', detail: 'JSON',   info: 'Query params as JSON array (read/write via export)' },
  { name: 'REQUEST_PATH_PARAMS',  detail: 'JSON',   info: 'Path params as JSON array (read/write via export)' },
  { name: 'RESPONSE_STATUS',      detail: 'number', info: 'HTTP status code (read-only)' },
  { name: 'RESPONSE_STATUS_TEXT', detail: 'string', info: 'HTTP status text (read-only)' },
  { name: 'RESPONSE_BODY',        detail: 'string', info: 'Response body (read-only)' },
  { name: 'RESPONSE_HEADERS',     detail: 'JSON',   info: 'Response headers as JSON (read-only)' },
  { name: 'RESPONSE_TIME',        detail: 'number', info: 'Response time in ms (read-only)' },
  { name: 'RESPONSE_SIZE',        detail: 'number', info: 'Response size in bytes (read-only)' },
];

// ─── Suggestion computation ──────────────────────────────────────────────────

/**
 * Computes inline suggestion data from the current cursor position.
 * Handles:
 *   - voiden.  → dot-notation API (JS, Python, Shell)
 *   - $VOIDEN_ → shell env var API
 */
function getVdInlineSuggestion(state: EditorState): { from: number; text: string } | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;

  const pos = selection.head;
  const nextChar = state.sliceDoc(pos, pos + 1);
  const beforeCursor = state.sliceDoc(Math.max(0, pos - 120), pos);

  // ── voiden. (JS / Python / Shell) ────────────────────────
  // Don't fire when cursor is in the middle of a path identifier.
  if (!/[a-zA-Z.]/.test(nextChar)) {
    const dotMatch = beforeCursor.match(/\bvoiden\.([a-zA-Z.]*)$/);
    if (dotMatch) {
      const partialPath = dotMatch[1];
      const partialLower = partialPath.toLowerCase();

      const candidates = VD_COMPLETIONS
        .filter((c) => c.path.toLowerCase().startsWith(partialLower))
        .sort((a, b) => {
          const boostDiff = (b.boost ?? 0) - (a.boost ?? 0);
          if (boostDiff !== 0) return boostDiff;
          return a.path.length - b.path.length;
        });

      if (candidates.length > 0) {
        const remaining = candidates[0].path.slice(partialPath.length);
        if (remaining) return { from: pos, text: remaining };
      }
    }
  }

  // ── $VOIDEN_ (shell env vars) ─────────────────────────────
  // Don't fire in the middle of an uppercase identifier.
  if (!/[A-Z_]/.test(nextChar)) {
    const envMatch = beforeCursor.match(/\$VOIDEN_([A-Z_]*)$/);
    if (envMatch) {
      const partial = envMatch[1];
      const candidates = VD_SHELL_ENV_COMPLETIONS
        .filter((c) => c.name.startsWith(partial))
        .sort((a, b) => a.name.length - b.name.length);

      if (candidates.length > 0) {
        const remaining = candidates[0].name.slice(partial.length);
        if (remaining) return { from: pos, text: remaining };
      }
    }
  }

  return null;
}

// ─── Widget ──────────────────────────────────────────────────────────────────

class InlineSuggestionWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-vd-inline-suggestion';
    span.textContent = this.text;
    return span;
  }
}

// ─── Extension ───────────────────────────────────────────────────────────────

/**
 * Creates inline suggestion extension for vd API.
 * Press Tab to accept the ghost suggestion.
 */
export function vdAutocomplete(): Extension {
  const inlineSuggestionField = StateField.define<DecorationSet>({
    create(state) {
      const suggestion = getVdInlineSuggestion(state);
      if (!suggestion) return Decoration.none;

      const builder = new RangeSetBuilder<Decoration>();
      builder.add(
        suggestion.from,
        suggestion.from,
        Decoration.widget({
          widget: new InlineSuggestionWidget(suggestion.text),
          side: 1,
        }),
      );
      return builder.finish();
    },
    update(_, tr) {
      const suggestion = getVdInlineSuggestion(tr.state);
      if (!suggestion) return Decoration.none;

      const builder = new RangeSetBuilder<Decoration>();
      builder.add(
        suggestion.from,
        suggestion.from,
        Decoration.widget({
          widget: new InlineSuggestionWidget(suggestion.text),
          side: 1,
        }),
      );
      return builder.finish();
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const acceptSuggestionKeymap = Prec.highest(keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        const suggestion = getVdInlineSuggestion(view.state);
        if (!suggestion) {
          return false;
        }

        const pos = view.state.selection.main.head;
        const inserted = suggestion.text;
        const end = pos + inserted.length;
        view.dispatch({
          changes: { from: pos, to: pos, insert: inserted },
          selection: { anchor: end, head: end },
          scrollIntoView: true,
        });
        return true;
      },
    },
  ]));

  const inlineSuggestionTheme = EditorView.baseTheme({
    '.cm-vd-inline-suggestion': {
      color: 'var(--fg-secondary)',
      opacity: '0.65',
      pointerEvents: 'none',
      fontStyle: 'italic',
    },
  });

  return [inlineSuggestionField, acceptSuggestionKeymap, inlineSuggestionTheme];
}
