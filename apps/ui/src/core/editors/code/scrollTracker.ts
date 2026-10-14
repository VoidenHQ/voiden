/**
 * Scroll-position tracker for a CodeMirror editor's scroller (.cm-scroller).
 *
 * Its one job is to survive CodeMirror re-measuring its viewport when a tab
 * flips from hidden back to visible, which can reset scrollTop to 0: right
 * after the tab activates, any scroll the user didn't ask for is snapped back
 * to the last known-good position.
 *
 * That snap-back must NOT outlive the activation window. Later on, plenty of
 * legitimate scrolls arrive without a wheel/touch/key event on the scroller —
 * dragging the scrollbar for more than a second, the markdown split view
 * scrolling the editor to follow the preview, CodeMirror re-anchoring after
 * wrapped-line heights get measured. Reverting those to a stale position
 * fights the scroll (visible as glitching/jumping while scrolling), so outside
 * the window every scroll is simply accepted as the new position.
 */

/** How long after activation an unrequested scroll is treated as a remeasure reset. */
export const SETTLE_WINDOW_MS = 500;

/** How long a wheel/touch/key/mouse interaction keeps scrolls counting as the user's own. */
const USER_SCROLL_HOLD_MS = 1000;

export interface ScrollTrackerOptions {
  scrollEl: HTMLElement;
  /** Position to restore to and treat as current until the user scrolls. */
  initialTarget: number;
  /** Called with every accepted position so it can be persisted. */
  onPositionChange: (scrollTop: number) => void;
  /**
   * Returns true (and clears the flag) if the scroll being handled was a
   * deliberate programmatic jump, e.g. search navigation.
   */
  consumeProgrammaticFlag: () => boolean;
  now?: () => number;
}

export interface ScrollTracker {
  /** Re-applies the tracked position, unless the user is mid-scroll. */
  restore: () => void;
  /** Removes listeners and returns the final tracked position. */
  detach: () => number;
}

export function attachScrollTracker(options: ScrollTrackerOptions): ScrollTracker {
  const { scrollEl, onPositionChange, consumeProgrammaticFlag, now = () => Date.now() } = options;

  let currentTarget = options.initialTarget;
  let isUserScrolling = false;
  let userScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  const settleUntil = now() + SETTLE_WINDOW_MS;

  const holdUserScrolling = () => {
    isUserScrolling = true;
    if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
    userScrollTimeout = setTimeout(() => {
      isUserScrolling = false;
      userScrollTimeout = null;
    }, USER_SCROLL_HOLD_MS);
  };

  const restore = () => {
    if (isUserScrolling) return;
    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    scrollEl.scrollTop = Math.min(currentTarget, maxScrollTop);
  };

  const handleScroll = () => {
    // Consume unconditionally so a flagged jump never leaks onto a later scroll.
    const programmatic = consumeProgrammaticFlag();
    if (isUserScrolling || programmatic || now() >= settleUntil) {
      currentTarget = scrollEl.scrollTop;
      onPositionChange(currentTarget);
    } else {
      restore();
    }
  };

  const handleInteraction = () => holdUserScrolling();

  scrollEl.addEventListener("scroll", handleScroll, { passive: true });
  scrollEl.addEventListener("wheel", handleInteraction, { passive: true, capture: true });
  scrollEl.addEventListener("touchmove", handleInteraction, { passive: true, capture: true });
  scrollEl.addEventListener("keydown", handleInteraction, { capture: true });
  scrollEl.addEventListener("mousedown", handleInteraction, { capture: true });

  return {
    restore,
    detach: () => {
      scrollEl.removeEventListener("scroll", handleScroll);
      scrollEl.removeEventListener("wheel", handleInteraction, { capture: true });
      scrollEl.removeEventListener("touchmove", handleInteraction, { capture: true });
      scrollEl.removeEventListener("keydown", handleInteraction, { capture: true });
      scrollEl.removeEventListener("mousedown", handleInteraction, { capture: true });
      if (userScrollTimeout !== null) clearTimeout(userScrollTimeout);
      return currentTarget;
    },
  };
}
