import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Copy, X } from "lucide-react";
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

  // Not over the Start tab or the project setup screen: those are their own onboarding.
  if (!visible || !inPlayground || activeType === "welcome" || activeType === "projectSetup") return null;

  const count = GETTING_STARTED_STEPS.filter((s) => done[s.id]).length;
  const next = GETTING_STARTED_STEPS.find((s) => !done[s.id]);
  const pct = (count / GETTING_STARTED_STEPS.length) * 100;

  return (
    <div id="getting-started-card" className="absolute right-4 bottom-4 z-20 w-[300px] max-h-[calc(100%-2rem)] rounded-xl border border-border bg-panel text-text shadow-lg flex flex-col">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded(!open)}
          aria-expanded={open}
          className="flex-1 min-w-0 flex flex-col gap-2 p-3 text-left"
        >
          <span className="flex items-center justify-between text-sm font-semibold">
            Getting started
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
              {count} / {GETTING_STARTED_STEPS.length}
              {open ? <ChevronDown size={14} className="text-comment" /> : <ChevronUp size={14} className="text-comment" />}
            </span>
          </span>
          <span className="block h-1 rounded bg-active">
            <span className="block h-1 rounded bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </span>
          {!open && <span className="text-xs text-comment truncate">{next ? `Next: ${next.label}` : "All done. Nice work."}</span>}
        </button>
        <button
          type="button"
          aria-label="Dismiss Getting started"
          onClick={() => setVisible(false)}
          className="self-start m-1.5 p-1 rounded text-comment hover:text-text hover:bg-hover"
        >
          <X size={14} />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2 overflow-auto">
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
      )}
    </div>
  );
}
