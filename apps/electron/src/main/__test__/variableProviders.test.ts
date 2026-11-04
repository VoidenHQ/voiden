import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  clearVariableProviders,
  registerVariableProvider,
  resolveProviderVariables,
  unregisterVariableProviders,
} from "../variableProviders";

const context = { projectPath: "/project", activeEnv: "dev", env: {} as Record<string, string> };

afterEach(() => clearVariableProviders());

describe("variable providers", () => {
  it("resolves references in a registered namespace", async () => {
    registerVariableProvider("ext-a", "vault", (key) => `secret:${key}`);
    const values = await resolveProviderVariables("Bearer {{vault.api_token}} {{ vault.db/password }}", context);
    expect(Object.fromEntries(values)).toEqual({
      "vault.api_token": "secret:api_token",
      "vault.db/password": "secret:db/password",
    });
  });

  it("calls the resolver once per unique reference and passes the context", async () => {
    const resolve = vi.fn(async () => "x");
    registerVariableProvider("ext-a", "vault", resolve);
    await resolveProviderVariables("{{vault.a}} {{vault.a}} {{other.b}} {{HOST}}", context);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("a", context);
  });

  it("lets an explicit environment variable win over the provider", async () => {
    const resolve = vi.fn(() => "from-provider");
    registerVariableProvider("ext-a", "vault", resolve);
    const values = await resolveProviderVariables("{{vault.token}}", { ...context, env: { "vault.token": "from-env" } });
    expect(values.size).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("leaves references unresolved when the resolver throws or returns undefined", async () => {
    registerVariableProvider("ext-a", "vault", (key) => {
      if (key === "boom") throw new Error("permission denied");
      return key === "ok" ? "value" : undefined;
    });
    const values = await resolveProviderVariables("{{vault.boom}} {{vault.missing}} {{vault.ok}}", context);
    expect(Object.fromEntries(values)).toEqual({ "vault.ok": "value" });
  });

  it("rejects reserved, invalid and already-claimed namespaces", () => {
    expect(() => registerVariableProvider("ext-a", "process", () => "")).toThrow(/reserved/);
    expect(() => registerVariableProvider("ext-a", "$faker", () => "")).toThrow(/Invalid/);
    registerVariableProvider("ext-a", "vault", () => "");
    expect(() => registerVariableProvider("ext-b", "vault", () => "")).toThrow(/already registered by "ext-a"/);
  });

  it("stops resolving after unregistering", async () => {
    const dispose = registerVariableProvider("ext-a", "vault", () => "v");
    registerVariableProvider("ext-a", "doppler", () => "d");
    dispose();
    expect((await resolveProviderVariables("{{vault.x}}", context)).size).toBe(0);
    unregisterVariableProviders("ext-a");
    expect((await resolveProviderVariables("{{doppler.x}}", context)).size).toBe(0);
  });
});
