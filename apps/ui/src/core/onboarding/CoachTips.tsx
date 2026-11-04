import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Lightbulb, X } from "lucide-react";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { usePanelStore } from "@/core/stores/panelStore";
import { getQueryClient } from "@/main";
import { GETTING_STARTED_STEPS, STEP_TIPS, nextTip, stepById, stepTip, useGettingStartedStore, type GettingStartedStepId } from "./gettingStartedStore";

const TIP_WIDTH = 300;
const GAP = 12;
const PAD = 4;

type Rect = { top: number; left: number; right: number; bottom: number };
type Arrow = "up" | "down" | "left" | "right" | "none";
type Layout = { spot: Rect | null; tip: { top: number; left: number; arrow: Arrow } };

const clampLeft = (left: number) => Math.max(GAP, Math.min(left, window.innerWidth - TIP_WIDTH - GAP));
const clampTop = (top: number, height: number) => Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
const rectOf = (el: Element | null | undefined): Rect | null => {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom } : null;
};

/** Screen rect of the document's last block — the end of the file, where the user types next. */
function endOfDocRect(editor: any): Rect | null {
  const { doc } = editor.state;
  const last = doc.lastChild;
  if (!last) return rectOf(editor.view.dom);
  const dom = editor.view.nodeDOM(doc.content.size - last.nodeSize) as HTMLElement | null;
  return rectOf(dom) ?? rectOf(editor.view.dom);
}

/** Reveal what a step needs: the end of the file, room for the Environments editor, Source Control, or the checklist's commands. */
async function prepareStep(step: GettingStartedStepId, editor: any, envEditorOpen: boolean) {
  const { target } = stepById(step);
  if (target === "envEditor") {
    if (!envEditorOpen) return;
    const panels = usePanelStore.getState();
    panels.closeRightPanel();
    panels.rightPanelRef?.current?.collapse();
  } else if (target === "editor" && editor && !editor.isDestroyed) {
    editor.commands.focus("end", { scrollIntoView: true });
  } else if (target === "sidebar") {
    const panels = usePanelStore.getState();
    panels.openLeftPanel();
    panels.leftPanelRef?.current?.expand();
    const tabs = await window.electron?.sidebar.getTabs("left");
    const git = tabs?.tabs?.find((t: any) => t.type === "gitSourceControl");
    if (git) {
      await window.electron?.sidebar.activateTab("left", git.id);
      await getQueryClient().invalidateQueries({ queryKey: ["sidebar:tabs", "left"] });
    }
  } else if (target === "card") {
    useGettingStartedStore.getState().setExpanded(true);
  }
}

function placeAround(target: ReturnType<typeof stepById>["target"], liveEditor: any, envEditorOpen: boolean, height: number): Layout | null {
  const editorArea = rectOf(document.getElementById("main-editor"));
  if (target === "editor" && liveEditor) {
    const end = endOfDocRect(liveEditor);
    if (!end) return null;
    const left = clampLeft(end.left);
    const below = end.bottom + GAP;
    return below + height < window.innerHeight - GAP
      ? { spot: editorArea, tip: { top: below, left, arrow: "up" } }
      : { spot: editorArea, tip: { top: clampTop(end.top - GAP - height, height), left, arrow: "down" } };
  }
  if (target === "envEditor" && envEditorOpen && editorArea) {
    return { spot: editorArea, tip: { top: editorArea.top + 16, left: clampLeft(editorArea.right - TIP_WIDTH - 24), arrow: "none" } };
  }
  // Before the Environments editor is open, point at the picker it opens from.
  if (target === "env" || target === "envEditor") {
    const spot = rectOf(document.querySelector('[data-onboarding="env-selector"]'));
    if (spot) return { spot, tip: { top: spot.bottom + GAP, left: clampLeft(spot.left), arrow: "up" } };
  }
  if (target === "sidebar") {
    const spot = rectOf(document.getElementById("left-sidebar"));
    if (spot) return { spot, tip: { top: clampTop(spot.top + 48, height), left: clampLeft(spot.right + GAP), arrow: "left" } };
  }
  const card = rectOf(document.getElementById("getting-started-card"));
  if (card) return { spot: card, tip: { top: clampTop(card.bottom - height, height), left: clampLeft(card.left - TIP_WIDTH - GAP), arrow: "right" } };
  return { spot: null, tip: { top: window.innerHeight - height - 60, left: clampLeft(window.innerWidth - TIP_WIDTH - 24), arrow: "none" } };
}

/**
 * The guided tour's tip for one step. While it's open the rest of the window is dimmed and
 * blocked, so the user stays on that step. Doing the step switches the tip to a "done" note
 * with a Next button; "Got it" moves straight on; ✕ or Esc ends the tour and frees the window.
 */
export function CoachTips({ docOpen, activeTabType }: { docOpen: boolean; activeTabType?: string }) {
  const tipStep = useGettingStartedStore((s) => s.tipStep);
  const tipDone = useGettingStartedStore((s) => s.tipDone);
  const closeTip = useGettingStartedStore((s) => s.closeTip);
  const editor = useVoidenEditorStore((s) => s.editor);
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const liveEditor = docOpen && editor && !editor.isDestroyed ? editor : null;

  // Editor steps need their .void file open; the rest can show over anything except the
  // Start tab. The env-variable step first shows how to open the Environments editor.
  const target = tipStep ? stepById(tipStep).target : null;
  const envEditorOpen = activeTabType === "environmentEditor";
  const canShow = target === "editor" ? !!liveEditor : !!target && activeTabType !== "welcome";
  const shown = tipStep && canShow ? tipStep : null;

  useEffect(() => {
    if (shown && !tipDone) prepareStep(shown, liveEditor, envEditorOpen);
    // Only when the step (or the document or tab it points into) changes — not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, liveEditor, envEditorOpen]);

  useEffect(() => {
    if (!shown) {
      setLayout(null);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayout(placeAround(stepById(shown).target, liveEditor, envEditorOpen, ref.current?.offsetHeight ?? 160)));
    };
    update();
    const events = ["update", "transaction"] as const;
    events.forEach((e) => liveEditor?.on(e, update));
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // Panels open and expand without an editor event; follow them lightly.
    const poll = window.setInterval(update, 300);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeTip();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((e) => liveEditor?.off(e, update));
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKey);
      window.clearInterval(poll);
    };
  }, [shown, liveEditor, envEditorOpen, closeTip]);

  if (!shown || !layout) return null;

  const tip = STEP_TIPS[shown];
  const body = stepById(shown).target === "envEditor" && !envEditorOpen && tip.open ? tip.open : tip.body;
  const stepNumber = GETTING_STARTED_STEPS.findIndex((s) => s.id === shown) + 1;
  const isLast = stepNumber === GETTING_STARTED_STEPS.length;
  const arrowStyle = {
    up: { top: -6, left: 22 },
    down: { bottom: -6, left: 22 },
    left: { left: -6, top: 22 },
    right: { right: -6, bottom: 22 },
    none: null,
  }[layout.tip.arrow];

  // Four dim panes around the spotlit area block clicks everywhere else; the area itself stays usable.
  // Once the step is done the dimming lifts, so the user can look at the result (e.g. the response).
  const s = !tipDone && layout.spot && {
    top: layout.spot.top - PAD,
    left: layout.spot.left - PAD,
    right: layout.spot.right + PAD,
    bottom: layout.spot.bottom + PAD,
  };
  const blockers = s
    ? [
        { top: 0, left: 0, width: "100vw", height: Math.max(0, s.top) },
        { top: s.bottom, left: 0, width: "100vw", height: `calc(100vh - ${s.bottom}px)` },
        { top: s.top, left: 0, width: Math.max(0, s.left), height: s.bottom - s.top },
        { top: s.top, left: s.right, width: `calc(100vw - ${s.right}px)`, height: s.bottom - s.top },
      ]
    : [];

  return (
    <>
      {blockers.map((style, i) => (
        <div key={i} aria-hidden className="fixed z-40 bg-black/55" style={style} onMouseDown={(e) => e.preventDefault()} />
      ))}
      {s && (
        <div
          aria-hidden
          className="fixed z-40 pointer-events-none rounded-lg ring-2 ring-accent/70"
          style={{ top: s.top, left: s.left, width: s.right - s.left, height: s.bottom - s.top }}
        />
      )}
      <div
        ref={ref}
        role="dialog"
        aria-label={tip.title}
        // Keep focus where it is (e.g. the end of the file), so clicking the tip doesn't move the caret.
        onMouseDown={(e) => e.preventDefault()}
        style={{ top: layout.tip.top, left: layout.tip.left, width: TIP_WIDTH }}
        className="fixed z-50 flex flex-col gap-2 p-4 rounded-xl bg-text text-bg shadow-xl select-none"
      >
        {arrowStyle && <span aria-hidden className="absolute w-3 h-3 bg-text rotate-45" style={arrowStyle} />}
        <span className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-60">
            {tipDone ? <Check size={12} /> : <Lightbulb size={12} />}
            Step {stepNumber} of {GETTING_STARTED_STEPS.length}
            {tipDone && " · done"}
          </span>
          <button type="button" aria-label="End the tour" onClick={closeTip} className="p-0.5 rounded opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </span>
        <span className="text-sm font-semibold">{tipDone ? `Nice. ${tip.title}: done.` : tip.title}</span>
        <span className="text-xs leading-relaxed opacity-80">{tipDone ? tip.done : body}</span>
        <span className="flex items-center justify-between mt-1">
          <button
            type="button"
            onClick={() => (tipDone && isLast ? closeTip() : nextTip())}
            className="h-8 px-3 rounded-md bg-bg text-text text-xs font-semibold hover:opacity-90"
          >
            {tipDone ? (isLast ? "Finish" : "Next step →") : "Got it"}
          </button>
          {/* Move between tips in order, whether or not each step is done. */}
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous tip"
              disabled={stepNumber === 1}
              onClick={() => stepTip(-1)}
              className="h-7 w-7 flex items-center justify-center rounded-md opacity-70 hover:opacity-100 hover:bg-bg/15 disabled:opacity-25 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Next tip"
              disabled={isLast}
              onClick={() => stepTip(1)}
              className="h-7 w-7 flex items-center justify-center rounded-md opacity-70 hover:opacity-100 hover:bg-bg/15 disabled:opacity-25 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} />
            </button>
          </span>
        </span>
        <span className="text-[10px] opacity-50">Esc ends the tour</span>
      </div>
    </>
  );
}
