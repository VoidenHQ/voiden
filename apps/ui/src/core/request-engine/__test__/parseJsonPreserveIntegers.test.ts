import { describe, expect, it } from "vitest";
import { parseJsonPreserveIntegers, prettifyJsonText } from "../parseJsonPreserveIntegers";

/** JSON.parse rounds this id; issue #408 requires the exact decimal string. */
const LARGE_ID = "174322306148984899";

describe("parseJsonPreserveIntegers", () => {
  it("preserves integers larger than MAX_SAFE_INTEGER as strings (#408)", () => {
    const parsed = parseJsonPreserveIntegers(
      `{"args":{"id":${LARGE_ID}}}`,
    ) as { args: { id: string } };
    expect(parsed.args.id).toBe(LARGE_ID);
    expect(JSON.parse(`{"args":{"id":${LARGE_ID}}}`).args.id).not.toBe(LARGE_ID);
  });

  it("preserves a trailing large integer before closing brace", () => {
    const parsed = parseJsonPreserveIntegers(`{"id":${LARGE_ID}}`) as {
      id: string;
    };
    expect(parsed.id).toBe(LARGE_ID);
  });

  it("keeps safe integers as numbers", () => {
    const parsed = parseJsonPreserveIntegers('{"count":42}') as { count: number };
    expect(parsed.count).toBe(42);
    expect(typeof parsed.count).toBe("number");
  });

  it("keeps MAX_SAFE_INTEGER as a number", () => {
    const max = String(Number.MAX_SAFE_INTEGER);
    const parsed = parseJsonPreserveIntegers(`{"n":${max}}`) as { n: number };
    expect(parsed.n).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("does not alter strings that look like numbers", () => {
    const parsed = parseJsonPreserveIntegers(`{"id":"${LARGE_ID}"}`) as {
      id: string;
    };
    expect(parsed.id).toBe(LARGE_ID);
  });

  it("prettifyJsonText shows large integers without rounding", () => {
    const pretty = prettifyJsonText(`{"args":{"id":${LARGE_ID}}}`);
    expect(pretty).toContain(LARGE_ID);
    expect(pretty).not.toContain("174322306148984900");
  });
});
