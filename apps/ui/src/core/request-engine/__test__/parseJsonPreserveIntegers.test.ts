import { describe, expect, it } from "vitest";
import {
  isStructuredJsonString,
  parseJsonPreserveIntegers,
  prettifyJsonText,
  safeJsonParse,
  stringifyJsonForDisplay,
} from "../parseJsonPreserveIntegers";

describe("parseJsonPreserveIntegers", () => {
  it("preserves integers larger than MAX_SAFE_INTEGER as strings (#395)", () => {
    const parsed = parseJsonPreserveIntegers(
      '{"args":{"id":174322306148984899}}',
    ) as { args: { id: string } };
    expect(parsed.args.id).toBe("174322306148984899");
  });

  it("keeps safe integers as numbers", () => {
    const parsed = parseJsonPreserveIntegers('{"count":42}') as { count: number };
    expect(parsed.count).toBe(42);
  });

  it("does not alter strings that look like numbers", () => {
    const parsed = parseJsonPreserveIntegers('{"id":"174322306148984899"}') as {
      id: string;
    };
    expect(parsed.id).toBe("174322306148984899");
  });

  it("preserves negative integers beyond MAX_SAFE_INTEGER", () => {
    const parsed = parseJsonPreserveIntegers('{"delta":-9007199254740993}') as {
      delta: string;
    };
    expect(parsed.delta).toBe("-9007199254740993");
  });

  it("preserves unsafe integers inside arrays", () => {
    const parsed = parseJsonPreserveIntegers('{"ids":[9007199254740993,42]}') as {
      ids: Array<string | number>;
    };
    expect(parsed.ids[0]).toBe("9007199254740993");
    expect(parsed.ids[1]).toBe(42);
  });
});

describe("safeJsonParse", () => {
  it("only parses structured JSON strings", () => {
    expect(isStructuredJsonString('{"a":1}')).toBe(true);
    expect(isStructuredJsonString("[1]")).toBe(true);
    expect(isStructuredJsonString("333333333333333333")).toBe(false);
    expect(safeJsonParse("333333333333333333")).toBe("333333333333333333");
  });

  it("uses integer-preserving parse for objects", () => {
    const parsed = safeJsonParse('{"id":174322306148984899}') as { id: string };
    expect(parsed.id).toBe("174322306148984899");
  });
});

describe("prettifyJsonText", () => {
  it("formats JSON without corrupting string-encoded snowflake ids (#408)", () => {
    const pretty = prettifyJsonText('{"big_number_id":"333333333333333333"}');
    expect(pretty).toContain('"big_number_id"');
    expect(pretty).toContain('"333333333333333333"');
    expect(pretty).not.toContain("333333333333333300");
  });

  it("stringifyJsonForDisplay matches prettify for parsed values", () => {
    const value = parseJsonPreserveIntegers('{"n":9007199254740992}');
    expect(stringifyJsonForDisplay(value)).toContain('"9007199254740992"');
  });
});
