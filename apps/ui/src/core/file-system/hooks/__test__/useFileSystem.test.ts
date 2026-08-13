import { describe, it, expect, vi, beforeEach } from "vitest";

const invalidateQueries = vi.fn();
const getQueryData = vi.fn(() => ({ activeDirectory: "/mock/project" }));

vi.mock("@/main", () => ({
  getQueryClient: () => ({ invalidateQueries, getQueryData }),
}));

import { invalidateOnFileSave } from "@/core/file-system/hooks/useFileSystem";

describe("invalidateOnFileSave", () => {
  beforeEach(() => {
    invalidateQueries.mockClear();
    getQueryData.mockClear();
  });

  const invalidatedKeys = () => invalidateQueries.mock.calls.map((call) => call[0].queryKey);

  it("does not refresh the file tree when saving an existing file", () => {
    invalidateOnFileSave("/mock/project/notes.void", "main", "tab-1");

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["panel:tabs", "main"]);
    expect(keys).toContainEqual(["tab:content", "main", "tab-1"]);
    expect(keys.some((key) => key[0] === "files:tree")).toBe(false);
  });

  it("still refreshes the file tree when a new file is created", () => {
    invalidateOnFileSave(null, "main", "tab-1");

    const keys = invalidatedKeys();
    expect(keys).toContainEqual(["files:tree", "/mock/project"]);
  });
});
