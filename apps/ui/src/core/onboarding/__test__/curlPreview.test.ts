import { describe, expect, it } from "vitest";
import { parseCurl, planEnv, rewriteCurl } from "../curlPreview";
import type { EnvTarget } from "../envTree";

const target = (existing: Record<string, string> = {}): EnvTarget => ({
  segments: ["local"],
  label: "Local",
  createEnv: false,
  needsActivate: false,
  existing,
});

const CURL = `curl -X POST https://api.example.com/v1/users \\
  -H 'Authorization: Bearer sk_live_51Hx9' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Ada","role":"admin"}'`;

describe("parseCurl", () => {
  it("reads method, path, file name, chips and the bearer token", () => {
    const parsed = parseCurl(CURL);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.method).toBe("POST");
    expect(parsed.path).toBe("/v1/users");
    expect(parsed.origin).toBe("https://api.example.com");
    expect(parsed.title).toBe("users");
    expect(parsed.chips).toEqual(["JSON body", "Bearer auth", "Content-Type header"]);
    expect(parsed.secrets).toEqual([{ value: "sk_live_51Hx9", label: "Authorization", kind: "token" }]);
  });

  it("defaults to GET without a body and counts query params", () => {
    const parsed = parseCurl("curl 'https://shop.dev/items?limit=2&page=3'");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.method).toBe("GET");
    expect(parsed.chips).toEqual(["2 query params"]);
    expect(parsed.secrets).toEqual([]);
  });

  it("treats api-key headers and -u as secrets, but not values that are already variables", () => {
    const parsed = parseCurl("curl https://x.io/a -H 'X-Api-Key: abc' -H 'Authorization: Bearer {{apiToken}}' -u bob:pw");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.secrets.map((s) => s.value)).toEqual(["bob:pw", "abc"]);
  });

  it("explains what's wrong with bad input", () => {
    expect(parseCurl("")).toHaveProperty("error");
    expect(parseCurl("wget https://x.io")).toHaveProperty("error");
    expect(parseCurl("curl -H 'A: b'")).toHaveProperty("error");
  });
});

describe("planEnv + rewriteCurl", () => {
  it("swaps the host and the token for variables", () => {
    const parsed = parseCurl(CURL);
    if ("error" in parsed) throw new Error(parsed.error);
    const plan = planEnv(parsed, target());
    expect(plan.baseUrlVar).toBe("baseUrl");
    expect(plan.secretVars.map((s) => s.name)).toEqual(["apiToken"]);
    const out = rewriteCurl(CURL, parsed, plan);
    expect(out).toContain("{{baseUrl}}/v1/users");
    expect(out).toContain("Bearer {{apiToken}}");
    expect(out).not.toContain("sk_live_51Hx9");
    expect(out).not.toContain("api.example.com");
  });

  it("keeps an existing baseUrl that already points at this host", () => {
    const parsed = parseCurl(CURL);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(planEnv(parsed, target({ baseUrl: "https://api.example.com" })).baseUrlVar).toBe("baseUrl");
  });

  it("picks a host-prefixed name instead of overwriting a different baseUrl", () => {
    const parsed = parseCurl(CURL);
    if ("error" in parsed) throw new Error(parsed.error);
    const plan = planEnv(parsed, target({ baseUrl: "https://echo.voiden.md", apiToken: "other" }));
    expect(plan.baseUrlVar).toBe("exampleBaseUrl");
    expect(plan.secretVars[0].name).toBe("exampleApiToken");
  });
});
