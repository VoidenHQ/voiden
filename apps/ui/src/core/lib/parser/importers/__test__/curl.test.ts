import { describe, it, expect } from "vitest";
import { convert } from "../curl.ts";

// Regression tests for the full convert() pipeline (parse() -> curl.ts's own
// token post-processing -> ImportRequest). shell-quote-override.ts's parse()
// was fixed in isolation to preserve unresolved $VAR/${VAR} references
// instead of blanking them, but curl.ts had its own untouched post-processing
// step that unconditionally stripped a leading "$" from any string token.
// Before the parser fix, no token could legitimately start with "$" (every
// "$" was already consumed during parsing), so that stripping was
// effectively a no-op. After the parser fix, it silently re-broke the same
// preserved variables it was supposed to protect -- these tests exercise the
// real code path from the reported issue (convert(), not parse() alone) so
// that interaction can't regress silently again.

describe("curl.ts convert()", () => {
  it("preserves a shell variable in the URL instead of distorting it", async () => {
    const cmd = `curl -X POST "$AMBER_URL/admin/consumers/<ORG_ID>/atoms"`;
    const [request] = (await convert(cmd))!;
    // Host casing is normalized by the URL API itself (hostnames are
    // case-insensitive per spec) -- what matters is the variable reference
    // itself survives, rather than disappearing or being partially stripped.
    expect((request.url ?? "").toLowerCase()).toBe("http://$amber_url/admin/consumers/%3corg_id%3e/atoms");
  });

  it("preserves shell variables consistently across both username and password", async () => {
    const cmd = `curl -u "$AMBER_ADMIN_USER:$AMBER_ADMIN_PASS" -X POST "https://example.com"`;
    const [request] = (await convert(cmd))!;
    expect(request.authentication?.username).toBe("$AMBER_ADMIN_USER");
    expect(request.authentication?.password).toBe("$AMBER_ADMIN_PASS");
  });

  it("reproduces the reported issue's full command end-to-end", async () => {
    const cmd = `curl -u "$AMBER_ADMIN_USER:$AMBER_ADMIN_PASS" -X POST "$AMBER_URL/admin/consumers/<ORG_ID>/atoms" -H 'Content-Type: application/json' -d '{"atoms": 123456778, "topup_id": "free"}'`;
    const [request] = (await convert(cmd))!;

    expect((request.url ?? "").toLowerCase()).toBe("http://$amber_url/admin/consumers/%3corg_id%3e/atoms");
    expect(request.authentication?.username).toBe("$AMBER_ADMIN_USER");
    expect(request.authentication?.password).toBe("$AMBER_ADMIN_PASS");
    expect(request.method).toBe("POST");
    expect(request.body?.text).toBe('{"atoms": 123456778, "topup_id": "free"}');
  });

  it("does not strip a literal, non-variable leading $ character in a value", async () => {
    // Bareword/body text that happens to start with a literal "$" (not a
    // variable reference at all, e.g. a currency amount) must not be
    // mistaken for the variable-stripping case either.
    const cmd = `curl -X POST "https://example.com" -H 'X-Price: $5'`;
    const [request] = (await convert(cmd))!;
    const priceHeader = request.headers?.find((h) => h.name === "X-Price");
    expect(priceHeader?.value).toBe("$5");
  });

  it("still substitutes real values when the command has no unresolved variables", async () => {
    const cmd = `curl -X GET "https://example.com/health"`;
    const [request] = (await convert(cmd))!;
    expect(request.url).toBe("https://example.com/health");
  });
});
