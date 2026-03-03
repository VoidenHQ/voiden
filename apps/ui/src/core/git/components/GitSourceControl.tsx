import { useGetGitStatus, useStageFiles, useUnstageFiles, useCommit, useDiscardFiles, useGetGitBranches } from "@/core/git/hooks";
import { Loader2, FileIcon, FilePlus, FileEdit, FileX, GitBranch, Check, X, Plus, Minus, RotateCcw, GitCommit } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useState } from "react";
import { toast } from "@/core/components/ui/sonner";
import { useAddPanelTab } from "@/core/layout/hooks";
import { GitGraph } from "./GitGraph";
import { Tip } from "@/core/components/ui/Tip";

export const GitSourceControl = () => {
  const [showGraph, setShowGraph] = useState(true);
  const { data: status, isLoading } = useGetGitStatus();
  const { data: branches } = useGetGitBranches();
  const { mutate: stageFiles } = useStageFiles();
  const { mutate: unstageFiles } = useUnstageFiles();
  const { mutate: commit, isPending: isCommitting } = useCommit();
  const { mutate: discardFiles } = useDiscardFiles();
  const { mutate: addPanelTab } = useAddPanelTab();

  const [commitMessage, setCommitMessage] = useState("");

  const handleFileClick = (file: string, isStaged: boolean) => {
    // Open diff view comparing HEAD with working directory
    const currentBranch = branches?.activeBranch || status?.current || "HEAD";

    addPanelTab({
      panelId: "main",
      tab: {
        id: `diff-working-${file}-${Date.now()}`,
        type: "diff",
        title: file.split('/').pop() || file,
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
    const unstaged = [...status.modified, ...status.untracked, ...status.deleted];
    stageFiles(unstaged);
  };

  const handleUnstageAll = () => {
    if (!status) return;
    unstageFiles(status.staged);
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

  if (!status) {
    return (
      <div className="p-4 text-center text-comment text-sm">
        No git repository detected
      </div>
    );
  }

  const totalChanges = status.staged.length + status.modified.length + status.untracked.length + status.deleted.length;

  return (
    <div className="flex flex-col justify-between  h-full">
      {/* Changes Section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch size={16} className="text-accent" />
            <span className="text-sm font-medium text-text">{status.current}</span>
          </div>
          {status.tracking && (
            <div className="text-xs text-comment flex items-center gap-3">
              {status.ahead > 0 && <span className="text-green-500">↑{status.ahead}</span>}
              {status.behind > 0 && <span className="text-red-500">↓{status.behind}</span>}
              {status.ahead === 0 && status.behind === 0 && <span>Up to date</span>}
            </div>
          )}
        </div>

        {/* Commit Message Input */}
        <div className="p-3 border-b border-border">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            placeholder="Commit message (Ctrl+Enter to commit)"
            className="w-full bg-editor border border-border rounded px-3 py-2 text-sm text-text placeholder:text-comment resize-none focus:outline-none focus:ring-1 focus:ring-accent"
            rows={3}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key === 'Enter') {
                handleCommit();
              }
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

        {/* Files List */}
        <div className="overflow-y-auto">
          {/* Staged Changes */}
          {status.staged.length > 0 && (
            <div className="border-b border-border">
              <div className="px-3 py-2 bg-active/30 flex items-center justify-between">
                <span className="text-xs font-medium text-text">
                  Staged Changes ({status.staged.length})
                </span>
                <Tip label="Unstage all" side="bottom">
                  <button
                    onClick={handleUnstageAll}
                    className="text-xs text-comment hover:text-text"
                  >
                    <Minus size={14} />
                  </button>
                </Tip>
              </div>
              <div>
                {status.staged.map((file) => (
                  <div
                    key={file}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-active/50 group cursor-pointer"
                  >
                    {getFileIcon(file, 'staged')}
                    <span
                      onClick={() => handleFileClick(file, true)}
                      className="flex-1 text-sm text-text truncate font-mono"
                    >
                      {file}
                    </span>
                    <Tip label="Unstage" side="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnstage(file);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-comment hover:text-text"
                      >
                        <Minus size={14} />
                      </button>
                    </Tip>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Changes */}
          {(status.modified.length > 0 || status.untracked.length > 0 || status.deleted.length > 0) && (
            <div>
              <div className="px-3 py-2 bg-active/30 flex items-center justify-between">
                <span className="text-xs font-medium text-text">
                  Changes ({status.modified.length + status.untracked.length + status.deleted.length})
                </span>
                <Tip label="Stage all" side="bottom">
                  <button
                    onClick={handleStageAll}
                    className="text-xs text-comment hover:text-text"
                  >
                    <Plus size={14} />
                  </button>
                </Tip>
              </div>
              <div>
                {[...status.modified, ...status.untracked, ...status.deleted].map((file) => {
                  const fileStatus = status.untracked.includes(file) ? 'untracked' :
                    status.deleted.includes(file) ? 'deleted' : 'modified';

                  return (
                    <div
                      key={file}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-active/50 group cursor-pointer"
                    >
                      {getFileIcon(file, fileStatus)}
                      <span
                        onClick={() => handleFileClick(file, false)}
                        className="flex-1 text-sm text-text truncate font-mono"
                      >
                        {file}
                      </span>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                        <Tip label="Stage" side="bottom">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStage(file);
                            }}
                            className="text-comment hover:text-text"
                          >
                            <Plus size={14} />
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
                            <RotateCcw size={14} />
                          </button>
                        </Tip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {totalChanges === 0 && (
            <div className="p-8 text-center text-comment text-sm">
              <Check size={48} className="mx-auto mb-4 opacity-50" />
              <p>No changes</p>
              <p className="text-xs mt-1">Working tree clean</p>
            </div>
          )}
        </div>
      </div>

      {/* Graph Section */}
      {showGraph && (
        <div className="h-80 border-t border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-active/20">
            <div className="flex items-center gap-2">
              <GitCommit size={14} className="text-accent" />
              <span className="text-xs font-medium text-text">Commit History</span>
            </div>
            <Tip label="Hide commit history" side="bottom">
              <button
                onClick={() => setShowGraph(false)}
                className="text-xs text-comment hover:text-text"
              >
                <X size={14} />
              </button>
            </Tip>
          </div>
          <GitGraph />
        </div>
      )}

      {!showGraph && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowGraph(true)}
            className="w-full px-3 py-2 text-xs text-comment hover:text-text hover:bg-active/50 flex items-center justify-center gap-2"
          >
            <GitCommit size={14} />
            Show Commit History
          </button>
        </div>
      )}
    </div>
  );
};
