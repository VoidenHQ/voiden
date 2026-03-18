import { GitBranch, Loader2, Plus, Check, GitFork, ArrowLeft } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useEffect, useState, useRef } from "react";
import { useCheckoutBranch, useGetGitBranches, useCreateBranch, useCreateBranchFrom } from "@/core/git/hooks";
import { useGetProjects } from "@/core/projects/hooks";
import { toast } from "@/core/components/ui/sonner";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";

type Step =
  | { type: "main" }
  | { type: "pick-source" }
  | { type: "enter-name"; fromBranch: string };

export const GitBranchesList = () => {
  const { data, isLoading } = useGetGitBranches();
  const { data: projects } = useGetProjects();
  const activeProject = projects?.activeProject;
  const { mutate: checkoutBranch } = useCheckoutBranch();
  const { mutate: createBranch } = useCreateBranch();
  const { mutate: createBranchFrom } = useCreateBranchFrom();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Step>({ type: "main" });
  const inputRef = useRef<HTMLInputElement>(null);

  const closeDialog = () => {
    setOpen(false);
    setQuery("");
    setStep({ type: "main" });
  };

  // Toggle the dialog with ⌥⌘B (Mac) or Alt+Ctrl+B (Windows/Linux).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) return;

      const isMac = navigator.platform ? navigator.platform.toLowerCase().includes('mac') : false;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (e.code === "KeyB" && modKey && e.altKey) {
        e.preventDefault();
        setOpen((open) => !open);
      }

      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        if (step.type !== "main") {
          // Go back to main instead of closing
          setStep({ type: "main" });
          setQuery("");
        } else {
          closeDialog();
        }
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, step]);

  // Auto-focus input when dialog opens or step changes
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, step]);

  const handleBranchSelect = (branch: string) => {
    if (activeProject) {
      checkoutBranch(
        { projectPath: activeProject, branch },
        {
          onSuccess: () => {
            toast.success("Branch switched", {
              description: `Switched to branch "${branch}"`,
              duration: 3000,
            });
          },
          onError: (error: any) => {
            const errorMessage = error?.message || String(error);
            let displayMessage = errorMessage;
            if (errorMessage.includes("would be overwritten by checkout")) {
              displayMessage = "Cannot switch branches: You have uncommitted changes. Please commit or stash them first.";
            } else if (errorMessage.includes("already exists")) {
              displayMessage = "A branch with that name already exists.";
            }
            toast.error("Git Checkout Failed", { description: displayMessage, duration: 5000 });
          },
        }
      );
    }
    closeDialog();
  };

  const handleCreateBranch = () => {
    if (!query || !activeProject) return;
    const branchName = query;
    createBranch(
      { projectPath: activeProject, branch: branchName },
      {
        onSuccess: () => {
          toast.success("Branch created", {
            description: `Created and switched to branch "${branchName}"`,
            duration: 3000,
          });
        },
        onError: (error: any) => {
          const errorMessage = error?.message || String(error);
          let displayMessage = errorMessage;
          if (errorMessage.includes("already exists")) displayMessage = `Branch "${branchName}" already exists.`;
          else if (errorMessage.includes("not a valid branch name")) displayMessage = `"${branchName}" is not a valid branch name.`;
          toast.error("Failed to Create Branch", { description: displayMessage, duration: 5000 });
        },
      }
    );
    closeDialog();
  };

  const handleCreateBranchFrom = (fromBranch: string) => {
    if (!query || !activeProject) return;
    const branchName = query;
    createBranchFrom(
      { projectPath: activeProject, branch: branchName, fromBranch },
      {
        onSuccess: () => {
          toast.success("Branch created", {
            description: `Created "${branchName}" from "${fromBranch}"`,
            duration: 3000,
          });
        },
        onError: (error: any) => {
          const errorMessage = error?.message || String(error);
          let displayMessage = errorMessage;
          if (errorMessage.includes("already exists")) displayMessage = `Branch "${branchName}" already exists.`;
          else if (errorMessage.includes("not a valid branch name")) displayMessage = `"${branchName}" is not a valid branch name.`;
          toast.error("Failed to Create Branch", { description: displayMessage, duration: 5000 });
        },
      }
    );
    closeDialog();
  };

  if (isLoading)
    return (
      <div>
        <Loader2 className="animate-spin text-comment px-2" size={14} />
      </div>
    );
  if (data?.branches.length === 0) return null;

  const isPickSource = step.type === "pick-source";
  const isEnterName = step.type === "enter-name";

  return (
    <>
      <Tip label={<span className="flex items-center gap-2"><span>Checkout branch</span><Kbd keys="⌥⌘B" size="sm" /></span>}>
        <button
          className={cn("text-sm h-full px-2 flex items-center gap-2 hover:bg-active no-drag text-comment", !data?.activeBranch && "text-comment")}
          onClick={() => setOpen(true)}
        >
          <GitBranch size={14} />
          <span>{data?.activeBranch || "Branches"}</span>
        </button>
      </Tip>

      {open && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/50" onClick={closeDialog}>
          <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <Command
              className="bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
              label="Git Branches"
            >
              {/* Header */}
              <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
                {step.type !== "main" && (
                  <button
                    onClick={() => { setStep({ type: "main" }); setQuery(""); }}
                    className="text-comment hover:text-text flex-shrink-0"
                  >
                    <ArrowLeft size={15} />
                  </button>
                )}
                <GitBranch size={16} className="text-accent flex-shrink-0" />
                <span className="text-sm font-medium text-text">
                  {isPickSource
                    ? "Select source branch"
                    : isEnterName
                    ? `New branch from "${(step as { type: "enter-name"; fromBranch: string }).fromBranch}"`
                    : "Checkout Branch"}
                </span>
                <span className="text-xs text-comment ml-auto">ESC to {step.type !== "main" ? "go back" : "close"}</span>
              </div>

              {/* Search / Name Input */}
              <div className="flex items-center gap-3 py-2 px-4 border-b border-border">
                <Command.Input
                  ref={inputRef as any}
                  className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-comment"
                  placeholder={
                    isPickSource
                      ? "Search source branch..."
                      : isEnterName
                      ? "New branch name..."
                      : "Search or create branch..."
                  }
                  value={query}
                  onMouseDown={(e) => e.stopPropagation()}
                  onValueChange={(value) => setQuery(value)}
                  autoFocus
                />
              </div>

              <Command.List className="max-h-[400px] overflow-y-auto">

                {/* ── MAIN VIEW ── */}
                {step.type === "main" && (
                  <>
                    {/* Create options pinned at top */}
                    <Command.Group>
                      {/* Create new branch (from current HEAD) */}
                      <Command.Item
                        value={query ? `create-branch-${query}` : "create-new-branch"}
                        keywords={["create", "new", "branch", query].filter(Boolean)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2",
                          "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                          "hover:bg-active/50 border-transparent",
                          !query && "opacity-60"
                        )}
                        onSelect={() => {
                          if (query && !data?.branches.includes(query)) handleCreateBranch();
                          else inputRef.current?.focus();
                        }}
                      >
                        <Plus size={16} className="text-accent flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {query && !data?.branches.includes(query) ? (
                            <>
                              <div className="text-sm font-medium text-text">Create branch &quot;{query}&quot;</div>
                              <div className="text-xs text-comment">From current branch · Press Enter</div>
                            </>
                          ) : (
                            <>
                              <div className="text-sm font-medium text-text">Create new branch</div>
                              <div className="text-xs text-comment">From current branch · Type a name above</div>
                            </>
                          )}
                        </div>
                      </Command.Item>

                      {/* Create branch from a specific branch */}
                      <Command.Item
                        value="create-branch-from"
                        keywords={["create", "branch", "from", "source"]}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2 border-b border-border",
                          "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                          "hover:bg-active/50 border-transparent"
                        )}
                        onSelect={() => {
                          setStep({ type: "pick-source" });
                          setQuery("");
                        }}
                      >
                        <GitFork size={16} className="text-accent flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text">Create branch from…</div>
                          <div className="text-xs text-comment">Pick a source branch first</div>
                        </div>
                      </Command.Item>
                    </Command.Group>

                    {/* Branch list for checkout */}
                    <Command.Group>
                      {data?.branches.map((branch: string) => (
                        <Command.Item
                          key={branch}
                          value={branch}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2",
                            "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                            "hover:bg-active/50 border-transparent"
                          )}
                          onSelect={() => handleBranchSelect(branch)}
                        >
                          <GitBranch size={16} className="text-comment flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text truncate">{branch}</div>
                          </div>
                          {branch === data?.activeBranch && (
                            <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <Check size={12} />
                              <span>Active</span>
                            </div>
                          )}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                )}

                {/* ── PICK SOURCE BRANCH ── */}
                {isPickSource && (
                  <Command.Group>
                    {data?.branches.map((branch: string) => (
                      <Command.Item
                        key={branch}
                        value={branch}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2",
                          "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                          "hover:bg-active/50 border-transparent"
                        )}
                        onSelect={() => {
                          setStep({ type: "enter-name", fromBranch: branch });
                          setQuery("");
                        }}
                      >
                        <GitBranch size={16} className="text-comment flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{branch}</div>
                        </div>
                        {branch === data?.activeBranch && (
                          <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <Check size={12} />
                            <span>Active</span>
                          </div>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* ── ENTER NEW BRANCH NAME ── */}
                {isEnterName && (
                  <Command.Group>
                    <Command.Item
                      value={query ? `create-from-${query}` : "enter-branch-name"}
                      keywords={["create", "branch", query].filter(Boolean)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2",
                        "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                        "hover:bg-active/50 border-transparent",
                        !query && "opacity-60"
                      )}
                      onSelect={() => {
                        if (query) handleCreateBranchFrom((step as { type: "enter-name"; fromBranch: string }).fromBranch);
                        else inputRef.current?.focus();
                      }}
                    >
                      <Plus size={16} className="text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        {query ? (
                          <>
                            <div className="text-sm font-medium text-text">Create &quot;{query}&quot;</div>
                            <div className="text-xs text-comment">
                              From &quot;{(step as { type: "enter-name"; fromBranch: string }).fromBranch}&quot; · Press Enter
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-medium text-text">Type a branch name</div>
                            <div className="text-xs text-comment">
                              Will branch from &quot;{(step as { type: "enter-name"; fromBranch: string }).fromBranch}&quot;
                            </div>
                          </>
                        )}
                      </div>
                    </Command.Item>
                  </Command.Group>
                )}

                <Command.Empty className="px-4 py-4 text-center text-comment text-sm">
                  No matching branches
                </Command.Empty>
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </>
  );
};
