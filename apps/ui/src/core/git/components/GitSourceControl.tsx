import { useGetGitStatus, useStageFiles, useUnstageFiles, useCommit, useDiscardFiles, useGetGitBranches, useInitializeGit, usePushToRemote, usePullFromRemote, useCloneRepo, useFetchRemote, useGetGitRemote, useStash, useStashList, useStashPop, useUncommit, useGetGitLog } from "@/core/git/hooks";
import { useSetActiveProject, useOpenProject } from "@/core/projects/hooks/useProjects";
import { Loader2, FilePlus, FileEdit, FileX, GitBranch, Check, Plus, Minus, RotateCcw, GitCommit, ArrowUp, ArrowDown, RefreshCw, ChevronDown, ChevronRight, GitFork, Eye, EyeOff, MoreVertical, CloudDownload, Archive, ArrowDownToLine, X } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useState } from "react";
import { toast } from "@/core/components/ui/sonner";
import { useAddPanelTab } from "@/core/layout/hooks";
import { GitGraph } from "./GitGraph";
import { ConflictResolver } from "./ConflictResolver";
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
  const { mutateAsync: commitAsync, isPending: isCommitting } = useCommit();
  const { mutate: discardFiles } = useDiscardFiles();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutateAsync: pushToRemoteAsync, isPending: isPushing } = usePushToRemote();
  const { mutate: pullFromRemote, isPending: isPulling } = usePullFromRemote();
  const { triggerFetch } = useFetchRemote();
  const { data: remoteUrl, refetch: refetchRemote } = useGetGitRemote();
  const { mutate: stash, isPending: isStashing } = useStash();
  const { mutate: stashPop, isPending: isPopping } = useStashPop();
  const { data: stashList } = useStashList();
  const { mutateAsync: uncommitAsync, isPending: isUncommitting } = useUncommit();
  const { data: gitLog } = useGetGitLog(1);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
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
    const isUntracked = status?.untracked.includes(file);
    discardFiles([file], {
      onSuccess: (result: any) => {
        if (result?.canceled) return;
        toast.success(isUntracked ? "File deleted" : "Changes discarded", {
          description: isUntracked ? `Deleted ${file}` : `Discarded changes in ${file}`,
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
    const allUnstaged = [...status.modified, ...status.deleted, ...status.untracked].filter(f => !status.staged.includes(f));
    if (allUnstaged.length === 0) return;
    discardFiles(allUnstaged, {
      onSuccess: (result: any) => {
        if (result?.canceled) return;
        toast.success("All changes discarded");
      },
      onError: (error: any) => toast.error("Failed to discard changes", { description: error?.message || String(error) }),
    });
  };

  const handleUnstageAll = () => {
    if (!status) return;
    unstageFiles(status.staged);
  };

  const handlePush = async () => {
    try {
      await pushToRemoteAsync();
      toast.success(status?.published ? "Pushed to remote" : "Branch published", {
        description: `Branch ${status?.current} pushed successfully`,
      });
      refetchStatus();
    } catch (error: any) {
      toast.error("Push failed", {
        description: error?.message || String(error),
      });
    }
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

  const handleUncommit = async () => {
    try {
      await uncommitAsync();
      toast.success("Last commit undone", {
        description: "Changes moved back to staged area",
      });
    } catch (error: any) {
      toast.error("Failed to undo commit", {
        description: error?.message || String(error),
      });
    }
  };

  const handleCommit = async () => {
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

    const stagedCount = status.staged.length;

    try {
      await commitAsync(commitMessage);
      setCommitMessage("");

      toast.success("Changes committed", {
        description: `Committed ${stagedCount} file(s)`,
      });
    } catch (error: any) {
      toast.error("Failed to commit", {
        description: error?.message || String(error),
      });
    }
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
  const conflictedFiles = status.conflicted ?? [];
  const unstagedChanges = [
    ...status.modified,
    ...status.untracked,
    ...status.deleted,
  ].filter((f) => !status.staged.includes(f) && !conflictedFiles.includes(f));
  const stagedChanges = status.staged.filter((f) => !conflictedFiles.includes(f));

  const hasConflicts = conflictedFiles.length > 0;
  const hasStagedChanges = stagedChanges.length > 0;
  const hasUnstagedChanges = unstagedChanges.length > 0;
  const hasWorkingTreeChanges = hasConflicts || hasStagedChanges || hasUnstagedChanges;
  const hasPushTarget = status.published || !!status.tracking || !!remoteUrl;
  const canPushNow = hasPushTarget && !hasWorkingTreeChanges && status.outgoing;
  const totalChanges = conflictedFiles.length + stagedChanges.length + unstagedChanges.length;

  return (
    <div className="flex flex-col h-full">
      {/* Branch header */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0 relative">
        <div className="flex items-center gap-2">
          <Tip label={remoteUrl || "No remote configured"} side="bottom">
            <GitBranch size={14} className="text-accent flex-shrink-0" />
          </Tip>
          <span className="text-xs font-medium text-text flex-1 truncate">{status.current}</span>

          {/* Pull — remote has commits we don't have */}
          {status.behind > 0 && (
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
          {(status.published || !!status.tracking) && !status.outgoing && status.ahead === 0 && status.behind === 0 && (
            <span className="text-[10px] text-comment flex-shrink-0">Up to date</span>
          )}

          {/* Vertical dots menu */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            disabled={isRefreshing || isFetchingAll || isPulling}
            className="text-comment hover:text-text flex-shrink-0 p-0.5 rounded hover:bg-active/50 disabled:opacity-60"
          >
            {isRefreshing || isFetchingAll || isPulling
              ? <Loader2 size={14} className="animate-spin" />
              : <MoreVertical size={14} />}
          </button>
        </div>

        {/* Dropdown menu */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-2 top-8 z-50 bg-editor border border-border rounded-md shadow-lg py-1 min-w-[170px]">
              {/* Section 1: Refresh + Pull */}
              <button
                onClick={() => { setMenuOpen(false); handleRefresh(); }}
                disabled={isRefreshing}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-accent/20 disabled:opacity-50"
              >
                <RefreshCw size={12} className={cn("text-comment", isRefreshing && "animate-spin")} />
                Refresh
              </button>
              <button
                onClick={() => { setMenuOpen(false); handlePull(); }}
                disabled={isPulling}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-accent/20 disabled:opacity-50"
              >
                <ArrowDown size={12} className="text-comment" />
                {isPulling ? "Pulling…" : "Pull"}
              </button>

              {/* Section 2: Stash */}
              <div className="border-t border-border my-1" />
              <button
                onClick={() => { setMenuOpen(false); setStashOpen(true); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-accent/20"
              >
                <Archive size={12} className="text-comment" />
                Stash…
              </button>

              {/* Section 3: Undo Last Commit */}
              <div className="border-t border-border my-1" />
              <button
                onClick={() => { setMenuOpen(false); handleUncommit(); }}
                disabled={isUncommitting || !gitLog?.all.length}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw size={12} className="text-comment" />
                Undo Last Commit
              </button>

              {/* Section 4: Fetch All */}
              <div className="border-t border-border my-1" />
              <button
                onClick={() => { setMenuOpen(false); handleFetchAll(); }}
                disabled={isFetchingAll}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-accent/20 disabled:opacity-50"
              >
                <CloudDownload size={12} className={cn("text-comment", isFetchingAll && "animate-pulse")} />
                Fetch All
              </button>
            </div>
          </>
        )}

        {/* Stash modal */}
        {stashOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setStashOpen(false)} />
            <div className="fixed left-1/2 top-1/3 z-50 -translate-x-1/2 -translate-y-1/2 bg-editor border border-border rounded-lg shadow-xl w-[360px]">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Archive size={13} className="text-accent" />
                  <span className="text-sm font-medium text-text">Stash Changes</span>
                </div>
                <button onClick={() => setStashOpen(false)} className="text-comment hover:text-text">
                  <X size={14} />
                </button>
              </div>

              {/* Stash input */}
              <div className="p-4 flex flex-col gap-2 border-b border-border">
                <input
                  type="text"
                  value={stashMessage}
                  onChange={(e) => setStashMessage(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="Stash name (optional)"
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text placeholder:text-comment focus:outline-none focus:ring-1 focus:ring-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      stash(stashMessage.trim() || undefined, {
                        onSuccess: () => { setStashMessage(""); toast.success("Changes stashed"); },
                        onError: (err: any) => toast.error("Stash failed", { description: err?.message }),
                      });
                    }
                  }}
                />
                <button
                  onClick={() => stash(stashMessage.trim() || undefined, {
                    onSuccess: () => { setStashMessage(""); toast.success("Changes stashed"); },
                    onError: (err: any) => toast.error("Stash failed", { description: err?.message }),
                  })}
                  disabled={isStashing}
                  className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs rounded px-3 py-1.5 transition-colors"
                >
                  {isStashing ? <Loader2 size={12} className="animate-spin mx-auto" /> : "Stash"}
                </button>
              </div>

              {/* Stash list */}
              <div className="max-h-52 overflow-y-auto">
                {!stashList?.length ? (
                  <div className="px-4 py-6 text-center text-xs text-comment">No stashes</div>
                ) : (
                  stashList.map((item) => (
                    <div key={item.index} className="flex items-center gap-2 px-4 py-2 border-b border-border/50 hover:bg-active/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text truncate">{item.message}</p>
                        <p className="text-[10px] text-comment">{item.date}</p>
                      </div>
                      <button
                        onClick={() => stashPop(item.index, {
                          onSuccess: () => toast.success("Stash applied"),
                          onError: (err: any) => toast.error("Pop failed", { description: err?.message }),
                        })}
                        disabled={isPopping}
                        className="flex items-center gap-1 text-[10px] bg-active hover:bg-active/70 text-text rounded px-2 py-0.5 flex-shrink-0 disabled:opacity-50 transition-colors"
                      >
                        <ArrowDownToLine size={10} />
                        Pop
                      </button>
                    </div>
                  ))
                )}
              </div>
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
          className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text placeholder:text-comment resize-none focus:outline-none focus:ring-1 focus:ring-accent"
          rows={3}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter' && hasWorkingTreeChanges) handleCommit();
          }}
        />


        {!canPushNow ? (
          <button
            onClick={handleCommit}
            disabled={isCommitting || hasConflicts || !commitMessage.trim() || !hasStagedChanges}
            className={cn(
              "mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "bg-accent text-white hover:bg-accent/90"
            )}
          >
            {isCommitting ? <RefreshCw size={13} className="animate-spin" /> : <GitCommit size={13} />}
            {isCommitting ? "Committing…" : hasConflicts ? `Resolve conflicts (${conflictedFiles.length})` : `Commit (${stagedChanges.length})`}
          </button>
        ) : (
          <button
            onClick={handlePush}
            disabled={isPushing}
            className={cn(
              "mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "bg-accent text-white hover:bg-accent/90"
            )}
          >
            {isPushing ? <RefreshCw size={13} className="animate-spin" /> : <ArrowUp size={13} />}
            {isPushing
              ? "Pushing…"
              : status.published
                ? `Push ${status.ahead} commit${status.ahead !== 1 ? "s" : ""}`
                : "Publish branch"}
          </button>
        )}

      </div>

      {/* Scrollable file lists */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">
          <ConflictResolver conflicted={conflictedFiles} />

          {/* ── Staged Changes ── */}
          {stagedChanges.length > 0 && (
            <div>
              <div
                className="px-3 py-1.5 bg-active/30 border-b border-border flex items-center justify-between cursor-pointer select-none"
                onClick={() => setStagedOpen((o) => !o)}
              >
                <div className="flex items-center gap-1">
                  {stagedOpen ? <ChevronDown size={11} className="text-comment" /> : <ChevronRight size={11} className="text-comment" />}
                  <span className="text-[10px] uppercase tracking-wide text-comment">
                    Staged ({stagedChanges.length})
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
                  {stagedChanges.map((file) => (
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
