/* eslint-disable @typescript-eslint/no-explicit-any -- walks untyped ProseMirror response JSON */
/**
 * Pure helpers behind the response panel's Compare mode: snapshot a response doc into a
 * comparable run, then diff two runs' headers and body (by JSON path, or line by line).
 */

export interface ResponseHeader {
  key: string;
  value: string;
}

export interface ResponseRun {
  /** Increasing per request section, shown as "#N" */
  id: number;
  timestamp: number;
  /** "file" = the response saved in the .void file, loaded when the tab opened */
  source: "live" | "file";
  status?: number;
  statusMessage?: string;
  elapsedMs?: number;
  url?: string | null;
  /** HTTP method that produced this response, e.g. "GET" */
  method?: string;
  contentType?: string | null;
  headers: ResponseHeader[];
  /** Body as text, or null when there was none */
  bodyText: string | null;
  /** UTF-8 size of the body */
  bytes: number;
  binary: boolean;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

function findNode(node: any, type: string): any | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const hit = findNode(child, type);
      if (hit) return hit;
    }
  }
  return null;
}

function decodeBytes(bytes: Uint8Array): { text: string; binary: boolean } {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { text, binary: text.includes("\u0000") || text.includes("\uFFFD") };
}

export function bodyToText(body: unknown): { text: string | null; binary: boolean } {
  if (body === null || body === undefined) return { text: null, binary: false };
  if (typeof body === "string") return { text: body, binary: false };
  if (body instanceof Uint8Array) return decodeBytes(body);
  if (body instanceof ArrayBuffer) return decodeBytes(new Uint8Array(body));
  if (typeof body === "object" && (body as any).type === "Buffer" && Array.isArray((body as any).data)) {
    return decodeBytes(Uint8Array.from((body as any).data));
  }
  try {
    return { text: JSON.stringify(body, null, 2), binary: false };
  } catch {
    return { text: String(body), binary: false };
  }
}

/** Turn a response doc (as stored in responseStore) into a run, or null if it has no HTTP body node. */
export function snapshotRun(doc: any, id: number, source: ResponseRun["source"], timestamp = Date.now()): ResponseRun | null {
  const responseDoc = findNode(doc, "response-doc");
  const bodyNode = findNode(doc, "response-body");
  if (!bodyNode) return null;

  const attrs = { ...(responseDoc?.attrs ?? {}), ...(doc?.attrs ?? {}) };
  const headersNode = findNode(doc, "response-headers");
  const headers: ResponseHeader[] = Array.isArray(headersNode?.attrs?.headers)
    ? headersNode.attrs.headers
        .filter((h: any) => h && h.key)
        .map((h: any) => ({ key: String(h.key), value: String(h.value ?? "") }))
    : [];

  const requestNode = findNode(doc, "request-headers");
  const method = requestNode?.attrs?.method || attrs.requestMeta?.method || undefined;
  const { text, binary } = bodyToText(bodyNode.attrs?.body);
  return {
    id,
    timestamp,
    source,
    status: typeof attrs.statusCode === "number" ? attrs.statusCode : undefined,
    statusMessage: attrs.statusMessage ?? undefined,
    elapsedMs: typeof attrs.elapsedTime === "number" ? attrs.elapsedTime : undefined,
    url: attrs.url ?? requestNode?.attrs?.url ?? null,
    method: method ? String(method).toUpperCase() : undefined,
    contentType: bodyNode.attrs?.contentType ?? null,
    headers,
    bodyText: text,
    bytes: text ? new TextEncoder().encode(text).length : 0,
    binary,
  };
}

// ─── Volatile values (change on every call) ──────────────────────────────────

const VOLATILE_HEADERS = new Set([
  "date", "age", "expires", "last-modified", "etag", "set-cookie",
  "x-request-id", "x-correlation-id", "x-trace-id", "traceparent", "x-amzn-requestid", "x-amz-cf-id",
  "cf-ray", "x-runtime", "x-response-time", "server-timing",
]);

export function isVolatileHeader(key: string): boolean {
  const k = key.toLowerCase();
  return VOLATILE_HEADERS.has(k) || k.startsWith("x-ratelimit-") || k.startsWith("ratelimit-");
}

const VOLATILE_KEY = /^(timestamp|time|now|date|created_?at|updated_?at|last_?login|last_?seen|expires_?at|request_?id|trace_?id|correlation_?id|nonce|etag)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ID_LIKE = /^(req|trace|corr|evt)_[A-Za-z0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Values that are expected to differ between runs (timestamps, request IDs). */
export function isVolatileField(key: string | number | null, a: unknown, b: unknown): boolean {
  if (typeof key === "string" && VOLATILE_KEY.test(key)) return true;
  const bothMatch = (re: RegExp) => typeof a === "string" && typeof b === "string" && re.test(a) && re.test(b);
  return bothMatch(ISO_DATE) || bothMatch(ID_LIKE) || (typeof key === "string" && /id$/i.test(key) && bothMatch(UUID));
}

// ─── Headers ─────────────────────────────────────────────────────────────────

export type ChangeKind = "same" | "added" | "removed" | "changed" | "ignored";

export interface HeaderChange {
  key: string;
  kind: ChangeKind;
  a?: string;
  b?: string;
}

function headerMap(headers: ResponseHeader[]): Map<string, { key: string; value: string }> {
  const map = new Map<string, { key: string; value: string }>();
  for (const h of headers) {
    const k = h.key.toLowerCase();
    const prev = map.get(k);
    map.set(k, prev ? { key: prev.key, value: `${prev.value}, ${h.value}` } : { key: h.key, value: h.value });
  }
  return map;
}

export function diffHeaders(a: ResponseHeader[], b: ResponseHeader[], ignoreVolatile: boolean): HeaderChange[] {
  const A = headerMap(a);
  const B = headerMap(b);
  const keys = [...new Set([...B.keys(), ...A.keys()])];
  return keys.map((k) => {
    const ha = A.get(k);
    const hb = B.get(k);
    const key = (hb ?? ha)!.key;
    if (!ha) return { key, kind: "added", b: hb!.value };
    if (!hb) return { key, kind: "removed", a: ha.value };
    if (ha.value === hb.value) return { key, kind: "same", a: ha.value, b: hb.value };
    return { key, kind: ignoreVolatile && isVolatileHeader(k) ? "ignored" : "changed", a: ha.value, b: hb.value };
  });
}

// ─── Semantic (JSON path) diff ───────────────────────────────────────────────

export type SemNode =
  | { t: "container"; key: string | number | null; arr: boolean; children: SemNode[]; changes: number }
  | { t: "leaf"; key: string | number | null; kind: ChangeKind; a?: unknown; b?: unknown };

const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function diffJson(a: unknown, b: unknown, ignoreVolatile: boolean, key: string | number | null = null): SemNode {
  const bothArr = Array.isArray(a) && Array.isArray(b);
  const bothObj = isPlainObj(a) && isPlainObj(b);
  if (bothArr || bothObj) {
    const keys: Array<string | number> = bothArr
      ? [...Array(Math.max((a as unknown[]).length, (b as unknown[]).length)).keys()]
      : [...new Set([...Object.keys(b as object), ...Object.keys(a as object)])];
    const children = keys.map((k): SemNode => {
      const inA = bothArr ? (k as number) < (a as unknown[]).length : Object.prototype.hasOwnProperty.call(a, k);
      const inB = bothArr ? (k as number) < (b as unknown[]).length : Object.prototype.hasOwnProperty.call(b, k);
      const va = (a as any)[k];
      const vb = (b as any)[k];
      if (inA && inB) return diffJson(va, vb, ignoreVolatile, k);
      if (inB) return { t: "leaf", key: k, kind: "added", b: vb };
      return { t: "leaf", key: k, kind: "removed", a: va };
    });
    // Real changes only: ignored (volatile) values don't keep a subtree from folding.
    const changes = children.reduce(
      (n, c) => n + (c.t === "container" ? c.changes : c.kind === "same" || c.kind === "ignored" ? 0 : 1),
      0,
    );
    return { t: "container", key, arr: bothArr, children, changes };
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return { t: "leaf", key, kind: "same", a, b };
  const kind: ChangeKind = ignoreVolatile && isVolatileField(key, a, b) ? "ignored" : "changed";
  return { t: "leaf", key, kind, a, b };
}

export interface ChangeCounts {
  added: number;
  removed: number;
  changed: number;
  ignored: number;
}

export const emptyCounts = (): ChangeCounts => ({ added: 0, removed: 0, changed: 0, ignored: 0 });

export function countSem(node: SemNode, into: ChangeCounts = emptyCounts()): ChangeCounts {
  if (node.t === "container") node.children.forEach((c) => countSem(c, into));
  else if (node.kind !== "same") into[node.kind]++;
  return into;
}

export function countKinds(kinds: ChangeKind[], into: ChangeCounts = emptyCounts()): ChangeCounts {
  for (const k of kinds) if (k !== "same") into[k]++;
  return into;
}

// ─── Line diff ───────────────────────────────────────────────────────────────

export type LineOp =
  | { t: "same" | "ignored"; a: string; b: string; ai: number; bi: number }
  | { t: "added"; b: string; bi: number }
  | { t: "removed"; a: string; ai: number }
  | { t: "changed"; a: string; b: string; ai: number; bi: number };

const LINE_KV = /^(\s*"([^"\\]*(?:\\.[^"\\]*)*)":\s*)(.*?)(,?)$/;

/** Replace a volatile value on a pretty-printed JSON line with a placeholder, so the two sides compare equal. */
function normalizeLine(line: string): string {
  const m = line.match(LINE_KV);
  if (!m) return line;
  let value: unknown;
  try {
    value = JSON.parse(m[3]);
  } catch {
    return line;
  }
  return isVolatileField(m[2], value, value) || (typeof value === "string" && (ISO_DATE.test(value) || ID_LIKE.test(value)))
    ? `${m[1]}\u0000${m[4]}`
    : line;
}

/** Cap on the LCS table (rows × cols) — beyond this the middle is shown as a block replace. */
const MAX_CELLS = 4_000_000;

export function diffLines(aText: string, bText: string, ignoreVolatile: boolean): LineOp[] {
  const A = aText.split("\n");
  const B = bText.split("\n");
  const nA = ignoreVolatile ? A.map(normalizeLine) : A;
  const nB = ignoreVolatile ? B.map(normalizeLine) : B;

  const raw: LineOp[] = [];
  const eq = (i: number, j: number): LineOp =>
    ({ t: A[i] === B[j] ? "same" : "ignored", a: A[i], b: B[j], ai: i + 1, bi: j + 1 });

  // Trim the common prefix and suffix first; responses usually differ in a few places.
  let start = 0;
  while (start < A.length && start < B.length && nA[start] === nB[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && nA[endA - 1] === nB[endB - 1]) { endA--; endB--; }

  for (let i = 0; i < start; i++) raw.push(eq(i, i));

  const rows = endA - start;
  const cols = endB - start;
  if (rows * cols > MAX_CELLS) {
    for (let i = start; i < endA; i++) raw.push({ t: "removed", a: A[i], ai: i + 1 });
    for (let j = start; j < endB; j++) raw.push({ t: "added", b: B[j], bi: j + 1 });
  } else if (rows > 0 || cols > 0) {
    const width = cols + 1;
    const L = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        L[i * width + j] = nA[start + i] === nB[start + j]
          ? L[(i + 1) * width + j + 1] + 1
          : Math.max(L[(i + 1) * width + j], L[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows || j < cols) {
      if (i < rows && j < cols && nA[start + i] === nB[start + j]) {
        raw.push(eq(start + i, start + j));
        i++; j++;
      } else if (j < cols && (i >= rows || L[i * width + j + 1] >= L[(i + 1) * width + j])) {
        raw.push({ t: "added", b: B[start + j], bi: start + j + 1 });
        j++;
      } else {
        raw.push({ t: "removed", a: A[start + i], ai: start + i + 1 });
        i++;
      }
    }
  }

  for (let k = 0; k < A.length - endA; k++) raw.push(eq(endA + k, endB + k));

  // Pair each run of removals with the additions next to it, as changed lines.
  const out: LineOp[] = [];
  for (let k = 0; k < raw.length;) {
    const op = raw[k];
    if (op.t !== "added" && op.t !== "removed") { out.push(op); k++; continue; }
    const removed: Extract<LineOp, { t: "removed" }>[] = [];
    const added: Extract<LineOp, { t: "added" }>[] = [];
    while (k < raw.length && (raw[k].t === "added" || raw[k].t === "removed")) {
      const r = raw[k++];
      if (r.t === "removed") removed.push(r);
      else if (r.t === "added") added.push(r);
    }
    for (let x = 0; x < Math.max(removed.length, added.length); x++) {
      const d = removed[x];
      const a = added[x];
      if (d && a) out.push({ t: "changed", a: d.a, b: a.b, ai: d.ai, bi: a.bi });
      else out.push((d ?? a)!);
    }
  }
  return out;
}

// ─── Folding unchanged lines ─────────────────────────────────────────────────

/** Unchanged lines kept visible on each side of a change. */
export const FOLD_CONTEXT = 3;

export type LineBlock = { op: LineOp } | { fold: number; ignored: number; start: number };

/**
 * Collapse long stretches of unchanged lines into fold blocks. Ignored (volatile) lines
 * count as unchanged, otherwise a timestamp in every array item would split each
 * stretch too short to fold. `open` holds the start index of folds the user expanded.
 */
export function foldLineOps(ops: LineOp[], showUnchanged: boolean, open: Set<number> = new Set()): LineBlock[] {
  if (showUnchanged) return ops.map((op) => ({ op }));
  const quiet = (op: LineOp) => op.t === "same" || op.t === "ignored";
  const out: LineBlock[] = [];
  for (let k = 0; k < ops.length;) {
    if (quiet(ops[k])) {
      let e = k;
      while (e < ops.length && quiet(ops[e])) e++;
      const from = k === 0 ? 0 : k + FOLD_CONTEXT;
      const to = e === ops.length ? e : e - FOLD_CONTEXT;
      if (to - from > 2 && !open.has(k)) {
        for (let x = k; x < from; x++) out.push({ op: ops[x] });
        const ignored = ops.slice(from, to).filter((o) => o.t === "ignored").length;
        out.push({ fold: to - from, ignored, start: k });
        for (let x = to; x < e; x++) out.push({ op: ops[x] });
        k = e;
        continue;
      }
    }
    out.push({ op: ops[k++] });
  }
  return out;
}

/** The differing middle of two strings, as [prefixLength, suffixLength]. */
export function inlineRange(a: string, b: string): [number, number] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [p, s];
}

/** Pretty-print JSON bodies so formatting differences don't show up as line changes. */
export function parseJsonBody(text: string | null): { ok: true; value: unknown } | { ok: false } {
  if (text === null) return { ok: false };
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

export function bodyForLines(text: string | null): string {
  if (text === null) return "";
  const parsed = parseJsonBody(text);
  return parsed.ok ? JSON.stringify(parsed.value, null, 2) : text;
}
