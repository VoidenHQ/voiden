// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateFileSaveQueries } from "../fileSaveInvalidation";

describe("invalidateFileSaveQueries", () => {
  it("refreshes saved tab data without invalidating the file tree", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateFileSaveQueries(queryClient, "main", "tab-1");

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["panel:tabs", "main"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["tab:content", "main", "tab-1"],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(["files:tree"]),
      }),
    );
  });

  it("refreshes the file tree when saving creates a file", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateFileSaveQueries(queryClient, "main", "tab-1", {
      activeDirectory: "/project",
      fileTreeChanged: true,
    });

    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["files:tree", "/project"],
    });
  });
});
