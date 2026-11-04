// @vitest-environment node
import { describe, expect, it } from "vitest";

import { injectChildrenBatch } from "../treeData";
import type { ExtendedFileTree } from "../types";

const folder = (path: string, children?: ExtendedFileTree[]): ExtendedFileTree =>
  ({ path, name: path.split("/").pop(), type: "folder", children, lazy: !children }) as unknown as ExtendedFileTree;
const file = (path: string): ExtendedFileTree =>
  ({ path, name: path.split("/").pop(), type: "file" }) as unknown as ExtendedFileTree;

describe("injectChildrenBatch", () => {
  it("keeps a nested folder's children when its result arrives before its parent's", () => {
    const tree = [folder("/p", [folder("/p/a")])];

    // Completion order: child first, parent last. The parent's fresh listing
    // has /p/a unloaded, so applying it last would drop /p/a/b.void.
    const results = [
      { dirPath: "/p/a", children: [file("/p/a/b.void")] },
      { dirPath: "/p", children: [folder("/p/a")] },
    ];

    const [root] = injectChildrenBatch(tree, results);
    const a = root.children?.[0];
    expect(a?.path).toBe("/p/a");
    expect(a?.children?.map((c) => c.path)).toEqual(["/p/a/b.void"]);
    expect(a?.lazy).toBe(false);
  });

  it("does not reorder the caller's results array", () => {
    const results = [
      { dirPath: "/p/a", children: [] },
      { dirPath: "/p", children: [folder("/p/a")] },
    ];
    injectChildrenBatch([folder("/p", [folder("/p/a")])], results);
    expect(results.map((r) => r.dirPath)).toEqual(["/p/a", "/p"]);
  });
});
