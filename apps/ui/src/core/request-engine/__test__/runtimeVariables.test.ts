import { describe, expect, it } from "vitest";
import { getValueByPath } from "../runtimeVariables";
import { parseJsonPreserveIntegers } from "../parseJsonPreserveIntegers";

describe("runtime variable path extraction", () => {
  it("extracts large integer IDs without precision loss for issue #408", () => {
    const responseBody = parseJsonPreserveIntegers(
      '{"response":[{"big_number_id":333333333333333333}]}',
    );

    const value = getValueByPath(
      { body: responseBody },
      "body.response[0].big_number_id",
    );

    expect(value).toBe("333333333333333333");
  });

  it("extracts quoted large integer strings unchanged for issue #408", () => {
    const responseBody = parseJsonPreserveIntegers(
      '{"response":[{"big_number_id":"333333333333333333"}]}',
    );

    const value = getValueByPath(
      { body: responseBody },
      "body.response[0].big_number_id",
    );

    expect(value).toBe("333333333333333333");
  });
});
