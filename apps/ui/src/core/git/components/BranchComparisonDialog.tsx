import { GitCompareArrows, Loader2 } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useEffect, useState, useRef } from "react";
import { useGetGitBranches, useSelectedGitRepo } from "@/core/git/hooks";
import { useGetProjects } from "@/core/projects/hooks";
import { toast } from "@/core/components/ui/sonner";
import { useAddPanelTab } from "@/core/layout/hooks";

interface BranchComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const BranchComparisonDialog = ({ open, onOpenChange }: BranchComparisonDialogProps) => {
  const { data, isLoading } = useGetGitBranches();
  const { data: projects } = useGetProjects();
  const activeProject = projects?.activeProject;
  const { mutate: addPanelTab } = useAddPanelTab();
  const repoPath = useSelectedGitRepo();

  const [step, setStep] = useState<"base" | "compare">("base");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("base");
      setBaseBranch("");
      setQuery("");
    }
  }, [open]);

  // Auto-focus input when dialog opens or step changes
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open, step]);

  // Handle ESC key to close
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const handleBaseBranchSelect = (branch: string) => {
    setBaseBranch(branch);
    setStep("compare");
    setQuery("");
  };

  const handleCompareBranchSelect = (branch: string) => {
    if (!baseBranch) return;

    // Create a new diff tab
    addPanelTab(
      {
        panelId: "main",
        tab: {
          id: `diff-${baseBranch}-${branch}-${Date.now()}`,
          type: "diff",
          title: `${baseBranch}...${branch}`,
          source: `${baseBranch}...${branch}`,
          meta: {
            baseBranch,
            compareBranch: branch,
            repoPath,
          },
        } as any,
      },
      {
        onSuccess: () => {
          toast.success("Diff viewer opened", {
            description: `Comparing ${baseBranch} with ${branch}`,
            duration: 3000,
          });
        },
        onError: () => {
          toast.error("Failed to open diff viewer", {
            description: "Could not create the diff tab",
            duration: 5000,
          });
        },
      }
    );

    onOpenChange(false);
  };

  const handleBack = () => {
    setStep("base");
    setQuery("");
  };

  if (!open) return null;

  const filteredBranches = data?.branches.filter((branch: string) =>
    branch.toLowerCase().includes(query.toLowerCase())
  ) || [];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={() => onOpenChange(false)}
    >
      <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
        <Command
          className="bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
          label="Branch Comparison"
        >
          {/* Header */}
          <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
            <GitCompareArrows size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm font-medium text-text">
              {step === "base" ? "Select Base Branch" : "Select Branch to Compare"}
            </span>
            {step === "compare" && (
              <button
                onClick={handleBack}
                className="text-xs text-comment hover:text-text ml-auto"
              >
                ← Back
              </button>
            )}
            <span className="text-xs text-comment ml-auto">ESC to close</span>
          </div>

          {/* Breadcrumb when on compare step */}
          {step === "compare" && (
            <div className="flex items-center gap-2 py-2 px-4 bg-active/30 border-b border-border text-xs">
              <span className="text-comment">Base:</span>
              <span className="text-accent font-medium">{baseBranch}</span>
              <GitCompareArrows size={12} className="text-comment" />
              <span className="text-comment">Compare with...</span>
            </div>
          )}

          {/* Search Input */}
          <div className="flex items-center gap-3 py-2 px-4 border-b border-border">
            <Command.Input
              ref={inputRef as any}
              className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-comment"
              placeholder={step === "base" ? "Search base branch..." : "Search branch to compare..."}
              value={query}
              onValueChange={(value) => setQuery(value)}
              autoFocus
            />
          </div>

          {/* Results List */}
          <Command.List className="max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-comment" size={20} />
              </div>
            ) : (
              <>
                <Command.Group>
                  {filteredBranches.map((branch: string) => {
                    // Don't show the same branch in compare step
                    if (step === "compare" && branch === baseBranch) return null;

                    return (
                      <Command.Item
                        key={branch}
                        value={branch}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-l-2",
                          "data-[selected=true]:bg-active data-[selected=true]:border-accent",
                          "hover:bg-active/50 border-transparent"
                        )}
                        onSelect={() =>
                          step === "base"
                            ? handleBaseBranchSelect(branch)
                            : handleCompareBranchSelect(branch)
                        }
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{branch}</div>
                          {branch === data?.activeBranch && (
                            <div className="text-xs text-comment">Current branch</div>
                          )}
                        </div>
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                <Command.Empty className="px-4 py-4 text-center text-comment text-sm">
                  No matching branches found
                </Command.Empty>
              </>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
};
