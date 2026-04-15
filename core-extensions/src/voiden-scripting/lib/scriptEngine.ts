/**
 * Script execution engine.
 * Executes user-authored scripts in an isolated sandbox.
 * JavaScript: Node.js subprocess (worker_threads) with pre-loaded env/vars — no await needed.
 * Python: Electron subprocess via IPC — synchronous by design.
 * Shell: reuses the Node.js IPC bridge; the Node subprocess spawns bash internally.
 *
 * All languages receive env vars and variables pre-loaded, so env/variable
 * access is always synchronous inside scripts.
 */

import type { VdApi, ScriptLog, ScriptExecutionResult, ScriptLanguage } from './types';

const SCRIPT_TIMEOUT_MS = 5_000;

type WorkerToHostMessage =
  | { type: 'log'; args: any[] }
  | {
      type: 'done';
      success: boolean;
      cancelled: boolean;
      logs: ScriptLog[];
      assertions?: Array<{
        passed: boolean;
        message: string;
        condition?: string;
        actualValue?: any;
        operator?: string;
        expectedValue?: any;
        reason?: string;
      }>;
      modifiedRequest: any;
      modifiedResponse?: any;
      modifiedVariables?: Record<string, any>;
      error?: string;
    };

// ---------------------------------------------------------------------------
// Worker source — synchronous API (no RPC). env/variables pre-loaded.
// ---------------------------------------------------------------------------
const workerSource = `
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  let requestState = null;
  let responseState = null;
  let _envData = {};
  let _variablesData = {};
  const _modifiedVariables = {};
  const logs = [];
  const assertions = [];
  let cancelled = false;

  function _normalizeLevel(value) {
    if (typeof value !== 'string') return null;
    const lowered = value.toLowerCase();
    if (lowered === 'warning') return 'warn';
    if (lowered === 'log' || lowered === 'info' || lowered === 'debug' || lowered === 'warn' || lowered === 'error') return lowered;
    return null;
  }

  function _pushLog(level, args) {
    logs.push({ level, args });
    self.postMessage({ type: 'log', args });
  }

  function _serializeAssertionValue(val) {
    try { return JSON.parse(JSON.stringify(val)); } catch { return String(val); }
  }

  function _toConditionText(val) {
    if (typeof val === 'string') return JSON.stringify(val);
    try { return JSON.stringify(val); } catch { return String(val); }
  }

  function _normalizeOperator(op) {
    if (typeof op !== 'string') return null;
    const key = op.trim().toLowerCase().replace(/\\s+/g, '');
    const map = {
      '==':'==','===':'===','eq':'==','equal':'==',
      '!=':'!=','!==':'!==','neq':'!=','notequal':'!=',
      'greater':'>','greaterthan':'>','gte':'>=',
      'less':'<','lessthan':'<','lte':'<=',
      '>':'>','>=':'>=','<':'<','<=':'<=',
      'contains':'contains','includes':'contains',
      'matches':'matches','regex':'matches',
      'truthy':'truthy','falsy':'falsy',
    };
    return map[key] || null;
  }

  function _evaluateAssertion(actual, operator, expected) {
    switch (operator) {
      case '==': return actual == expected;
      case '===': return actual === expected;
      case '!=': return actual != expected;
      case '!==': return actual !== expected;
      case '>': return actual > expected;
      case '>=': return actual >= expected;
      case '<': return actual < expected;
      case '<=': return actual <= expected;
      case 'contains':
        if (typeof actual === 'string') return actual.includes(String(expected));
        if (Array.isArray(actual)) return actual.includes(expected);
        return false;
      case 'matches':
        try { return new RegExp(String(expected)).test(String(actual)); } catch { return false; }
      case 'truthy': return Boolean(actual);
      case 'falsy': return !actual;
      default: return Boolean(actual);
    }
  }

  self.onmessage = async (event) => {
    const data = event.data;
    if (data && data.type === 'start') {
      requestState = data.request;
      responseState = data.response;
      _envData = data.envData || {};
      _variablesData = Object.assign({}, data.variablesData || {});
      const scriptBody = data.script;

      const voiden = {
        request: requestState,
        response: responseState,
        env: { get: function(key) { return _envData[key]; } },
        variables: {
          get: function(key) { return _variablesData[key]; },
          set: function(key, value) { _variablesData[key] = value; _modifiedVariables[key] = value; },
        },
        log: function(levelOrMessage) {
          const rest = Array.prototype.slice.call(arguments, 1);
          const normalized = _normalizeLevel(levelOrMessage);
          if (normalized) { _pushLog(normalized, rest); return; }
          _pushLog('log', [levelOrMessage].concat(rest));
        },
        assert: function(actual, operator, expected, message) {
          const rawOperator = String(operator);
          const normalizedOperator = _normalizeOperator(operator);
          if (!normalizedOperator) {
            assertions.push({ passed: false, message: message ? String(message) : '', reason: 'Unsupported operator: ' + rawOperator, condition: _toConditionText(actual) + ' ' + rawOperator + ' ' + _toConditionText(expected), actualValue: _serializeAssertionValue(actual), operator: rawOperator, expectedValue: _serializeAssertionValue(expected) });
            return;
          }
          const passed = _evaluateAssertion(actual, normalizedOperator, expected);
          assertions.push({ passed, message: message ? String(message) : '', condition: _toConditionText(actual) + ' ' + normalizedOperator + ' ' + _toConditionText(expected), actualValue: _serializeAssertionValue(actual), operator: normalizedOperator, expectedValue: _serializeAssertionValue(expected) });
        },
        cancel: function() { cancelled = true; },
      };

      try {
        const _require = typeof require !== 'undefined' ? require : undefined;
        const fn = new AsyncFunction('voiden', 'vd', 'require', scriptBody);
        await fn(voiden, voiden, _require);
        self.postMessage({ type: 'done', success: true, cancelled, logs, assertions, modifiedRequest: voiden.request, modifiedResponse: voiden.response, modifiedVariables: _modifiedVariables });
      } catch (error) {
        self.postMessage({ type: 'done', success: false, cancelled, logs, assertions, modifiedRequest: voiden.request, modifiedResponse: voiden.response, modifiedVariables: _modifiedVariables, error: (error && (error.stack || error.message)) ? String(error.stack || error.message) : String(error) });
      }
    }
  };
`;

// ---------------------------------------------------------------------------
// Node host wrapper — simplified (no RPC). Passes pre-loaded data to worker.
// ---------------------------------------------------------------------------
const nodeHostWrapperSource = `
'use strict';
var Worker = require('worker_threads').Worker;
var _chunks = [];
process.stdin.on('data', function(c) { _chunks.push(c); });
process.stdin.on('end', function() {
  var _input = JSON.parse(Buffer.concat(_chunks).toString('utf-8'));
  var _workerSource = _input.workerSource;
  var _envData = _input.envVars || {};
  var _variablesData = _input.variables || {};

  var _shim = [
    "var workerThreads = require('worker_threads');",
    "var self = { postMessage: function(data) { workerThreads.parentPort.postMessage(data); } };",
    "workerThreads.parentPort.on('message', function(data) { if (self.onmessage) self.onmessage({ data: data }); });",
    ""
  ].join('\\n');

  var _worker = new Worker(_shim + _workerSource, { eval: true });

  var _timeout = setTimeout(function() {
    _worker.terminate();
    process.stdout.write(JSON.stringify({ success: false, logs: [], error: 'Script execution timed out after 10000ms', cancelled: false, modifiedVariables: {} }) + '\\n');
    process.exit(1);
  }, 10000);

  _worker.on('message', function(msg) {
    if (msg.type === 'done') {
      clearTimeout(_timeout);
      process.stdout.write(JSON.stringify({ success: msg.success, logs: msg.logs || [], assertions: msg.assertions || [], cancelled: msg.cancelled || false, error: msg.error, modifiedRequest: msg.modifiedRequest, modifiedResponse: msg.modifiedResponse, modifiedVariables: msg.modifiedVariables || {} }) + '\\n');
      _worker.terminate();
      process.exit(msg.success ? 0 : 1);
    }
  });

  _worker.on('error', function(err) {
    clearTimeout(_timeout);
    process.stdout.write(JSON.stringify({ success: false, logs: [], error: err.stack || err.message || String(err), cancelled: false, modifiedVariables: {} }) + '\\n');
    process.exit(1);
  });

  _worker.postMessage({ type: 'start', script: _input.scriptBody, request: _input.request || {}, response: _input.response || null, envData: _envData, variablesData: _variablesData });
});
`;


// ---------------------------------------------------------------------------
// Python wrapper source (unchanged)
// ---------------------------------------------------------------------------
const pythonWrapperSource = `
import sys, json
import traceback

def main():
    input_data = json.loads(sys.stdin.read())

    script_body = input_data["scriptBody"]

    request_data = input_data.get("request", {})
    response_data = input_data.get("response", None)
    env_data = input_data.get("envVars", {})
    variables_data = input_data.get("variables", {})

    logs = []
    assertions = []
    cancelled = False
    modified_variables = {}

    class _List:
        def __init__(self, values=None):
            self._items = []
            if values:
                for v in values:
                    self._items.append(_wrap(v))

        def push(self, *values):
            if len(values) == 2 and isinstance(values[0], str) and not isinstance(values[1], (dict, list, tuple)):
                key = values[0].strip()
                if key:
                    self._items.append(_wrap({"key": key, "value": str(values[1]), "enabled": True}))
                return len(self._items)
            for v in values:
                if isinstance(v, dict) and "key" in v and "value" in v:
                    key = str(v.get("key", "")).strip()
                    if not key: continue
                    self._items.append(_wrap({"key": key, "value": str(v.get("value", "")), "enabled": v.get("enabled", True) is not False}))
                    continue
                if isinstance(v, dict):
                    for mk, mv in v.items():
                        mkey = str(mk).strip()
                        if not mkey: continue
                        self._items.append(_wrap({"key": mkey, "value": str(mv), "enabled": True}))
                    continue
                self._items.append(_wrap(v))
            return len(self._items)

        def append(self, value): self._items.append(_wrap(value))
        def extend(self, values):
            for v in values: self._items.append(_wrap(v))
        def __iter__(self): return iter(self._items)
        def __len__(self): return len(self._items)
        def __getitem__(self, index): return self._items[index]
        def __setitem__(self, index, value): self._items[index] = _wrap(value)
        def __repr__(self): return repr(self._items)

    def _wrap(val):
        if isinstance(val, dict): return _Obj(val)
        if isinstance(val, list): return _List(val)
        if isinstance(val, tuple): return tuple(_wrap(v) for v in val)
        return val

    _REQUEST_COLLECTION_FIELDS = {"headers", "queryParams", "pathParams"}

    class _Obj:
        def __init__(self, data, normalize_collections=False):
            object.__setattr__(self, '_normalize_collections', normalize_collections)
            for k, v in data.items(): setattr(self, k, v)

        def __setattr__(self, key, value):
            if key == '_normalize_collections':
                object.__setattr__(self, key, value)
                return
            if object.__getattribute__(self, '_normalize_collections') and key in _REQUEST_COLLECTION_FIELDS:
                object.__setattr__(self, key, _List(_normalize_kv_collection(value)))
                return
            object.__setattr__(self, key, _wrap(value))

        def __getitem__(self, key): return getattr(self, key)
        def __setitem__(self, key, value): setattr(self, key, value)
        def get(self, key, default=None): return getattr(self, key, default)
        def items(self): return ((k, v) for k, v in self.__dict__.items() if k != '_normalize_collections')

    def _normalize_kv_collection(value):
        items = []
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and "key" in item and "value" in item:
                    key = str(item.get("key", "")).strip()
                    if not key: continue
                    items.append({"key": key, "value": str(item.get("value", "")), "enabled": item.get("enabled", True) is not False})
                elif isinstance(item, dict):
                    for mk, mv in item.items():
                        mkey = str(mk).strip()
                        if not mkey: continue
                        items.append({"key": mkey, "value": str(mv), "enabled": True})
            return items
        if isinstance(value, dict):
            if "key" in value and "value" in value:
                key = str(value.get("key", "")).strip()
                if not key: return []
                return [{"key": key, "value": str(value.get("value", "")), "enabled": value.get("enabled", True) is not False}]
            for mk, mv in value.items():
                mkey = str(mk).strip()
                if not mkey: continue
                items.append({"key": mkey, "value": str(mv), "enabled": True})
            return items
        return []

    class _Variables:
        def get(self, key): return variables_data.get(key)
        def set(self, key, value):
            serialized = _serialize(value)
            variables_data[key] = serialized
            modified_variables[key] = serialized

    class _Env:
        def get(self, key): return env_data.get(key)

    class _Vd:
        def __init__(self):
            self.request = _Obj(request_data, normalize_collections=True)
            self.response = _Obj(response_data) if response_data else None
            self.env = _Env()
            self.variables = _Variables()

        def log(self, *args):
            level = "log"
            payload = args
            if len(args) >= 1 and isinstance(args[0], str):
                lowered = args[0].lower()
                if lowered == "warning": lowered = "warn"
                if lowered in ("log", "info", "debug", "warn", "error"):
                    level = lowered
                    payload = args[1:]
            logs.append({"level": level, "args": [_serialize(a) for a in payload]})

        def assert_(self, actual, operator, expected, message=""):
            normalized_operator = _normalize_operator(operator)
            if normalized_operator is None:
                raw_operator = str(operator)
                assertions.append({"passed": False, "message": str(message), "reason": "Unsupported operator: " + raw_operator, "condition": _to_condition_text(actual) + " " + raw_operator + " " + _to_condition_text(expected), "actualValue": _serialize(actual), "operator": raw_operator, "expectedValue": _serialize(expected)})
                return
            passed = _evaluate_assertion(actual, normalized_operator, expected)
            assertions.append({"passed": bool(passed), "message": str(message), "condition": _to_condition_text(actual) + " " + str(normalized_operator) + " " + _to_condition_text(expected), "actualValue": _serialize(actual), "operator": str(normalized_operator), "expectedValue": _serialize(expected)})

        def cancel(self):
            nonlocal cancelled
            cancelled = True

    def _serialize(val):
        if isinstance(val, _List): return [_serialize(v) for v in val]
        if isinstance(val, _Obj): return {k: _serialize(v) for k, v in val.__dict__.items() if k != '_normalize_collections'}
        if isinstance(val, dict): return {k: _serialize(v) for k, v in val.items()}
        if isinstance(val, (list, tuple)): return [_serialize(v) for v in val]
        try:
            json.dumps(val)
            return val
        except (TypeError, ValueError): return str(val)

    def _extract(obj, keys):
        result = {}
        for k in keys:
            if hasattr(obj, k): result[k] = _serialize(getattr(obj, k))
        return result

    def _json_equal(a, b):
        try: return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
        except Exception: return False

    def _normalize_operator(op):
        if not isinstance(op, str): return None
        key = "".join(op.strip().lower().split())
        mapping = {"==":"==","===":"===","eq":"==","equal":"==","!=":"!=","!==":"!==","neq":"!=","notequal":"!=","greater":">","greaterthan":">","gte":">=","less":"<","lessthan":"<","lte":"<=",">":">",">=":">=","<":"<","<=":"<=","contains":"contains","includes":"contains","matches":"matches","regex":"matches","truthy":"truthy","falsy":"falsy"}
        return mapping.get(key)

    def _to_condition_text(value):
        if isinstance(value, str): return json.dumps(value)
        try: return json.dumps(value)
        except Exception: return str(value)

    def _evaluate_assertion(actual, operator, expected):
        try:
            if operator == "==": return actual == expected
            if operator == "===": return type(actual) == type(expected) and actual == expected
            if operator == "!=": return actual != expected
            if operator == "!==": return not (type(actual) == type(expected) and actual == expected)
            if operator == ">": return actual > expected
            if operator == ">=": return actual >= expected
            if operator == "<": return actual < expected
            if operator == "<=": return actual <= expected
            if operator == "contains":
                if isinstance(actual, str): return str(expected) in actual
                if isinstance(actual, (list, tuple)): return expected in actual
                return False
            if operator == "matches":
                import re
                return re.search(str(expected), str(actual)) is not None
            if operator == "truthy": return bool(actual)
            if operator == "falsy": return not bool(actual)
        except Exception: return False
        return bool(actual)

    voiden = _Vd()

    try:
        script_body = script_body.replace('voiden.assert(', 'voiden.assert_(')
        script_body = script_body.replace('vd.assert(', 'vd.assert_(')
        exec(script_body, {"voiden": voiden, "vd": voiden, "__builtins__": __builtins__})

        mod_request = _extract(voiden.request, ["url", "method", "headers", "body", "queryParams", "pathParams"])
        mod_response = None
        if voiden.response is not None:
            candidate_response = _extract(voiden.response, ["status", "statusText", "headers", "body", "time", "size"])
            original_response = _serialize(response_data) if response_data is not None else None
            if original_response is None or not _json_equal(candidate_response, original_response):
                mod_response = candidate_response

        result = {"success": True, "logs": logs, "assertions": assertions, "cancelled": cancelled, "modifiedRequest": mod_request, "modifiedResponse": mod_response, "modifiedVariables": modified_variables}
    except Exception as e:
        result = {"success": False, "logs": logs, "assertions": assertions, "cancelled": cancelled, "error": traceback.format_exc(), "modifiedVariables": _serialize(modified_variables)}

    print(json.dumps(result))
    sys.exit(0 if result.get("success") else 1)

main()
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pre-load env vars and variables from the renderer IPC bridge. */
async function preloadEnvAndVariables(): Promise<{
  envVars: Record<string, string>;
  variables: Record<string, any>;
}> {
  let envVars: Record<string, string> = {};
  let variables: Record<string, any> = {};

  try {
    const envLoad = await (window as any).electron?.env?.load?.();
    const activeEnvPath = envLoad?.activeEnv;
    const allEnvData = envLoad?.data;
    if (activeEnvPath && allEnvData && typeof allEnvData === 'object') {
      const activeEnv = allEnvData[activeEnvPath];
      if (activeEnv && typeof activeEnv === 'object') envVars = activeEnv;
    }
  } catch { /* env unavailable */ }

  try {
    const readResult = await (window as any).electron?.variables?.read?.();
    if (readResult && typeof readResult === 'object') {
      variables = readResult;
    } else {
      const state = await (window as any).electron?.state?.get();
      const projectPath = state?.activeDirectory || '';
      const fileContent = await (window as any).electron?.files?.read(
        projectPath + '/.voiden/.process.env.json'
      );
      if (fileContent) Object.assign(variables, JSON.parse(fileContent));
    }
  } catch { /* variables unavailable */ }

  return { envVars, variables };
}

/** Escape a value for single-quoted bash strings. */
function shSingleQuote(val: string): string {
  return "'" + String(val).replace(/'/g, "'\\''") + "'";
}

/**
 * Build the complete bash wrapper script that exposes the voiden_* shell API.
 * This runs in TypeScript so template literals work freely.
 */
function buildBashScript(params: {
  request: any;
  response: any;
  envVars: Record<string, string>;
  variables: Record<string, any>;
  logFile: string;
  varFile: string;
  assertFile: string;
  cancelFile: string;
  reqFile: string;
  respFile: string;
  userScriptFile: string;
}): string {
  const { request, response, envVars, variables, logFile, varFile, assertFile, cancelFile, reqFile, respFile, userScriptFile } = params;

  const envLines = Object.entries(envVars)
    .map(([k, v]) => `_VD_ENV_${k.replace(/[^A-Za-z0-9_]/g, '_')}=${shSingleQuote(String(v))}`)
    .join('\n') || '# (no env vars)';

  const varLines = Object.entries(variables)
    .map(([k, v]) => `_VD_VAR_${k.replace(/[^A-Za-z0-9_]/g, '_')}=${shSingleQuote(String(v))}`)
    .join('\n') || '# (no variables)';

  const has = !!response;
  const q = shSingleQuote;

  return [
    '#!/bin/bash',
    'set +e',
    `_VD_LOG_FILE=${q(logFile)}`,
    `_VD_VAR_FILE=${q(varFile)}`,
    `_VD_ASSERT_FILE=${q(assertFile)}`,
    `_VD_CANCEL_FILE=${q(cancelFile)}`,
    `_VD_REQUEST_FILE=${q(reqFile)}`,
    `_VD_RESPONSE_FILE=${q(respFile)}`,
    `_VD_USERSCRIPT_FILE=${q(userScriptFile)}`,
    'touch "$_VD_LOG_FILE" "$_VD_VAR_FILE" "$_VD_ASSERT_FILE" "$_VD_REQUEST_FILE" "$_VD_RESPONSE_FILE"',
    '_vd_b64() { printf "%s" "$1" | base64 | tr -d "\\n"; }',
    'voiden_log() {',
    '  local _level="log"',
    '  case "$1" in log|info|debug|warn|warning|error) _level="$1"; shift;; esac',
    '  [ "$_level" = "warning" ] && _level="warn"',
    '  printf "%s\\t%s\\n" "$(_vd_b64 "$_level")" "$(_vd_b64 "$*")" >> "$_VD_LOG_FILE"',
    '}',
    'voiden_env_get() { local _k="_VD_ENV_${1//[^A-Za-z0-9_]/_}"; printf "%s" "${!_k}"; }',
    'voiden_variables_get() { local _k="_VD_VAR_${1//[^A-Za-z0-9_]/_}"; printf "%s" "${!_k}"; }',
    'voiden_variables_set() {',
    '  local _key="$1" _val="$2"',
    '  local _k="_VD_VAR_${_key//[^A-Za-z0-9_]/_}"',
    '  export "${_k}=${_val}"',
    '  printf "%s\\t%s\\n" "$(_vd_b64 "$_key")" "$(_vd_b64 "$_val")" >> "$_VD_VAR_FILE"',
    '}',
    'voiden_cancel() { touch "$_VD_CANCEL_FILE"; }',
    '',
    '# voiden.* dot-notation aliases (same API as JS / Python)',
    'voiden.log() { voiden_log "$@"; }',
    'voiden.env.get() { voiden_env_get "$@"; }',
    'voiden.variables.get() { voiden_variables_get "$@"; }',
    'voiden.variables.set() { voiden_variables_set "$@"; }',
    'voiden.assert() { voiden_assert "$@"; }',
    'voiden.cancel() { voiden_cancel; }',
    '# request getters / setters',
    '# Supports both call styles:',
    '#   voiden.request.url "https://new.com"   (bash style)',
    '#   voiden.request.url = "https://new.com" (JS-like style — = is treated as separator)',
    '_vd_val() { [ "$1" = "=" ] && printf "%s" "$2" || printf "%s" "$1"; }',
    'voiden.request.url()         { [ $# -gt 0 ] && export VOIDEN_REQUEST_URL="$(_vd_val "$@")"          || printf "%s" "$VOIDEN_REQUEST_URL"; }',
    'voiden.request.method()      { [ $# -gt 0 ] && export VOIDEN_REQUEST_METHOD="$(_vd_val "$@")"       || printf "%s" "$VOIDEN_REQUEST_METHOD"; }',
    'voiden.request.body()        { [ $# -gt 0 ] && export VOIDEN_REQUEST_BODY="$(_vd_val "$@")"         || printf "%s" "$VOIDEN_REQUEST_BODY"; }',
    '# shared entry builder — stores result in $_VD_KV_ENTRY',
    '_vd_build_kv_entry() {',
    '  local _Q=\'"\' _k _v',
    '  _k="${1//$_Q/\\\\$_Q}"',
    '  _v="${2//$_Q/\\\\$_Q}"',
    '  printf -v _VD_KV_ENTRY \'{"key":"%s","value":"%s","enabled":true}\' "$_k" "$_v"',
    '}',
    '# _vd_set_kv: replace the array with a single entry',
    '_vd_set_kv() {',
    '  local _var="$1"',
    '  _vd_build_kv_entry "$2" "$3"',
    '  printf -v "$_var" \'[%s]\' "$_VD_KV_ENTRY"',
    '  export "$_var"',
    '}',
    '# _vd_push_kv: append an entry to the existing array',
    '_vd_push_kv() {',
    '  local _var="$1" _cur',
    '  _vd_build_kv_entry "$2" "$3"',
    '  _cur="${!_var}"',
    '  if [ -z "$_cur" ] || [ "$_cur" = "[]" ]; then',
    '    printf -v "$_var" \'[%s]\' "$_VD_KV_ENTRY"',
    '  else',
    '    printf -v "$_var" \'%s,%s]\' "${_cur%]}" "$_VD_KV_ENTRY"',
    '  fi',
    '  export "$_var"',
    '}',
    '# collection setters: 2 args = set as single {key,value}; 1 arg = raw JSON; 0 args = getter',
    'voiden.request.headers()     { if [ $# -ge 2 ]; then _vd_set_kv VOIDEN_REQUEST_HEADERS "$1" "$2"; elif [ $# -gt 0 ]; then export VOIDEN_REQUEST_HEADERS="$(_vd_val "$@")"; else printf "%s" "$VOIDEN_REQUEST_HEADERS"; fi; }',
    'voiden.request.queryParams() { if [ $# -ge 2 ]; then _vd_set_kv VOIDEN_REQUEST_QUERY_PARAMS "$1" "$2"; elif [ $# -gt 0 ]; then export VOIDEN_REQUEST_QUERY_PARAMS="$(_vd_val "$@")"; else printf "%s" "$VOIDEN_REQUEST_QUERY_PARAMS"; fi; }',
    'voiden.request.pathParams()  { if [ $# -ge 2 ]; then _vd_set_kv VOIDEN_REQUEST_PATH_PARAMS "$1" "$2"; elif [ $# -gt 0 ]; then export VOIDEN_REQUEST_PATH_PARAMS="$(_vd_val "$@")"; else printf "%s" "$VOIDEN_REQUEST_PATH_PARAMS"; fi; }',
    'voiden.request.headers.push()     { _vd_push_kv VOIDEN_REQUEST_HEADERS "$1" "$2"; }',
    'voiden.request.queryParams.push() { _vd_push_kv VOIDEN_REQUEST_QUERY_PARAMS "$1" "$2"; }',
    'voiden.request.pathParams.push()  { _vd_push_kv VOIDEN_REQUEST_PATH_PARAMS "$1" "$2"; }',
    '# response getters and writable setters (status, statusText, body)',
    'voiden.response.status()     { [ $# -gt 0 ] && export VOIDEN_RESPONSE_STATUS="$(_vd_val "$@")"      || printf "%s" "$VOIDEN_RESPONSE_STATUS"; }',
    'voiden.response.statusText() { [ $# -gt 0 ] && export VOIDEN_RESPONSE_STATUS_TEXT="$(_vd_val "$@")" || printf "%s" "$VOIDEN_RESPONSE_STATUS_TEXT"; }',
    'voiden.response.body()       { [ $# -gt 0 ] && export VOIDEN_RESPONSE_BODY="$(_vd_val "$@")"        || printf "%s" "$VOIDEN_RESPONSE_BODY"; }',
    '# response read-only fields',
    'voiden.response.headers()    { printf "%s" "$VOIDEN_RESPONSE_HEADERS"; }',
    'voiden.response.time()       { printf "%s" "$VOIDEN_RESPONSE_TIME"; }',
    'voiden.response.size()       { printf "%s" "$VOIDEN_RESPONSE_SIZE"; }',
    '',
    'voiden_assert() {',
    '  local _actual="$1" _op="$2" _expected="$3" _msg="${4:-}" _passed="false"',
    '  case "$_op" in',
    '    "=="|eq|equal)           [ "$_actual" = "$_expected" ] && _passed="true" ;;',
    '    "===")                   [ "$_actual" = "$_expected" ] && _passed="true" ;;',
    '    "!="|neq|notequal)       [ "$_actual" != "$_expected" ] && _passed="true" ;;',
    '    "!==")                   [ "$_actual" != "$_expected" ] && _passed="true" ;;',
    '    contains|includes)       case "$_actual" in *"$_expected"*) _passed="true";; esac ;;',
    '    matches|regex)           printf "%s" "$_actual" | grep -qE "$_expected" 2>/dev/null && _passed="true"; true ;;',
    '    truthy)                  [ -n "$_actual" ] && _passed="true" ;;',
    '    falsy)                   [ -z "$_actual" ] && _passed="true" ;;',
    '    ">"|greater|greaterthan) (( _actual > _expected )) 2>/dev/null && _passed="true"; true ;;',
    '    ">="|gte)                (( _actual >= _expected )) 2>/dev/null && _passed="true"; true ;;',
    '    "<"|less|lessthan)       (( _actual < _expected )) 2>/dev/null && _passed="true"; true ;;',
    '    "<="|lte)                (( _actual <= _expected )) 2>/dev/null && _passed="true"; true ;;',
    '  esac',
    '  printf "%s\\t%s\\t%s\\t%s\\t%s\\n" "$(_vd_b64 "$_passed")" "$(_vd_b64 "$_actual")" "$(_vd_b64 "$_op")" "$(_vd_b64 "$_expected")" "$(_vd_b64 "$_msg")" >> "$_VD_ASSERT_FILE"',
    '}',
    '',
    '# Pre-loaded env vars',
    envLines,
    '',
    '# Pre-loaded variables',
    varLines,
    '',
    `export VOIDEN_REQUEST_URL=${q(request?.url ?? '')}`,
    `export VOIDEN_REQUEST_METHOD=${q(request?.method ?? 'GET')}`,
    `export VOIDEN_REQUEST_BODY=${q(request?.body != null ? (typeof request.body === 'object' ? JSON.stringify(request.body) : String(request.body)) : '')}`,
    `export VOIDEN_REQUEST_HEADERS=${q(JSON.stringify(request?.headers ?? []))}`,
    `export VOIDEN_REQUEST_QUERY_PARAMS=${q(JSON.stringify(request?.queryParams ?? []))}`,
    `export VOIDEN_REQUEST_PATH_PARAMS=${q(JSON.stringify(request?.pathParams ?? []))}`,
    `export VOIDEN_RESPONSE_STATUS=${q(has ? String(response?.status ?? '') : '')}`,
    `export VOIDEN_RESPONSE_STATUS_TEXT=${q(has ? String(response?.statusText ?? '') : '')}`,
    `export VOIDEN_RESPONSE_BODY=${q(has && response?.body != null ? (typeof response.body === 'object' ? JSON.stringify(response.body) : String(response.body)) : '')}`,
    `export VOIDEN_RESPONSE_HEADERS=${q(has ? JSON.stringify(response?.headers ?? {}) : '{}')}`,
    `export VOIDEN_RESPONSE_TIME=${q(has ? String(response?.time ?? 0) : '0')}`,
    `export VOIDEN_RESPONSE_SIZE=${q(has ? String(response?.size ?? 0) : '0')}`,
    '',
    '# --- User Script (sourced from separate file; errors are caught) ---',
    '. "$_VD_USERSCRIPT_FILE" || true',
    '# --- End User Script ---',
    '',
    'printf "%s\\t%s\\n" "$(_vd_b64 "url")"         "$(_vd_b64 "$VOIDEN_REQUEST_URL")"          >> "$_VD_REQUEST_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "method")"      "$(_vd_b64 "$VOIDEN_REQUEST_METHOD")"       >> "$_VD_REQUEST_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "body")"        "$(_vd_b64 "$VOIDEN_REQUEST_BODY")"         >> "$_VD_REQUEST_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "headers")"     "$(_vd_b64 "$VOIDEN_REQUEST_HEADERS")"      >> "$_VD_REQUEST_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "queryParams")" "$(_vd_b64 "$VOIDEN_REQUEST_QUERY_PARAMS")" >> "$_VD_REQUEST_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "pathParams")"  "$(_vd_b64 "$VOIDEN_REQUEST_PATH_PARAMS")"  >> "$_VD_REQUEST_FILE"',
    '# Write modified response fields (only when a response exists)',
    `[ -n ${q(has ? '1' : '')} ] && {`,
    'printf "%s\\t%s\\n" "$(_vd_b64 "status")"     "$(_vd_b64 "$VOIDEN_RESPONSE_STATUS")"      >> "$_VD_RESPONSE_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "statusText")" "$(_vd_b64 "$VOIDEN_RESPONSE_STATUS_TEXT")" >> "$_VD_RESPONSE_FILE"',
    'printf "%s\\t%s\\n" "$(_vd_b64 "body")"       "$(_vd_b64 "$VOIDEN_RESPONSE_BODY")"        >> "$_VD_RESPONSE_FILE"',
    '}',
    'true',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// In-process JS fallback
// ---------------------------------------------------------------------------
async function executeScriptInProcess(scriptBody: string, vdApi: VdApi): Promise<ScriptExecutionResult> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const logs: ScriptLog[] = [];
  const assertions: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any; reason?: string }> = [];
  let cancelled = false;

  const { envVars, variables: variablesData } = await preloadEnvAndVariables();
  const modifiedVariables: Record<string, any> = {};

  const normalizeLevel = (value: any): ScriptLog['level'] | null => {
    if (typeof value !== 'string') return null;
    const lowered = value.toLowerCase();
    if (lowered === 'warning') return 'warn';
    if (['log', 'info', 'debug', 'warn', 'error'].includes(lowered)) return lowered as ScriptLog['level'];
    return null;
  };
  const pushLog = (level: ScriptLog['level'], args: any[]) => logs.push({ level, args });
  const toConditionText = (value: any): string => {
    if (typeof value === 'string') return JSON.stringify(value);
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const normalizeOperator = (op: any): string | null => {
    if (typeof op !== 'string') return null;
    const key = op.trim().toLowerCase().replace(/\s+/g, '');
    const map: Record<string, string> = { '==':'==','===':'===',eq:'==',equal:'==','!=':'!=','!==':'!==',neq:'!=',notequal:'!=',greater:'>',greaterthan:'>',gte:'>=',less:'<',lessthan:'<',lte:'<=','>':'>','>=':'>=','<':'<','<=':'<=',contains:'contains',includes:'contains',matches:'matches',regex:'matches',truthy:'truthy',falsy:'falsy' };
    return map[key] || null;
  };
  const evaluateAssertion = (actual: any, operator: string, expected: any): boolean => {
    try {
      switch (operator) {
        case '==': return actual == expected;
        case '===': return actual === expected;
        case '!=': return actual != expected;
        case '!==': return actual !== expected;
        case '>': return actual > expected;
        case '>=': return actual >= expected;
        case '<': return actual < expected;
        case '<=': return actual <= expected;
        case 'contains':
          if (typeof actual === 'string') return actual.includes(String(expected));
          if (Array.isArray(actual)) return actual.includes(expected);
          return false;
        case 'matches': return new RegExp(String(expected)).test(String(actual));
        case 'truthy': return Boolean(actual);
        case 'falsy': return !actual;
        default: return Boolean(actual);
      }
    } catch { return false; }
  };

  const voiden: VdApi = {
    request: vdApi.request,
    response: vdApi.response,
    env: { get: (key: string) => envVars[key] } as any,
    variables: {
      get: (key: string) => variablesData[key],
      set: (key: string, value: any) => { variablesData[key] = value; modifiedVariables[key] = value; },
    } as any,
    log: (levelOrMessage: any, ...args: any[]) => {
      const normalized = normalizeLevel(levelOrMessage);
      if (normalized) { pushLog(normalized, args); return; }
      pushLog('log', [levelOrMessage, ...args]);
    },
    assert: (actual: any, operator: string, expected: any, message?: string) => {
      const rawOperator = String(operator);
      const normalizedOperator = normalizeOperator(operator);
      if (!normalizedOperator) {
        assertions.push({ passed: false, message: message ? String(message) : '', reason: `Unsupported operator: ${rawOperator}`, condition: `${toConditionText(actual)} ${rawOperator} ${toConditionText(expected)}`, actualValue: actual, operator: rawOperator, expectedValue: expected });
        return;
      }
      assertions.push({ passed: evaluateAssertion(actual, normalizedOperator, expected), message: message ? String(message) : '', condition: `${toConditionText(actual)} ${normalizedOperator} ${toConditionText(expected)}`, actualValue: actual, operator: normalizedOperator, expectedValue: expected });
    },
    cancel: () => { cancelled = true; },
  };

  try {
    const scriptFn = new AsyncFunction('voiden', 'vd', scriptBody);
    await scriptFn(voiden, voiden);
    for (const [key, value] of Object.entries(modifiedVariables)) {
      try { await vdApi.variables.set(key, value); } catch { /* best effort */ }
    }
    return { success: true, logs, assertions, cancelled, exitCode: 0, modifiedRequest: voiden.request, modifiedResponse: voiden.response };
  } catch (error: any) {
    return { success: false, logs, assertions, error: String(error?.stack || error?.message || error), cancelled, exitCode: 1, modifiedResponse: voiden.response };
  }
}

// ---------------------------------------------------------------------------
// Python execution
// ---------------------------------------------------------------------------
async function executePythonScript(scriptBody: string, vdApi: VdApi): Promise<ScriptExecutionResult> {
  const { envVars, variables } = await preloadEnvAndVariables();

  try {
    const result = await (window as any).electron?.ipc?.invoke(
      'ext:voiden-scripting:script:executePython',
      { scriptBody, pythonWrapper: pythonWrapperSource,
        request: vdApi.request, response: vdApi.response, envVars, variables },
    );

    if (!result) return { success: false, logs: [], error: 'Python execution bridge unavailable', cancelled: false, exitCode: -1 };
    if (result.error) return { success: false, logs: result.logs || [], assertions: result.assertions || [], error: `Python execution failed: ${result.error}`, cancelled: result.cancelled || false, exitCode: result.exitCode ?? 1 };

    if (result.modifiedVariables && Object.keys(result.modifiedVariables).length > 0) {
      for (const [key, value] of Object.entries(result.modifiedVariables)) {
        try { await vdApi.variables.set(key, value); } catch { /* best effort */ }
      }
    }
    return { success: Boolean(result.success), logs: result.logs || [], assertions: result.assertions || [], error: result.success === false ? 'Python execution failed' : result.error, cancelled: result.cancelled || false, exitCode: result.exitCode ?? (result.success ? 0 : 1), modifiedRequest: result.modifiedRequest, modifiedResponse: result.modifiedResponse };
  } catch (error: any) {
    return { success: false, logs: [], error: `Python execution failed: ${error.message || String(error)}`, cancelled: false, exitCode: -1 };
  }
}

// ---------------------------------------------------------------------------
// Node.js execution  →  ext:voiden-scripting:script:executeNode
// ---------------------------------------------------------------------------
async function executeNodeScript(scriptBody: string, vdApi: VdApi): Promise<ScriptExecutionResult> {
  const { envVars, variables } = await preloadEnvAndVariables();

  try {
    const result = await (window as any).electron?.ipc?.invoke(
      'ext:voiden-scripting:script:executeNode',
      { scriptBody, nodeHostWrapper: nodeHostWrapperSource, workerSource,
        request: vdApi.request, response: vdApi.response, envVars, variables },
    );

    if (!result) return { success: false, logs: [], error: 'Node.js execution bridge unavailable', cancelled: false, exitCode: -1 };
    if (result.error) return { success: false, logs: result.logs || [], assertions: result.assertions || [], error: `Script execution failed: ${result.error}`, cancelled: result.cancelled || false, exitCode: result.exitCode ?? 1 };

    if (result.modifiedVariables && Object.keys(result.modifiedVariables).length > 0) {
      for (const [key, value] of Object.entries(result.modifiedVariables)) {
        try { await vdApi.variables.set(key, value); } catch { /* best effort */ }
      }
    }
    return { success: Boolean(result.success), logs: result.logs || [], assertions: result.assertions || [], error: result.success === false ? 'Script execution failed' : result.error, cancelled: result.cancelled || false, exitCode: result.exitCode ?? (result.success ? 0 : 1), modifiedRequest: result.modifiedRequest, modifiedResponse: result.modifiedResponse };
  } catch (error: any) {
    return { success: false, logs: [], error: `Script execution failed: ${error.message || String(error)}`, cancelled: false, exitCode: -1 };
  }
}

// ---------------------------------------------------------------------------
// Shell execution  →  ext:voiden-scripting:script:executeShell
// Builds the bash script here (template literals work freely in TS), then
// sends it to the dedicated main-process shell runner via plugin IPC.
// ---------------------------------------------------------------------------
async function executeShellScript(scriptBody: string, vdApi: VdApi): Promise<ScriptExecutionResult> {
  const { envVars, variables } = await preloadEnvAndVariables();

  // Placeholder paths are replaced by the main-process runner with real tmpDir paths.
  // scriptBody is passed separately so the main-process writes it to its own file
  // and sources it — this way bash syntax errors in user code don't abort the wrapper.
  const bashScript = buildBashScript({
    request: vdApi.request,
    response: vdApi.response,
    envVars,
    variables,
    logFile: '__VD_LOG__',
    varFile: '__VD_VAR__',
    assertFile: '__VD_ASSERT__',
    cancelFile: '__VD_CANCEL__',
    reqFile: '__VD_REQUEST__',
    respFile: '__VD_RESPONSE__',
    userScriptFile: '__VD_USERSCRIPT__',
  });

  try {
    const result = await (window as any).electron?.ipc?.invoke(
      'ext:voiden-scripting:script:executeShell',
      { bashScript, scriptBody },
    );

    if (!result) return { success: false, logs: [], error: 'Shell execution bridge unavailable', cancelled: false, exitCode: -1 };
    if (result.error) return { success: false, logs: result.logs || [], assertions: result.assertions || [], error: result.error, cancelled: result.cancelled || false, exitCode: result.exitCode ?? 1 };

    if (result.modifiedVariables && Object.keys(result.modifiedVariables).length > 0) {
      for (const [key, value] of Object.entries(result.modifiedVariables)) {
        try { await vdApi.variables.set(key, value); } catch { /* best effort */ }
      }
    }
    return { success: Boolean(result.success), logs: result.logs || [], assertions: result.assertions || [], error: result.success === false ? 'Shell execution failed' : result.error, cancelled: result.cancelled || false, exitCode: result.exitCode ?? (result.success ? 0 : 1), modifiedRequest: result.modifiedRequest, modifiedResponse: result.modifiedResponse };
  } catch (error: any) {
    return { success: false, logs: [], error: `Shell execution failed: ${error.message || String(error)}`, cancelled: false, exitCode: -1 };
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
/**
 * Execute a script string with the voiden API available as `voiden` / `vd`.
 * JavaScript: ext:voiden-scripting:script:executeNode (Worker/in-process fallback if unavailable).
 * Python: ext:voiden-scripting:script:executePython
 * Shell: ext:voiden-scripting:script:executeShell (dedicated bash runner, no intermediate Node)
 *
 * All languages pre-load env vars and variables — no await needed inside scripts.
 */
export async function executeScript(
  scriptBody: string,
  vdApi: VdApi,
  language: ScriptLanguage = 'javascript'
): Promise<ScriptExecutionResult> {
  if (language === 'python') return executePythonScript(scriptBody, vdApi);
  if (language === 'shell') return executeShellScript(scriptBody, vdApi);

  // JavaScript — try Node.js subprocess first (enables require/import)
  if ((window as any).electron?.ipc?.invoke) return executeNodeScript(scriptBody, vdApi);

  // Fallback: Web Worker (no require support)
  if (typeof Worker === 'undefined') return executeScriptInProcess(scriptBody, vdApi);

  const { envVars: envData, variables: variablesData } = await preloadEnvAndVariables();
  const logs: ScriptLog[] = [];
  const blob = new Blob([workerSource], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);

  return new Promise<ScriptExecutionResult>((resolve) => {
    let settled = false;
    const finish = (result: ScriptExecutionResult) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ success: false, logs, error: `Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`, cancelled: false, exitCode: -1 });
    }, SCRIPT_TIMEOUT_MS);

    worker.onmessage = async (event: MessageEvent<WorkerToHostMessage>) => {
      const message = event.data;
      if (message.type === 'log') { logs.push({ level: 'log', args: message.args }); return; }
      if (message.type === 'done') {
        clearTimeout(timeout);
        const modifiedVars = (message as any).modifiedVariables || {};
        for (const [key, value] of Object.entries(modifiedVars)) {
          try { await vdApi.variables.set(key, value); } catch { /* best effort */ }
        }
        finish({ success: message.success, logs: message.logs ?? logs, assertions: message.assertions || [], cancelled: message.cancelled, error: message.error, exitCode: message.success ? 0 : 1, modifiedRequest: message.modifiedRequest, modifiedResponse: message.modifiedResponse });
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeout);
      finish({ success: false, logs, error: error.message || 'Worker execution failed', cancelled: false, exitCode: -1 });
    };

    worker.postMessage({ type: 'start', script: scriptBody, request: vdApi.request, response: vdApi.response, envData, variablesData });
  });
}
