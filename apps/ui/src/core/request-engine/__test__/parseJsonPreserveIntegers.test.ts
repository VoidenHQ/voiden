import { describe, expect, it } from "vitest";
import {
  parseJsonPreserveIntegers,
  prettifyJsonPreserveIntegers,
  stringifyJsonForDisplay,
} from "../parseJsonPreserveIntegers";

describe("parseJsonPreserveIntegers", () => {
  it("preserves integers larger than MAX_SAFE_INTEGER as strings", () => {
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

  it("preserves multiple unsafe integers in arrays", () => {
    const parsed = parseJsonPreserveIntegers(
      '{"ids":[174322306148984899,9007199254740992]}',
    ) as { ids: [string, string] };
    expect(parsed.ids[0]).toBe("174322306148984899");
    expect(parsed.ids[1]).toBe("9007199254740992");
  });

  it("preserves negative unsafe integers", () => {
    const parsed = parseJsonPreserveIntegers('{"value":-9007199254740993}') as {
      value: string;
    };
    expect(parsed.value).toBe("-9007199254740993");
  });
});

describe("prettifyJsonPreserveIntegers", () => {
  it("formats JSON while preserving large integers", () => {
    const input = '{"args":{"id":174322306148984899}}';
    const output = prettifyJsonPreserveIntegers(input);
    expect(output).toContain('"174322306148984899"');
    expect(output).not.toContain("174322306148984900");
  });

  it("returns original text when JSON is invalid", () => {
    const input = "not-json";
    expect(prettifyJsonPreserveIntegers(input)).toBe(input);
  });
});

describe("stringifyJsonForDisplay", () => {
  it("pretty-prints parsed values", () => {
    const value = parseJsonPreserveIntegers('{"count":42}');
    expect(stringifyJsonForDisplay(value)).toBe('{\n  "count": 42\n}');
  });
});
