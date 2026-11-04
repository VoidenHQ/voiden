import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Braces, Download, GitBranch, Folder, Loader2, Settings, Bot, Workflow, Copy } from "lucide-react";
import { toast } from "@/core/components/ui/sonner";
import { Kbd } from "@/core/components/ui/kbd";
import { cn, isMac } from "@/core/lib/utils";
import { getShortcutLabel } from "@/core/shortcuts";
import { useSettings } from "@/core/settings/hooks/useSettings";
import { setActiveProjectImperative, useGetProjects, useOpenProject, useSetActiveProject } from "@/core/projects/hooks";
import { useAddPanelTab, useActivateTab, useGetPanelTabs } from "@/core/layout/hooks";
import { useActivateSidebarTab, useGetSidebarTabs } from "@/core/layout/hooks/useSidebar";
import { usePanelStore } from "@/core/stores/panelStore";
import { ImportDialog, importProjectName } from "@/core/onboarding/ImportDialog";
import { openProjectSetup } from "@/core/onboarding/projectSetup";
import { openPlaygroundProject } from "@/core/onboarding/playground";
import {
  GETTING_STARTED_STEPS,
  RUNNER_COMMANDS,
  markGettingStartedStep,
  nextTip,
  showGettingStartedChecklist,
  showTips,
  useGettingStartedStore,
} from "@/core/onboarding/gettingStartedStore";

const FIRST_TOUR_FILE = GETTING_STARTED_STEPS[0].file;

type Busy = null | "sample" | "import";

const SPEC_URL = /^https?:\/\/.+\.(json|ya?ml)(\?.*)?$/i;
const SPEC_FILTERS = [{ name: "OpenAPI / Swagger", extensions: ["json", "yaml", "yml"] }];

const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;

function pasteHint(value: string) {
  const v = value.trim();
  if (!v) return "";
  if (/^curl\s/i.test(v)) return "Looks like curl. Convert shows what it becomes before creating a .void file.";
  if (SPEC_URL.test(v)) return "Looks like an OpenAPI spec URL. Download it and use “OpenAPI spec” below to import every endpoint.";
  if (/^https?:\/\//i.test(v)) return "A URL. Convert makes a GET request from it.";
  return "Paste a curl command or a URL.";
}

const StartScreen = () => {
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const { data: projects } = useGetProjects();
  const { mutateAsync: setActiveProject } = useSetActiveProject();
  const { mutateAsync: openProject } = useOpenProject();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: mainTabs } = useGetPanelTabs("main");
  const { data: leftTabs } = useGetSidebarTabs("left");
  const { mutate: activateSidebarTab } = useActivateSidebarTab();
  const openLeftPanel = usePanelStore((s) => s.openLeftPanel);

  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [importDialog, setImportDialog] = useState<{ open: boolean; curl?: string }>({ open: false });

  // The explorer starts collapsed on first launch; bring it back once there's a project to show.
  const refreshAfterOpen = () => {
    openLeftPanel();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false }),
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false }),
    ]);
  };

  /** Opens (or first creates) the playground project and returns its path. */
  const openPlayground = () => openPlaygroundProject();

  /** Imports start a project of their own: create one in the default directory (made unique) and open it. */
  const createImportProject = async (name: string): Promise<string> => {
    const projectPath = await window.electron?.files.createProjectDirectory(name);
    if (!projectPath) throw new Error("Couldn't create a project for the import.");
    await setActiveProjectImperative(projectPath);
    await refreshAfterOpen();
    return projectPath;
  };

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const startFirstRequest = () =>
    run("sample", async () => {
      const projectPath = await openPlayground();
      const firstPath = await window.electron?.utils?.pathJoin(projectPath, FIRST_TOUR_FILE);
      await window.electron?.ipc?.invoke("fileLink:open", firstPath, FIRST_TOUR_FILE);
      await refreshAfterOpen();
      // Start (or resume) the guided tour in the playground.
      useGettingStartedStore.setState({ visible: true });
      await nextTip();
    });

  const convertPaste = () => {
    const value = paste.trim();
    if (!value) return;
    setImportDialog({ open: true, curl: /^curl\s/i.test(value) ? value : `curl ${value}` });
  };

  // The OpenAPI importer attaches an Import button to the open spec's toolbar.
  const openSpecFile = () =>
    run("import", async () => {
      const [file] = (await window.electron?.dialog.openFile({ properties: ["openFile"], filters: SPEC_FILTERS })) ?? [];
      if (!file) return;
      await createImportProject(importProjectName(baseName(file)));
      await window.electron?.ipc?.invoke("fileLink:open", file, baseName(file));
      await refreshAfterOpen();
    });

  // After the folder opens, offer to bring in any OpenAPI spec or .env template it has.
  const openFolder = () =>
    run("import", async () => {
      try {
        await openProject("~/");
      } catch (e) {
        if (e instanceof Error && /cancel/i.test(e.message)) return;
        throw e;
      }
      await openProjectSetup();
    });

  const openClone = () => {
    const gitTab = leftTabs?.tabs?.find((t: any) => t.type === "gitSourceControl");
    if (!gitTab) {
      toast.error("Source Control isn't available in this window.");
      return;
    }
    openLeftPanel();
    activateSidebarTab({ sidebarId: "left", tabId: gitTab.id });
  };

  const openSettings = () => {
    const existing = mainTabs?.tabs?.find((t: any) => t.type === "settings");
    if (existing) activateTab({ panelId: "main", tabId: existing.id });
    else addPanelTab({ panelId: "main", tab: { id: crypto.randomUUID(), type: "settings", title: "Settings", source: null } });
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        markGettingStartedStep("outside");
        toast.success(`Copied ${label}`);
      })
      .catch(() => toast.error("Couldn't copy to the clipboard"));
  };

  const openCommandPalette = () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", code: "KeyP", shiftKey: true, metaKey: isMac, ctrlKey: !isMac, bubbles: true }),
    );
  };

  // Cmd/Ctrl+Enter anywhere on the Start tab (outside the paste field) sends the first request
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      if (importDialog.open || (e.target as HTMLElement)?.id === "start-paste") return;
      e.preventDefault();
      startFirstRequest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const recent: string[] = (projects?.projects ?? []).slice(0, 5);
  const hint = pasteHint(paste);

  const cards = [
    {
      icon: <Braces size={22} className="text-accent" />,
      title: "OpenAPI spec",
      copy: "Pick a spec file. Every endpoint becomes a runnable request, linted and documented.",
      onClick: openSpecFile,
    },
    {
      icon: <Download size={22} className="text-blue-400" />,
      title: "Import",
      copy: "Postman, Insomnia, Bruno or HAR. Your originals aren't changed.",
      onClick: () => setImportDialog({ open: true }),
    },
    {
      icon: <GitBranch size={22} className="text-emerald-400" />,
      title: "Clone a Git repo",
      copy: "Paste a repo URL. Your team's .void files open ready to run.",
      onClick: openClone,
    },
    {
      icon: <Folder size={22} className="text-violet-400" />,
      title: "Open a folder",
      copy: "Any folder or repo works. Bring your existing .void files.",
      onClick: openFolder,
    },
  ];

  return (
    <div className="h-full bg-editor overflow-auto text-text select-text">
      <div className="flex justify-center px-8 pt-14 pb-10">
        <div className="w-full max-w-[880px] flex flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <div className="font-mono text-sm tracking-wide text-accent">voiden</div>
            <h1 className="m-0 text-[34px] leading-tight font-semibold tracking-tight">Send your first request in under a minute.</h1>
            <p className="m-0 max-w-[620px] text-[15px] leading-relaxed text-comment">
              Requests, docs and tests live as plain <span className="font-mono text-text">.void</span> files on your machine. No account, no
              sync. Pick where to start. You can change any of it later.
            </p>
          </div>

          <button
            type="button"
            onClick={startFirstRequest}
            disabled={!!busy}
            className="w-full flex items-center gap-5 px-6 py-5 rounded-xl border border-accent bg-surface hover:bg-hover text-left transition-colors disabled:opacity-70"
          >
            <span className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl bg-accent text-bg">
              {busy === "sample" ? <Loader2 size={22} className="animate-spin" /> : <Play size={22} fill="currentColor" />}
            </span>
            <span className="flex-1 flex flex-col gap-1">
              <span className="text-[17px] font-semibold">Send your first request</span>
              <span className="text-sm text-comment">
                A guided tour of five short <span className="font-mono">.void</span> files in a playground project under{" "}
                <span className="font-mono">{settings?.projects?.default_directory || "your projects folder"}</span>.
              </span>
            </span>
            <Kbd keys="⌘↵" />
          </button>

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              convertPaste();
            }}
          >
            <label htmlFor="start-paste" className="text-xs font-medium text-comment">
              Or paste a curl command or a URL
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="start-paste"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="curl https://api.example.com/v1/users …"
                className="flex-[1_1_420px] min-w-0 h-11 px-3.5 rounded-lg border border-border bg-bg font-mono text-sm text-text placeholder:text-comment outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!paste.trim() || !!busy}
                className="h-11 px-4 rounded-lg border border-border text-sm font-medium hover:bg-hover disabled:opacity-50 flex items-center gap-2"
              >
                Convert
              </button>
            </div>
            <span className="min-h-4 text-xs text-comment">{hint}</span>
          </form>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map((c) => (
              <button
                key={c.title}
                type="button"
                onClick={c.onClick}
                disabled={!!busy}
                className="flex flex-col gap-2.5 p-5 rounded-xl border border-border bg-panel hover:bg-hover text-left transition-colors disabled:opacity-70"
              >
                {c.icon}
                <span className="text-sm font-semibold">{c.title}</span>
                <span className="text-xs leading-relaxed text-comment">{c.copy}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2.5">
            <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-comment">Use Voiden outside the app</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {[
                {
                  icon: <Bot size={18} className="text-accent" />,
                  title: "Use Voiden from Claude Code or Codex (MCP)",
                  copy: (
                    <>
                      Let your AI editor list, run and record your .void requests. Run this in your project folder, or click{" "}
                      <span className="text-text">Initialize MCP</span> in the status bar.
                    </>
                  ),
                  command: RUNNER_COMMANDS.mcp,
                  label: "MCP setup command",
                },
                {
                  icon: <Workflow size={18} className="text-emerald-400" />,
                  title: "Run .void files in CI",
                  copy: "The same files run headless in GitHub Actions, GitLab CI or any terminal with Node 18+. A failed request fails the build.",
                  command: RUNNER_COMMANDS.ci,
                  label: "CI command",
                },
              ].map((c) => (
                <div key={c.title} className="flex flex-col gap-2.5 p-4 rounded-xl border border-border bg-panel">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {c.icon}
                    {c.title}
                  </span>
                  <span className="text-xs leading-relaxed text-comment">{c.copy}</span>
                  <span className="mt-auto flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg">
                    <code className="flex-1 min-w-0 truncate font-mono text-xs text-text">{c.command}</code>
                    <button
                      type="button"
                      aria-label={`Copy ${c.label}`}
                      onClick={() => copy(c.command, c.label)}
                      className="shrink-0 flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Copy size={12} /> Copy
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-comment">Recent</h2>
            {recent.length ? (
              <div className="flex flex-col gap-1.5">
                {recent.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setActiveProject(p)}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-3 rounded-lg border border-border bg-panel hover:bg-hover text-left",
                      projects?.activeProject === p && "border-accent/50",
                    )}
                  >
                    <Folder size={16} className="shrink-0 text-violet-400" />
                    <span className="text-sm font-medium">{baseName(p)}</span>
                    <span className="ml-auto truncate font-mono text-xs text-comment">{p}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg border border-dashed border-border text-sm text-comment">Projects you open will show up here.</div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 border-t border-border text-sm">
            <button type="button" className="text-accent hover:underline" onClick={() => window.electron?.openExternal("https://docs.voiden.md")}>
              Docs
            </button>
            <button type="button" className="text-accent hover:underline flex items-center gap-1.5" onClick={openSettings}>
              <Settings size={14} /> Theme, fonts and settings
            </button>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={showGettingStartedChecklist}
            >
              Getting started checklist
            </button>
            <button type="button" className="text-accent hover:underline" onClick={showTips}>
              Show next tip
            </button>
            <button type="button" className="text-comment hover:text-text flex items-center gap-2" onClick={openCommandPalette}>
              Command palette <Kbd keys={getShortcutLabel("CommandPaletteCommands")} size="sm" />
            </button>
          </div>
        </div>
      </div>
      <ImportDialog
        open={importDialog.open}
        initialCurl={importDialog.curl}
        onOpenChange={(open) => setImportDialog((d) => ({ ...d, open }))}
        ensureProject={createImportProject}
        onOpened={() => {
          openLeftPanel();
          setPaste("");
        }}
      />
    </div>
  );
};

export default StartScreen;
