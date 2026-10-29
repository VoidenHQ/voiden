import { memo, useCallback } from "react";
import { Eye, FileDiff, Infinity } from "lucide-react";
import { useGetCommitFiles, useSelectedGitRepo } from "@/core/git/hooks";
import { useAddPanelTab } from "@/core/layout/hooks";
import { VSCodeFileIcon } from "@/core/lib/vscodeFileIcon";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";
import { splitFilePath } from "@/core/git/utils/commitInfo";

export type CommitFile = Awaited<ReturnType<NonNullable<typeof window.electron>["git"]["getCommitFiles"]>>[number];

const STATUS_META: Record<CommitFile["status"], { label: string; className: string }> = {
  A: { label: "Added", className: "text-vcs-added" },
  M: { label: "Modified", className: "text-vcs-modified" },
  D: { label: "Deleted", className: "text-vcs-removed" },
  R: { label: "Renamed", className: "text-vcs-modified" },
  C: { label: "Copied", className: "text-vcs-added" },
  T: { label: "Type changed", className: "text-vcs-modified" },
  U: { label: "Unmerged", className: "text-vcs-removed" },
};

const FileTypeIcon = ({ name }: { name: string }) =>
  name.endsWith(".void")
    ? <Infinity size={14} className="text-accent flex-shrink-0" />
    : <VSCodeFileIcon name={name} size={14} />;

/** Opens the diff of one file in a commit against its first parent. */
export const useOpenCommitFileDiff = () => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const repoPath = useSelectedGitRepo();
  return useCallback((commitHash: string, shortHash: string, filePath: string) => {
    const { name } = splitFilePath(filePath);
    addPanelTab({
      panelId: "main",
      tab: {
        id: `diff-commit-${commitHash}-${filePath}`,
        type: "diff",
        title: `${shortHash}^ >>> ${shortHash} | ${name}`,
        source: filePath,
        meta: {
          baseBranch: `${commitHash}^`,
          compareBranch: commitHash,
          filePath,
          isWorkingDirectory: false,
          repoPath,
        },
      } as any,
    });
  }, [addPanelTab, repoPath]);
};

/** Opens the full multi-file diff of a commit against its first parent. */
export const useOpenCommitChanges = () => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const repoPath = useSelectedGitRepo();
  return useCallback((commitHash: string, shortHash: string) => {
    addPanelTab({
      panelId: "main",
      tab: {
        id: `diff-commit-${commitHash}`,
        type: "diff",
        title: `${shortHash}^ >>> ${shortHash}`,
        source: `${commitHash}^..${commitHash}`,
        meta: {
          baseBranch: `${commitHash}^`,
          compareBranch: commitHash,
          repoPath,
        },
      } as any,
    });
  }, [addPanelTab, repoPath]);
};

const CommitFileRow = memo(({ file, commitHash, shortHash }: { file: CommitFile; commitHash: string; shortHash: string }) => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const repoPath = useSelectedGitRepo();
  const openDiff = useOpenCommitFileDiff();
  const { name, dir } = splitFilePath(file.path);
  const status = STATUS_META[file.status] ?? STATUS_META.M;
  const fullPathLabel = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;

  const viewFile = () => {
    addPanelTab({
      panelId: "main",
      tab: {
        id: `view-file-${commitHash}-${file.path}`,
        type: "diff",
        title: `${name} (${shortHash})`,
        source: file.path,
        meta: {
          baseBranch: commitHash,
          compareBranch: commitHash,
          filePath: file.path,
          isWorkingDirectory: false,
          viewOnly: true,
          repoPath,
        },
      } as any,
    });
  };

  return (
    <div
      role="button"
      tabIndex={-1}
      title={`${fullPathLabel} • ${status.label}`}
      onClick={() => openDiff(commitHash, shortHash, file.path)}
      className="group/file flex items-center gap-1.5 h-[22px] pl-1 pr-2 cursor-pointer hover:bg-hover text-xs"
    >
      <FileTypeIcon name={name} />
      <span className={cn("truncate text-text flex-shrink-0 max-w-[60%]", file.status === "D" && "line-through opacity-70")}>{name}</span>
      {dir && <span className="truncate text-comment text-[11px] min-w-0">{dir}</span>}
      <span className="flex-1" />
      <div className="hidden group-hover/file:flex items-center gap-0.5 flex-shrink-0">
        <Tip label="Open Changes" side="top" align="center">
          <button
            onClick={(e) => { e.stopPropagation(); openDiff(commitHash, shortHash, file.path); }}
            className="p-0.5 rounded text-comment hover:text-text hover:bg-active"
            aria-label="Open Changes"
          >
            <FileDiff size={12} />
          </button>
        </Tip>
        {file.status !== "D" && (
          <Tip label="Open File at This Commit" side="top" align="center">
            <button
              onClick={(e) => { e.stopPropagation(); viewFile(); }}
              className="p-0.5 rounded text-comment hover:text-text hover:bg-active"
              aria-label="Open File at This Commit"
            >
              <Eye size={12} />
            </button>
          </Tip>
        )}
      </div>
      {(file.insertions > 0 || file.deletions > 0) && (
        <span className="flex items-center gap-1 text-[10px] font-mono flex-shrink-0 group-hover/file:hidden">
          {file.insertions > 0 && <span className="text-vcs-added">+{file.insertions}</span>}
          {file.deletions > 0 && <span className="text-vcs-removed">-{file.deletions}</span>}
        </span>
      )}
      <span className={cn("w-3 text-center font-mono text-[11px] font-semibold flex-shrink-0", status.className)}>
        {file.status}
      </span>
    </div>
  );
});
CommitFileRow.displayName = "CommitFileRow";

// One line: every commit shows at least one row, so the row only grows once files load.
const SKELETON_WIDTHS = [55];

/** Files changed by a commit, shown inline under an expanded history row. */
export const CommitFileList = ({ commitHash, shortHash }: { commitHash: string; shortHash: string }) => {
  const { data: files, isLoading } = useGetCommitFiles(commitHash);

  if (isLoading) {
    return (
      <div aria-busy="true">
        {SKELETON_WIDTHS.map((w) => (
          <div key={w} className="flex items-center gap-1.5 h-[22px] pr-2">
            <div className="w-3.5 h-3.5 rounded-sm bg-active animate-pulse" />
            <div className="h-2.5 rounded bg-active animate-pulse" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  }

  if (!files || files.length === 0) {
    return <div className="h-[22px] flex items-center text-xs text-comment">No files changed</div>;
  }

  return (
    <div role="group" aria-label={`Files changed in ${shortHash}`}>
      {files.map((file) => (
        <CommitFileRow key={file.path} file={file} commitHash={commitHash} shortHash={shortHash} />
      ))}
    </div>
  );
};
