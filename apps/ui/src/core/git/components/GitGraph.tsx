import { KeyboardEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileDiff, Loader2, Tag } from "lucide-react";
import { useGetGitLog } from "@/core/git/hooks";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";
import { parseRefs } from "@/core/git/utils/commitInfo";
import { GraphNode, ROW_HEIGHT, buildGraph, continuationWidth, rowGraphWidth } from "./gitGraphLayout";
import { CommitGraphCell, LaneContinuation } from "./CommitGraphCell";
import { CommitFileList, useOpenCommitChanges } from "./CommitFileList";
import { CommitHoverCard } from "./CommitHoverCard";

const PAGE_SIZE = 100;
const SKELETON_WIDTHS = [62, 48, 70, 55, 66, 44, 58, 50];
const EMPTY_LANES: number[] = [];

const RefBadges = ({ refs }: { refs: string }) => {
  const parsed = parseRefs(refs);
  if (!parsed.length) return null;
  const [first, ...rest] = parsed;
  return (
    <span
      className="flex items-center gap-1 flex-shrink min-w-0 max-w-[45%] ml-1.5 overflow-hidden"
      title={parsed.map((r) => r.name).join(", ")}
    >
      <span
        className={cn(
          "flex items-center gap-0.5 min-w-0 px-1 rounded border text-[10px] leading-[14px]",
          first.kind === "head" ? "border-accent/60 text-accent" : "border-border text-comment",
        )}
      >
        {first.kind === "tag" && <Tag size={9} className="flex-shrink-0" />}
        <span className="truncate">{first.name}</span>
      </span>
      {rest.length > 0 && <span className="text-[10px] text-comment flex-shrink-0">+{rest.length}</span>}
    </span>
  );
};

const FILES_TRANSITION = { duration: 0.15, ease: "easeOut" } as const;
const FILES_VARIANTS = {
  // Switching to another commit closes this one at once, so rows don't slide under the pointer.
  closed: (instant: boolean) => ({ height: 0, transition: instant ? { duration: 0 } : FILES_TRANSITION }),
};

/**
 * Files under an expanded commit. The height follows the measured content, so
 * the switch from the loading placeholder to the real list animates instead of
 * snapping, which a one-off "auto" height would do.
 */
const ExpandedFiles = ({ node, indent }: { node: GraphNode; indent: number }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={{ height: 0 }}
      animate={{ height }}
      exit="closed"
      variants={FILES_VARIANTS}
      transition={FILES_TRANSITION}
      className="relative overflow-hidden"
      style={{ paddingLeft: indent }}
    >
      <LaneContinuation node={node} graphWidth={indent} />
      <div ref={contentRef}>
        <CommitFileList commitHash={node.commit.hash} shortHash={node.commit.shortHash} />
      </div>
    </motion.div>
  );
};

interface CommitRowProps {
  node: GraphNode;
  prevActiveLanes: number[];
  selected: boolean;
  expanded: boolean;
  /** Another commit is open, so this one closes instantly instead of sliding shut. */
  otherExpanded: boolean;
  onRowClick: (hash: string) => void;
  onOpenChanges: (hash: string, shortHash: string) => void;
}

const CommitRow = memo(({ node, prevActiveLanes, selected, expanded, otherExpanded, onRowClick, onOpenChanges }: CommitRowProps) => {
  const { commit } = node;
  const graphWidth = rowGraphWidth(node, prevActiveLanes);
  const filesIndent = continuationWidth(node);
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
          <span className="flex-1 min-w-[4rem] truncate text-xs pl-1">
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
      <AnimatePresence initial={false} custom={otherExpanded}>
        {expanded && <ExpandedFiles key="files" node={node} indent={filesIndent} />}
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

/** Each change of `revealHead` selects the commit HEAD points at and scrolls to it. */
export const GitGraph = ({ revealHead = 0 }: { revealHead?: number }) => {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { data: log, isLoading, isPlaceholderData } = useGetGitLog(limit);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openChanges = useOpenCommitChanges();

  const graphNodes = useMemo(() => (log?.all ? buildGraph(log.all) : []), [log]);
  const hasMore = (log?.all.length ?? 0) >= limit;

  const handleRowClick = useCallback((hash: string) => {
    setSelectedHash(hash);
    setExpandedHash((current) => (current === hash ? null : hash));
    listRef.current?.focus({ preventScroll: true });
  }, []);

  const handledReveal = useRef(revealHead);
  useEffect(() => {
    if (revealHead === handledReveal.current) return;
    handledReveal.current = revealHead;
    // The log follows HEAD, so it is normally the first row.
    const head = graphNodes.find((n) => parseRefs(n.commit.refs).some((r) => r.kind === "head")) ?? graphNodes[0];
    if (!head) return;
    setSelectedHash(head.commit.hash);
    listRef.current?.querySelector(`[data-hash="${head.commit.hash}"]`)?.scrollIntoView({ block: "center" });
    listRef.current?.focus({ preventScroll: true });
  }, [revealHead, graphNodes]);

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
      className="flex-grow flex-shrink min-h-0 overflow-auto relative outline-none py-0.5"
      // Sized by the commit rows alone, so opening a commit scrolls inside the list
      // instead of growing the panel and moving the rows under the pointer.
      style={{ flexBasis: (graphNodes.length + (hasMore ? 1 : 0)) * ROW_HEIGHT + 4 }}
    >
      {graphNodes.map((node, index) => (
        <CommitRow
          key={node.commit.hash}
          node={node}
          prevActiveLanes={index > 0 ? graphNodes[index - 1].activeLanesAfter : EMPTY_LANES}
          selected={selectedHash === node.commit.hash}
          expanded={expandedHash === node.commit.hash}
          otherExpanded={expandedHash !== null && expandedHash !== node.commit.hash}
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
