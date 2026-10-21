import { memo, useMemo } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronsUpDown, Code } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { BlocksPreview, Extensions, Side, VoidFileView, parseVoidBlocks, usePreviewExtensions } from "./VoidDiffView";
import { FrontmatterChange, VoidDiffSection, diffFrontmatter, diffVoidBlocks } from "../utils/voidBlockDiff";
import {
  ConflictGroup,
  Resolution,
  conflictLabels,
  getHunks,
  groupConflictsByBlock,
  parseConflicts,
  resolveSegments,
  validateVoidContent,
} from "../utils/conflictMarkers";

/**
 * Resolves conflicts in a .void file one block at a time: each conflict is
 * shown as the Current and Incoming versions of the block, rendered the way
 * the editor shows them. Choices edit the file text directly, so everything
 * outside the chosen conflicts stays exactly as git wrote it.
 */

const SIDE_CLASSES: Record<"current" | "incoming", string> = {
  current: "border-l-2 border-vcs-added bg-[color-mix(in_srgb,var(--vcs-added)_8%,transparent)]",
  incoming: "border-l-2 border-vcs-modified bg-[color-mix(in_srgb,var(--vcs-modified)_8%,transparent)]",
};

interface GroupView {
  group: ConflictGroup;
  /** Block differences between the two sides, or null if a side cannot be shown as blocks. */
  sections: VoidDiffSection[] | null;
  metadata: FrontmatterChange[];
  incomingValid: boolean;
  /** Keeping both sides is offered only when that still gives a valid file with separate blocks. */
  canKeepBoth: boolean;
}

const sideBlocks = (sections: VoidDiffSection[], side: "current" | "incoming") =>
  sections.flatMap((s) => {
    if (s.kind === "modified") return [{ blocks: [side === "current" ? s.before : s.after], other: [side === "current" ? s.after : s.before] }];
    if (s.kind === "changed") {
      const blocks = side === "current" ? s.removed : s.added;
      return blocks.length ? [{ blocks, other: undefined }] : [];
    }
    return [];
  });

interface ColumnProps {
  sections: VoidDiffSection[];
  side: "current" | "incoming";
  extensions: Extensions;
  extensionsKey: string;
}

const SideColumn = memo(({ sections, side, extensions, extensionsKey }: ColumnProps) => {
  // New arrays here would make every preview editor rebuild on each render,
  // briefly collapsing its height and throwing the scroll position back.
  const parts = useMemo(() => sideBlocks(sections, side), [sections, side]);
  return (
    <div className={cn("min-w-0 px-4 py-3", SIDE_CLASSES[side])}>
      {parts.length === 0 ? (
        <p className="text-xs text-comment italic">Not in this version</p>
      ) : (
        <div className="space-y-3">
          {parts.map((part, i) => (
            <BlocksPreview
              key={i}
              blocks={part.blocks}
              compareTo={part.other}
              side={part.other ? (side as Side) : undefined}
              extensions={extensions}
              extensionsKey={extensionsKey}
            />
          ))}
        </div>
      )}
    </div>
  );
});
SideColumn.displayName = "SideColumn";

const MetadataRows = ({ changes }: { changes: FrontmatterChange[] }) => (
  <div className="grid grid-cols-2 text-xs font-mono">
    {changes.map((change) => (
      <div key={change.key} className="contents">
        <div className={cn("px-4 py-1.5 truncate", SIDE_CLASSES.current)} title={change.before}>
          <span className="text-comment">{change.key}:</span> {change.before ?? "(none)"}
        </div>
        <div className={cn("px-4 py-1.5 truncate", SIDE_CLASSES.incoming)} title={change.after}>
          <span className="text-comment">{change.key}:</span> {change.after ?? "(none)"}
        </div>
      </div>
    ))}
  </div>
);

const ActionButton = ({ onClick, children, className }: { onClick: () => void; children: React.ReactNode; className?: string }) => (
  <button
    onClick={onClick}
    className={cn("flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border transition-colors", className)}
  >
    {children}
  </button>
);

interface CardProps {
  view: GroupView;
  number: number;
  total: number;
  labels: { current: string; incoming: string };
  onResolve: (indices: number[], resolution: Resolution) => void;
  onShowSource: () => void;
  extensions: Extensions;
  extensionsKey: string;
}

const ConflictCard = memo(({ view, number, total, labels, onResolve, onShowSource, extensions, extensionsKey }: CardProps) => {
  const { group, sections, metadata, incomingValid, canKeepBoth } = view;
  const resolve = (resolution: Resolution) => onResolve(group.indices, resolution);
  const showsBlocks = !group.metadata && sections && sections.length > 0 && incomingValid;

  return (
    <section className="border border-border rounded-md overflow-hidden" data-testid="void-conflict-card">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border bg-panel">
        <span className="text-xs font-medium text-text">
          Conflict {number} of {total}
        </span>
        <span className="text-[11px] text-comment truncate flex-1">{group.metadata ? "File metadata" : "Block"}</span>
        <ActionButton onClick={() => resolve("current")} className="text-vcs-added border-border hover:bg-active">
          <ArrowUp size={11} /> Keep Current
        </ActionButton>
        <ActionButton onClick={() => resolve("incoming")} className="text-vcs-modified border-border hover:bg-active">
          <ArrowDown size={11} /> Keep Incoming
        </ActionButton>
        {canKeepBoth && (
          <ActionButton onClick={() => resolve("both")} className="text-comment border-border hover:text-text hover:bg-active">
            <ChevronsUpDown size={11} /> Keep Both
          </ActionButton>
        )}
      </header>

      <div className="grid grid-cols-2 text-[11px] text-comment border-b border-border">
        <div className="px-4 py-1.5 truncate">
          Current <span className="font-mono">({labels.current})</span>
        </div>
        <div className="px-4 py-1.5 truncate border-l border-border">
          Incoming <span className="font-mono">({labels.incoming})</span>
        </div>
      </div>

      {group.metadata ? (
        metadata.length > 0 ? (
          <MetadataRows changes={metadata} />
        ) : (
          <p className="px-4 py-3 text-xs text-comment">The two versions of the file header differ only in formatting.</p>
        )
      ) : showsBlocks ? (
        <div className="grid grid-cols-2">
          <SideColumn sections={sections!} side="current" extensions={extensions} extensionsKey={extensionsKey} />
          <SideColumn sections={sections!} side="incoming" extensions={extensions} extensionsKey={extensionsKey} />
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-comment flex items-center gap-2">
          <AlertTriangle size={13} className="text-vcs-modified flex-shrink-0" />
          <span className="flex-1">This conflict cannot be shown as blocks.</span>
          <button onClick={onShowSource} className="flex items-center gap-1 text-accent hover:underline">
            <Code size={11} /> Open in Source
          </button>
        </div>
      )}
    </section>
  );
});
ConflictCard.displayName = "ConflictCard";

interface VoidConflictViewProps {
  content: string;
  onResolve: (indices: number[], resolution: Resolution) => void;
  onShowSource: () => void;
}

export const VoidConflictView = ({ content, onResolve, onShowSource }: VoidConflictViewProps) => {
  const { extensions, extensionsKey, schema } = usePreviewExtensions();
  const segments = useMemo(() => parseConflicts(content), [content]);
  const labels = useMemo(() => conflictLabels(segments), [segments]);

  const views = useMemo((): GroupView[] | null => {
    const hunks = getHunks(segments);
    if (hunks.length === 0) return [];
    const allCurrent = resolveSegments(segments, () => "current");
    const currentBlocks = parseVoidBlocks(allCurrent, schema);
    if (!currentBlocks || !validateVoidContent(allCurrent).valid) return null;

    return groupConflictsByBlock(content).map((group) => {
      const inGroup = new Set(group.indices);
      const variant = (resolution: Resolution) => resolveSegments(segments, (h) => (inGroup.has(h.index) ? resolution : "current"));
      const incoming = variant("incoming");
      const incomingBlocks = parseVoidBlocks(incoming, schema);
      const sections = incomingBlocks ? diffVoidBlocks(currentBlocks, incomingBlocks).filter((s) => s.kind !== "unchanged") : null;
      const canKeepBoth =
        !group.metadata &&
        !!sections &&
        sections.length > 0 &&
        sections.every((s) => s.kind === "changed") &&
        validateVoidContent(variant("both")).valid;
      return {
        group,
        sections,
        metadata: group.metadata ? diffFrontmatter(allCurrent, incoming) : [],
        incomingValid: validateVoidContent(incoming).valid,
        canKeepBoth,
      };
    });
  }, [content, segments, schema]);

  if (!views) {
    return (
      <div className="flex-1 flex items-center justify-center text-comment">
        <div className="text-center text-xs max-w-xs">
          <AlertTriangle size={28} className="mx-auto mb-3 opacity-50" />
          <p className="mb-3">These conflicts cannot be shown as blocks. Resolve them in Source.</p>
          <button onClick={onShowSource} className="inline-flex items-center gap-1 text-accent hover:underline">
            <Code size={12} /> Open in Source
          </button>
        </div>
      </div>
    );
  }

  if (views.length === 0) return <ResolvedResult content={content} onShowSource={onShowSource} />;

  return (
    <div className="flex-1 overflow-auto px-4 py-4 space-y-4" data-testid="void-conflict-view">
      {views.map((view, i) => (
        <ConflictCard
          key={view.group.indices.join(",")}
          view={view}
          number={i + 1}
          total={views.length}
          labels={labels}
          onResolve={onResolve}
          onShowSource={onShowSource}
          extensions={extensions}
          extensionsKey={extensionsKey}
        />
      ))}
    </div>
  );
};

/** Shown once every conflict has a choice: the merged file as it will be saved. */
const ResolvedResult = ({ content, onShowSource }: { content: string; onShowSource: () => void }) => {
  const { valid, invalidBlocks } = useMemo(() => validateVoidContent(content), [content]);
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="void-conflict-result">
      <div className="px-5 py-2 border-b border-border text-xs flex items-center gap-2">
        {valid ? (
          <>
            <CheckCircle2 size={13} className="text-vcs-added flex-shrink-0" />
            <span className="text-text">All conflicts resolved. This is the file that will be saved.</span>
          </>
        ) : (
          <>
            <AlertTriangle size={13} className="text-vcs-removed flex-shrink-0" />
            <span className="text-text flex-1">
              {invalidBlocks} block{invalidBlocks === 1 ? " is" : "s are"} not valid. Fix {invalidBlocks === 1 ? "it" : "them"} in Source before saving.
            </span>
            <button onClick={onShowSource} className="flex items-center gap-1 text-accent hover:underline">
              <Code size={11} /> Open in Source
            </button>
          </>
        )}
      </div>
      <VoidFileView content={content} />
    </div>
  );
};
