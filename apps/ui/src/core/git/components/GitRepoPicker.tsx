import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, FolderGit2, GitBranch, Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { toast } from "@/core/components/ui/sonner";
import { Tip } from "@/core/components/ui/Tip";
import { useGitRepos, useRescanGitRepos, useSelectGitRepo } from "@/core/git/hooks";
import { getGitErrorMessage } from "@/core/git/utils/gitErrorMessage";

type Repo = { path: string; name: string; relativePath: string; branch: string | null };

const RepoSwitcherDialog = ({
  repos,
  selected,
  onSelect,
  onClose,
}: {
  repos: Repo[];
  selected: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const { mutate: rescan, isPending: isRescanning } = useRescanGitRepos();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.relativePath.toLowerCase().includes(q) || r.branch?.toLowerCase().includes(q),
    );
  }, [repos, query]);

  // Rendered into <body>: the side panel's overflow and stacking would clip a fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="w-full max-w-xl mx-4" onClick={(e) => e.stopPropagation()}>
        <Command
          className="bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
          label="Switch repository"
          shouldFilter={false}
          defaultValue={selected ?? undefined}
        >
          {/* Header */}
          <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
            <FolderGit2 size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm font-medium text-text">Switch Repository</span>
            <span className="text-xs text-comment">{repos.length} in this project</span>
            <Tip label="Rescan the project for repositories" side="bottom">
              <button
                onClick={() =>
                  rescan(undefined, { onError: (error: any) => toast.error("Rescan failed", { description: getGitErrorMessage(error) }) })
                }
                disabled={isRescanning}
                className="ml-auto flex items-center gap-1.5 text-xs text-comment hover:text-text disabled:opacity-60"
              >
                <RefreshCw size={12} className={cn(isRescanning && "animate-spin")} />
                Rescan
              </button>
            </Tip>
            <span className="text-xs text-comment">ESC to close</span>
          </div>

          {/* Search */}
          <div className="flex items-center gap-3 py-2 px-4 border-b border-border">
            <Search size={14} className="text-comment flex-shrink-0" />
            <Command.Input
              className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-comment"
              placeholder="Search by name, folder or branch…"
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
          </div>

          {/* Repositories */}
          <Command.List className="max-h-[400px] overflow-y-auto py-1">
            {visible.map((repo) => {
              const isCurrent = repo.path === selected;
              return (
                <Command.Item
                  key={repo.path}
                  value={repo.path}
                  onSelect={() => onSelect(repo.path)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-l-2 border-transparent",
                    "data-[selected=true]:bg-active data-[selected=true]:border-accent hover:bg-active/50",
                  )}
                >
                  <FolderGit2 size={16} className={cn("flex-shrink-0", isCurrent ? "text-accent" : "text-comment")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text truncate">{repo.name}</span>
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 rounded px-1.5 py-px flex-shrink-0">
                          <Check size={10} /> Current
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-comment truncate">{repo.relativePath || "Project root"}</div>
                  </div>
                  {repo.branch && (
                    <span className="flex items-center gap-1 text-xs text-comment bg-active/60 rounded px-2 py-0.5 max-w-[40%] flex-shrink-0">
                      <GitBranch size={11} className="flex-shrink-0" />
                      <span className="truncate">{repo.branch}</span>
                    </span>
                  )}
                </Command.Item>
              );
            })}
            {visible.length === 0 && (
              <div className="px-4 py-6 text-center text-comment text-sm">No repository matches "{query}"</div>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center gap-4 py-2 px-4 border-t border-border text-[11px] text-comment">
            <span><kbd className="font-sans">↑↓</kbd> navigate</span>
            <span><kbd className="font-sans">Enter</kbd> switch</span>
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Switches which repo the Source Control panel works on, for projects that
 * contain several repos. Hidden when the project has one repo or none, so
 * single-repo projects look exactly as before.
 */
export const GitRepoPicker = () => {
  const { data } = useGitRepos();
  const { mutate: selectRepo, isPending: isSwitching } = useSelectGitRepo();
  const [open, setOpen] = useState(false);

  const repos = data?.repos ?? [];
  if (repos.length < 2) return null;
  const selected = repos.find((r) => r.path === data?.selected);

  const choose = (path: string) => {
    setOpen(false);
    if (path === data?.selected) return;
    selectRepo(path, {
      onError: (error: any) => toast.error("Couldn't switch repository", { description: getGitErrorMessage(error) }),
    });
  };

  return (
    <div className="px-2 py-1.5 border-b border-border flex-shrink-0">
      <Tip label={selected?.path ?? "Choose a repository"} side="bottom">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 rounded px-1.5 py-1 hover:bg-active/50 text-left"
        >
          {isSwitching
            ? <Loader2 size={14} className="animate-spin text-comment flex-shrink-0" />
            : <FolderGit2 size={14} className="text-accent flex-shrink-0" />}
          <span className="text-xs font-medium text-text truncate">{selected?.name ?? "Choose a repository"}</span>
          {/* The folder path, when it says more than the name (nested deeper than the project's top level). */}
          {selected && selected.relativePath !== selected.name && selected.relativePath && (
            <span className="text-[10px] text-comment truncate">{selected.relativePath}</span>
          )}
          <ChevronsUpDown size={12} className="text-comment flex-shrink-0 ml-auto" />
        </button>
      </Tip>

      {open && <RepoSwitcherDialog repos={repos} selected={data?.selected ?? null} onSelect={choose} onClose={() => setOpen(false)} />}
    </div>
  );
};
