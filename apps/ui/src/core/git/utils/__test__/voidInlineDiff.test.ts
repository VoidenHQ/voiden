import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { changedRanges, flattenText } from "../voidInlineDiff";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    request: { group: "block", content: "method url" },
    method: { content: "text*" },
    url: { content: "text*" },
    text: {},
  },
});

const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const doc = (...content: unknown[]): PMNode => schema.nodeFromJSON({ type: "doc", content });
const request = (method: string, url: string) => ({
  type: "request",
  content: [
    { type: "method", content: [{ type: "text", text: method }] },
    { type: "url", content: [{ type: "text", text: url }] },
  ],
});
const textAt = (d: PMNode, ranges: { from: number; to: number }[]) => ranges.map((r) => d.textBetween(r.from, r.to));

describe("flattenText", () => {
  it("joins text blocks with newlines in reading order", () => {
    expect(flattenText(doc(p("Hello"), request("GET", "https://a.io"))).text).toBe("Hello\nGET\nhttps://a.io");
  });

  it("skips empty blocks", () => {
    expect(flattenText(doc(p(""), p("x"))).text).toBe("x");
  });
});

describe("changedRanges", () => {
  it("marks the changed words of a request on each side", () => {
    const before = doc(request("GET", "https://echo.apyhub.com"));
    const after = doc(request("POST", "https://echo.apyhub.com/v2/headers"));
    // jsdiff splits on punctuation, so only the parts that really changed are marked.
    expect(textAt(before, changedRanges(before, after, "removed"))).toEqual(["GET"]);
    expect(textAt(after, changedRanges(after, before, "added"))).toEqual(["POST", "/v2/headers"]);
  });

  it("returns nothing for identical text", () => {
    const d = doc(p("Same text"));
    expect(changedRanges(d, doc(p("Same text")), "removed")).toEqual([]);
    expect(changedRanges(d, doc(p("Same text")), "added")).toEqual([]);
  });

  it("ignores whitespace-only changes", () => {
    expect(changedRanges(doc(p("a b")), doc(p("a  b")), "added")).toEqual([]);
  });

  it("maps ranges into the right block when a word changes in a later block", () => {
    const before = doc(p("Intro"), p("Content-Type application/json"));
    const after = doc(p("Intro"), p("Content-Type application/xml"));
    expect(textAt(after, changedRanges(after, before, "added"))).toEqual(["xml"]);
  });

  it("handles a block that only exists on one side", () => {
    const before = doc(p("Keep"));
    const after = doc(p("Keep"), p("New row"));
    expect(textAt(after, changedRanges(after, before, "added"))).toEqual(["New row"]);
    expect(changedRanges(before, after, "removed")).toEqual([]);
  });
});
