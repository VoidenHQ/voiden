import React from "react";

export const PreScriptHelp = () => (
  <div className="text-xs space-y-2">
    <p className="font-semibold">Pre-Request Script</p>
    <p>Runs before the request is sent. Modify headers, URL, body, or cancel the request.</p>
    <div className="space-y-1 font-mono text-[11px]">
      <p className="font-semibold text-comment">Language</p>
      <p>JavaScript, Python, or Shell (bash)</p>
      <p className="font-semibold text-comment mt-2">voiden.request (JS / Python)</p>
      <p>voiden.request.url — Read/write URL</p>
      <p>voiden.request.method — Read/write method</p>
      <p>voiden.request.headers — Accepts object map, single {'{key,value}'}, or array of {'{key,value}'} (push supported)</p>
      <p>voiden.request.body — Read/write body (string payload; stringify objects/JSON)</p>
      <p>voiden.request.queryParams — Accepts object map, single {'{key,value}'}, or array of {'{key,value}'}</p>
      <p>voiden.request.pathParams — Accepts object map, single {'{key,value}'}, or array of {'{key,value}'}</p>
      <p className="font-semibold text-comment mt-2">voiden.env / voiden.variables (JS / Python)</p>
      <p>voiden.env.get(key) — synchronous in all languages</p>
      <p>voiden.variables.get(key) / .set(key, val) — synchronous in all languages</p>
      <p className="font-semibold text-comment mt-2">Utilities (JS / Python)</p>
      <p>voiden.log(message) or voiden.log(level, ...args) — level: log/info/debug/warn/error</p>
      <p>voiden.assert(actual, operator, expected, message?) — e.g. voiden.assert(status, "==", 200)</p>
      <p>voiden.cancel() — Cancel the request</p>
      <p className="font-semibold text-comment mt-2">Shell (bash) API</p>
      <p>Same voiden.* dot-notation as JS/Python — bash supports dot function names:</p>
      <p>voiden.log "hello" or voiden.log warn "oops"</p>
      <p>voiden.env.get KEY — prints env value</p>
      <p>voiden.variables.get KEY / voiden.variables.set KEY VALUE</p>
      <p>voiden.assert ACTUAL OPERATOR EXPECTED [MESSAGE]</p>
      <p>voiden.cancel</p>
      <p>voiden.request.url — getter; voiden.request.url "https://new.com" — setter</p>
      <p>voiden.request.method / .body / .headers / .queryParams / .pathParams</p>
      <p>voiden.response.status / .statusText / .body / .headers / .time / .size</p>
      <p className="text-comment mt-1">Also available: $VOIDEN_REQUEST_URL, $VOIDEN_RESPONSE_STATUS, etc.</p>
    </div>
  </div>
);

export const PostScriptHelp = () => (
  <div className="text-xs space-y-2">
    <p className="font-semibold">Post-Response Script</p>
    <p>Runs after the response is received. Read response data and store variables.</p>
    <div className="space-y-1 font-mono text-[11px]">
      <p className="font-semibold text-comment">Language</p>
      <p>JavaScript, Python, or Shell (bash)</p>
      <p className="font-semibold text-comment mt-2">voiden.response (JS / Python)</p>
      <p>voiden.response.status — Status code</p>
      <p>voiden.response.statusText — Status text</p>
      <p>voiden.response.headers — Response headers object</p>
      <p>voiden.response.body — Parsed response body</p>
      <p>voiden.response.time — Duration in ms</p>
      <p>voiden.response.size — Size in bytes</p>
      <p className="font-semibold text-comment mt-2">voiden.request (read-only, JS / Python)</p>
      <p>voiden.request.url, .method, .headers, .body (string payload; stringify objects/JSON)</p>
      <p className="font-semibold text-comment mt-2">voiden.env / voiden.variables (JS / Python)</p>
      <p>voiden.env.get(key) — synchronous in all languages</p>
      <p>voiden.variables.get(key) / .set(key, val) — synchronous in all languages</p>
      <p className="font-semibold text-comment mt-2">Utilities (JS / Python)</p>
      <p>voiden.log(message) or voiden.log(level, ...args) — level: log/info/debug/warn/error</p>
      <p>voiden.assert(actual, operator, expected, message?) — e.g. voiden.assert(status, "==", 200)</p>
      <p className="font-semibold text-comment mt-2">Shell (bash) API</p>
      <p>Same voiden.* dot-notation as JS/Python:</p>
      <p>voiden.response.status / .statusText / .body / .headers / .time / .size</p>
      <p>voiden.request.url / .method / .body (read-only in post-script)</p>
      <p>voiden.variables.get KEY / voiden.variables.set KEY VALUE</p>
      <p>voiden.log [level] message / voiden.assert ACTUAL OP EXPECTED [MSG]</p>
      <p className="text-comment mt-1">Also available: $VOIDEN_RESPONSE_STATUS, $VOIDEN_RESPONSE_BODY, etc.</p>
    </div>
  </div>
);
