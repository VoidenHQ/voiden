import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  blockSignature,
  blockSimilarity,
  diffFrontmatter,
  diffVoidBlocks,
  hasBlockChanges,
  isVoidFile,
  readFrontmatter,
} from "../voidBlockDiff";

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text: string): JSONContent => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const request = (uid: string, method: string, url: string): JSONContent => ({
  type: "request",
  attrs: { uid },
  content: [
    { type: "method", attrs: { uid: `${uid}-m` }, content: [{ type: "text", text: method }] },
    { type: "url", attrs: { uid: `${uid}-u` }, content: [{ type: "text", text: url }] },
  ],
});
const headers = (uid: string, rows: [string, string][]): JSONContent => ({
  type: "headers-table",
  attrs: { uid },
  content: [{ type: "table", content: rows.map(([k, v]) => ({ type: "tableRow", content: [p(k), p(v)] })) }],
});

describe("diffVoidBlocks", () => {
  it("reports identical documents as one unchanged section", () => {
    const doc = [h("Title"), request("r1", "GET", "https://a.io")];
    expect(diffVoidBlocks(doc, structuredClone(doc))).toEqual([{ kind: "unchanged", blocks: doc }]);
  });

  it("pairs an edited request by uid as modified", () => {
    const before = [h("Title"), request("r1", "GET", "https://a.io"), p("Footer")];
    const after = [h("Title"), request("r1", "POST", "https://a.io/v2"), p("Footer")];
    expect(diffVoidBlocks(before, after)).toEqual([
      { kind: "unchanged", blocks: [after[0]] },
      { kind: "modified", before: before[1], after: after[1] },
      { kind: "unchanged", blocks: [after[2]] },
    ]);
  });

  it("pairs a nested table edit by uid", () => {
    const before = [headers("t1", [["Content-Type", "application/json"]])];
    const after = [headers("t1", [["Content-Type", "application/xml"], ["X-Id", "1"]])];
    expect(diffVoidBlocks(before, after)).toEqual([{ kind: "modified", before: before[0], after: after[0] }]);
  });

  it("shows added and removed blocks in document order", () => {
    const before = [h("A"), p("old note"), h("C")];
    const after = [h("A"), h("C"), request("r2", "DELETE", "https://a.io/items/42")];
    expect(diffVoidBlocks(before, after)).toEqual([
      { kind: "unchanged", blocks: [after[0]] },
      { kind: "changed", removed: [before[1]], added: [] },
      { kind: "unchanged", blocks: [after[1]] },
      { kind: "changed", removed: [], added: [after[2]] },
    ]);
  });

  it("treats a rewritten paragraph as removed + added, but a small edit as modified", () => {
    const rewritten = diffVoidBlocks([p("Now let's make it fancy with classy headers.")], [p("Add the headers your API needs.")]);
    expect(rewritten).toEqual([
      { kind: "changed", removed: [p("Now let's make it fancy with classy headers.")], added: [p("Add the headers your API needs.")] },
    ]);
    const edited = diffVoidBlocks([p("Send the request to the echo server.")], [p("Send the request to the echo server now.")]);
    expect(edited[0].kind).toBe("modified");
  });

  it("never pairs blocks of different types", () => {
    const sections = diffVoidBlocks([p("Same words here")], [h("Same words here")]);
    expect(sections).toEqual([{ kind: "changed", removed: [p("Same words here")], added: [h("Same words here")] }]);
  });

  it("never pairs two requests with different uids", () => {
    const before = [request("r1", "GET", "https://a.io/users")];
    const after = [request("r2", "GET", "https://a.io/users/1")];
    expect(diffVoidBlocks(before, after)[0].kind).toBe("changed");
  });

  it("ignores regenerated uids when the content is the same", () => {
    expect(hasBlockChanges(diffVoidBlocks([request("old", "GET", "https://a.io")], [request("new", "GET", "https://a.io")]))).toBe(false);
  });

  it("handles a new file and a deleted file", () => {
    const doc = [h("Title"), request("r1", "GET", "https://a.io")];
    expect(diffVoidBlocks([], doc)).toEqual([{ kind: "changed", removed: [], added: doc }]);
    expect(diffVoidBlocks(doc, [])).toEqual([{ kind: "changed", removed: doc, added: [] }]);
    expect(diffVoidBlocks([], [])).toEqual([]);
  });

  it("keeps order when several blocks are edited and one is inserted between them", () => {
    const before = [request("r1", "GET", "https://a.io/1"), request("r2", "GET", "https://a.io/2")];
    const after = [request("r1", "PUT", "https://a.io/1"), p("New note"), request("r2", "PATCH", "https://a.io/2")];
    expect(diffVoidBlocks(before, after)).toEqual([
      { kind: "modified", before: before[0], after: after[0] },
      { kind: "changed", removed: [], added: [after[1]] },
      { kind: "modified", before: before[1], after: after[2] },
    ]);
  });

  it("handles a moved block without losing any block", () => {
    const before = [h("A"), h("B"), h("C")];
    const after = [h("C"), h("A"), h("B")];
    const sections = diffVoidBlocks(before, after);
    const shownAfter = sections.flatMap((s) => (s.kind === "unchanged" ? s.blocks : s.kind === "modified" ? [s.after] : s.added));
    const shownBefore = sections.flatMap((s) => (s.kind === "unchanged" ? s.blocks : s.kind === "modified" ? [s.before] : s.removed));
    expect(shownAfter).toEqual(after);
    expect(shownBefore).toEqual(before);
  });
});

describe("blockSignature / blockSimilarity", () => {
  it("ignores uids anywhere in the tree and key order", () => {
    expect(blockSignature(request("a", "GET", "x"))).toBe(blockSignature(request("b", "GET", "x")));
    expect(blockSignature({ type: "x", attrs: { a: 1, b: 2 } })).toBe(blockSignature({ attrs: { b: 2, a: 1 }, type: "x" }));
  });

  it("scores identical text 1 and unrelated text low", () => {
    expect(blockSimilarity(p("hello world"), p("hello world"))).toBe(1);
    expect(blockSimilarity(p("hello world"), p("zzz qqq"))).toBeLessThan(0.5);
    expect(blockSimilarity({ type: "horizontalRule" }, { type: "horizontalRule" })).toBe(1);
  });
});

describe("frontmatter", () => {
  const v1 = "---\nversion: 0.20.1\ngeneratedBy: Voiden app\ngeneratedAt: 2025-04-01T07:33:37.478Z\n---\n\n## Hi\n";
  const v2 = "---\nversion: 0.21.0\ngeneratedBy: Voiden app\ngeneratedAt: 2026-10-20T10:00:00.000Z\n---\n\n## Hi\n";

  it("reads the YAML header, also with Windows line endings", () => {
    expect(readFrontmatter(v1)).toMatchObject({ version: "0.20.1", generatedBy: "Voiden app" });
    expect(readFrontmatter(v1.replace(/\n/g, "\r\n"))).toMatchObject({ version: "0.20.1" });
  });

  it("returns nothing for files without a header or with broken YAML", () => {
    expect(readFrontmatter("## Just text")).toEqual({});
    expect(readFrontmatter("---\nkey: [unclosed\n---\n")).toEqual({});
    expect(readFrontmatter(null)).toEqual({});
  });

  it("lists changed, added and removed keys", () => {
    expect(diffFrontmatter(v1, v2)).toEqual([
      { key: "version", before: "0.20.1", after: "0.21.0" },
      { key: "generatedAt", before: "2025-04-01T07:33:37.478Z", after: "2026-10-20T10:00:00.000Z" },
    ]);
    expect(diffFrontmatter("## none", v1)).toHaveLength(3);
    expect(diffFrontmatter(v1, v1)).toEqual([]);
  });
});

describe("isVoidFile", () => {
  it("matches .void paths only, case-insensitively", () => {
    expect(isVoidFile("blocks/headers.void")).toBe(true);
    expect(isVoidFile("A/B.VOID")).toBe(true);
    expect(isVoidFile("imports/initiate-protocol..void")).toBe(true);
    expect(isVoidFile("README.md")).toBe(false);
    expect(isVoidFile("notes.void.md")).toBe(false);
    expect(isVoidFile(undefined)).toBe(false);
  });
});
