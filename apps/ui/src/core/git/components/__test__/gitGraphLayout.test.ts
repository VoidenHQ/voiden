import { describe, expect, it } from "vitest";
import { buildGraph, continuationWidth, rowGraphWidth } from "../gitGraphLayout";

describe("buildGraph", () => {
  const c = (hash: string, parents: string[]) => ({
    hash, shortHash: hash, message: hash, author: "a", date: "2026-01-01", refs: "", parents,
  });

  it("keeps the first-parent line on lane 0 and puts a merged branch on lane 1", () => {
    // M merges S into B; S and B both come from A.
    const nodes = buildGraph([c("M", ["B", "S"]), c("S", ["A"]), c("B", ["A"]), c("A", [])]);
    expect(nodes.map((n) => [n.commit.hash, n.lane])).toEqual([["M", 0], ["S", 1], ["B", 0], ["A", 0]]);
    expect(nodes[0].branches).toEqual([
      { from: 0, to: 0, isMerge: false },
      { from: 0, to: 1, isMerge: true },
    ]);
    // Row width follows each row's own lanes, so text starts right after them.
    expect(rowGraphWidth(nodes[0], [])).toBeGreaterThan(rowGraphWidth(nodes[3], nodes[2].activeLanesAfter));
    expect(continuationWidth(nodes[1])).toBe(rowGraphWidth(nodes[1], nodes[0].activeLanesAfter));
  });

  it("handles an empty history", () => {
    expect(buildGraph([])).toEqual([]);
  });
});
