import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileText, Lightbulb, X } from "lucide-react";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { usePanelStore } from "@/core/stores/panelStore";
import { getQueryClient } from "@/main";
import { useGetGitStatus, useIsGitRepo } from "@/core/git/hooks";
import { useEnvironments } from "@/core/environment/hooks";
import { revealPluginsTab } from "@/core/extensions/utils/revealPluginsTab";
import { GETTING_STARTED_STEPS, STEP_TIPS, finishTour, nextTip, requestTip, stepById, stepTip, useGettingStartedStore, type GettingStartedStepId } from "./gettingStartedStore";

const TIP_WIDTH = 260;
const GAP = 12;
const PAD = 4;

type Rect = { top: number; left: number; right: number; bottom: number };
type Arrow = "up" | "down" | "left" | "right" | "none";
type CommitPhase = "init" | "stage" | "commit";
/** The commit step in three parts, each explained, since Git may be new to the user. */
const COMMIT_PHASES: { id: CommitPhase; label: string; body: string }[] = [
  {
    id: "init",
    label: "1 Initialize",
    body: "This project isn't a Git repo yet. Click Initialize Repository: it starts tracking this folder on your machine. Nothing is uploaded.",
  },
  {
    id: "stage",
    label: "2 Stage",
    body: "Your .void files show under Changes. Click + beside Changes to stage them all: staged files are what goes into the commit.",
  },
  {
    id: "commit",
    label: "3 Commit",
    body: "Type a message, like \"My first requests\", and click Commit. That saves this version of your files in Git's history.",
  },
];
type Layout = { spot: Rect | null; tip: { top: number; left: number; arrow: Arrow; arrowAt?: number } };

const clampLeft = (left: number) => Math.max(GAP, Math.min(left, window.innerWidth - TIP_WIDTH - GAP));
const clampTop = (top: number, height: number) => Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
const rectOf = (el: Element | null | undefined): Rect | null => {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom } : null;
};
const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Open editor menus (/ commands, the @ link picker): the tip must not sit under them. */
const openMenuRects = (): Rect[] =>
  Array.from(document.querySelectorAll("[data-tippy-root]")).flatMap((el) => {
    const r = rectOf(el);
    return r ? [r] : [];
  });
/** Reveal what a step needs: the end of the file, room for the Environments editor, Source Control, or the checklist's commands. */
async function prepareStep(step: GettingStartedStepId, editor: any, envEditorOpen: boolean) {
  const { target } = stepById(step);
  // The checklist stays on screen through the tour as a pill; only the step that uses it opens it.
  useGettingStartedStore.getState().setExpanded(target === "card");
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
  } else if (target === "plugins" || (target === "pluginActions" && !document.querySelector('[data-onboarding="plugin-actions"]'))) {
    revealPluginsTab();
  }
}

function placeAround(step: GettingStartedStepId, liveEditor: any, envEditorOpen: boolean, height: number): Layout | null {
  const { target } = stepById(step);
  const editorArea = rectOf(document.getElementById("main-editor"));
  if (target === "editor" && liveEditor && editorArea) {
    // The file itself explains the step: the tip stays put in the editor's top-right corner,
    // and moves to the bottom-right while an editor menu (/ commands, the @ picker) would sit under it.
    const left = clampLeft(editorArea.right - TIP_WIDTH - 16);
    const box = (top: number): Rect => ({ top, left, right: left + TIP_WIDTH, bottom: top + height });
    const topRight = editorArea.top + 16;
    const covered = openMenuRects().some((m) => overlaps(box(topRight), m));
    // Bottom-right, above the checklist pill (32px tall, 16px from the edge).
    const top = covered ? clampTop(editorArea.bottom - height - 64, height) : topRight;
    return { spot: editorArea, tip: { top, left, arrow: "none" } };
  }
  if (target === "envEditor" && envEditorOpen && editorArea) {
    // Bottom-right, above the checklist pill: the top of the Environments editor holds its tabs and actions.
    return { spot: editorArea, tip: { top: clampTop(editorArea.bottom - height - 64, height), left: clampLeft(editorArea.right - TIP_WIDTH - 24), arrow: "none" } };
  }
  // Before the Environments editor is open, point at the picker it opens from.
  if (target === "env" || target === "envEditor") {
    const spot = rectOf(document.querySelector('[data-onboarding="env-selector"]'));
    if (spot) return { spot, tip: { top: spot.bottom + GAP, left: clampLeft(spot.left), arrow: "up" } };
  }
  // A plugin's Enable / Disable / Uninstall buttons, on its details page; until one is open, the list.
  if (target === "pluginActions") {
    const spot = rectOf(document.querySelector('[data-onboarding="plugin-actions"]'));
    if (spot) return { spot, tip: { top: spot.bottom + GAP, left: clampLeft(spot.left), arrow: "up" } };
  }
  if (target === "sidebar" || target === "plugins" || target === "pluginActions") {
    const spot = rectOf(document.getElementById("left-sidebar"));
    if (spot) return { spot, tip: { top: clampTop(spot.top + 48, height), left: clampLeft(spot.right + GAP), arrow: "left" } };
  }
  const card = rectOf(document.getElementById("getting-started-card"));
  if (card) return { spot: card, tip: { top: clampTop(card.bottom - height, height), left: clampLeft(card.left - TIP_WIDTH - GAP), arrow: "right" } };
  return { spot: null, tip: { top: window.innerHeight - height - 60, left: clampLeft(window.innerWidth - TIP_WIDTH - 24), arrow: "none" } };
}

/**
 * The guided tour's tip for one step: a title and one line of what to do (the step's file holds
 * the details). Doing the step switches it to a "done" line with a Next button; the arrows
 * move between tips either way; ✕ (or Esc outside the editor) ends the tour.
 */
export function CoachTips({ docOpen, activeTabType, activeTabTitle }: { docOpen: boolean; activeTabType?: string; activeTabTitle?: string }) {
  const tipStep = useGettingStartedStore((s) => s.tipStep);
  const tipDone = useGettingStartedStore((s) => s.tipDone);
  // Send needs an environment: without one {{baseUrl}} stays unresolved and the request fails,
  // which doesn't count. Say so instead of repeating "Click Send".
  const { data: envs } = useEnvironments();
  const noEnv = tipStep === "send" && !!envs && !envs.activeEnv;
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

  // "Open a plugin" is done once its page is open. Its tip sits by the list, on top of that page,
  // so move straight on to the next step, which points at the page's own buttons. Only when it
  // was just done: going back to it with the arrows shows it as done and stays there.
  const pluginsWasOpen = useRef(false);
  useEffect(() => {
    const justDone = shown === "plugins" && tipDone && pluginsWasOpen.current;
    pluginsWasOpen.current = shown === "plugins" && !tipDone;
    if (!justDone) return;
    const t = window.setTimeout(() => nextTip(), 700);
    return () => window.clearTimeout(t);
  }, [shown, tipDone]);

  // Commit: the project usually isn't a Git repo yet, so walk through it — initialize, stage,
  // commit — and say what each part means, following Source Control's state as it changes.
  const { data: isRepo } = useIsGitRepo();
  const { data: gitStatus } = useGetGitStatus();
  const commitPhase: CommitPhase = !isRepo ? "init" : gitStatus?.staged?.length ? "commit" : "stage";

  // "Reuse" imports the headers block from 2-headers.void: if that step was skipped there's
  // nothing to import, so send the user back to it first instead of a step that can't work.
  const headersDone = useGettingStartedStore((s) => !!s.done.headers);
  const [headersMissing, setHeadersMissing] = useState(false);
  useEffect(() => {
    setHeadersMissing(false);
    if (shown !== "reuse" || headersDone) return;
    let cancelled = false;
    (async () => {
      const root: string | undefined = (await window.electron?.state.getProjects())?.activeProject;
      const file = stepById("headers").file!;
      const path = root && (await window.electron?.utils.pathJoin(root, file));
      const text: string = path ? ((await window.electron?.files.read(path).catch(() => "")) ?? "") : "";
      if (!cancelled) setHeadersMissing(!/type:\s*headers-table/.test(text));
    })();
    return () => {
      cancelled = true;
    };
  }, [shown, headersDone]);
  useEffect(() => {
    if (!elsewhere) return setShowElsewhere(false);
    const t = window.setTimeout(() => setShowElsewhere(true), 400);
    return () => window.clearTimeout(t);
  }, [elsewhere, tipStep]);

  useEffect(() => {
    // Done steps too: going back to one still shows where it happens.
    if (shown) prepareStep(shown, liveEditor, envEditorOpen);
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
            {stepNumber} of {GETTING_STARTED_STEPS.length} · paused
          </span>
          <button type="button" aria-label="End the tour" onClick={closeTip} className="p-0.5 rounded opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </span>
        <span className="text-sm font-semibold">{STEP_TIPS[tipStep].title}</span>
        <span className="text-xs leading-relaxed opacity-80">
          This step is in <span className="font-mono">{stepFile}</span>.
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

  // Enable / Disable step: once the plugin is off, the next move is turning it back on.
  const pluginOff =
    shown === "pluginActions" && document.querySelector('[data-onboarding="plugin-actions"]')?.getAttribute("data-enabled") === "false";

  const tip = STEP_TIPS[shown];
  const body =
    shown === "commit"
      ? COMMIT_PHASES.find((p) => p.id === commitPhase)!.body
      : tip.open &&
          ((stepById(shown).target === "envEditor" && !envEditorOpen) ||
            (stepById(shown).target === "pluginActions" && activeTabType !== "extensionDetails"))
        ? tip.open
        : tip.body;
  const stepNumber = GETTING_STARTED_STEPS.findIndex((s) => s.id === shown) + 1;
  const isLast = stepNumber === GETTING_STARTED_STEPS.length;
  const arrowStyle = {
    up: { top: -6, left: layout.tip.arrowAt ?? 22 },
    down: { bottom: -6, left: layout.tip.arrowAt ?? 22 },
    left: { left: -6, top: 22 },
    right: { right: -6, bottom: 22 },
    none: null,
  }[layout.tip.arrow];

  // No dimming: the window stays usable. A ring shows where the step happens: the editor
  // (whose file holds the steps), the environment picker, Source Control or the checklist.
  const ring =
    !tipDone && layout.spot && !(stepById(shown).target === "envEditor" && envEditorOpen)
      ? { top: layout.spot.top - PAD, left: layout.spot.left - PAD, right: layout.spot.right + PAD, bottom: layout.spot.bottom + PAD }
      : null;

  return (
    <>
      {ring && (
        <div
          aria-hidden
          className="fixed z-40 pointer-events-none rounded-lg ring-2 ring-accent/70"
          style={{ top: ring.top, left: ring.left, width: ring.right - ring.left, height: ring.bottom - ring.top }}
        />
      )}
      <div
        ref={ref}
        role="dialog"
        aria-label={tip.title}
        // Keep focus where it is (e.g. the end of the file), so clicking the tip doesn't move the caret.
        onMouseDown={(e) => e.preventDefault()}
        style={{ top: layout.tip.top, left: layout.tip.left, width: TIP_WIDTH }}
        className="fixed z-50 flex flex-col gap-1.5 p-3 rounded-xl bg-text text-bg shadow-xl select-none"
      >
        {arrowStyle && <span aria-hidden className="absolute w-3 h-3 bg-text rotate-45" style={arrowStyle} />}
        <span className="flex items-center justify-between">
          {/* Done reads at a glance: a green check and "Done", not the faded step count alone. */}
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {tipDone ? (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white">
                <Check size={10} strokeWidth={3} />
              </span>
            ) : (
              <Lightbulb size={12} className="opacity-60" />
            )}
            <span className="opacity-60">
              {stepNumber} of {GETTING_STARTED_STEPS.length}
            </span>
            {tipDone && <span className="text-emerald-500">Done</span>}
          </span>
          <button type="button" aria-label="End the tour" onClick={closeTip} className="p-0.5 rounded opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </span>
        <span className="text-sm font-semibold">{tip.title}</span>
        {shown === "commit" && !tipDone && (
          <span className="flex items-center gap-1 text-[10px] font-semibold">
            {COMMIT_PHASES.map((p, i) => {
              const at = COMMIT_PHASES.findIndex((q) => q.id === commitPhase);
              return (
                <span key={p.id} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-30">·</span>}
                  <span className={i === at ? "opacity-100" : i < at ? "opacity-50 line-through" : "opacity-40"}>{p.label}</span>
                </span>
              );
            })}
          </span>
        )}
        <span className="text-xs leading-relaxed opacity-80">
          {tipDone
            ? tip.done
            : noEnv
              ? "No environment is picked, so {{baseUrl}} can't resolve and the request fails. Pick Local first, then send."
              : headersMissing
              ? "This imports the headers block from 2-headers.void. Add it there first."
              : pluginOff
                ? "It's off now: its blocks stop working. Click Enable to turn it back on."
                : body}
        </span>
        {tip.points && !tipDone && (
          <ul className="m-0 pl-4 flex flex-col gap-1 list-disc text-xs leading-relaxed opacity-80">
            {tip.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {noEnv && !tipDone && (
          <button
            type="button"
            onClick={() => requestTip("selectEnv")}
            className="self-start h-7 px-3 rounded-md bg-bg text-text text-xs font-semibold hover:opacity-90"
          >
            Pick an environment
          </button>
        )}
        {headersMissing && !tipDone && (
          <button
            type="button"
            onClick={() => requestTip("headers")}
            className="self-start h-7 px-3 rounded-md bg-bg text-text text-xs font-semibold hover:opacity-90 flex items-center gap-1.5"
          >
            <FileText size={12} /> Open 2-headers.void
          </button>
        )}
        <span className="flex items-center justify-between mt-1">
          {/* Done: a clear way on. Not done yet, the arrows are enough to move between tips. */}
          {tipDone ? (
            <button
              type="button"
              onClick={() => (isLast ? finishTour() : nextTip())}
              className="h-7 px-3 rounded-md bg-bg text-text text-xs font-semibold hover:opacity-90"
            >
              {isLast ? "Finish" : "Next →"}
            </button>
          ) : (
            <span />
          )}
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
      </div>
    </>
  );
}
