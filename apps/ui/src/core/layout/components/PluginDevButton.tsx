import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Puzzle, FolderInput, FolderOpen, Plus, Loader2, ChevronRight, ArrowLeft } from "lucide-react";
import { useGetAppState } from "@/core/state/hooks";
import { useOpenProject, useSetActiveProject } from "@/core/projects/hooks/useProjects";
import { useDevModeStore } from "@/core/layout/devModeStore";
import { toast } from "@/core/components/ui/sonner";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";

type Step = "choose" | "convert" | "create";
type Busy = null | "create" | "convert" | "open";

const folderName = (p?: string) => p?.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";

// "my_cool-plugin" → "My Cool Plugin"
const toDisplayName = (s: string) =>
  s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

// Mirrors toPluginId in the main process, to preview the folder name.
const toPluginId = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-plugin";

const checkProject = (dir: string) => window.electron?.pluginDev?.checkProject?.(dir);

const SCAFFOLD_FILES = ["manifest.json", "package.json", "build.mjs", "src/plugin.ts", "src/WelcomePage.tsx", "README.md"];

export const PluginDevButton = () => {
  const { isDevMode, setDevMode } = useDevModeStore();
  const { data: appState } = useGetAppState();
  const activeDir = (appState as any)?.activeDirectory as string | undefined;
  const { mutateAsync: setActiveProject } = useSetActiveProject();
  const { mutateAsync: openProject } = useOpenProject();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState<Busy>(null);
  const [newName, setNewName] = useState("");
  const [convertName, setConvertName] = useState("");
  // Folder being converted: the open project, or one just picked via "Open existing".
  const [convertDir, setConvertDir] = useState<string>();

  // Dev mode is tied to the project it was turned on for: switching to a
  // folder that isn't a plugin turns it back off.
  useEffect(() => {
    if (!isDevMode) return;
    if (!activeDir) {
      setDevMode(false);
      return;
    }
    let cancelled = false;
    checkProject(activeDir)?.then((r) => {
      if (!cancelled && !r?.isPlugin) setDevMode(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDir, isDevMode, setDevMode]);

  // ESC steps back to the choices first, then closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (step === "choose") setOpen(false);
      else setStep("choose");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, step]);

  const handleClick = async () => {
    if (isDevMode) {
      setDevMode(false);
      return;
    }
    if (activeDir) {
      const result = await checkProject(activeDir);
      if (result?.isPlugin) {
        setDevMode(true);
        return;
      }
    }
    setNewName("");
    setConvertName(toDisplayName(folderName(activeDir)));
    setStep("choose");
    setOpen(true);
  };

  const enterDevMode = (pluginLabel: string) => {
    setOpen(false);
    setDevMode(true);
    toast.success(`Plugin dev mode on for ${pluginLabel}`, {
      description: "Press Run in the floating toolbar to build and load it.",
    });
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy("create");
    try {
      const result = await window.electron?.pluginDev?.create?.(name);
      if (!result || result.canceled) return;
      if (!result.success || !result.projectPath) {
        toast.error("Couldn't create plugin", { description: result.error });
        return;
      }
      await setActiveProject(result.projectPath);
      enterDevMode(name);
    } finally {
      setBusy(null);
    }
  };

  const handleConvert = async () => {
    const name = convertName.trim();
    if (!convertDir || !name) return;
    setBusy("convert");
    try {
      const result = await window.electron?.pluginDev?.convert?.(convertDir, name);
      if (!result?.success) {
        toast.error("Couldn't set up plugin files", { description: result?.error });
        return;
      }
      if (result.skipped?.length) {
        toast.info(`Kept your existing ${result.skipped.join(", ")}`);
      }
      const check = await checkProject(convertDir);
      if (!check?.isPlugin) {
        toast.warning("Plugin files were added, but the project still isn't buildable.", {
          description: 'Make sure package.json has a "build" script.',
        });
        return;
      }
      enterDevMode(name);
    } finally {
      setBusy(null);
    }
  };

  const handleOpenExisting = async () => {
    setBusy("open");
    try {
      // The native picker throws when cancelled; resolves undefined when the
      // folder is already open in another window (which gets focused instead).
      const projectPath = await openProject(activeDir ?? "").catch(() => undefined);
      if (!projectPath) return;
      const check = await checkProject(projectPath);
      if (check?.isPlugin) {
        enterDevMode(check.pluginName ?? folderName(projectPath));
      } else {
        // Not a plugin yet: offer to set it up right here.
        setConvertName(toDisplayName(folderName(projectPath)));
        setConvertDir(projectPath);
        setStep("convert");
      }
    } finally {
      setBusy(null);
    }
  };

  const close = () => !busy && setOpen(false);

  return (
    <>
      <Tip label={isDevMode ? "Plugin dev mode: on" : "Plugin dev mode"} side="bottom" align="end">
        <button
          onClick={handleClick}
          aria-pressed={isDevMode}
          data-plugin-dev-anchor
          className={cn(
            "relative h-full px-2 no-drag hover:bg-active w-8 flex items-center justify-center transition-colors",
            isDevMode ? "text-accent" : "text-comment hover:text-text",
          )}
        >
          <Puzzle size={14} />
          {isDevMode && (
            <span
              className="absolute top-[9px] right-[7px] w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "rgb(var(--common-accent))", boxShadow: "0 0 4px rgba(var(--common-accent), 0.8)" }}
            />
          )}
        </button>
      </Tip>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[18vh] bg-black/50" onClick={close}>
            <div
              className="w-full max-w-md mx-4 bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {step === "choose" && (
                <>
                  <Header
                    title="Plugin Dev Mode"
                    subtitle={
                      activeDir
                        ? `${folderName(activeDir)} isn't a plugin project yet.`
                        : "No project is open. Start a new plugin or open one."
                    }
                  />
                  <div className="p-1.5 flex flex-col">
                    {activeDir && (
                      <ChoiceRow
                        icon={<FolderInput size={15} />}
                        title="Make this project a plugin"
                        description={`Add plugin files to ${folderName(activeDir)}`}
                        onClick={() => {
                          setConvertDir(activeDir);
                          setStep("convert");
                        }}
                        disabled={!!busy}
                      />
                    )}
                    <ChoiceRow
                      icon={<Plus size={15} />}
                      title="Create a new plugin"
                      description="Start from a ready-to-run template"
                      onClick={() => setStep("create")}
                      disabled={!!busy}
                    />
                    <ChoiceRow
                      icon={busy === "open" ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                      title="Open an existing plugin"
                      description="Pick a folder with a manifest.json"
                      onClick={handleOpenExisting}
                      disabled={!!busy}
                    />
                  </div>
                </>
              )}

              {step === "create" && (
                <StepForm
                  title="Create a new plugin"
                  subtitle="You'll pick a parent folder next. The plugin opens as your project when it's ready."
                  value={newName}
                  onChange={setNewName}
                  placeholder="e.g. My Plugin"
                  hint={newName.trim() ? `Creates a ${toPluginId(newName)}/ folder` : undefined}
                  action="Choose folder & create"
                  busy={busy === "create"}
                  onBack={() => setStep("choose")}
                  onSubmit={handleCreate}
                />
              )}

              {step === "convert" && convertDir && (
                <StepForm
                  title="Make this project a plugin"
                  subtitle={`Adds plugin files to ${folderName(convertDir)}. Files you already have are never overwritten.`}
                  value={convertName}
                  onChange={setConvertName}
                  placeholder="Plugin name"
                  hint={`Adds ${SCAFFOLD_FILES.join(", ")}`}
                  action="Set up plugin"
                  busy={busy === "convert"}
                  onBack={() => setStep("choose")}
                  onSubmit={handleConvert}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

function Header({ title, subtitle, onBack }: { title: string; subtitle: string; onBack?: () => void }) {
  return (
    <div className="px-4 py-3 border-b border-border">
      <span className="flex items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 p-0.5 rounded text-comment hover:text-text hover:bg-active transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>
        ) : (
          <Puzzle size={14} className="text-accent" />
        )}
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <span className="text-xs text-comment ml-auto">ESC to {onBack ? "go back" : "close"}</span>
      </span>
      <p className="text-xs text-comment mt-0.5">{subtitle}</p>
    </div>
  );
}

function ChoiceRow({
  icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-md text-left hover:bg-active disabled:opacity-50 transition-colors"
    >
      <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md border border-border bg-panel text-comment group-hover:text-accent transition-colors">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text">{title}</span>
        <span className="block text-xs text-comment truncate">{description}</span>
      </span>
      <ChevronRight size={14} className="text-comment opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function StepForm({
  title,
  subtitle,
  value,
  onChange,
  placeholder,
  hint,
  action,
  busy,
  onBack,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  action: string;
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Header title={title} subtitle={subtitle} onBack={busy ? undefined : onBack} />
      <div className="px-4 py-4">
        <label className="block text-xs text-comment mb-1.5">Plugin name</label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          disabled={busy}
          className="w-full h-8 px-2 text-sm bg-panel border border-border rounded text-text outline-none focus:border-accent placeholder:text-comment disabled:opacity-50"
        />
        <p className="text-[11px] text-comment mt-1.5 min-h-[16px] font-mono truncate">{hint}</p>
      </div>
      <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="h-7 px-3 text-xs rounded text-comment hover:text-text hover:bg-active disabled:opacity-40 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="h-7 px-3 flex items-center gap-1.5 text-xs rounded border border-border bg-panel text-text hover:bg-active disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {action}
        </button>
      </div>
    </form>
  );
}
