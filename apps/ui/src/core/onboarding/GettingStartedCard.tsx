import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronUp, Copy, X } from "lucide-react";
import { useGetProjects } from "@/core/projects/hooks/useProjects";
import { useGetPanelTabs } from "@/core/layout/hooks/usePanelTabs";
import { toast } from "@/core/components/ui/sonner";
import { cn } from "@/core/lib/utils";
import { GETTING_STARTED_STEPS, RUNNER_COMMANDS, requestTip, stepById, useGettingStartedStore } from "./gettingStartedStore";

/** The tour only makes sense in the playground project: the one holding its first file. */
function useIsPlaygroundOpen() {
  const { data: projects } = useGetProjects();
  const root: string | undefined = projects?.activeProject;
  const firstFile = stepById("selectEnv").file!;
  const { data } = useQuery({
    queryKey: ["onboarding:is-playground", root],
    queryFn: async () => !!root && !!(await window.electron?.files.getFileExist(root, firstFile)),
    enabled: !!root,
  });
  return !!data;
}


function CommandRow({ label, command }: { label: string; command: string }) {
  const markDone = useGettingStartedStore((s) => s.markDone);
  return (
    <div className="flex flex-col gap-1 px-2.5 py-2 rounded-md border border-border bg-bg">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-comment">{label}</span>
      <span className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate font-mono text-[11px] text-text" title={command}>
          {command}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label} command`}
          className="shrink-0 text-accent hover:underline flex items-center gap-1 text-[11px]"
          onClick={() =>
            navigator.clipboard
              .writeText(command)
              .then(() => {
                markDone("outside");
                toast.success("Copied");
              })
              .catch(() => toast.error("Couldn't copy to the clipboard"))
          }
        >
          <Copy size={11} /> Copy
        </button>
      </span>
    </div>
  );
}

/** "Getting started" checklist floating in the bottom-right corner of the editor area, in the playground project only. */
export function GettingStartedCard() {
  const { done, visible, toggleStep, setVisible, expanded: open, setExpanded, tipStep } = useGettingStartedStore();
  const inPlayground = useIsPlaygroundOpen();
  const { data: panelTabs } = useGetPanelTabs("main");
  const activeType = panelTabs?.tabs?.find((t: any) => t.id === panelTabs?.activeTabId)?.type;

  // Expanded, the card covers the right edge of the editor (table value columns). Fold it back
  // to the small pill as soon as the user works in the editor.
  useEffect(() => {
    if (!open || !visible) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("#getting-started-card")) return;
      if (el?.closest?.("#main-editor")) setExpanded(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, visible, setExpanded]);

  // The step list stays mounted so it can animate; while folded it mustn't take focus or clicks.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.toggleAttribute("inert", !open);
  });

  // Not over the Start tab or the project setup screen: those are their own onboarding.
  // During the tour it stays as the small pill (the tour folds it), so it doesn't come and go
  // between steps; only the last step, which uses its commands, opens it up.
  if (!visible || !inPlayground || activeType === "welcome" || activeType === "projectSetup") return null;

  const count = GETTING_STARTED_STEPS.filter((s) => done[s.id]).length;
  const next = GETTING_STARTED_STEPS.find((s) => !done[s.id]);
  const pct = (count / GETTING_STARTED_STEPS.length) * 100;

  // One card that grows from a pill into the full checklist and back: the width and the
  // list's height (a 0fr → 1fr grid row) animate together.
  return (
    <div
      id="getting-started-card"
      className={cn(
        "absolute right-4 bottom-4 z-20 max-h-[calc(100%-2rem)] flex flex-col overflow-hidden rounded-2xl border border-border bg-panel text-text shadow-lg",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        open ? "w-[300px]" : "w-[200px]",
      )}
    >
      <div className="shrink-0 flex items-center h-8">
        <button
          type="button"
          onClick={() => setExpanded(!open)}
          aria-expanded={open}
          title={open ? undefined : next ? `Next: ${next.label}` : "All done. Nice work."}
          className="flex-1 min-w-0 h-full flex items-center gap-2 pl-3 text-xs font-semibold text-left"
        >
          <span className="truncate">Getting started</span>
          <span className="ml-auto font-medium text-emerald-400">
            {count} / {GETTING_STARTED_STEPS.length}
          </span>
          <ChevronUp size={14} className={cn("shrink-0 text-comment transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <button
          type="button"
          aria-label="Dismiss Getting started"
          onClick={() => setVisible(false)}
          className="mx-1 p-1 rounded-full text-comment hover:text-text hover:bg-hover"
        >
          <X size={12} />
        </button>
      </div>

      <div
        ref={bodyRef}
        aria-hidden={!open}
        className={cn(
          "grid min-h-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-auto">
          <div className="w-[300px] px-3 pb-3 flex flex-col gap-2">
            <span className="block h-1 rounded bg-active">
              <span className="block h-1 rounded bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
            </span>
            <div className="flex flex-col">
              {GETTING_STARTED_STEPS.map((step) => {
                const isDone = !!done[step.id];
                const isNext = next?.id === step.id;
                return (
                  <div key={step.id} className="flex items-start gap-2.5 py-2 border-t border-border">
                    <button
                      type="button"
                      aria-pressed={isDone}
                      aria-label={isDone ? `Mark "${step.label}" as not done` : `Mark "${step.label}" as done`}
                      onClick={() => toggleStep(step.id)}
                      className={cn(
                        "mt-px w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center",
                        isDone ? "bg-emerald-400 border-emerald-400 text-bg" : isNext ? "border-accent" : "border-border hover:border-comment",
                      )}
                    >
                      {isDone && <Check size={10} strokeWidth={3} />}
                    </button>
                    {/* The step itself opens its tip; it closes again once dismissed or done. */}
                    <button type="button" onClick={() => requestTip(step.id)} className="flex-1 min-w-0 flex flex-col gap-0.5 text-left group">
                      <span
                        className={cn(
                          "text-xs group-hover:text-accent",
                          isDone ? "line-through text-comment" : isNext ? "font-semibold" : "",
                          tipStep === step.id && "text-accent",
                        )}
                      >
                        {step.label}
                      </span>
                      {isNext && <span className="text-[11px] text-comment group-hover:text-text">Show me how</span>}
                    </button>
                  </div>
                );
              })}
            </div>
            <CommandRow label="In CI" command={RUNNER_COMMANDS.ci} />
            <CommandRow label="In Claude Code or Codex (MCP)" command={RUNNER_COMMANDS.mcp} />
          </div>
        </div>
      </div>
    </div>
  );
}
