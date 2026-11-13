import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isMac } from "@/core/lib/utils";

/** Where a step's tip points, and what the rest of the window is dimmed around. */
export type StepTarget = "editor" | "env" | "envEditor" | "sidebar" | "plugins" | "pluginActions" | "card";

/**
 * The guided tour, in order. Each editor step lives in its own file of the playground
 * project (apps/electron/src/playground-project), which is opened when the step starts.
 * The file explains the step; the tip only says what to do next, in a line.
 * 4-form-with-file.void and 5-binary-body.void stay in the playground as extra examples.
 */
export const GETTING_STARTED_STEPS = [
  { id: "selectEnv", label: "Pick an environment", file: "1-first-request.void", target: "env" },
  { id: "send", label: "Send your first request", file: "1-first-request.void", target: "editor" },
  { id: "writeEnv", label: "Write an environment variable", target: "envEditor" },
  { id: "headers", label: "Add a headers block", file: "2-headers.void", target: "editor" },
  { id: "blockMenu", label: "Open a block's menu", file: "2-headers.void", target: "editor" },
  { id: "reuse", label: "Reuse a block with @", file: "3-reuse-blocks.void", target: "editor" },
  { id: "commit", label: "Commit it to Git", target: "sidebar" },
  { id: "plugins", label: "Open a plugin", target: "plugins" },
  { id: "pluginActions", label: "Enable, disable or uninstall a plugin", target: "pluginActions" },
  { id: "outside", label: "Run it outside the app", target: "card" },
] as const satisfies readonly { id: string; label: string; file?: string; target: StepTarget }[];

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number]["id"];

export const stepById = (id: GettingStartedStepId): { id: GettingStartedStepId; label: string; file?: string; target: StepTarget } =>
  GETTING_STARTED_STEPS.find((s) => s.id === id)!;

/**
 * Each step's tip: one short action while it's open, one line once it's done. Steps in a
 * file keep the details in that file, so there's one place to read, not two.
 */
export const STEP_TIPS: Record<GettingStartedStepId, { title: string; body: string; done: string; open?: string; points?: string[] }> = {
  selectEnv: {
    title: "Pick an environment",
    body: "Click the environment picker in the top bar (it says No environment) and choose Local.",
    done: "{{user}} in the request now comes from Local.",
  },
  send: {
    title: "Send your first request",
    body: "Click Send, or press Cmd/Ctrl+Enter.",
    done: "Your response is on the right.",
  },
  writeEnv: {
    title: "Write an environment variable",
    open: "Click the environment picker in the top bar, then Edit Environments.",
    body: "In Local, add a Private variable named token.",
    done: "{{token}} is saved, and kept out of Git.",
  },
  headers: {
    title: "Add a headers block",
    body: "Type /headers at the end of the file.",
    done: "Headers added. Send it to see them in the response.",
  },
  blockMenu: {
    title: "Open a block's menu",
    body: `Click ⋮⋮ beside the headers block, or put the cursor in it and press ${isMac ? "⌘." : "Ctrl+."}`,
    done: "Copy, link, duplicate or delete any block from this menu.",
  },
  reuse: {
    title: "Reuse a block with @",
    body: "Type @ at the end of the file and pick 2-headers.void.",
    done: "Those headers are linked from 2-headers.void.",
  },
  commit: {
    title: "Commit it to Git",
    // The tip shows Initialize → Stage → Commit from Source Control's state (CoachTips).
    body: "In Source Control, stage the .void files and commit them.",
    done: "Committed. To share it, use Link a remote repository below to publish it to GitHub, GitLab or similar.",
  },
  plugins: {
    title: "Open a plugin",
    body: "Plugins add the blocks you've used. Click one to see what it adds.",
    points: ["Filter by Core (built in) or Community."],
    done: "This is its page: what it adds, its version and changelog.",
  },
  pluginActions: {
    title: "Enable, disable or uninstall",
    open: "Open a plugin from the list first.",
    body: "Click Disable to turn it off, then Enable to bring it back. Uninstall removes it; you can install it again any time.",
    done: "That's how you manage any plugin, here or from ⚙ in the list.",
  },
  outside: {
    title: "Run it outside the app",
    body: "Copy a command below to run these files in CI or from an AI agent.",
    done: "That's the tour. Find it again under Help → Getting Started Checklist.",
  },
};

interface GettingStartedState {
  done: Partial<Record<GettingStartedStepId, boolean>>;
  /** Whether the checklist card is shown. Off for existing users; turned on by a fresh install or on request. */
  visible: boolean;
  /** Checklist card expanded to show every step. */
  expanded: boolean;
  /** The step whose tip is on screen, if any. Closing it ends the tour until it's asked for again. */
  tipStep: GettingStartedStepId | null;
  /** The open tip's step was just completed: show its "done" note and a Next button. */
  tipDone: boolean;
  markDone: (id: GettingStartedStepId) => void;
  toggleStep: (id: GettingStartedStepId) => void;
  setVisible: (visible: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  showTip: (id: GettingStartedStepId) => void;
  closeTip: () => void;
  /** Fresh install: show the checklist. The first tip waits until the playground is open. */
  begin: () => void;
}

export const useGettingStartedStore = create<GettingStartedState>()(
  persist(
    (set) => ({
      done: {},
      visible: false,
      expanded: false,
      tipStep: null,
      tipDone: false,
      markDone: (id) =>
        set((s) => (s.done[id] ? s : { done: { ...s.done, [id]: true }, tipDone: s.tipStep === id ? true : s.tipDone })),
      toggleStep: (id) =>
        set((s) => ({ done: { ...s.done, [id]: !s.done[id] }, tipDone: s.tipStep === id ? !s.done[id] : s.tipDone })),
      // Hiding the checklist also ends a tip that points at it (the last step's "copy the command
      // below"), which would otherwise be left floating with nothing to point at.
      setVisible: (visible) =>
        set((s) => (!visible && s.tipStep && stepById(s.tipStep).target === "card" ? { visible, tipStep: null, tipDone: false } : { visible })),
      setExpanded: (expanded) => set({ expanded }),
      // Re-showing the open step (e.g. coming back to its file) keeps its "done" note.
      // A step that's already done opens in its done state, so moving back through the tips shows it.
      showTip: (id) => set((s) => ({ tipStep: id, tipDone: !!s.done[id] })),
      closeTip: () => set({ tipStep: null, tipDone: false }),
      begin: () => set({ visible: true }),
    }),
    {
      name: "voiden-getting-started",
      version: 3,
      // v1 had other step ids: start over. v2 had two more steps (form, binary): keep
      // progress on the steps that remain, and drop an open tip that may be a removed step.
      migrate: (state: any, version) => {
        const kept = version >= 2 ? state?.done ?? {} : {};
        const done = Object.fromEntries(GETTING_STARTED_STEPS.filter((s) => kept[s.id]).map((s) => [s.id, true]));
        return { visible: !!state?.visible, expanded: false, done, tipStep: null, tipDone: false } as any;
      },
      // A finished checklist left showing (from before it put itself away) shouldn't come back on launch.
      onRehydrateStorage: () => (state) => {
        // Rehydration can run while the store is still being created: defer the write.
        if (state && allStepsDone(state.done) && state.visible)
          queueMicrotask(() => useGettingStartedStore.setState({ visible: false, expanded: false }));
      },
    },
  ),
);

export function allStepsDone(done: Partial<Record<GettingStartedStepId, boolean>> | undefined) {
  return GETTING_STARTED_STEPS.every((s) => done?.[s.id]);
}

// Once every step is done and no tip is open, put the checklist away so it doesn't stay
// pinned over the editor. This covers ticking the last step by hand and closing the tip
// after the last step; the tip's own Finish button goes through finishTour directly.
// Reopening it from Help afterwards isn't a transition, so it stays until dismissed.
useGettingStartedStore.subscribe((s, prev) => {
  if (!s.visible || s.tipStep || !allStepsDone(s.done)) return;
  if (allStepsDone(prev.done) && !prev.tipStep) return;
  finishTour();
});

/** Callable from non-React code (mutation callbacks, plugin events). */
export const markGettingStartedStep = (id: GettingStartedStepId) => useGettingStartedStore.getState().markDone(id);

/** Commands shown on the Start tab and in the checklist for running .void files outside the app. */
export const RUNNER_COMMANDS = {
  ci: "npx @voiden/runner run ./ --stop-on-failure",
  mcp: "npx @voiden/runner mcp install",
};

/**
 * Switch to the playground (the checklist only shows there, and its steps only work on its
 * files), creating it if needed. Returns false, after telling the user, if that failed.
 */
async function goToPlayground(): Promise<boolean> {
  try {
    const { openPlaygroundProject } = await import("./playground");
    await openPlaygroundProject();
    return true;
  } catch (e) {
    const { toast } = await import("@/core/components/ui/sonner");
    toast.error("Couldn't open the playground", { description: e instanceof Error ? e.message : undefined });
    return false;
  }
}

/** Re-show the checklist in the editor's corner, opened up so the steps are visible, in the playground. */
export async function showGettingStartedChecklist() {
  if (!(await goToPlayground())) return;
  useGettingStartedStore.setState({ visible: true, expanded: true });
}

async function activeMainTab() {
  const tabs = await window.electron?.state.getPanelTabs("main");
  return tabs?.tabs?.find((t: any) => t.id === tabs?.activeTabId);
}

const TOUR_FILES = new Set<string>(GETTING_STARTED_STEPS.flatMap((s) => ("file" in s ? [s.file] : [])));

/**
 * Write any tour file with unsaved edits to disk. Later steps read earlier files from disk
 * (the @ picker in "reuse" lists 2-headers.void's blocks), so edits must not stay in memory.
 */
export async function saveTourFiles() {
  const tabs = await window.electron?.state.getPanelTabs("main");
  const { useEditorStore } = await import("@/core/editors/voiden/VoidenEditor");
  const { saveTabById } = await import("@/core/file-system/hooks");
  const unsaved = useEditorStore.getState().unsaved;
  const dirty = (tabs?.tabs ?? []).filter((t: any) => t.type === "document" && TOUR_FILES.has(t.title) && unsaved[t.id]);
  await Promise.all(dirty.map((t: any) => saveTabById(t.id, { silent: true }).catch(() => false)));
}

/** Open what a step needs: its tour file, if the active project has it. The Environments editor the user opens themselves. */
async function openStepContext(id: GettingStartedStepId) {
  const step = stepById(id);
  await saveTourFiles();
  const active = await activeMainTab();
  // A step without a file of its own (Environments, Git, the checklist) can't show over the
  // Start tab, so leave it for the file of the step before it.
  const onStart = active?.type === "welcome" || active?.type === "projectSetup";
  const index = GETTING_STARTED_STEPS.findIndex((s) => s.id === id);
  const file =
    step.file ?? (onStart ? GETTING_STARTED_STEPS.slice(0, index + 1).reverse().find((s): s is typeof s & { file: string } => "file" in s)?.file : undefined);
  if (!file) return;
  const projects = await window.electron?.state.getProjects();
  const root: string | undefined = projects?.activeProject;
  if (!root || active?.title === file) return;
  if (!(await window.electron?.files.getFileExist(root, file))) return;
  const filePath = await window.electron?.utils.pathJoin(root, file);
  await window.electron?.ipc?.invoke("fileLink:open", filePath, file);
  const { getQueryClient } = await import("@/main");
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false }),
    queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false }),
  ]);
}

/** Show a step's tip, opening its file (or the Environments editor) first. */
export async function requestTip(id: GettingStartedStepId) {
  useGettingStartedStore.getState().showTip(id);
  await openStepContext(id);
  if (stepById(id).target !== "editor") return;
  const active = await activeMainTab();
  if (!(active?.type === "document" && /\.void$/i.test(active?.title || ""))) {
    const { toast } = await import("@/core/components/ui/sonner");
    toast.info("Open a .void file to see this tip", { description: "The tour files are in your playground project." });
  }
}

/** Move the tour on: the next step after the current one that isn't done. */
export async function nextTip() {
  const { tipStep, done } = useGettingStartedStore.getState();
  const from = tipStep ? GETTING_STARTED_STEPS.findIndex((s) => s.id === tipStep) + 1 : 0;
  const ordered = [...GETTING_STARTED_STEPS.slice(from), ...GETTING_STARTED_STEPS.slice(0, from)];
  const next = ordered.find((s) => !done[s.id] && s.id !== tipStep);
  if (next) return requestTip(next.id);
  return finishTour();
}

/** The last step is done: end the tour and put the checklist away, so it stops covering the editor. */
export async function finishTour() {
  useGettingStartedStore.setState({ tipStep: null, tipDone: false, visible: false, expanded: false });
  const { toast } = await import("@/core/components/ui/sonner");
  toast.success("You've finished the tour", { description: "Reopen the checklist any time from Help → Getting Started Checklist." });
}

/** Step through the tour in order, done or not: -1 for the previous tip, 1 for the next. */
export async function stepTip(delta: -1 | 1) {
  const { tipStep } = useGettingStartedStore.getState();
  if (!tipStep) return;
  const target = GETTING_STARTED_STEPS[GETTING_STARTED_STEPS.findIndex((s) => s.id === tipStep) + delta];
  if (target) return requestTip(target.id);
}

/** Start (or resume) the tour at the first step that isn't done, in the playground. Once every step is done, start it over. */
export async function showTips() {
  if (!(await goToPlayground())) return;
  if (allStepsDone(useGettingStartedStore.getState().done)) return replayTour();
  useGettingStartedStore.setState({ visible: true, tipStep: null, tipDone: false });
  return nextTip();
}

/** Run the whole tour again from step 1, clearing the checklist. */
export async function replayTour() {
  if (!(await goToPlayground())) return;
  useGettingStartedStore.setState({ visible: true, expanded: false, done: {}, tipStep: null, tipDone: false });
  return requestTip(GETTING_STARTED_STEPS[0].id);
}
