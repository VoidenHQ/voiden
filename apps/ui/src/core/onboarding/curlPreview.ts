import type { EnvTarget } from "./envTree";

// ── curl parsing (preview only; the real conversion is the REST plugin's curl importer) ──

function tokenize(input: string): string[] {
  const s = input.replace(/\\\r?\n/g, " ");
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (cur || started) out.push(cur);
      cur = "";
      started = false;
    } else cur += c;
  }
  if (cur || started) out.push(cur);
  return out;
}

export type Secret = { value: string; label: string; kind: "token" | "key" | "credentials" };

export type ParsedCurl =
  | { error: string }
  | { method: string; path: string; origin: string; host: string; title: string; chips: string[]; secrets: Secret[] };

export function parseCurl(input: string): ParsedCurl {
  const t = tokenize(input.trim());
  if (!t.length) return { error: "Paste a curl command to see what it becomes." };
  if (t[0] !== "curl") return { error: 'That doesn\'t start with "curl". Paste a full curl command, or pick a file on the left.' };

  let method: string | null = null;
  let url: string | null = null;
  let data: string | null = null;
  const headers: [string, string][] = [];
  const secrets: Secret[] = [];
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (a === "-X" || a === "--request") method = (t[++i] || "").toUpperCase();
    else if (a === "-H" || a === "--header") {
      const h = t[++i] || "";
      const k = h.indexOf(":");
      if (k > 0) headers.push([h.slice(0, k).trim(), h.slice(k + 1).trim()]);
    } else if (/^(-d|--data|--data-raw|--data-binary|--json)$/.test(a)) data = t[++i] ?? "";
    else if (a === "-u" || a === "--user") {
      const v = t[++i] || "";
      if (v) secrets.push({ value: v, label: "Basic auth", kind: "credentials" });
    } else if (/^https?:\/\//.test(a)) url = a;
    else if (!a.startsWith("-") && !url && a.includes(".")) url = `https://${a}`;
  }
  if (!url) return { error: "Couldn't find a URL in that command." };

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: "That URL doesn't look valid." };
  }

  const chips: string[] = [];
  if (data != null) {
    let isJson = false;
    try {
      JSON.parse(data);
      isJson = true;
    } catch {
      /* not JSON */
    }
    chips.push(isJson ? "JSON body" : "Body");
  }
  const queryCount = [...u.searchParams.keys()].length;
  if (queryCount) chips.push(`${queryCount} query param${queryCount > 1 ? "s" : ""}`);
  for (const [k, v] of headers) {
    if (/^authorization$/i.test(k)) {
      const m = v.match(/^(bearer|basic|token)\s+(.+)$/i);
      chips.push(m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} auth` : "Auth header");
      secrets.push({ value: m ? m[2] : v, label: "Authorization", kind: "token" });
    } else if (/(api[-_]?key|token|secret)/i.test(k)) {
      chips.push(`${k} header`);
      secrets.push({ value: v, label: k, kind: "key" });
    } else chips.push(`${k} header`);
  }
  if (secrets.some((s) => s.kind === "credentials")) chips.push("Basic auth");

  const seg = u.pathname
    .split("/")
    .filter(Boolean)
    .find((x) => !/^v\d+$/i.test(x) && !/^\d+$/.test(x) && !/^\{.*\}$/.test(x));
  const title = (seg || u.hostname.split(".")[0] || "request").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();

  return {
    method: method || (data != null ? "POST" : "GET"),
    path: u.pathname + u.search,
    origin: `${u.protocol}//${u.host}`,
    host: u.host,
    title,
    chips,
    secrets: secrets.filter((s) => s.value && !/^\{\{.*\}\}$/.test(s.value)),
  };
}

// ── environment variables ──

/** Keep `preferred` unless the env already uses it for a different value; then prefix with the host, e.g. exampleBaseUrl. */
function pickVarName(existing: Record<string, string>, preferred: string, value: string, host: string) {
  if (existing[preferred] === undefined || existing[preferred] === value) return preferred;
  const prefix = host.split(".").filter((p) => !/^(www|api)$/i.test(p))[0]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "my";
  return `${prefix}${preferred[0].toUpperCase()}${preferred.slice(1)}`;
}

export type EnvPlan = { envLabel: string; baseUrlVar: string; secretVars: { secret: Secret; name: string }[] };

export function planEnv(parsed: Exclude<ParsedCurl, { error: string }>, target: EnvTarget): EnvPlan {
  const used = { ...target.existing };
  const baseUrlVar = pickVarName(used, "baseUrl", parsed.origin, parsed.host);
  used[baseUrlVar] = parsed.origin;
  const secretVars = parsed.secrets.map((secret) => {
    const preferred = secret.kind === "credentials" ? "credentials" : secret.kind === "key" ? "apiKey" : "apiToken";
    const name = pickVarName(used, preferred, secret.value, parsed.host);
    used[name] = secret.value;
    return { secret, name };
  });
  return { envLabel: target.label, baseUrlVar, secretVars };
}

/** The curl with its origin and secrets swapped for {{variables}}. */
export function rewriteCurl(curl: string, parsed: Exclude<ParsedCurl, { error: string }>, plan: EnvPlan) {
  let out = curl.replace(parsed.origin, `{{${plan.baseUrlVar}}}`);
  for (const { secret, name } of plan.secretVars) out = out.split(secret.value).join(`{{${name}}}`);
  return out;
}
