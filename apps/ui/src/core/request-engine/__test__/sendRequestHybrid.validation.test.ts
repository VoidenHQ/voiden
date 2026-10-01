import { describe, it, expect, beforeEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { UnresolvedVariablesError } from "@/core/request-engine/utils/collectUnresolvedVariables";

const sendSecure = vi.fn().mockResolvedValue({
  status: 200,
  statusText: "OK",
  headers: [["content-type", "application/json"]],
  body: Buffer.from(JSON.stringify({ ok: true })),
  requestMeta: { url: "https://api.example.com" },
});

const mockElectron = {
  request: { sendSecure },
  variables: {
    readMerged: vi.fn().mockResolvedValue({}),
  },
  env: {
    replaceVariables: vi.fn(async (value: string) => value),
  },
  state: {
    get: vi.fn().mockResolvedValue({ activeDirectory: "" }),
  },
};

if (typeof window !== "undefined") {
  (window as any).electron = mockElectron;
}

vi.mock("@/core/request-engine/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/request-engine/pipeline")>();
  return {
    ...actual,
    hookRegistry: {
      ...actual.hookRegistry,
      executeHooks: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("@/core/editors/voiden/utils/expandLinkedBlocks", () => ({
  expandLinkedBlocksInDoc: vi.fn(async (doc: unknown) => doc),
}));

vi.mock("@/core/request-engine/getRequestFromJson", () => ({
  getRuntimeVariablesMap: vi.fn().mockResolvedValue([]),
}));

import { sendRequestHybrid } from "@/core/request-engine/sendRequestHybrid";

const createMockEditor = () =>
  ({
    getJSON: vi.fn(() => ({ type: "doc", content: [] })),
    schema: { nodes: {}, marks: {} },
  }) as unknown as Editor;

function restRequest(overrides: Record<string, unknown> = {}) {
  return {
    protocolType: "rest",
    method: "GET",
    headers: [],
    params: [],
    path_params: [],
    auth: { enabled: false },
    ...overrides,
  };
}

describe("sendRequestHybrid unresolved variable handling", () => {
  beforeEach(() => {
    sendSecure.mockClear();
    mockElectron.variables.readMerged.mockResolvedValue({});
  });

  it("voiden test : does not block raw env templates before sendSecure", async () => {
    const response = await sendRequestHybrid(
      restRequest({ url: "https://{{HOST}}/health" }),
      createMockEditor(),
      undefined,
      mockElectron,
    );

    expect(sendSecure).toHaveBeenCalledTimes(1);
    expect(response?.statusCode).toBe(200);
  });

  it("voiden test : throws when sendSecure reports unresolved variables after substitution", async () => {
    sendSecure.mockResolvedValueOnce({
      status: 0,
      statusText: "Cannot send request: unresolved environment variable(s): `MISSING_HOST`. Add them to your active environment or fix the spelling.",
      error: "Cannot send request: unresolved environment variable(s): `MISSING_HOST`. Add them to your active environment or fix the spelling.",
      headers: [],
    });

    await expect(
      sendRequestHybrid(
        restRequest({ url: "https://{{MISSING_HOST}}/health" }),
        createMockEditor(),
        undefined,
        mockElectron,
      ),
    ).rejects.toBeInstanceOf(UnresolvedVariablesError);
  });

  it("voiden test : preserves required-row metadata for the secure executor", async () => {
    await sendRequestHybrid(
      restRequest({
        url: "https://api.example.com/items",
        headers: [
          { key: "X-Optional", value: "{{MISSING_HEADER}}", enabled: true, omitIfUnresolved: true },
        ],
        cookies: [
          { key: "session", value: "{{MISSING_COOKIE}}", enabled: true, omitIfUnresolved: true },
        ],
        params: [
          { key: "filter", value: "{{MISSING_QUERY}}", enabled: true, omitIfUnresolved: true },
        ],
        content_type: "application/x-www-form-urlencoded",
        body_params: [
          { key: "form", value: "{{MISSING_FORM}}", type: "text", enabled: true, omitIfUnresolved: true },
        ],
      }),
      createMockEditor(),
      undefined,
      mockElectron,
    );

    expect(sendSecure).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [expect.objectContaining({ key: "X-Optional", omitIfUnresolved: true })],
        cookies: [expect.objectContaining({ key: "session", omitIfUnresolved: true })],
        queryParams: [expect.objectContaining({ key: "filter", omitIfUnresolved: true })],
        bodyParams: [expect.objectContaining({ key: "form", omitIfUnresolved: true })],
      }),
      undefined,
    );
  });
});
