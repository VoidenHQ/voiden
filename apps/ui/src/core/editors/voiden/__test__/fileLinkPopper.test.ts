import { describe, it, expect, vi } from "vitest";
import {
  computeFileLinkPopperMaxHeight,
  FILE_LINK_POPPER_PADDING,
  scrollSelectedItemIntoView,
} from "@/core/editors/voiden/extensions/fileLinkPopper";

describe("computeFileLinkPopperMaxHeight", () => {
  it("limits height for bottom placement near the viewport bottom", () => {
    const maxH = computeFileLinkPopperMaxHeight("bottom-start", 700, 20, 800);
    expect(maxH).toBe(800 - 700 - 20 - FILE_LINK_POPPER_PADDING);
  });

  it("limits height for right-start placement when cursor is in a lower section", () => {
    const maxH = computeFileLinkPopperMaxHeight("right-start", 650, 20, 800);
    expect(maxH).toBe(800 - 650 - FILE_LINK_POPPER_PADDING);
  });

  it("limits height for top placement", () => {
    const maxH = computeFileLinkPopperMaxHeight("top-start", 200, 20, 800);
    expect(maxH).toBe(200 - FILE_LINK_POPPER_PADDING);
  });

  it("returns undefined when no vertical room remains", () => {
    expect(computeFileLinkPopperMaxHeight("right-start", 795, 20, 800)).toBeUndefined();
  });
});

describe("scrollSelectedItemIntoView", () => {
  it("scrolls down when the selected item extends below the container", () => {
    const container = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 100, bottom: 200 }),
    } as unknown as HTMLElement;

    const item = {
      getBoundingClientRect: () => ({ top: 150, bottom: 220 }),
    } as unknown as HTMLElement;

    scrollSelectedItemIntoView(container, item);
    expect(container.scrollTop).toBe(20);
  });

  it("scrolls up when the selected item is above the container", () => {
    const container = {
      scrollTop: 50,
      getBoundingClientRect: () => ({ top: 100, bottom: 200 }),
    } as unknown as HTMLElement;

    const item = {
      getBoundingClientRect: () => ({ top: 80, bottom: 120 }),
    } as unknown as HTMLElement;

    scrollSelectedItemIntoView(container, item);
    expect(container.scrollTop).toBe(30);
  });

  it("does not scroll when the item is already fully visible", () => {
    const container = {
      scrollTop: 10,
      getBoundingClientRect: vi.fn(() => ({ top: 100, bottom: 200 })),
    } as unknown as HTMLElement;

    const item = {
      getBoundingClientRect: vi.fn(() => ({ top: 120, bottom: 180 })),
    } as unknown as HTMLElement;

    scrollSelectedItemIntoView(container, item);
    expect(container.scrollTop).toBe(10);
  });
});
