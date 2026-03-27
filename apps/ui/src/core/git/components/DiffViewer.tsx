import { useGetBranchDiff, useGetFileAtBranch } from "@/core/git/hooks";
import { Loader2, FileIcon, GitCompareArrows, Split, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { useState, useRef, useCallback, useEffect } from "react";
import * as Diff from "diff";
import { useQuery } from "@tanstack/react-query";

// Hook to get git repository root
const useGetGitRepoRoot = () => {
  return useQuery({
    queryKey: ["git:repoRoot"],
    queryFn: async () => {
      return window.electron?.git.getRepoRoot();
    },
  });
};

// Hook to read file from filesystem (for working directory changes)
const useReadFile = (filePath: string | undefined) => {
  const { data: repoRoot } = useGetGitRepoRoot();

  return useQuery({
    queryKey: ["file:read:working", filePath],
    enabled: !!filePath && !!repoRoot,
    queryFn: async () => {
      if (!filePath || !repoRoot) return null;
      // Construct full path - filePath from git status is relative to repo root
      const fullPath = `${repoRoot}/${filePath}`;
      const content = await window.electron?.files.read(fullPath);
      return content || null;
    },
  });
};

interface DiffViewerProps {
  tab: {
    source?: string;
    meta?: {
      baseBranch: string;
      compareBranch: string;
      filePath?: string;
      isWorkingDirectory?: boolean;
      viewOnly?: boolean;
    };
  };
}

type DiffMode = "split" | "unified";

// Simple read-only file viewer for a file at a specific commit
const FileAtCommitViewer = ({ branch, filePath }: { branch: string; filePath: string }) => {
  const { data: content, isLoading } = useGetFileAtBranch(branch, filePath);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-comment" size={20} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <pre className="p-4 text-xs font-mono text-text whitespace-pre leading-5">
        {content ?? <span className="text-comment italic">File not found at this commit</span>}
      </pre>
    </div>
  );
};

export const DiffViewer = ({ tab }: DiffViewerProps) => {
  const baseBranch = tab.meta?.baseBranch;
  const compareBranch = tab.meta?.compareBranch;
  const isWorkingDirectory = tab.meta?.isWorkingDirectory;
  const viewOnly = tab.meta?.viewOnly;
  const singleFilePath = tab.meta?.filePath;

  // Skip branch diff if comparing with working directory
  const { data: diffData, isLoading } = useGetBranchDiff(
    isWorkingDirectory || viewOnly ? undefined : baseBranch,
    isWorkingDirectory || viewOnly ? undefined : compareBranch
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(singleFilePath || null);
  const [diffMode, setDiffMode] = useState<DiffMode>("split");
  const [panelWidth, setPanelWidth] = useState(30); // percentage
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-select first file when diff data loads
  useEffect(() => {
    if (diffData?.files?.length && !selectedFile) {
      setSelectedFile(diffData.files[0].path);
    }
  }, [diffData, selectedFile]);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setPanelWidth(Math.max(10, Math.min(60, pct)));
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  // View-only: show raw file content at the commit (no diff)
  if (viewOnly && singleFilePath && compareBranch) {
    return (
      <div className="flex flex-col h-full bg-bg">
        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <FileIcon size={14} className="text-comment flex-shrink-0" />
          <span className="text-xs font-mono text-text">{singleFilePath}</span>
        </div>
        <FileAtCommitViewer branch={compareBranch} filePath={singleFilePath} />
      </div>
    );
  }

  // For working directory diffs, skip to file view directly
  if (isWorkingDirectory && singleFilePath) {
    return (
      <div className="flex flex-col h-full bg-bg">
        {/* Diff Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileIcon size={16} className="text-comment" />
            <span className="text-sm font-mono text-text">{singleFilePath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDiffMode("split")}
              className={cn(
                "px-3 py-1 text-xs rounded flex items-center gap-1 transition-colors",
                diffMode === "split"
                  ? "bg-accent text-bg"
                  : "bg-active text-comment hover:text-text"
              )}
            >
              <Split size={12} />
              Split
            </button>
            <button
              onClick={() => setDiffMode("unified")}
              className={cn(
                "px-3 py-1 text-xs rounded flex items-center gap-1 transition-colors",
                diffMode === "unified"
                  ? "bg-accent text-bg"
                  : "bg-active text-comment hover:text-text"
              )}
            >
              <FileText size={12} />
              Unified
            </button>
          </div>
        </div>

        {/* Diff Display */}
        <FileDiffContent
          baseBranch={baseBranch}
          compareBranch={compareBranch}
          filePath={singleFilePath}
          mode={diffMode}
          isWorkingDirectory={isWorkingDirectory}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-comment" size={24} />
      </div>
    );
  }

  if (!diffData || !baseBranch || !compareBranch) {
    return (
      <div className="flex items-center justify-center h-full text-comment">
        <div className="text-center">
          <p>No diff data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* ── Top header: comparison info + stats ── */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-border flex items-center gap-4">
        <GitCompareArrows size={14} className="text-accent flex-shrink-0" />
        <div className="flex items-center gap-1.5 text-xs font-mono min-w-0 flex-1">
          <span className="text-accent truncate max-w-[200px]">{baseBranch}</span>
          <ArrowRight size={12} className="text-comment flex-shrink-0" />
          <span className="text-green-400 truncate max-w-[200px]">{compareBranch}</span>
        </div>
        <div className="flex items-center gap-3 text-xs flex-shrink-0">
          <span className="text-comment">{diffData.summary.files} file{diffData.summary.files !== 1 ? 's' : ''}</span>
          {diffData.summary.insertions > 0 && (
            <span className="text-green-500">+{diffData.summary.insertions}</span>
          )}
          {diffData.summary.deletions > 0 && (
            <span className="text-red-500">-{diffData.summary.deletions}</span>
          )}
        </div>
        {/* Diff mode toggle */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setDiffMode("split")}
            className={cn("px-2 py-0.5 text-xs rounded flex items-center gap-1 transition-colors",
              diffMode === "split" ? "bg-accent text-bg" : "bg-active/50 text-comment hover:text-text")}
          >
            <Split size={11} /> Split
          </button>
          <button
            onClick={() => setDiffMode("unified")}
            className={cn("px-2 py-0.5 text-xs rounded flex items-center gap-1 transition-colors",
              diffMode === "unified" ? "bg-accent text-bg" : "bg-active/50 text-comment hover:text-text")}
          >
            <FileText size={11} /> Unified
          </button>
        </div>
      </div>

      {/* ── Body: resizable file list + wide diff ── */}
      <div ref={containerRef} className="flex flex-1 min-h-0 select-none">
        {/* File list — resizable */}
        <div style={{ width: `${panelWidth}%`, minWidth: 80 }} className="border-r border-border flex flex-col overflow-hidden flex-shrink-0">
          {diffData.files.length === 0 ? (
            <div className="p-2 text-center text-comment text-[10px]">No changes</div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {diffData.files.map((file: any) => {
                const fileName = file.path.split('/').pop() || file.path;
                const statusColor =
                  file.status[0] === 'A' ? 'bg-green-500' :
                  file.status[0] === 'D' ? 'bg-red-500' :
                  file.status[0] === 'R' ? 'bg-yellow-500' : 'bg-blue-500';
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    title={file.path}
                    className={cn(
                      "w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors",
                      "hover:bg-active/50",
                      selectedFile === file.path ? "bg-active border-l-2 border-accent" : "border-l-2 border-transparent"
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", statusColor)} />
                    <span className="text-[11px] text-text font-mono truncate">{fileName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Drag divider */}
        <div
          onMouseDown={handleDividerMouseDown}
          className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 flex-shrink-0 transition-colors"
        />

        {/* Diff panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <FileDiffContent
              baseBranch={baseBranch}
              compareBranch={compareBranch}
              filePath={selectedFile}
              mode={diffMode}
              isWorkingDirectory={false}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-comment">
              <div className="text-center">
                <FileIcon size={36} className="mx-auto mb-3 opacity-40" />
                <p className="text-xs">Select a file to view diff</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface FileDiffContentProps {
  baseBranch: string;
  compareBranch: string;
  filePath: string;
  mode: DiffMode;
  isWorkingDirectory?: boolean;
}

const FileDiffContent = ({ baseBranch, compareBranch, filePath, mode, isWorkingDirectory }: FileDiffContentProps) => {
  const { data: baseContent, isLoading: baseLoading } = useGetFileAtBranch(baseBranch, filePath);

  // For working directory, read file from filesystem instead of git
  const { data: workingFileContent, isLoading: workingFileLoading } = useReadFile(
    isWorkingDirectory ? filePath : undefined
  );

  // For branch comparison, get file from git
  const { data: gitCompareContent, isLoading: compareLoading } = useGetFileAtBranch(
    !isWorkingDirectory ? compareBranch : undefined,
    !isWorkingDirectory ? filePath : undefined
  );

  const finalCompareContent = isWorkingDirectory ? workingFileContent : gitCompareContent;
  const finalCompareLoading = isWorkingDirectory ? workingFileLoading : compareLoading;

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplitRef = useRef(false);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left panel

  const handleLeftScroll = useCallback(() => {
    if (isScrollingRef.current) return;
    isScrollingRef.current = true;
    if (leftScrollRef.current && rightScrollRef.current) {
      rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    }
    setTimeout(() => { isScrollingRef.current = false; }, 0);
  }, []);

  const handleRightScroll = useCallback(() => {
    if (isScrollingRef.current) return;
    isScrollingRef.current = true;
    if (leftScrollRef.current && rightScrollRef.current) {
      leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    }
    setTimeout(() => { isScrollingRef.current = false; }, 0);
  }, []);

  const handleSplitDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.max(20, Math.min(80, pct)));
    };

    const onMouseUp = () => {
      isDraggingSplitRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  if (baseLoading || finalCompareLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-comment" size={20} />
      </div>
    );
  }

  if (mode === "split") {
    // Use proper diff algorithm
    const changes = Diff.diffLines(baseContent || "", finalCompareContent || "");

    // Build separate arrays for left (base) and right (compare) sides
    const leftLines: Array<{ lineNum: number | null; content: string; type: 'normal' | 'removed' | 'empty' }> = [];
    const rightLines: Array<{ lineNum: number | null; content: string; type: 'normal' | 'added' | 'empty' }> = [];

    let baseLineNum = 1;
    let compareLineNum = 1;

    // Process changes and detect modifications (removed followed by added)
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const nextChange = changes[i + 1];

      const lines = change.value.split('\n');
      // Remove last empty line if it exists (from split)
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }

      if (change.removed && nextChange?.added) {
        // This is a modification: removed lines followed by added lines
        // Show them side-by-side
        const nextLines = nextChange.value.split('\n');
        if (nextLines[nextLines.length - 1] === '') {
          nextLines.pop();
        }

        const maxLines = Math.max(lines.length, nextLines.length);
        for (let j = 0; j < maxLines; j++) {
          const removedLine = lines[j];
          const addedLine = nextLines[j];

          if (removedLine !== undefined && addedLine !== undefined) {
            // Both sides have content - show as modified
            leftLines.push({ lineNum: baseLineNum++, content: removedLine, type: 'removed' });
            rightLines.push({ lineNum: compareLineNum++, content: addedLine, type: 'added' });
          } else if (removedLine !== undefined) {
            // Only removed line exists
            leftLines.push({ lineNum: baseLineNum++, content: removedLine, type: 'removed' });
            rightLines.push({ lineNum: null, content: '', type: 'empty' });
          } else if (addedLine !== undefined) {
            // Only added line exists
            leftLines.push({ lineNum: null, content: '', type: 'empty' });
            rightLines.push({ lineNum: compareLineNum++, content: addedLine, type: 'added' });
          }
        }

        // Skip the next change since we already processed it
        i++;
      } else if (change.added) {
        // Pure addition: show empty on left, content on right
        lines.forEach((line) => {
          leftLines.push({ lineNum: null, content: '', type: 'empty' });
          rightLines.push({ lineNum: compareLineNum++, content: line, type: 'added' });
        });
      } else if (change.removed) {
        // Pure removal: show content on left, empty on right
        lines.forEach((line) => {
          leftLines.push({ lineNum: baseLineNum++, content: line, type: 'removed' });
          rightLines.push({ lineNum: null, content: '', type: 'empty' });
        });
      } else {
        // Unchanged lines: show on both sides
        lines.forEach((line) => {
          leftLines.push({ lineNum: baseLineNum++, content: line, type: 'normal' });
          rightLines.push({ lineNum: compareLineNum++, content: line, type: 'normal' });
        });
      }
    }

    return (
      <div ref={splitContainerRef} className="flex-1 flex overflow-hidden select-none">
        {/* Left side - Base */}
        <div style={{ width: `${splitRatio}%` }} className="flex flex-col flex-shrink-0 min-w-0">
          <div className="px-4 py-2 bg-red-500/10 border-b border-border text-xs text-comment flex items-center gap-2 flex-shrink-0">
            <span className="font-semibold">{baseBranch}</span>
            <span className="text-[10px]">(base)</span>
          </div>
          <div ref={leftScrollRef} onScroll={handleLeftScroll} className="flex-1 overflow-auto">
            <div className="font-mono text-xs min-w-max">
              {leftLines.map((line, idx) => (
                <div
                  key={`base-${idx}`}
                  className={cn(
                    "flex min-h-[20px] w-max",
                    line.type === 'removed' && "bg-red-500/15",
                    line.type === 'empty' && "bg-gray-500/5"
                  )}
                >
                  <span className="inline-block w-12 text-right px-2 text-comment select-none border-r border-border flex-shrink-0">
                    {line.lineNum || ''}
                  </span>
                  <span className={cn("px-3 py-0.5 whitespace-pre", line.type === 'empty' && "text-comment")}>
                    {line.content || ' '}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Draggable split divider */}
        <div
          onMouseDown={handleSplitDividerMouseDown}
          className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 flex-shrink-0 transition-colors bg-border"
        />

        {/* Right side - Compare */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2 bg-green-500/10 border-b border-border text-xs text-comment flex items-center gap-2 flex-shrink-0">
            <span className="font-semibold">{isWorkingDirectory ? "Working Directory" : compareBranch}</span>
            <span className="text-[10px]">(compare)</span>
          </div>
          <div ref={rightScrollRef} onScroll={handleRightScroll} className="flex-1 overflow-auto">
            <div className="font-mono text-xs min-w-max">
              {rightLines.map((line, idx) => (
                <div
                  key={`compare-${idx}`}
                  className={cn(
                    "flex min-h-[20px] w-max",
                    line.type === 'added' && "bg-green-500/15",
                    line.type === 'empty' && "bg-gray-500/5"
                  )}
                >
                  <span className="inline-block w-12 text-right px-2 text-comment select-none border-r border-border flex-shrink-0">
                    {line.lineNum || ''}
                  </span>
                  <span className={cn("px-3 py-0.5 whitespace-pre", line.type === 'empty' && "text-comment")}>
                    {line.content || ' '}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Unified view using proper diff algorithm
  const changes = Diff.diffLines(baseContent || "", finalCompareContent || "");

  let baseLineNum = 1;
  let compareLineNum = 1;

  return (
    <div className="flex-1 overflow-auto">
      <div className="font-mono text-xs">
        <div>
          {changes.map((change, changeIdx) => {
            const lines = change.value.split('\n');
            // Remove last empty line if it exists (from split)
            if (lines[lines.length - 1] === '') {
              lines.pop();
            }

            if (change.added) {
              // Added lines
              return lines.map((line, lineIdx) => {
                const currentLineNum = compareLineNum++;
                return (
                  <div
                    key={`add-${changeIdx}-${lineIdx}`}
                    className="flex bg-green-500/15 border-l-2 border-green-500"
                  >
                    <span className="inline-block w-12 text-right px-2 text-comment select-none"></span>
                    <span className="inline-block w-12 text-right px-2 text-comment select-none border-r border-border">
                      {currentLineNum}
                    </span>
                    <span className="text-green-500 px-2 select-none w-6">+</span>
                    <span className="text-text px-2 py-0.5">{line}</span>
                  </div>
                );
              });
            } else if (change.removed) {
              // Removed lines
              return lines.map((line, lineIdx) => {
                const currentLineNum = baseLineNum++;
                return (
                  <div
                    key={`remove-${changeIdx}-${lineIdx}`}
                    className="flex bg-red-500/15 border-l-2 border-red-500"
                  >
                    <span className="inline-block w-12 text-right px-2 text-comment select-none border-r border-border">
                      {currentLineNum}
                    </span>
                    <span className="inline-block w-12 text-right px-2 text-comment select-none"></span>
                    <span className="text-red-500 px-2 select-none w-6">-</span>
                    <span className="text-text px-2 py-0.5">{line}</span>
                  </div>
                );
              });
            } else {
              // Unchanged lines
              return lines.map((line, lineIdx) => {
                const currentBaseLineNum = baseLineNum++;
                const currentCompareLineNum = compareLineNum++;
                return (
                  <div key={`same-${changeIdx}-${lineIdx}`} className="flex hover:bg-active/20">
                    <span className="inline-block w-12 text-right px-2 text-comment select-none border-r border-border">
                      {currentBaseLineNum}
                    </span>
                    <span className="inline-block w-12 text-right px-2 text-comment select-none border-r border-border">
                      {currentCompareLineNum}
                    </span>
                    <span className="text-comment px-2 select-none w-6"> </span>
                    <span className="text-text px-2 py-0.5">{line}</span>
                  </div>
                );
              });
            }
          })}
        </div>
      </div>
    </div>
  );
};
