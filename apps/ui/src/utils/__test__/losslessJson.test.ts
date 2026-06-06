import { describe, expect, it } from "vitest";
import {
  losslessValueToString,
  parseJsonLossless,
  prettifyJsonLossless,
  stringifyJsonLossless,
} from "../losslessJson";

const LARGE_ID = 174322306148984899n;
const ROUNDED_ID = 174322306148984900;

describe("losslessJson", () => {
  it("preserves integers larger than MAX_SAFE_INTEGER (issue #395)", () => {
    const parsed = parseJsonLossless(
      '{"args":{"id":174322306148984899}}',
    ) as { args: { id: bigint } };

    expect(parsed.args.id).toBe(LARGE_ID);
    expect(parsed.args.id).not.toBe(BigInt(ROUNDED_ID));
  });

  it("keeps safe integers as numbers", () => {
    const parsed = parseJsonLossless('{"count":42}') as { count: number };
    expect(parsed.count).toBe(42);
    expect(typeof parsed.count).toBe("number");
  });

  it("stringifies bigint values without rounding", () => {
    const text = stringifyJsonLossless({ args: { id: LARGE_ID } }, 2);
    expect(text).toContain("174322306148984899");
    expect(text).not.toContain(String(ROUNDED_ID));
  });

  it("prettify round-trip preserves large integers", () => {
    const raw = '{"args":{"id":174322306148984899}}';
    const pretty = prettifyJsonLossless(raw);
    expect(pretty).toContain("174322306148984899");
    expect(pretty).not.toContain(String(ROUNDED_ID));
  });

  it("losslessValueToString returns exact digits for bigint", () => {
    expect(losslessValueToString(LARGE_ID)).toBe("174322306148984899");
  });

  it("does not alter strings that look like numbers", () => {
    const parsed = parseJsonLossless('{"id":"174322306148984899"}') as {
      id: string;
    };
    expect(parsed.id).toBe("174322306148984899");
  });
});
