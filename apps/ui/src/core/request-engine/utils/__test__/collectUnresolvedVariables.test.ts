import { describe, it, expect } from "vitest";
import {
  assertNoUnresolvedTemplates,
  UnresolvedVariablesError,
  validateResolvedStrings,
} from "@voiden/executors";

describe("validateResolvedStrings", () => {
  it("voiden test : collects unique blocking environment and process variables", () => {
    const result = validateResolvedStrings([
      "GET {{BASE_URL}}/users/{{process.user_id}} with {{API_KEY}} and {{API_KEY}}",
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved).toEqual(["API_KEY", "BASE_URL", "process.user_id"]);
    }
  });

  it("voiden test : allows capture and faker templates", () => {
    const result = validateResolvedStrings([
      "{{$req.url}}",
      "{{$res.body}}",
      "{{$faker.name}}",
    ]);

    expect(result).toEqual({ ok: true });
  });

  it("voiden test : blocks unknown namespaces that look like capture variables", () => {
    const result = validateResolvedStrings(["https://api.example.com/{{$reqFoo}}"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved).toEqual(["$reqFoo"]);
    }
  });

  it("voiden test : returns actionable error for environment variables", () => {
    const result = validateResolvedStrings(["https://{{BASE_URL}}/health"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved).toEqual(["BASE_URL"]);
      expect(result.message).toContain("unresolved environment variable(s)");
      expect(result.message).toContain("`BASE_URL`");
    }
  });

  it("voiden test : returns actionable error for runtime variables", () => {
    const result = validateResolvedStrings(["Bearer {{process.access_token}}"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved).toEqual(["process.access_token"]);
      expect(result.message).toContain("unresolved runtime variable(s)");
    }
  });

  it("voiden test : formats mixed environment and runtime variables", () => {
    const result = validateResolvedStrings([
      "https://{{API_KEY}}",
      "Bearer {{process.token}}",
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "Cannot send request: unresolved environment variable(s): `API_KEY`. Add them to your active environment or fix the spelling.\nCannot send request: unresolved runtime variable(s): `process.token`. Capture them in a prior request, set them in .voiden/.process.env.json, or fix the spelling.",
      );
    }
  });

  it("voiden test : scans multiple resolved outgoing fields", () => {
    const result = validateResolvedStrings([
      "https://{{HOST}}/api",
      "Bearer {{TOKEN}}",
      "q={{SEARCH}}",
      "{\"id\":\"{{ID}}\"}",
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unresolved.sort()).toEqual(["HOST", "ID", "SEARCH", "TOKEN"]);
    }
  });

  it("voiden test : passes when resolved payload has no blocking templates", () => {
    const result = validateResolvedStrings([
      "https://api.example.com/users",
      "{{$req.headers.Authorization}}",
    ]);

    expect(result).toEqual({ ok: true });
  });
});

describe("assertNoUnresolvedTemplates", () => {
  it("voiden test : throws UnresolvedVariablesError with message and unresolved list", () => {
    expect(() => assertNoUnresolvedTemplates(["https://{{HOST}}"])).toThrowError(
      UnresolvedVariablesError,
    );

    try {
      assertNoUnresolvedTemplates(["https://{{HOST}}"]);
    } catch (error) {
      expect(error).toMatchObject({
        name: "UnresolvedVariablesError",
        unresolved: ["HOST"],
        message: expect.stringContaining("Cannot send request"),
      });
    }
  });
});
