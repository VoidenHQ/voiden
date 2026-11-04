import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeSecureRequest, type SecureRequestAdapter } from "@voiden/executors";

const mockFetch = vi.fn();

const adapter: SecureRequestAdapter = {
  replaceVar: async (text: string) => text,
  isElectron: false,
};

function send(method: string, body?: string) {
  return executeSecureRequest(
    {
      method,
      url: "https://api.example.com/items/1",
      headers: [],
      queryParams: [],
      pathParams: [],
      body,
      contentType: "application/json",
    } as any,
    adapter,
  );
}

describe("executeSecureRequest method normalization", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers([["content-type", "application/json"]]),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  it.each(["patch", "Patch", " PATCH "])("voiden test : sends %j as PATCH", async (method) => {
    const result = await send(method, '{"name":"x"}');

    const options = mockFetch.mock.calls[0][1];
    expect(options.method).toBe("PATCH");
    expect(options.body).toBe('{"name":"x"}');
    expect(result.kind === "http" && result.requestMeta.method).toBe("PATCH");
  });

  it("voiden test : does not attach a body to a lowercase get", async () => {
    await send("get", '{"name":"x"}');

    const options = mockFetch.mock.calls[0][1];
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
  });
});
