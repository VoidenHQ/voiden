import { useState, type RefObject } from "react";
import { cn } from "@/core/lib/utils";
import { useCommitHistoryHeight } from "@/core/stores/commitHistoryHeight";

/** Smallest height the Commit History panel can be dragged to. */
const MIN_HISTORY = 80;
/** Space left above the panel when there are no change lists to keep in view. */
const MIN_ABOVE = 120;
/** The lists above never get pushed below this share of the shared space. */
const MAX_ABOVE_SHARE = 0.5;
const KEY_STEP = 16;

/**
 * Height the change lists need so the last section's header and its first file
 * stay in view, like VS Code keeps "Changes" and one file above the graph.
 */
const keepVisible = (lists: HTMLElement | null): number => {
  if (!lists) return MIN_ABOVE;
  const sections = lists.querySelectorAll<HTMLElement>("[data-scm-section]");
  const last = sections[sections.length - 1];
  if (!last) return MIN_ABOVE;
  const header = last.firstElementChild as HTMLElement | null;
  // The first file row, when the section is expanded.
  const firstRow = last.children[1]?.firstElementChild?.firstElementChild as HTMLElement | null;
  const bottom = (firstRow ?? header ?? last).getBoundingClientRect().bottom;
  return bottom - lists.getBoundingClientRect().top + lists.scrollTop;
};

/**
 * Drag handle on the top edge of Commit History, like the sash between
 * VS Code's Source Control views. Drag to resize, double-click to go back to
 * the automatic size, or focus it and use the arrow keys.
 */
export const CommitHistoryResizer = ({ panelRef }: { panelRef: RefObject<HTMLDivElement> }) => {
  const setHeight = useCommitHistoryHeight((s) => s.setHeight);
  const [dragging, setDragging] = useState(false);

  /** Current panel height and the most it can grow without hiding the lists above. */
  const limits = () => {
    const panel = panelRef.current;
    if (!panel) return null;
    const section = panel.closest<HTMLElement>("[data-commit-history]");
    const above = section?.previousElementSibling as HTMLElement | null;
    const height = panel.getBoundingClientRect().height;
    const aboveHeight = above?.getBoundingClientRect().height ?? 0;
    const keep = Math.min(keepVisible(above), (aboveHeight + height) * MAX_ABOVE_SHARE);
    const room = Math.max(0, aboveHeight - keep);
    return { panel, height, max: Math.max(MIN_HISTORY, height + room) };
  };

  const clamp = (value: number, max: number) => Math.round(Math.min(max, Math.max(MIN_HISTORY, value)));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const start = limits();
    if (!start) return;
    e.preventDefault();
    const startY = e.clientY;
    let next = start.height;
    setDragging(true);
    // Resize the element directly while dragging; React only re-renders once, on release.
    start.panel.style.maxHeight = "none";
    // The pointer soon leaves the 4px handle, so listen on the document (like the
    // other dividers in the app) and keep the resize cursor everywhere meanwhile.
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      next = clamp(start.height + (startY - ev.clientY), start.max);
      start.panel.style.height = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      start.panel.style.maxHeight = "";
      setDragging(false);
      setHeight(next);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const current = limits();
    if (!current) return;
    e.preventDefault();
    setHeight(clamp(current.height + (e.key === "ArrowUp" ? KEY_STEP : -KEY_STEP), current.max));
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize commit history"
      title="Drag to resize. Double-click to reset."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setHeight(null)}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute -top-0.5 inset-x-0 h-1 z-10 cursor-row-resize outline-none transition-colors",
        "hover:bg-accent/70 hover:delay-150 focus-visible:bg-accent",
        dragging && "bg-accent",
      )}
    />
  );
};
