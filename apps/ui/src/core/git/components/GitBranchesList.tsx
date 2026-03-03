import { GitBranch, Loader2, Plus, Check } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useEffect, useState, useRef } from "react";
import { useCheckoutBranch, useGetGitBranches, useCreateBranch } from "@/core/git/hooks";
import { useGetProjects } from "@/core/projects/hooks";
import { toast } from "@/core/components/ui/sonner";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";

export const GitBranchesList = () => {
  // Get branches and active branch data.
  const { data, isLoading } = useGetGitBranches();
  // Get active project (needed for branch checkout/creation)
  const { data: projects } = useGetProjects();
  const activeProject = projects?.activeProject;
  const { mutate: checkoutBranch } = useCheckoutBranch();
  const { mutate: createBranch } = useCreateBranch();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Toggle the dialog with ⌥⌘B (Mac) or Alt+Ctrl+B (Windows/Linux).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      const isMac = navigator.platform ? navigator.platform.toLowerCase().includes('mac') : false;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (e.code === "KeyB" && modKey && e.altKey) {
        e.preventDefault();
        setOpen((open) => !open);
      }

      // Close with ESC
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

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
            // Extract the git error message
            const errorMessage = error?.message || String(error);

            // Parse the error to show a user-friendly message
            let displayMessage = errorMessage;
            if (errorMessage.includes("would be overwritten by checkout")) {
              displayMessage = "Cannot switch branches: You have uncommitted changes. Please commit or stash them first.";
            } else if (errorMessage.includes("already exists")) {
              displayMessage = "A branch with that name already exists.";
            }

            toast.error("Git Checkout Failed", {
              description: displayMessage,
              duration: 5000,
            });
          },
        }
      );
    }
    setOpen(false);
    setQuery("");
  };

  const handleCreateBranch = () => {
    if (query && activeProject) {
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
            // Extract the git error message
            const errorMessage = error?.message || String(error);

            // Parse the error to show a user-friendly message
            let displayMessage = errorMessage;
            if (errorMessage.includes("already exists")) {
              displayMessage = `Branch "${branchName}" already exists.`;
            } else if (errorMessage.includes("not a valid branch name")) {
              displayMessage = `"${branchName}" is not a valid branch name.`;
            }

            toast.error("Failed to Create Branch", {
              description: displayMessage,
              duration: 5000,
            });
          },
        }
      );
      setOpen(false);
      setQuery("");
    }
  };

  // Auto-focus input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      // Small delay to ensure the dialog is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  if (isLoading)
    return (
      <div>
        <Loader2 className="animate-spin text-comment px-2" size={14} />
      </div>
    );
  if (data?.branches.length === 0) return null;

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
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/50" onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <Command
              className="bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
              label="Git Branches"
            >
              {/* Header with icon and title */}
              <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
                <GitBranch size={16} className="text-accent flex-shrink-0" />
                <span className="text-sm font-medium text-text">Checkout Branch</span>
                <span className="text-xs text-comment ml-auto">ESC to close</span>
              </div>

              {/* Search Input */}
              <div className="flex items-center gap-3 py-2 px-4 border-b border-border">
                <Command.Input
                  ref={inputRef as any}
                  className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-comment"
                  placeholder="Search or create branch..."
                  value={query}
                  onMouseDown={(e)=>e.stopPropagation()}
                  onValueChange={(value) => setQuery(value)}
                  autoFocus
                />
              </div>

              {/* Results List */}
              <Command.List className="max-h-[400px] overflow-y-auto">
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

                  {/* Create branch option - always show when typing */}
                  {query && !data?.branches.includes(query) && (
                    <Command.Item
                      key="create-new-branch"
                      value={`create-branch-${query}`}
                      keywords={[query, "create", "new", "branch"]}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2 border-t border-border",
                        "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                        "hover:bg-active/50 border-transparent"
                      )}
                      onSelect={handleCreateBranch}
                    >
                      <Plus size={16} className="text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text">Create branch &quot;{query}&quot;</div>
                        <div className="text-xs text-comment">Press Enter to create new branch</div>
                      </div>
                    </Command.Item>
                  )}
                </Command.Group>

                <Command.Empty className="px-4 py-4 text-center text-comment text-sm">
                  {query ? (
                    <div>
                      <div className="mb-2">No matching branches found</div>
                      <button
                        onClick={handleCreateBranch}
                        className="text-accent hover:underline text-sm"
                      >
                        Create branch &quot;{query}&quot;
                      </button>
                    </div>
                  ) : (
                    "No branches found"
                  )}
                </Command.Empty>
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </>
  );
};
