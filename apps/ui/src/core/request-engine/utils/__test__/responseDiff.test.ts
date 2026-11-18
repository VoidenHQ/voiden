import { describe, expect, it } from "vitest";
import {
  bodyToText,
  countKinds,
  countSem,
  diffHeaders,
  diffJson,
  diffLines,
  foldLineOps,
  bodyForLines,
  inlineRange,
  snapshotRun,
} from "../responseDiff";

const doc = (body: unknown, headers: Array<{ key: string; value: string }> = [], status = 200) => ({
  type: "doc",
  attrs: { statusCode: status, statusMessage: "OK", elapsedTime: 120, url: "https://api.test/users/1" },
  content: [
    {
      type: "response-doc",
      attrs: { statusCode: status },
      content: [
        { type: "response-body", attrs: { body, contentType: "application/json" } },
        { type: "response-headers", attrs: { headers } },
        { type: "request-headers", attrs: { method: "post", url: "https://api.test/users/1" } },
      ],
    },
  ],
});

describe("snapshotRun", () => {
  it("reads status, timing, headers and body from a response doc", () => {
    const run = snapshotRun(doc('{"a":1}', [{ key: "Content-Type", value: "application/json" }]), 3, "live", 1000)!;
    expect(run).toMatchObject({ id: 3, method: "POST", status: 200, elapsedMs: 120, bodyText: '{"a":1}', bytes: 7, source: "live" });
    expect(run.headers).toEqual([{ key: "Content-Type", value: "application/json" }]);
  });

  it("accepts a bare response-doc node (as hydrated from the file)", () => {
    const run = snapshotRun(doc("x").content[0], 1, "file");
    expect(run?.bodyText).toBe("x");
  });

  it("returns null for docs without a response body (e.g. socket sessions)", () => {
    expect(snapshotRun({ type: "doc", content: [{ type: "paragraph" }] }, 1, "live")).toBeNull();
  });
});

describe("bodyToText", () => {
  it("decodes serialized Buffers and objects", () => {
    expect(bodyToText({ type: "Buffer", data: [104, 105] })).toEqual({ text: "hi", binary: false });
    expect(bodyToText({ a: 1 }).text).toBe('{\n  "a": 1\n}');
    expect(bodyToText(null).text).toBeNull();
  });

  it("flags binary bytes", () => {
    expect(bodyToText(new Uint8Array([0, 255, 1])).binary).toBe(true);
  });
});

describe("diffHeaders", () => {
  const a = [{ key: "Content-Type", value: "json" }, { key: "Date", value: "Mon" }, { key: "X-Old", value: "1" }];
  const b = [{ key: "content-type", value: "json" }, { key: "Date", value: "Tue" }, { key: "X-New", value: "2" }];

  it("matches keys case-insensitively and classifies each header", () => {
    const kinds = Object.fromEntries(diffHeaders(a, b, false).map((h) => [h.key.toLowerCase(), h.kind]));
    expect(kinds).toEqual({ "content-type": "same", date: "changed", "x-new": "added", "x-old": "removed" });
  });

  it("ignores volatile headers when asked", () => {
    expect(diffHeaders(a, b, true).find((h) => h.key === "Date")?.kind).toBe("ignored");
  });
});

describe("diffJson", () => {
  const a = { id: 1, email: "a@x.io", plan: { tier: "pro" }, tags: ["beta", "early"], requestId: "req_1", lastLogin: "2026-11-18T09:00:00Z" };
  const b = { plan: { tier: "team", seats: 3 }, id: 1, email: "a@x.io", tags: ["beta"], requestId: "req_2", lastLogin: "2026-11-18T09:30:00Z" };

  it("ignores key order and counts added, removed and changed leaves", () => {
    expect(countSem(diffJson(a, b, false))).toEqual({ added: 1, removed: 1, changed: 3, ignored: 0 });
  });

  it("moves timestamps and request IDs to ignored", () => {
    expect(countSem(diffJson(a, b, true))).toEqual({ added: 1, removed: 1, changed: 1, ignored: 2 });
  });

  it("treats a type change as one changed value", () => {
    expect(countSem(diffJson({ v: [1] }, { v: { x: 1 } }, false))).toEqual({ added: 0, removed: 0, changed: 1, ignored: 0 });
  });
});

describe("diffLines", () => {
  it("pairs removed and added lines into changes", () => {
    const ops = diffLines("a\nb\nc", "a\nB\nc\nd", false);
    expect(ops.map((o) => o.t)).toEqual(["same", "changed", "same", "added"]);
  });

  it("treats volatile JSON values as equal when ignoring", () => {
    const A = '{\n  "id": 1,\n  "updatedAt": "2026-01-01T00:00:00Z"\n}';
    const B = '{\n  "id": 1,\n  "updatedAt": "2026-01-02T00:00:00Z"\n}';
    expect(countKinds(diffLines(A, B, true).map((o) => o.t))).toEqual({ added: 0, removed: 0, changed: 0, ignored: 1 });
    expect(countKinds(diffLines(A, B, false).map((o) => o.t)).changed).toBe(1);
  });

  it("handles identical and empty input", () => {
    expect(diffLines("x", "x", false)).toEqual([{ t: "same", a: "x", b: "x", ai: 1, bi: 1 }]);
    expect(diffLines("", "y", false).map((o) => o.t)).toEqual(["changed"]);
  });
});

describe("inlineRange", () => {
  it("finds the common prefix and suffix", () => {
    expect(inlineRange('"seats": 5,', '"seats": 10,')).toEqual([9, 1]);
    expect(inlineRange("same", "same")).toEqual([4, 0]);
  });
});

describe("foldLineOps", () => {
  // Four items that each carry a timestamp; only one name really changes.
  const body = (ts: string, name: string) =>
    bodyForLines(JSON.stringify({ items: Array.from({ length: 4 }, (_, i) => ({ id: i, name: i === 2 ? name : `n${i}`, role: "user", updatedAt: ts })) }));
  const ops = diffLines(body("2026-01-01T00:00:00Z", "a"), body("2026-01-02T00:00:00Z", "b"), true);
  const shownLines = (blocks: ReturnType<typeof foldLineOps>) => blocks.filter((b) => "op" in b).length;

  it("folds across ignored lines instead of showing every unchanged line", () => {
    const blocks = foldLineOps(ops, false);
    const folds = blocks.filter((b) => "fold" in b) as Array<{ fold: number; ignored: number }>;
    expect(folds.length).toBe(2);
    // Three of the four timestamps fold away; the changed item's own stays in the visible context.
    expect(folds.reduce((n, f) => n + f.ignored, 0)).toBe(3);
    // The change plus three lines of context on each side.
    expect(shownLines(blocks)).toBe(7);
  });

  it("shows everything when unchanged lines are requested, or a fold is opened", () => {
    expect(shownLines(foldLineOps(ops, true))).toBe(ops.length);
    const first = foldLineOps(ops, false).find((b) => "fold" in b) as { start: number };
    expect(shownLines(foldLineOps(ops, false, new Set([first.start])))).toBeGreaterThan(7);
  });
});

describe("diffJson folding", () => {
  it("doesn't count ignored values as real changes in a subtree", () => {
    const node = diffJson({ meta: { requestId: "req_1" } }, { meta: { requestId: "req_2" } }, true);
    expect(node.t === "container" && node.changes).toBe(0);
  });
});
