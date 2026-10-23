import { describe, it, expect } from "vitest";
import { cloneEnvNode, insertAfterKey, mergeToEditable, splitFromEditable } from "../components/envTreeUtils";
import type { EditableEnvNode } from "../components/EnvironmentNode";

describe("insertAfterKey", () => {
  it("inserts the new key directly after the given key", () => {
    const result = insertAfterKey({ a: 1, b: 2, c: 3 }, "b", "b-copy", 9);
    expect(Object.keys(result)).toEqual(["a", "b", "b-copy", "c"]);
    expect(result["b-copy"]).toBe(9);
  });

  it("appends when the anchor key is missing", () => {
    const result = insertAfterKey({ a: 1 }, "missing", "x", 2);
    expect(Object.keys(result)).toEqual(["a", "x"]);
  });
});

describe("cloneEnvNode", () => {
  const original: EditableEnvNode = {
    displayName: "Staging",
    intermediate: true,
    variables: [
      { id: "v1", key: "BASE_URL", value: "https://staging", isPrivate: false },
      { id: "v2", key: "TOKEN", value: "secret", isPrivate: true },
    ],
    children: {
      eu: { variables: [{ id: "v3", key: "REGION", value: "eu", isPrivate: false }], children: {} },
    },
  };

  it("copies variables, private flags, metadata and children", () => {
    const copy = cloneEnvNode(original);
    expect(copy.displayName).toBe("Staging");
    expect(copy.intermediate).toBe(true);
    expect(copy.variables.map(({ key, value, isPrivate }) => ({ key, value, isPrivate }))).toEqual([
      { key: "BASE_URL", value: "https://staging", isPrivate: false },
      { key: "TOKEN", value: "secret", isPrivate: true },
    ]);
    expect(copy.children.eu.variables[0].key).toBe("REGION");
    // Private values land in the private tree after a save round-trip
    const { privateTree } = splitFromEditable({ copy });
    expect(privateTree.copy?.variables).toEqual({ TOKEN: "secret" });
  });

  it("gives every variable a fresh id and shares no references", () => {
    const copy = cloneEnvNode(original);
    const ids = [...copy.variables, ...copy.children.eu.variables].map((v) => v.id);
    expect(ids).not.toContain("v1");
    expect(ids).not.toContain("v2");
    expect(ids).not.toContain("v3");
    copy.variables[0].value = "changed";
    copy.children.eu.variables.push({ id: "x", key: "K", value: "V", isPrivate: false });
    expect(original.variables[0].value).toBe("https://staging");
    expect(original.children.eu.variables).toHaveLength(1);
  });
});

describe("env picker visibility round-trip", () => {
  it("keeps a child's explicit intermediate: false under a hidden parent", () => {
    const editable = mergeToEditable(
      {
        base: {
          intermediate: true,
          children: {
            dev: { intermediate: false, variables: { HOST: "dev" } },
            qa: { variables: { HOST: "qa" } },
          },
        },
      },
      {},
    );
    expect(editable.base.intermediate).toBe(true);
    expect(editable.base.children.dev.intermediate).toBe(false);
    expect(editable.base.children.qa.intermediate).toBeUndefined();

    const { publicTree } = splitFromEditable(editable);
    expect(publicTree.base.intermediate).toBe(true);
    expect(publicTree.base.children?.dev.intermediate).toBe(false);
    expect(publicTree.base.children?.qa).not.toHaveProperty("intermediate");
  });
});
