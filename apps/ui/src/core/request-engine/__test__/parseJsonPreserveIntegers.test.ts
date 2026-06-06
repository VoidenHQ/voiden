import { describe, expect, it } from "vitest";
import { parseJsonPreserveIntegers } from "../parseJsonPreserveIntegers";

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

  it("preserves large IDs in nested response arrays (#408)", () => {
    const parsed = parseJsonPreserveIntegers(
      '{"response":[{"big_number_id":333333333333333333}]}',
    ) as { response: Array<{ big_number_id: string }> };
    expect(parsed.response[0].big_number_id).toBe("333333333333333333");
  });

  it("preserves string-serialized large IDs in nested response arrays (#408)", () => {
    const parsed = parseJsonPreserveIntegers(
      '{"response":[{"big_number_id":"333333333333333333"}]}',
    ) as { response: Array<{ big_number_id: string }> };
    expect(parsed.response[0].big_number_id).toBe("333333333333333333");
  });
});
