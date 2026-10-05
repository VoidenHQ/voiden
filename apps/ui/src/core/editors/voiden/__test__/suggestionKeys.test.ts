import { describe, expect, it } from "vitest";
import { isSuggestionAcceptKey } from "@/core/editors/voiden/utils/suggestionKeys";

const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: k, ...init });

describe("isSuggestionAcceptKey", () => {
  it("voiden test : accepts Enter and plain Tab (#566)", () => {
    expect(isSuggestionAcceptKey(key("Enter"))).toBe(true);
    expect(isSuggestionAcceptKey(key("Tab"))).toBe(true);
  });

  it("voiden test : ignores Shift+Tab and other modified Tabs", () => {
    expect(isSuggestionAcceptKey(key("Tab", { shiftKey: true }))).toBe(false);
    expect(isSuggestionAcceptKey(key("Tab", { altKey: true }))).toBe(false);
    expect(isSuggestionAcceptKey(key("Tab", { ctrlKey: true }))).toBe(false);
    expect(isSuggestionAcceptKey(key("Tab", { metaKey: true }))).toBe(false);
  });

  it("voiden test : ignores other keys", () => {
    expect(isSuggestionAcceptKey(key("ArrowDown"))).toBe(false);
    expect(isSuggestionAcceptKey(key(" "))).toBe(false);
  });
});
