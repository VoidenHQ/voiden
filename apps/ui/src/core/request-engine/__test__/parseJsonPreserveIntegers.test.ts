import { describe, expect, it } from "vitest";
import { parseJsonPreserveIntegers, prettifyJsonText } from "../parseJsonPreserveIntegers";

const LARGE_ID = "333333333333333333";
const LARGE_ID_395 = "174322306148984899";

describe("parseJsonPreserveIntegers", () => {
  it("preserves integers larger than MAX_SAFE_INTEGER as strings (#408)", () => {
    const parsed = parseJsonPreserveIntegers(
      `{"response":[{"big_number_id":${LARGE_ID}}]}`,
    ) as { response: Array<{ big_number_id: string }> };
    expect(parsed.response[0].big_number_id).toBe(LARGE_ID);
    expect(
      JSON.parse(`{"response":[{"big_number_id":${LARGE_ID}}]}`).response[0]
        .big_number_id,
    ).not.toBe(LARGE_ID);
  });

  it("preserves nested large integers (#395)", () => {
    const parsed = parseJsonPreserveIntegers(
      `{"args":{"id":${LARGE_ID_395}}}`,
    ) as { args: { id: string } };
    expect(parsed.args.id).toBe(LARGE_ID_395);
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
    const pretty = prettifyJsonText(`{"big_number_id":${LARGE_ID}}`);
    expect(pretty).toContain(LARGE_ID);
    expect(pretty).not.toContain("333333333333333300");
  });
});
