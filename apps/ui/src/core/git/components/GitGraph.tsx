import { useGetGitLog, useGetCommitFiles } from "@/core/git/hooks";
import { useAddPanelTab } from "@/core/layout/hooks";
import { Loader2, File, Eye } from "lucide-react";
import { useMemo, useState } from "react";

interface GraphNode {
  commit: {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    refs: string;
    parents: string[];
  };
  lane: number;
  color: string;
  branches: { from: number; to: number; isMerge?: boolean }[];
  /** Lanes that still have future commits pending after this row. */
  activeLanesAfter: number[];
}

const COLORS = [
  '#00D9FF', // Cyan
  '#00FF85', // Green
  '#FF00DC', // Magenta
  '#FFB300', // Orange
  '#00A6FF', // Blue
  '#FF6B6B', // Red
  '#A855F7', // Purple
  '#10B981', // Emerald
];

const LANE_WIDTH = 14;
const ROW_HEIGHT = 44;

/**
 * Assigns each commit to a lane and records which lanes are still active
 * (have pending future commits) after each row. This gives us all the
 * information needed to draw correct continuation lines between rows.
 */
function buildGraph(commits: any[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  const commitToLane = new Map<string, number>();
  // laneToHash[l] = hash means lane l is reserved for that future commit.
  // laneToHash[l] = null/undefined means lane l is free.
  const laneToHash: (string | null)[] = [];
  const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));

  // Keep the first-parent backbone pinned to lane 0 so the outer-left
  // branch remains the main continuous line and merged branches stay inside.
  const firstParentBackbone = new Set<string>();
  if (commits.length > 0) {
    let current: any | undefined = commits[0];
    while (current && !firstParentBackbone.has(current.hash)) {
      firstParentBackbone.add(current.hash);
      const parentHash = current.parents?.[0];
      current = parentHash ? commitsByHash.get(parentHash) : undefined;
    }
  }

  const freeLane = (startAt = 0): number => {
    const idx = laneToHash.findIndex(
      (h, lane) => lane >= startAt && (h === null || h === undefined)
    );
    return idx === -1 ? laneToHash.length : idx;
  };

  for (const commit of commits) {
    let lane: number;
    const existingLane = commitToLane.get(commit.hash);
    const isBackboneCommit = firstParentBackbone.has(commit.hash);

    if (isBackboneCommit) {
      lane = 0;
      commitToLane.set(commit.hash, 0);
      laneToHash[0] = null; // consume reservation if present
    } else if (existingLane !== undefined) {
      lane = existingLane;
      laneToHash[lane] = null; // consume reservation
    } else {
      // Keep lane 0 reserved for first-parent backbone commits.
      lane = freeLane(1);
      commitToLane.set(commit.hash, lane);
    }

    const branches: GraphNode['branches'] = [];

    if (commit.parents?.length > 0) {
      commit.parents.forEach((parentHash: string, parentIndex: number) => {
        const parentIsBackbone = firstParentBackbone.has(parentHash);
        let parentLane = commitToLane.get(parentHash);

        if (parentIsBackbone) {
          // Always keep backbone commits on lane 0.
          // If a prior pass mis-assigned this hash to a phantom lane, clear it.
          if (parentLane !== undefined && parentLane !== 0 && laneToHash[parentLane] === parentHash) {
            laneToHash[parentLane] = null;
          }
          parentLane = 0;
          commitToLane.set(parentHash, 0);
        } else if (parentLane === undefined) {
          parentLane = parentIndex === 0 ? lane : freeLane(1);
          commitToLane.set(parentHash, parentLane);
        }

        laneToHash[parentLane] = parentHash;
        branches.push({ from: lane, to: parentLane, isMerge: parentIndex > 0 });
      });
    }

    // Capture which lanes are still awaiting future commits.
    const activeLanesAfter: number[] = [];
    for (let l = 0; l < laneToHash.length; l++) {
      if (laneToHash[l]) activeLanesAfter.push(l);
    }

    nodes.push({
      commit,
      lane,
      color: COLORS[lane % COLORS.length],
      branches,
      activeLanesAfter,
    });
  }

  return nodes;
}

export const GitGraph = () => {
  const { data: log, isLoading, isFetching } = useGetGitLog(100);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  const graphNodes = useMemo(() => {
    if (!log?.all) return [];
    return buildGraph(log.all);
  }, [log]);

  // Compute a single graphWidth used by every row so content never shifts.
  const graphWidth = useMemo(() => {
    if (!graphNodes.length) return 30;
    const maxLane = graphNodes.reduce((max, node) => {
      const lanes = [node.lane, ...node.activeLanesAfter, ...node.branches.map((b) => b.to)];
      return Math.max(max, ...lanes);
    }, 0);
    return (maxLane + 1) * LANE_WIDTH + 8;
  }, [graphNodes]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-comment" size={18} />
      </div>
    );
  }

  if (!graphNodes.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-comment text-xs">
        No commit history
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto relative">
      {/* Loading overlay while refetching (e.g. after branch switch) */}
      {isFetching && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/60 backdrop-blur-[1px]">
          <Loader2 className="animate-spin text-comment" size={18} />
        </div>
      )}
      {graphNodes.map((node, index) => (
        <CommitRow
          key={node.commit.hash}
          node={node}
          index={index}
          graphNodes={graphNodes}
          graphWidth={graphWidth}
          expandedCommit={expandedCommit}
          setExpandedCommit={setExpandedCommit}
        />
      ))}
    </div>
  );
};

const CommitRow = ({
  node,
  index,
  graphNodes,
  graphWidth,
  expandedCommit,
  setExpandedCommit,
}: {
  node: GraphNode;
  index: number;
  graphNodes: GraphNode[];
  graphWidth: number;
  expandedCommit: string | null;
  setExpandedCommit: (hash: string | null) => void;
}) => {
  const isExpanded = expandedCommit === node.commit.hash;
  const prevNode = index > 0 ? graphNodes[index - 1] : null;
  const prevActiveLanes = prevNode ? prevNode.activeLanesAfter : [];
  const expandedLanes = node.activeLanesAfter.length > 0 ? node.activeLanesAfter : [node.lane];

  const dot = {
    cx: node.lane * LANE_WIDTH + LANE_WIDTH / 2,
    cy: ROW_HEIGHT / 2,
  };
  const laneRefSummary = node.commit.refs?.trim()
    ? node.commit.refs
    : "No branch/tag ref at this commit";
  const tooltipText = `${node.commit.shortHash} - ${node.commit.message}\n${laneRefSummary}`;

  return (
    <div>
      {/* Main commit row */}
      <div
        className="flex items-center hover:bg-active/50 cursor-pointer overflow-hidden"
        style={{ height: ROW_HEIGHT }}
        onClick={() =>
          setExpandedCommit(expandedCommit === node.commit.hash ? null : node.commit.hash)
        }
      >
        {/* Graph SVG */}
        <svg
          width={graphWidth}
          height={ROW_HEIGHT}
          viewBox={`0 0 ${graphWidth} ${ROW_HEIGHT}`}
          className="flex-shrink-0"
        >
          {/* ── Continuation lines ───────────────────────────────── */}
          {prevActiveLanes.map((l) => {
            const x = l * LANE_WIDTH + LANE_WIDTH / 2;
            const color = COLORS[l % COLORS.length];
            const remainsActiveAfterRow = node.activeLanesAfter.includes(l);

            if (l === node.lane) {
              // Line from top down to the commit dot.
              return (
                <line key={`in-${l}`} x1={x} y1={0} x2={x} y2={dot.cy}
                  stroke={color} strokeWidth="1.5" opacity="0.7" strokeLinecap="round" />
              );
            } else {
              // If a lane is no longer active after this row, terminate at the row center.
              const y2 = remainsActiveAfterRow ? ROW_HEIGHT : dot.cy;
              return (
                <line key={`pass-${l}`} x1={x} y1={0} x2={x} y2={y2}
                  stroke={color} strokeWidth="1.5" opacity="0.7" strokeLinecap="round" />
              );
            }
          })}

          {/* ── Outgoing branches ─────────────────────────────────── */}
          {node.branches.map((branch, i) => {
            const x1 = dot.cx;
            const y1 = dot.cy;
            const x2 = branch.to * LANE_WIDTH + LANE_WIDTH / 2;
            const y2 = ROW_HEIGHT;
            const branchColor = COLORS[branch.to % COLORS.length];

            if (branch.from === branch.to) {
              // Straight downward continuation.
              return (
                <line key={`br-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={node.color} strokeWidth="1.5" opacity="0.7" strokeLinecap="round" />
              );
            }

            // Smooth arc: departs straight down from x1, arrives straight down at x2.
            return (
              <path key={`br-${i}`}
                d={`M ${x1} ${y1} C ${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`}
                stroke={branchColor} strokeWidth="1.5"
                fill="none" opacity="0.7" strokeLinecap="round"
              />
            );
          })}

          {/* ── Commit dot ───────────────────────────────────────── */}
          <circle cx={dot.cx} cy={dot.cy} r="3.5"
            fill={node.color} stroke="#1e1e2e" strokeWidth="1.5">
            <title>{tooltipText}</title>
          </circle>
        </svg>

        {/* Commit info */}
        <div className="flex-1 min-w-0 pl-1.5 pr-3 flex flex-col justify-center gap-0.5">
          <p className="text-xs text-text min-w-0 truncate">
            {node.commit.message}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-comment">
            <span className="truncate max-w-[80px]">{node.commit.author}</span>
            <span className="font-mono opacity-70">{node.commit.shortHash}</span>
            <span className="whitespace-nowrap opacity-70">
              {new Date(node.commit.date).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded file list */}
      {isExpanded && (
        <div className="relative" style={{ paddingLeft: graphWidth }}>
          {/* Continue all active lanes through expanded content, including merge parent lanes. */}
          <svg
            className="absolute left-0 top-0 pointer-events-none"
            width={graphWidth}
            style={{ height: '100%', overflow: 'visible' }}
          >
            {expandedLanes.map((lane) => {
              const x = lane * LANE_WIDTH + LANE_WIDTH / 2;
              const isCommitLane = lane === node.lane;
              const color = isCommitLane ? node.color : COLORS[lane % COLORS.length];
              return (
                <line
                  key={`expanded-${node.commit.hash}-${lane}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2="100%"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={isCommitLane ? 0.9 : 0.7}
                />
              );
            })}
          </svg>
          <div className="p-2">
            <CommitFileList commitHash={node.commit.hash} shortHash={node.commit.shortHash} />
          </div>
        </div>
      )}
    </div>
  );
};

const CommitFileList = ({ commitHash, shortHash }: { commitHash: string; shortHash: string }) => {
  const { data: files, isLoading } = useGetCommitFiles(commitHash);
  const { mutate: addPanelTab } = useAddPanelTab();

  const handleFileClick = (filePath: string) => {
    const fileName = filePath.split('/').pop() || filePath;
    addPanelTab({
      panelId: "main",
      tab: {
        id: `diff-commit-${commitHash}-${filePath}`,
        type: "diff",
        title: `${shortHash}^ >>> ${shortHash} | ${fileName}`,
        source: filePath,
        meta: {
          baseBranch: `${commitHash}^`,
          compareBranch: commitHash,
          filePath,
          isWorkingDirectory: false,
        },
      } as any,
    });
  };

  const handleViewFile = (filePath: string) => {
    const fileName = filePath.split('/').pop() || filePath;
    addPanelTab({
      panelId: "main",
      tab: {
        id: `view-file-${commitHash}-${filePath}`,
        type: "diff",
        title: `${fileName} (${shortHash})`,
        source: filePath,
        meta: {
          baseBranch: commitHash,
          compareBranch: commitHash,
          filePath,
          isWorkingDirectory: false,
          viewOnly: true,
        },
      } as any,
    });
  };

  if (isLoading) {
    return (
      <div className="px-3 py-2 bg-active/20 border-t border-border">
        <Loader2 className="animate-spin text-comment" size={14} />
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="px-3 py-2 bg-active/20 border-t border-border text-xs text-comment">
        No files changed
      </div>
    );
  }

  return (
    <div className="bg-panel border-t border-border">
      <div className="px-3 py-1 text-[10px] text-comment font-medium">
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </div>
      {files.map((file: { path: string; insertions: number; deletions: number }) => (
        <div
          key={file.path}
          onClick={() => handleFileClick(file.path)}
          className="flex items-center justify-between px-3 py-1 hover:bg-active/40 cursor-pointer text-xs group"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <File size={11} className="text-comment flex-shrink-0" />
            <span className="text-text font-mono truncate text-[11px]">{file.path}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] flex-shrink-0 ml-2">
            {file.insertions > 0 && <span className="text-green-500">+{file.insertions}</span>}
            {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
            <button
              onClick={(e) => { e.stopPropagation(); handleViewFile(file.path); }}
              className="opacity-0 group-hover:opacity-100 text-comment hover:text-text ml-1"
              title="View file at this commit"
            >
              <Eye size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
