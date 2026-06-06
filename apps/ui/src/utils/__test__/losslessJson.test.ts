import { describe, expect, it } from "vitest";
import {
  losslessValueToString,
  parseJsonLossless,
  prettifyJsonLossless,
  stringifyJsonLossless,
} from "../losslessJson";

describe("losslessJson", () => {
  it("preserves large integers without rounding", () => {
    const json = '{"id":174322306148984899}';
    const parsed = parseJsonLossless(json) as { id: bigint };

    expect(typeof parsed.id).toBe("bigint");
    expect(parsed.id).toBe(174322306148984899n);
    expect(parsed.id.toString()).toBe("174322306148984899");
    expect(parsed.id.toString()).not.toBe("174322306148984900");

    const serialized = stringifyJsonLossless(parsed);
    expect(serialized).toContain("174322306148984899");
    expect(serialized).not.toContain("174322306148984900");
  });

  it("keeps safe integers as numbers", () => {
    const parsed = parseJsonLossless('{"count":42,"ratio":1.5}') as {
      count: number;
      ratio: number;
    };

    expect(typeof parsed.count).toBe("number");
    expect(parsed.count).toBe(42);
    expect(typeof parsed.ratio).toBe("number");
    expect(parsed.ratio).toBe(1.5);
  });

  it("prettifies JSON without losing large integer precision", () => {
    const input = '{"id":174322306148984899,"name":"test"}';
    const prettified = prettifyJsonLossless(input);

    expect(prettified).toContain("174322306148984899");
    expect(prettified).not.toContain("174322306148984900");

    const roundTrip = parseJsonLossless(prettified) as { id: bigint; name: string };
    expect(roundTrip.id).toBe(174322306148984899n);
    expect(roundTrip.name).toBe("test");
  });

  it("stringifies values for template replacement without rounding", () => {
    const value = { id: 174322306148984899n };
    expect(losslessValueToString(value)).toBe('{"id":174322306148984899}');
  });
});
