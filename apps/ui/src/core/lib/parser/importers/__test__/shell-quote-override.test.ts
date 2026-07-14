import { describe, it, expect } from "vitest";
import { parse } from "../shell-quote-override.ts";

// Regression tests for the curl importer distorting URLs/headers/bodies
// that reference shell environment variables (e.g. $AMBER_ADMIN_URL).
//
// curl.ts always calls parse(rawData, undefined, undefined) -- it's
// importing a pasted command, not executing it in a real shell, so there
// is never a real env map available. Previously, any $VAR with no
// matching env entry silently became an empty string, which visibly
// distorted the parsed URL/header/body. Unresolved variables should now
// be preserved as literal text instead.

describe("shell-quote-override parse()", () => {
  it("preserves a bare $VAR reference when no env is supplied", () => {
    const result = parse("curl $AMBER_URL/path", undefined, undefined);
    expect(result).toEqual(["curl", "$AMBER_URL/path"]);
  });

  it("preserves a braced ${VAR} reference when no env is supplied", () => {
    const result = parse("curl ${AMBER_URL}/path", undefined, undefined);
    expect(result).toEqual(["curl", "${AMBER_URL}/path"]);
  });

  it("preserves multiple shell variables inside a double-quoted argument", () => {
    const result = parse(
      'curl -u "$AMBER_ADMIN_USER:$AMBER_ADMIN_PASS"',
      undefined,
      undefined,
    );
    expect(result).toEqual(["curl", "-u", "$AMBER_ADMIN_USER:$AMBER_ADMIN_PASS"]);
  });

  it("reproduces the reported issue's full URL unchanged", () => {
    const result = parse(
      'curl -X POST "$AMBER_URL/admin/consumers/<ORG_ID>/atoms"',
      undefined,
      undefined,
    );
    expect(result).toContain("$AMBER_URL/admin/consumers/<ORG_ID>/atoms");
  });

  it("still substitutes real values when an env map is supplied", () => {
    const result = parse("curl $HOST/path", { HOST: "example.com" }, undefined);
    expect(result).toEqual(["curl", "example.com/path"]);
  });

  it("still substitutes real values for a braced variable when supplied", () => {
    const result = parse("curl ${HOST}/path", { HOST: "example.com" }, undefined);
    expect(result).toEqual(["curl", "example.com/path"]);
  });

  it("mixes resolved and unresolved variables correctly in the same command", () => {
    const result = parse(
      "curl $HOST/$UNKNOWN_PATH",
      { HOST: "example.com" },
      undefined,
    );
    expect(result).toEqual(["curl", "example.com/$UNKNOWN_PATH"]);
  });
});