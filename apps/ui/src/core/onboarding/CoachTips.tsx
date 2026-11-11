import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileText, Lightbulb, X } from "lucide-react";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { usePanelStore } from "@/core/stores/panelStore";
import { getQueryClient } from "@/main";
import { GETTING_STARTED_STEPS, STEP_TIPS, finishTour, nextTip, requestTip, stepById, stepTip, useGettingStartedStore, type GettingStartedStepId } from "./gettingStartedStore";

const TIP_WIDTH = 300;
const GAP = 12;
const PAD = 4;

type Rect = { top: number; left: number; right: number; bottom: number };
type Arrow = "up" | "down" | "left" | "right" | "none";
type Layout = { spot: Rect | null; tip: { top: number; left: number; arrow: Arrow; arrowAt?: number } };

const clampLeft = (left: number) => Math.max(GAP, Math.min(left, window.innerWidth - TIP_WIDTH - GAP));
const clampTop = (top: number, height: number) => Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
const rectOf = (el: Element | null | undefined): Rect | null => {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom } : null;
};
const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Screen rect of the document's last block — the end of the file, where the user types next. */
function endOfDocRect(editor: any): Rect | null {
  const { doc } = editor.state;
  const last = doc.lastChild;
  if (!last) return rectOf(editor.view.dom);
  const dom = editor.view.nodeDOM(doc.content.size - last.nodeSize) as HTMLElement | null;
  return rectOf(dom) ?? rectOf(editor.view.dom);
}

/** The request's Send button, for the step that's about clicking it. */
function sendButtonRect(editor: any): Rect | null {
  const buttons = editor.view.dom.querySelectorAll('[aria-label="Send request"], [aria-label="Cancel request"]');
  return rectOf(buttons[buttons.length - 1]);
}

/** Open editor menus (/ commands, the @ link picker): the tip must not sit under them. */
const openMenuRects = (): Rect[] =>
  Array.from(document.querySelectorAll("[data-tippy-root]")).flatMap((el) => {
    const r = rectOf(el);
    return r ? [r] : [];
  });
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

function placeAround(step: GettingStartedStepId, liveEditor: any, envEditorOpen: boolean, height: number): Layout | null {
  const { target } = stepById(step);
  const editorArea = rectOf(document.getElementById("main-editor"));
  if (target === "editor" && liveEditor) {
    const anchor = (step === "send" && sendButtonRect(liveEditor)) || endOfDocRect(liveEditor);
    if (!anchor) return null;
    // Aim the arrow at the anchor: the Send button's middle, or the start of the last line.
    const aimX = step === "send" ? (anchor.left + anchor.right) / 2 : anchor.left + 22;
    const left = clampLeft(aimX - 28);
    const arrowAt = Math.max(10, Math.min(aimX - left - 6, TIP_WIDTH - 22));
    const box = (top: number): Rect => ({ top, left, right: left + TIP_WIDTH, bottom: top + height });
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - height;
    const menus = openMenuRects();
    const clear = (top: number) => top >= GAP && top + height <= window.innerHeight - GAP && !menus.some((m) => overlaps(box(top), m));
    if (clear(below)) return { spot: editorArea, tip: { top: below, left, arrow: "up", arrowAt } };
    if (clear(above)) return { spot: editorArea, tip: { top: above, left, arrow: "down", arrowAt } };
    // A menu is open on both sides of the line: sit beside it instead.
    const menu = menus[0];
    if (menu) {
      const side = menu.right + GAP + TIP_WIDTH <= window.innerWidth - GAP ? menu.right + GAP : menu.left - GAP - TIP_WIDTH;
      return { spot: editorArea, tip: { top: clampTop(menu.top, height), left: Math.max(GAP, side), arrow: "none" } };
    }
    return below + height < window.innerHeight - GAP
      ? { spot: editorArea, tip: { top: below, left, arrow: "up", arrowAt } }
      : { spot: editorArea, tip: { top: clampTop(above, height), left, arrow: "down", arrowAt } };
  }
  if (target === "envEditor" && envEditorOpen && editorArea) {
    // Bottom-right: the top of the Environments editor holds its tabs and actions.
    return { spot: editorArea, tip: { top: clampTop(editorArea.bottom - height - 16, height), left: clampLeft(editorArea.right - TIP_WIDTH - 24), arrow: "none" } };
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
 * with a Next button; "Got it" moves straight on; ✕ (or Esc outside the editor) ends the tour.
 */
export function CoachTips({ docOpen, activeTabType, activeTabTitle }: { docOpen: boolean; activeTabType?: string; activeTabTitle?: string }) {
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
  // A step that lives in a file only shows over that file: after a tab switch its
  // instructions ("at the end of the file…") would describe a file you're not looking at.
  const stepFile = tipStep ? stepById(tipStep).file : undefined;
  const onStepFile = !stepFile || (docOpen && activeTabTitle === stepFile);
  const onStart = activeTabType === "welcome" || activeTabType === "projectSetup";
  const canShow = onStepFile && (target === "editor" ? !!liveEditor : !!target && !onStart);
  const shown = tipStep && canShow ? tipStep : null;
  // Off the step's file (and not on the Start tab, which is its own onboarding): offer to go back.
  // Wait a moment first, so it doesn't flash while the tour itself is opening that file.
  const elsewhere = !!tipStep && !!stepFile && !onStepFile && !onStart;
  const [showElsewhere, setShowElsewhere] = useState(false);
  useEffect(() => {
    if (!elsewhere) return setShowElsewhere(false);
    const t = window.setTimeout(() => setShowElsewhere(true), 400);
    return () => window.clearTimeout(t);
  }, [elsewhere, tipStep]);

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
      frame = requestAnimationFrame(() => setLayout(placeAround(shown, liveEditor, envEditorOpen, ref.current?.offsetHeight ?? 160)));
    };
    update();
    const events = ["update", "transaction"] as const;
    events.forEach((e) => liveEditor?.on(e, update));
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // Panels open and expand without an editor event; follow them lightly.
    const poll = window.setInterval(update, 300);
    const onKey = (e: KeyboardEvent) => {
      // Esc while typing closes menus (the @ picker, / commands) or leaves a field; it mustn't also end the tour.
      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest?.('input, textarea, select, [contenteditable="true"], [data-tippy-root]');
      if (e.key === "Escape" && !e.defaultPrevented && !typing) closeTip();
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

  if (elsewhere && showElsewhere && tipStep && stepFile) {
    const stepNumber = GETTING_STARTED_STEPS.findIndex((s) => s.id === tipStep) + 1;
    return (
      <div
        role="dialog"
        aria-label={STEP_TIPS[tipStep].title}
        onMouseDown={(e) => e.preventDefault()}
        style={{ bottom: 60, right: 24, width: TIP_WIDTH }}
        className="fixed z-50 flex flex-col gap-2 p-4 rounded-xl bg-text text-bg shadow-xl select-none"
      >
        <span className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-60">
            <Lightbulb size={12} />
            Step {stepNumber} of {GETTING_STARTED_STEPS.length} · paused
          </span>
          <button type="button" aria-label="End the tour" onClick={closeTip} className="p-0.5 rounded opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </span>
        <span className="text-sm font-semibold">{STEP_TIPS[tipStep].title}</span>
        <span className="text-xs leading-relaxed opacity-80">
          This step happens in <span className="font-mono">{stepFile}</span>. Go back to it to carry on.
        </span>
        <button
          type="button"
          onClick={() => requestTip(tipStep)}
          className="self-start mt-1 h-8 px-3 rounded-md bg-bg text-text text-xs font-semibold hover:opacity-90 flex items-center gap-1.5"
        >
          <FileText size={12} /> Open {stepFile}
        </button>
      </div>
    );
  }

  if (!shown || !layout) return null;

  const tip = STEP_TIPS[shown];
  const body = stepById(shown).target === "envEditor" && !envEditorOpen && tip.open ? tip.open : tip.body;
  const stepNumber = GETTING_STARTED_STEPS.findIndex((s) => s.id === shown) + 1;
  const isLast = stepNumber === GETTING_STARTED_STEPS.length;
  const arrowStyle = {
    up: { top: -6, left: layout.tip.arrowAt ?? 22 },
    down: { bottom: -6, left: layout.tip.arrowAt ?? 22 },
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
            onClick={() => (tipDone && isLast ? finishTour() : nextTip())}
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
        <span className="text-[10px] opacity-50">✕ ends the tour</span>
      </div>
    </>
  );
}
