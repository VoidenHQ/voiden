import { memo } from "react";
import { cn } from "@/core/lib/utils";
import { GraphNode, ROW_HEIGHT, laneColor, laneX } from "./gitGraphLayout";

const LINE_WIDTH = 1.5;

// Dot radius grows on row hover/selection (CSS `r`, so no re-render on hover).
const dotSize = (selected: boolean) =>
  cn("transition-[r] duration-100", selected ? "[r:5.5px]" : "[r:4px] group-hover:[r:5.5px]");
const innerDotSize = (selected: boolean) =>
  cn("transition-[r] duration-100", selected ? "[r:2.25px]" : "[r:1.75px] group-hover:[r:2.25px]");

interface CommitGraphCellProps {
  node: GraphNode;
  prevActiveLanes: number[];
  graphWidth: number;
  selected: boolean;
}

/** The lane lines, curves and commit dot for one history row. */
export const CommitGraphCell = memo(({ node, prevActiveLanes, graphWidth, selected }: CommitGraphCellProps) => {
  const cx = laneX(node.lane);
  const cy = ROW_HEIGHT / 2;
  const isMerge = node.commit.parents.length > 1;
  const maskId = `git-graph-mask-${node.commit.hash}`;

  return (
    <svg
      width={graphWidth}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${graphWidth} ${ROW_HEIGHT}`}
      className="flex-shrink-0 overflow-visible"
      aria-hidden
    >
      {isMerge && (
        // Punch a hole where the ring sits so lines never show through it,
        // whatever the row background (hover/selection are translucent).
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={graphWidth} height={ROW_HEIGHT}>
          <rect x={0} y={0} width={graphWidth} height={ROW_HEIGHT} fill="white" />
          <circle cx={cx} cy={cy} fill="black" className={dotSize(selected)} />
        </mask>
      )}

      <g mask={isMerge ? `url(#${maskId})` : undefined}>
        {/* Lines arriving from the row above */}
        {prevActiveLanes.map((l) => {
          const x = laneX(l);
          if (l === node.lane) {
            return (
              <line key={`in-${l}`} x1={x} y1={0} x2={x} y2={cy}
                stroke={node.color} strokeWidth={LINE_WIDTH} strokeLinecap="round" />
            );
          }
          // A lane that ends here (merged into this commit) stops at the row center.
          const y2 = node.activeLanesAfter.includes(l) ? ROW_HEIGHT : cy;
          return (
            <line key={`pass-${l}`} x1={x} y1={0} x2={x} y2={y2}
              stroke={laneColor(l)} strokeWidth={LINE_WIDTH} strokeLinecap="round" />
          );
        })}

        {/* Lines leaving this commit towards its parents */}
        {node.branches.map((branch, i) => {
          const x2 = laneX(branch.to);
          if (branch.from === branch.to) {
            return (
              <line key={`br-${i}`} x1={cx} y1={cy} x2={x2} y2={ROW_HEIGHT}
                stroke={node.color} strokeWidth={LINE_WIDTH} strokeLinecap="round" />
            );
          }
          // Departs straight down from the dot, arrives straight down in the parent's lane.
          return (
            <path key={`br-${i}`}
              d={`M ${cx} ${cy} C ${cx} ${ROW_HEIGHT} ${x2} ${cy} ${x2} ${ROW_HEIGHT}`}
              stroke={laneColor(branch.to)} strokeWidth={LINE_WIDTH} fill="none" strokeLinecap="round" />
          );
        })}
      </g>

      {/* Selected commit: soft halo so its position in the graph stands out */}
      {selected && <circle cx={cx} cy={cy} r={8.5} fill={node.color} opacity={0.25} />}

      {/* Commit dot: merges get VS Code's ring-with-center */}
      {isMerge ? (
        <>
          <circle cx={cx} cy={cy} fill="none" stroke={node.color} strokeWidth={1.5} className={dotSize(selected)} />
          <circle cx={cx} cy={cy} fill={node.color} className={innerDotSize(selected)} />
        </>
      ) : (
        <circle cx={cx} cy={cy} fill={node.color} className={dotSize(selected)} />
      )}
    </svg>
  );
});
CommitGraphCell.displayName = "CommitGraphCell";

/** Keeps every lane that is still open running through the expanded file list under a row. */
export const LaneContinuation = ({ node, graphWidth }: { node: GraphNode; graphWidth: number }) => {
  const lanes = node.activeLanesAfter.length > 0 ? node.activeLanesAfter : [node.lane];
  return (
    <svg
      className="absolute left-0 top-0 pointer-events-none"
      width={graphWidth}
      style={{ height: "100%" }}
      aria-hidden
    >
      {lanes.map((lane) => {
        const x = laneX(lane);
        return (
          <line key={lane} x1={x} y1={0} x2={x} y2="100%"
            stroke={lane === node.lane ? node.color : laneColor(lane)} strokeWidth={LINE_WIDTH} />
        );
      })}
    </svg>
  );
};
