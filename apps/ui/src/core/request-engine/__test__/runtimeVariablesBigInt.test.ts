import { describe, expect, it, vi, beforeEach } from "vitest";
import { saveRuntimeVariables } from "../runtimeVariables";
import { parseJsonPreserveIntegers } from "../parseJsonPreserveIntegers";

describe("runtime variables with large integers", () => {
  const mergeVariables = vi.fn().mockResolvedValue(undefined);
  const getActiveEnvKey = vi.fn().mockResolvedValue("default");
  const updateGitignore = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = {
      electron: {
        variables: { mergeVariables, getActiveEnvKey },
        git: { updateGitignore },
      },
    };
  });

  it("captures large response IDs without rounding (#408)", async () => {
    const rawBody = '{"response":[{"big_number_id":333333333333333333}]}';
    const resObject = {
      body: parseJsonPreserveIntegers(rawBody),
    };

    await saveRuntimeVariables(
      undefined,
      resObject,
      [
        {
          key: "big_number_id",
          value: "{{$res.body.response[0].big_number_id}}",
          enabled: true,
        },
      ],
      "/tmp/project",
    );

    expect(mergeVariables).toHaveBeenCalledWith(
      { big_number_id: "333333333333333333" },
      "default",
    );
  });

  it("captures string-serialized large IDs without coercion (#408)", async () => {
    const rawBody = '{"response":[{"big_number_id":"333333333333333333"}]}';
    const resObject = {
      body: parseJsonPreserveIntegers(rawBody),
    };

    await saveRuntimeVariables(
      undefined,
      resObject,
      [
        {
          key: "big_number_id",
          value: "{{$res.body.response[0].big_number_id}}",
          enabled: true,
        },
      ],
      "/tmp/project",
    );

    expect(mergeVariables).toHaveBeenCalledWith(
      { big_number_id: "333333333333333333" },
      "default",
    );
  });
});
