import { describe, it, expect } from "vitest";
import { findBlockByUid } from "@/core/editors/voiden/extensions/BlockLink";

/**
 * Regression test for: importing a block and reusing it elsewhere (e.g. an
 * AI agent authoring a `.void` file by hand, per the "Importing Blocks from
 * Other Files" section of the Voiden AI Skill) could corrupt the block.
 *
 * Root cause: `findBlockByUid` matched on `attrs.uid` alone, with no regard
 * for the node's type. A `linkedBlock` wrapper carries its own `uid` (its
 * identity) *and* a separate `blockUid` (the target it points at) — if those
 * two ever collide with the same value (a hand-authored file copying the
 * target's uid onto the wrapper instead of generating a fresh one, most
 * likely when the wrapper is placed in the very file that defines the real
 * block), `findBlockByUid` could match the `linkedBlock`/`linkedFile`
 * pointer itself instead of the real content — silently corrupting every
 * file that imports it instead of failing loudly.
 *
 * The fix excludes `linkedBlock`/`linkedFile` nodes from ever being returned
 * as a match, so a colliding uid resolves to the real block if one still
 * carries it, or to "not found" (surfaced by the UI as a missing/outdated
 * block) rather than to the pointer node.
 */
describe("findBlockByUid", () => {
  const uid = "825cb614-99af-4d19-ac1e-7af0dcb2acf5";

  it("finds a genuine block by uid", () => {
    const nodes = [{ type: "headers-table", attrs: { uid }, content: [] }];
    expect(findBlockByUid(nodes, uid)?.type).toBe("headers-table");
  });

  it("does not match a linkedBlock whose own uid collides with the target", () => {
    const nodes = [
      // A linkedBlock wrapper that was mistakenly given the same `uid` as the
      // block it points at (`blockUid`), e.g. by copy-pasting attrs instead
      // of generating a fresh uid for the wrapper.
      { type: "linkedBlock", attrs: { uid, blockUid: uid, originalFile: "/self.void" } },
    ];
    expect(findBlockByUid(nodes, uid)).toBeNull();
  });

  it("does not match a linkedFile whose own uid collides with the target", () => {
    const nodes = [{ type: "linkedFile", attrs: { uid, originalFile: "/self.void", sectionUid: null } }];
    expect(findBlockByUid(nodes, uid)).toBeNull();
  });

  it("finds the real block over a colliding linkedBlock sitting alongside it", () => {
    const nodes = [
      // The self-referencing wrapper comes first in document order...
      { type: "linkedBlock", attrs: { uid, blockUid: uid, originalFile: "/self.void" } },
      // ...but the actual block, still carrying the shared uid, must win.
      { type: "headers-table", attrs: { uid }, content: [] },
    ];
    expect(findBlockByUid(nodes, uid)?.type).toBe("headers-table");
  });
});
