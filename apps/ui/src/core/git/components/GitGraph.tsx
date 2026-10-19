import { KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileDiff, Loader2, Tag } from "lucide-react";
import { useGetGitLog } from "@/core/git/hooks";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";
import { parseRefs } from "@/core/git/utils/commitInfo";
import { GraphNode, ROW_HEIGHT, buildGraph, computeGraphWidth } from "./gitGraphLayout";
import { CommitGraphCell, LaneContinuation } from "./CommitGraphCell";
import { CommitFileList, useOpenCommitChanges } from "./CommitFileList";
import { CommitHoverCard } from "./CommitHoverCard";

const PAGE_SIZE = 100;
const MAX_VISIBLE_REFS = 2;
const SKELETON_WIDTHS = [62, 48, 70, 55, 66, 44, 58, 50];

const RefBadges = ({ refs }: { refs: string }) => {
  const parsed = parseRefs(refs);
  if (!parsed.length) return null;
  const visible = parsed.slice(0, MAX_VISIBLE_REFS);
  const hidden = parsed.length - visible.length;
  return (
    <span className="flex items-center gap-1 flex-shrink-0 ml-1.5" title={parsed.map((r) => r.name).join(", ")}>
      {visible.map((ref) => (
        <span
          key={ref.name}
          className={cn(
            "flex items-center gap-0.5 px-1 rounded border text-[10px] leading-[14px] max-w-[110px]",
            ref.kind === "head" ? "border-accent/60 text-accent" : "border-border text-comment",
          )}
        >
          {ref.kind === "tag" && <Tag size={9} className="flex-shrink-0" />}
          <span className="truncate">{ref.name}</span>
        </span>
      ))}
      {hidden > 0 && <span className="text-[10px] text-comment">+{hidden}</span>}
    </span>
  );
};

interface CommitRowProps {
  node: GraphNode;
  prevActiveLanes: number[];
  graphWidth: number;
  selected: boolean;
  expanded: boolean;
  onRowClick: (hash: string) => void;
  onOpenChanges: (hash: string, shortHash: string) => void;
}

const CommitRow = memo(({ node, prevActiveLanes, graphWidth, selected, expanded, onRowClick, onOpenChanges }: CommitRowProps) => {
  const { commit } = node;
  return (
    <div data-hash={commit.hash}>
      <CommitHoverCard commit={commit} color={node.color}>
        <div
          role="option"
          aria-selected={selected}
          aria-expanded={expanded}
          onClick={() => onRowClick(commit.hash)}
          className={cn(
            "group flex items-center cursor-pointer select-none pr-1.5",
            selected ? "bg-active" : "hover:bg-hover",
          )}
          style={{ height: ROW_HEIGHT }}
        >
          <CommitGraphCell node={node} prevActiveLanes={prevActiveLanes} graphWidth={graphWidth} selected={selected} />
          <span className="flex-1 min-w-0 truncate text-xs pl-1">
            <span className="text-text">{commit.message}</span>
            <span className="text-comment ml-1.5">{commit.author}</span>
          </span>
          <RefBadges refs={commit.refs} />
          <Tip label="Open Changes" side="top" align="center">
            <button
              onClick={(e) => { e.stopPropagation(); onOpenChanges(commit.hash, commit.shortHash); }}
              className={cn(
                "ml-1 p-0.5 rounded text-comment hover:text-text hover:bg-active flex-shrink-0",
                selected ? "visible" : "invisible group-hover:visible",
              )}
              aria-label={`Open changes in ${commit.shortHash}`}
            >
              <FileDiff size={13} />
            </button>
          </Tip>
        </div>
      </CommitHoverCard>

      {/* Only one commit is expanded at a time, so this is a single animated element. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="files"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative overflow-hidden"
            style={{ paddingLeft: graphWidth }}
          >
            <LaneContinuation node={node} graphWidth={graphWidth} />
            <CommitFileList commitHash={commit.hash} shortHash={commit.shortHash} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
CommitRow.displayName = "CommitRow";

const GitGraphSkeleton = () => (
  <div className="flex-1 overflow-hidden" aria-busy="true">
    {SKELETON_WIDTHS.map((w, i) => (
      <div key={i} className="flex items-center gap-2 px-2" style={{ height: ROW_HEIGHT }}>
        <div className="w-2 h-2 rounded-full bg-active animate-pulse flex-shrink-0" />
        <div className="h-2.5 rounded bg-active animate-pulse" style={{ width: `${w}%` }} />
      </div>
    ))}
  </div>
);

export const GitGraph = () => {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { data: log, isLoading, isPlaceholderData } = useGetGitLog(limit);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openChanges = useOpenCommitChanges();

  const graphNodes = useMemo(() => (log?.all ? buildGraph(log.all) : []), [log]);
  const graphWidth = useMemo(() => computeGraphWidth(graphNodes), [graphNodes]);
  const hasMore = (log?.all.length ?? 0) >= limit;

  const handleRowClick = useCallback((hash: string) => {
    setSelectedHash(hash);
    setExpandedHash((current) => (current === hash ? null : hash));
    listRef.current?.focus({ preventScroll: true });
  }, []);

  // Keep the selected row visible when it moves via the keyboard.
  useEffect(() => {
    if (!selectedHash) return;
    listRef.current
      ?.querySelector(`[data-hash="${selectedHash}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedHash]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!graphNodes.length) return;
    const index = graphNodes.findIndex((n) => n.commit.hash === selectedHash);
    const selectAt = (i: number) => setSelectedHash(graphNodes[Math.max(0, Math.min(graphNodes.length - 1, i))].commit.hash);

    switch (e.key) {
      case "ArrowDown":
        selectAt(index === -1 ? 0 : index + 1);
        break;
      case "ArrowUp":
        selectAt(index === -1 ? 0 : index - 1);
        break;
      case "Home":
        selectAt(0);
        break;
      case "End":
        selectAt(graphNodes.length - 1);
        break;
      case "Enter":
      case " ":
        if (selectedHash) setExpandedHash((current) => (current === selectedHash ? null : selectedHash));
        break;
      case "ArrowRight":
        if (selectedHash) setExpandedHash(selectedHash);
        break;
      case "ArrowLeft":
      case "Escape":
        setExpandedHash(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (isLoading) return <GitGraphSkeleton />;

  if (!graphNodes.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-comment text-xs">
        No commit history
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Commit history"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex-1 overflow-auto relative outline-none py-0.5"
    >
      {graphNodes.map((node, index) => (
        <CommitRow
          key={node.commit.hash}
          node={node}
          prevActiveLanes={index > 0 ? graphNodes[index - 1].activeLanesAfter : []}
          graphWidth={graphWidth}
          selected={selectedHash === node.commit.hash}
          expanded={expandedHash === node.commit.hash}
          onRowClick={handleRowClick}
          onOpenChanges={openChanges}
        />
      ))}

      {hasMore && (
        <button
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
          disabled={isPlaceholderData}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-comment hover:text-text hover:bg-hover disabled:cursor-default"
          style={{ height: ROW_HEIGHT }}
        >
          {isPlaceholderData ? <><Loader2 size={12} className="animate-spin" /> Loading…</> : "Load More Commits"}
        </button>
      )}
    </div>
  );
};
