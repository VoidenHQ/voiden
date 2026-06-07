import { describe, expect, it } from "vitest";
import { getValueByPath, safeJsonParse } from "../runtimeVariables";

describe("runtimeVariables big integer handling", () => {
  it("safeJsonParse leaves bare big integer strings unchanged", () => {
    expect(safeJsonParse("333333333333333333")).toBe("333333333333333333");
  });

  it("safeJsonParse preserves large integers inside JSON objects", () => {
    const parsed = safeJsonParse('{"id":333333333333333333}') as {
      id: string;
    };
    expect(parsed.id).toBe("333333333333333333");
    expect(typeof parsed.id).toBe("string");
  });

  it("getValueByPath resolves nested large integer fields", () => {
    const res = {
      body: { args: { id: "174322306148984899" } },
    };
    expect(getValueByPath(res, "body.args.id")).toBe("174322306148984899");
  });

  it("getValueByPath parses stringified JSON without rounding big ints", () => {
    const res = {
      body: '{"args":{"id":333333333333333333}}',
    };
    expect(getValueByPath(res, "body.args.id")).toBe("333333333333333333");
  });
});
