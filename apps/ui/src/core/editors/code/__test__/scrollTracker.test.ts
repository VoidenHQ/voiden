import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachScrollTracker, SETTLE_WINDOW_MS, type ScrollTracker } from "../scrollTracker";

// jsdom has no layout, so give the scroller a plain read/write scrollTop and
// fixed heights. Real browsers fire a 'scroll' event after scrollTop changes;
// `scrollTo` mimics that by dispatching it right after the write.
function makeScroller() {
  const el = document.createElement("div");
  let top = 0;
  Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => { top = v; }, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: 10_000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
  const scrollTo = (v: number) => {
    top = v;
    el.dispatchEvent(new Event("scroll"));
  };
  return { el, scrollTo, getTop: () => top };
}

describe("scroll tracker", () => {
  let now = 0;
  let tracker: ScrollTracker;
  let saved: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    saved = [];
  });
  afterEach(() => {
    tracker?.detach();
    vi.useRealTimers();
  });

  const attach = (el: HTMLElement, initialTarget: number, programmatic = () => false) => {
    tracker = attachScrollTracker({
      scrollEl: el,
      initialTarget,
      onPositionChange: (v) => saved.push(v),
      consumeProgrammaticFlag: programmatic,
      now: () => now,
    });
    return tracker;
  };

  it("restores the saved position when a remeasure resets the scroller right after activation", () => {
    const { el, scrollTo, getTop } = makeScroller();
    attach(el, 1200).restore();
    expect(getTop()).toBe(1200);

    now = 50;
    scrollTo(0); // CodeMirror re-measuring a just-shown tab
    expect(getTop()).toBe(1200);
    expect(saved).toEqual([]);
  });

  it("does not fight an unrequested scroll once the settle window has passed (split-view sync, CodeMirror re-anchoring)", () => {
    const { el, scrollTo, getTop } = makeScroller();
    attach(el, 1200).restore();

    now = SETTLE_WINDOW_MS + 1;
    scrollTo(1500); // e.g. the preview pane driving the editor: no wheel/key event on the editor
    expect(getTop()).toBe(1500);
    expect(saved).toEqual([1500]);

    // ...and the next one is not reverted to the earlier value either
    now += 16;
    scrollTo(1520);
    expect(getTop()).toBe(1520);
    expect(saved).toEqual([1500, 1520]);
  });

  it("accepts scrollbar-drag scrolling that lasts longer than the user-interaction hold", () => {
    const { el, scrollTo, getTop } = makeScroller();
    attach(el, 0).restore();

    el.dispatchEvent(new Event("mousedown")); // a scrollbar drag fires this once, then only scroll events
    for (let i = 1; i <= 20; i++) {
      now += 200; // 4s of slow dragging, well past the 1s hold
      vi.advanceTimersByTime(200);
      scrollTo(i * 40);
      expect(getTop()).toBe(i * 40);
    }
    expect(saved.at(-1)).toBe(800);
  });

  it("treats a wheel scroll inside the settle window as the user's own", () => {
    const { el, scrollTo, getTop } = makeScroller();
    attach(el, 1200).restore();

    now = 20;
    el.dispatchEvent(new Event("wheel"));
    scrollTo(1300);
    expect(getTop()).toBe(1300);
    expect(saved).toEqual([1300]);
  });

  it("accepts a flagged programmatic jump (search navigation) inside the settle window and clears the flag", () => {
    const { el, scrollTo, getTop } = makeScroller();
    let flag = true;
    attach(el, 0, () => { const f = flag; flag = false; return f; }).restore();

    now = 10;
    scrollTo(4000);
    expect(getTop()).toBe(4000);
    expect(saved).toEqual([4000]);

    now = 20;
    scrollTo(0); // the flag was consumed, so this one is a reset and gets undone
    expect(getTop()).toBe(4000);
  });

  it("restore() does not move the scroller while the user is mid-scroll", () => {
    const { el, scrollTo, getTop } = makeScroller();
    const t = attach(el, 100);
    t.restore();
    el.dispatchEvent(new Event("wheel"));
    scrollTo(700);
    t.restore();
    expect(getTop()).toBe(700);
  });

  it("clamps the restored position to the scrollable range and reports the final position on detach", () => {
    const { el, getTop } = makeScroller();
    const t = attach(el, 50_000);
    t.restore();
    expect(getTop()).toBe(9_500); // scrollHeight 10000 - clientHeight 500
    expect(t.detach()).toBe(50_000);
  });
});
