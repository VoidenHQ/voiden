// Lane layout for the Commit History graph. Pure, no React.

export interface GraphCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
  parents: string[];
}

export interface GraphNode {
  commit: GraphCommit;
  lane: number;
  color: string;
  branches: { from: number; to: number; isMerge?: boolean }[];
  /** Lanes that still have future commits pending after this row. */
  activeLanesAfter: number[];
}

// Theme tokens (styles.css), so lanes follow the active theme.
const LANE_COLORS = [
  "var(--git-branch-1)",
  "var(--git-branch-2)",
  "var(--git-branch-3)",
  "var(--git-branch-4)",
  "var(--git-branch-5)",
  "var(--git-branch-6)",
  "var(--git-branch-7)",
  "var(--git-branch-8)",
];

export const LANE_WIDTH = 11;
export const ROW_HEIGHT = 22;
export const GRAPH_PADDING = 6;

export const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];
export const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PADDING / 2;

/**
 * Assigns each commit to a lane and records which lanes are still active
 * (have pending future commits) after each row. This gives us all the
 * information needed to draw correct continuation lines between rows.
 */
export function buildGraph(commits: GraphCommit[]): GraphNode[] {
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
    let current: GraphCommit | undefined = commits[0];
    while (current && !firstParentBackbone.has(current.hash)) {
      firstParentBackbone.add(current.hash);
      const parentHash: string | undefined = current.parents?.[0];
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
      color: laneColor(lane),
      branches,
      activeLanesAfter,
    });
  }

  return nodes;
}

/** Width shared by every row so content never shifts horizontally. */
export function computeGraphWidth(nodes: GraphNode[]): number {
  if (!nodes.length) return LANE_WIDTH + GRAPH_PADDING;
  const maxLane = nodes.reduce((max, node) => {
    const lanes = [node.lane, ...node.activeLanesAfter, ...node.branches.map((b) => b.to)];
    return Math.max(max, ...lanes);
  }, 0);
  return (maxLane + 1) * LANE_WIDTH + GRAPH_PADDING;
}
