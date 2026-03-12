import { useGetGitStatus, useStageFiles, useUnstageFiles, useCommit, useDiscardFiles, useGetGitBranches, useInitializeGit, usePushToRemote, usePullFromRemote, useCloneRepo, useFetchRemote, useGetGitRemote } from "@/core/git/hooks";
import { useSetActiveProject, useOpenProject } from "@/core/projects/hooks/useProjects";
import { Loader2, FilePlus, FileEdit, FileX, GitBranch, Check, Plus, Minus, RotateCcw, GitCommit, ArrowUp, ArrowDown, RefreshCw, ChevronDown, ChevronRight, GitFork, Eye, EyeOff, MoreVertical, CloudDownload } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useState } from "react";
import { toast } from "@/core/components/ui/sonner";
import { useAddPanelTab } from "@/core/layout/hooks";
import { GitGraph } from "./GitGraph";
import { Tip } from "@/core/components/ui/Tip";

export const GitSourceControl = () => {

  const { data: status, isLoading, refetch: refetchStatus } = useGetGitStatus();
  const { data: branches, refetch: refetchBranches } = useGetGitBranches();
  const { mutate: stageFiles } = useStageFiles();
  const { mutate: initializeGit } = useInitializeGit();
  const { mutate: cloneRepo, isPending: isCloning } = useCloneRepo();
  const { mutate: setActiveProject } = useSetActiveProject();
  const { mutate: openProject } = useOpenProject();
  const { mutate: unstageFiles } = useUnstageFiles();
  const { mutate: commit, isPending: isCommitting } = useCommit();
  const { mutate: discardFiles } = useDiscardFiles();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: pushToRemote, isPending: isPushing } = usePushToRemote();
  const { mutate: pullFromRemote, isPending: isPulling } = usePullFromRemote();
  const { triggerFetch } = useFetchRemote();
  const { data: remoteUrl, refetch: refetchRemote } = useGetGitRemote();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneToken, setCloneToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([triggerFetch(), refetchStatus(), refetchBranches(), refetchRemote()]);
    } catch (error: any) {
      toast.error("Refresh failed", { description: error?.message || String(error) });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFetchAll = async () => {
    setIsFetchingAll(true);
    try {
      await triggerFetch();
      await Promise.all([refetchStatus(), refetchBranches()]);
    } catch (error: any) {
      toast.error("Fetch failed", { description: error?.message || String(error) });
    } finally {
      setIsFetchingAll(false);
    }
  };

  const handleFileClick = (file: string, isStaged: boolean) => {
    const currentBranch = branches?.activeBranch || status?.current || "HEAD";

    addPanelTab({
      panelId: "main",
      tab: {
        id: `diff-working-${file}-${Date.now()}`,
        type: "diff",
        title: `${currentBranch} >>> working-directory | ${file.split('/').pop() || file}`,
        source: file,
        meta: {
          baseBranch: currentBranch,
          compareBranch: "working-directory",
          filePath: file,
          isWorkingDirectory: true,
        },
      } as any,
    });
  };

  const handleStage = (file: string) => {
    stageFiles([file], {
      onError: (error: any) => {
        toast.error("Failed to stage file", {
          description: error?.message || String(error),
        });
      },
    });
  };

  const handleUnstage = (file: string) => {
    unstageFiles([file], {
      onError: (error: any) => {
        toast.error("Failed to unstage file", {
          description: error?.message || String(error),
        });
      },
    });
  };

  const handleDiscard = (file: string) => {
    if (status?.untracked.includes(file)) {
      toast.error("Cannot discard untracked file", {
        description: `"${file}" is untracked — stage and then unstage it to remove, or delete it manually.`,
      });
      return;
    }

    if (!confirm(`Are you sure you want to discard changes in ${file}?`)) {
      return;
    }

    discardFiles([file], {
      onSuccess: () => {
        toast.success("Changes discarded", {
          description: `Discarded changes in ${file}`,
        });
      },
      onError: (error: any) => {
        toast.error("Failed to discard changes", {
          description: error?.message || String(error),
        });
      },
    });
  };

  const handleStageAll = () => {
    if (!status) return;
    const unstaged = [...status.modified, ...status.untracked, ...status.deleted].filter(f => !status.staged.includes(f));
    stageFiles(unstaged);
  };

  const handleDiscardAll = () => {
    if (!status) return;
    const tracked = [...status.modified, ...status.deleted].filter(f => !status.staged.includes(f));
    if (!tracked.length) return;
    if (!confirm(`Discard all changes in ${tracked.length} file(s)?`)) return;
    discardFiles(tracked, {
      onSuccess: () => toast.success("All changes discarded"),
      onError: (error: any) => toast.error("Failed to discard changes", { description: error?.message || String(error) }),
    });
  };

  const handleUnstageAll = () => {
    if (!status) return;
    unstageFiles(status.staged);
  };

  const handlePush = () => {
    pushToRemote(undefined, {
      onSuccess: () => {
        toast.success("Pushed to remote", {
          description: `Branch ${status?.current} pushed successfully`,
        });
        refetchStatus();
      },
      onError: (error: any) => {
        toast.error("Push failed", {
          description: error?.message || String(error),
        });
      },
    });
  };

  const handlePull = () => {
    pullFromRemote(undefined, {
      onSuccess: () => {
        toast.success("Pulled from remote");
      },
      onError: (error: any) => {
        toast.error("Pull failed", {
          description: error?.message || String(error),
        });
      },
    });
  };

  const handleCommit = () => {
    if (!commitMessage.trim()) {
      toast.error("Commit message required", {
        description: "Please enter a commit message",
      });
      return;
    }

    if (!status?.staged.length) {
      toast.error("No staged changes", {
        description: "Stage files before committing",
      });
      return;
    }

    commit(commitMessage, {
      onSuccess: () => {
        setCommitMessage("");
        toast.success("Changes committed", {
          description: `Committed ${status.staged.length} file(s)`,
        });
      },
      onError: (error: any) => {
        toast.error("Failed to commit", {
          description: error?.message || String(error),
        });
      },
    });
  };

  const getFileIcon = (file: string, status?: string) => {
    if (status === 'untracked') return <FilePlus size={14} className="text-green-500" />;
    if (status === 'deleted') return <FileX size={14} className="text-red-500" />;
    return <FileEdit size={14} className="text-blue-500" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin text-comment" size={20} />
      </div>
    );
  }

  const handleClone = () => {
    const url = cloneUrl.trim();
    if (!url) {
      toast.error("Repository URL required");
      return;
    }

    const isHttps = /^https?:\/\/.+\/.+/.test(url);
    const isSsh = /^git@[^:]+:.+\/.+/.test(url);
    const isGitProto = /^git:\/\/.+\/.+/.test(url);
    if (!isHttps && !isSsh && !isGitProto) {
      toast.error("Invalid repository URL", {
        description: "Use a valid HTTPS (https://github.com/user/repo) or SSH (git@github.com:user/repo) URL.",
      });
      return;
    }

    cloneRepo(
      { repoUrl: cloneUrl.trim(), token: cloneToken.trim() || undefined },
      {
        onSuccess: (result) => {
          setCloneUrl("");
          setCloneToken("");
          setShowCloneForm(false);

          if (result?.isNewProject) {
            openProject(result.clonedPath);
          } else if (result?.clonedPath) {
            toast.success("Repository cloned", {
              description: result.clonedPath.split("/").pop(),
              action: {
                label: "Open Project",
                onClick: () => setActiveProject(result.clonedPath),
              },
            });
          }
        },
        onError: (error: any) => {
          toast.error("Clone failed", { description: error?.message || String(error) });
        },
      }
    );
  };

  if (!status) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <p className="text-xs text-comment text-center">No git repository found in this folder.</p>

        {!showCloneForm && (
          <button
            className="w-full bg-button-primary hover:bg-button-primary-hover rounded transition text-text text-xs px-3 py-2"
            onClick={() => initializeGit()}
          >
            Initialize Repository
          </button>
        )}

        <button
          className="w-full flex items-center justify-center gap-2 border border-border hover:bg-active/40 rounded transition text-text text-xs px-3 py-2"
          onClick={() => setShowCloneForm((v) => !v)}
        >
          <GitFork size={13} />
          {showCloneForm ? "Cancel Clone" : "Clone Repository"}
        </button>

        {showCloneForm && (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="https://github.com/user/repo.git"
              className="w-full bg-editor border border-border rounded px-3 py-2 text-xs text-text placeholder:text-comment focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={cloneToken}
                onChange={(e) => setCloneToken(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="Access token (optional)"
                className="w-full bg-editor border border-border rounded px-3 py-2 pr-9 text-xs text-text placeholder:text-comment focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-comment hover:text-text"
              >
                {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <button
              onClick={handleClone}
              disabled={isCloning || !cloneUrl.trim()}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed rounded transition text-white text-xs px-3 py-2"
            >
              {isCloning ? <Loader2 size={13} className="animate-spin mx-auto" /> : "Clone"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Files that are staged but also modified in working tree appear in both lists.
  // Filter them out so they only show in Staged, not in Changes.
  const unstagedChanges = [
    ...status.modified,
    ...status.untracked,
    ...status.deleted,
  ].filter((f) => !status.staged.includes(f));

  const totalChanges = status.staged.length + unstagedChanges.length;

  return (
    <div className="flex flex-col h-full">
      {/* Branch header */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0 relative">
        <div className="flex items-center gap-2">
          <Tip label={remoteUrl || "No remote configured"} side="bottom">
            <GitBranch size={14} className="text-accent flex-shrink-0" />
          </Tip>
          <span className="text-xs font-medium text-text flex-1 truncate">{status.current}</span>

          {/* Publish — branch not yet on remote */}
          {!status.published && (
            <Tip label="Publish branch to remote" side="bottom">
              <button
                onClick={handlePush}
                disabled={isPushing}
                className="flex items-center gap-1 text-xs bg-accent/15 hover:bg-accent/25 text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded px-2 py-0.5 flex-shrink-0"
              >
                {isPushing ? <RefreshCw size={11} className="animate-spin" /> : <ArrowUp size={11} />}
                {isPushing ? "Publishing…" : "Publish"}
              </button>
            </Tip>
          )}

          {/* Push — published branch with local commits ahead */}
          {status.published && status.ahead > 0 && (
            <Tip label={`Push ${status.ahead} commit${status.ahead !== 1 ? "s" : ""} to remote`} side="bottom">
              <button
                onClick={handlePush}
                disabled={isPushing}
                className="flex items-center gap-1 text-xs bg-green-500/15 hover:bg-green-500/25 text-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded px-2 py-0.5 flex-shrink-0"
              >
                {isPushing ? <RefreshCw size={11} className="animate-spin" /> : <ArrowUp size={11} />}
                {isPushing ? "Pushing…" : `Push ${status.ahead}`}
              </button>
            </Tip>
          )}

          {/* Pull — remote has commits we don't have */}
          {status.published && status.behind > 0 && (
            <Tip label={`Pull ${status.behind} commit${status.behind !== 1 ? "s" : ""} from remote`} side="bottom">
              <button
                onClick={handlePull}
                disabled={isPulling}
                className="flex items-center gap-1 text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded px-2 py-0.5 flex-shrink-0"
              >
                {isPulling ? <RefreshCw size={11} className="animate-spin" /> : <ArrowDown size={11} />}
                {isPulling ? "Pulling…" : `Pull ${status.behind}`}
              </button>
            </Tip>
          )}

          {/* Up to date */}
          {status.published && status.ahead === 0 && status.behind === 0 && (
            <span className="text-[10px] text-comment flex-shrink-0">Up to date</span>
          )}

          {/* Vertical dots menu */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            disabled={isRefreshing || isFetchingAll}
            className="text-comment hover:text-text flex-shrink-0 p-0.5 rounded hover:bg-active/50 disabled:opacity-60"
          >
            {isRefreshing || isFetchingAll
              ? <Loader2 size={14} className="animate-spin" />
              : <MoreVertical size={14} />}
          </button>
        </div>

        {/* Dropdown menu */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-2 top-8 z-50 bg-editor border border-border rounded-md shadow-lg py-1 min-w-[160px]">
              <button
                onClick={() => { setMenuOpen(false); handleRefresh(); }}
                disabled={isRefreshing}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-active/50 disabled:opacity-50"
              >
                <RefreshCw size={12} className={cn("text-comment", isRefreshing && "animate-spin")} />
                Refresh
              </button>
              <button
                onClick={() => { setMenuOpen(false); handleFetchAll(); }}
                disabled={isFetchingAll}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-active/50 disabled:opacity-50"
              >
                <CloudDownload size={12} className={cn("text-comment", isFetchingAll && "animate-pulse")} />
                Fetch All
              </button>
            </div>
          </>
        )}
      </div>

      {/* Commit input */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Commit message (Ctrl+Enter to commit)"
          className="w-full bg-editor border border-border rounded px-3 py-2 text-sm text-text placeholder:text-comment resize-none focus:outline-none focus:ring-1 focus:ring-accent"
          rows={3}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') handleCommit();
          }}
        />
        <button
          onClick={handleCommit}
          disabled={isCommitting || !commitMessage.trim() || !status.staged.length}
          className={cn(
            "mt-2 w-full px-3 py-2 rounded text-sm font-medium transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "bg-accent text-white hover:bg-accent/90"
          )}
        >
          {isCommitting ? "Committing..." : `Commit (${status.staged.length})`}
        </button>
      </div>

      {/* Scrollable file lists */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── Staged Changes ── */}
          {status.staged.length > 0 && (
            <div>
              <div
                className="px-3 py-1.5 bg-active/30 border-b border-border flex items-center justify-between cursor-pointer select-none"
                onClick={() => setStagedOpen((o) => !o)}
              >
                <div className="flex items-center gap-1">
                  {stagedOpen ? <ChevronDown size={11} className="text-comment" /> : <ChevronRight size={11} className="text-comment" />}
                  <span className="text-[10px] uppercase tracking-wide text-comment">
                    Staged ({status.staged.length})
                  </span>
                </div>
                <Tip label="Unstage all" side="bottom">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUnstageAll(); }}
                    className="text-comment hover:text-text"
                  >
                    <Minus size={13} />
                  </button>
                </Tip>
              </div>
              {stagedOpen && (
                <div>
                  {status.staged.map((file) => (
                    <div
                      key={file}
                      onClick={() => handleFileClick(file, true)}
                      className="ml-2 flex items-center gap-2 px-3 py-1.5 hover:bg-active/50 group cursor-pointer"
                    >
                      {getFileIcon(file)}
                      <span className="text-xs text-text flex-1 truncate">{file.split('/').pop() || file}</span>
                      <Tip label="Unstage" side="bottom">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnstage(file);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-comment hover:text-text"
                        >
                          <Minus size={13} />
                        </button>
                      </Tip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Changes ── */}
          {unstagedChanges.length > 0 && (
            <div >
              <div
                className="px-3 py-1.5 bg-active/30 border-b border-border flex items-center justify-between cursor-pointer select-none"
                onClick={() => setChangesOpen((o) => !o)}
              >
                <div className="flex items-center gap-1">
                  {changesOpen ? <ChevronDown size={11} className="text-comment" /> : <ChevronRight size={11} className="text-comment" />}
                  <span className="text-[10px] uppercase tracking-wide text-comment">
                    Changes ({unstagedChanges.length})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Tip label="Stage all" side="bottom">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStageAll(); }}
                      className="text-comment hover:text-text"
                    >
                      <Plus size={13} />
                    </button>
                  </Tip>
                  <Tip label="Discard all changes" side="bottom">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDiscardAll(); }}
                      className="text-comment hover:text-red-500"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </Tip>
                </div>
              </div>
              {changesOpen && (
                <div>
                  {unstagedChanges.map((file) => {
                    const fileStatus = status.untracked.includes(file) ? 'untracked'
                      : status.deleted.includes(file) ? 'deleted' : 'modified';
                    return (
                      <div
                        key={file}
                        onClick={() => handleFileClick(file, false)}
                        className="ml-2 flex items-center gap-2 px-3 py-1.5 hover:bg-active/50 group cursor-pointer"
                      >
                        {getFileIcon(file, fileStatus)}
                        <span className="text-xs text-text flex-1 truncate">{file.split('/').pop() || file}</span>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                          <Tip label="Stage" side="bottom">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStage(file);
                              }}
                              className="text-comment hover:text-text"
                            >
                              <Plus size={13} />
                            </button>
                          </Tip>
                          <Tip label="Discard changes" side="bottom">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDiscard(file);
                              }}
                              className="text-comment hover:text-red-500"
                            >
                              <RotateCcw size={13} />
                            </button>
                          </Tip>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {totalChanges === 0 && (
            <div className="p-6 text-center text-comment text-sm flex flex-col items-center gap-3">
              <Check size={36} className="opacity-40" />
              <div>
                <p>No changes</p>
                <p className="text-xs mt-0.5 opacity-60">Working tree clean</p>
              </div>
              {status.ahead > 0 && (
                <button
                  onClick={handlePush}
                  disabled={isPushing}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded text-xs font-medium transition-colors",
                    "bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {isPushing
                    ? <RefreshCw size={12} className="animate-spin" />
                    : <ArrowUp size={12} />}
                  {isPushing ? "Pushing..." : `Push ${status.ahead} commit${status.ahead !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Commit History ── */}
        <div className="border-t border-border flex-shrink-0">
          <div
            className="px-3 py-1.5 bg-active/30 border-b border-border flex items-center gap-1 cursor-pointer select-none"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            {historyOpen ? <ChevronDown size={11} className="text-comment" /> : <ChevronRight size={11} className="text-comment" />}
            <GitCommit size={11} className="text-accent" />
            <span className="text-[10px] uppercase tracking-wide text-comment">Commit History</span>
          </div>
          {historyOpen && (
            <div className="h-72 flex flex-col overflow-hidden border-b border-border">
              <GitGraph />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
