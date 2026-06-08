import { describe, it, expect } from "vitest";
import {
  isUnsafeIntegerString,
  parseJsonPreserveIntegers,
  prettifyJsonPreserveIntegers,
  stringifyJsonForDisplay,
} from "../parseJsonPreserveIntegers";

describe("parseJsonPreserveIntegers", () => {
  const BUG_CASE = "174322306148984899";

  it("detects unsafe integers via BigInt comparison", () => {
    expect(Number(BUG_CASE)).toBe(174322306148984900);
    expect(isUnsafeIntegerString(BUG_CASE)).toBe(true);
  });

  it("preserves issue #395 large integer in parsed JSON", () => {
    const json = `{"args":{"id":${BUG_CASE}}}`;
    const parsed = parseJsonPreserveIntegers(json) as { args: { id: string } };
    expect(parsed.args.id).toBe(BUG_CASE);
    expect(JSON.parse(json).args.id).toBe(174322306148984900);
  });

  it("leaves safe integers as numbers", () => {
    const parsed = parseJsonPreserveIntegers('{"n":42,"max":9007199254740991}') as {
      n: number;
      max: number;
    };
    expect(parsed.n).toBe(42);
    expect(parsed.max).toBe(9007199254740991);
  });

  it("does not alter numbers inside JSON strings", () => {
    const json = `{"s":"value ${BUG_CASE} here"}`;
    const parsed = parseJsonPreserveIntegers(json) as { s: string };
    expect(parsed.s).toBe(`value ${BUG_CASE} here`);
  });

  it("prettifies while preserving large integers without rounding", () => {
    const pretty = prettifyJsonPreserveIntegers(`{"args":{"id":${BUG_CASE}}}`);
    expect(pretty).toContain(BUG_CASE);
    expect(pretty).not.toContain("174322306148984900");
    expect(pretty).not.toContain(`"${BUG_CASE}"`);
  });

  it("stringifyJsonForDisplay unquotes preserved large integers", () => {
    const parsed = parseJsonPreserveIntegers(`{"id":${BUG_CASE}}`);
    const display = stringifyJsonForDisplay(parsed);
    expect(display).toContain(`"id": ${BUG_CASE}`);
  });

  it("preserves issue #408 snowflake ID in response array", () => {
    const json = '{"response":[{"big_number_id":333333333333333333}]}';
    const parsed = parseJsonPreserveIntegers(json) as {
      response: Array<{ big_number_id: string }>;
    };
    expect(parsed.response[0].big_number_id).toBe("333333333333333333");
  });

  it("preserves issue #408 snowflake ID when already a JSON string", () => {
    const json = '{"response":[{"big_number_id":"333333333333333333"}]}';
    const parsed = parseJsonPreserveIntegers(json) as {
      response: Array<{ big_number_id: string }>;
    };
    expect(parsed.response[0].big_number_id).toBe("333333333333333333");
  });
});
