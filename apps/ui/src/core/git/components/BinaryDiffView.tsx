import { memo, useState } from "react";
import { Archive, ArrowRight, Cpu, Database, File, FileAudio, FileImage, FileText, FileVideo, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { formatSize } from "@/utils/format";
import type { FileBlob } from "@/core/git/hooks";

/** Text files larger than this get a note instead of a line diff (matches TEXT_DIFF_LIMIT in the main process). */
export const TEXT_DIFF_LIMIT = 2 * 1024 * 1024;

export type BlobView = "image" | "binary" | "tooLarge" | "text";

/** How to show a file change, decided before any text is loaded (#610). */
export function pickBlobView(base: FileBlob | null | undefined, compare: FileBlob | null | undefined): BlobView {
  const sides = [base, compare].filter((blob): blob is FileBlob => !!blob?.exists);
  if (sides.some((blob) => blob.dataUrl)) return "image";
  if (sides.some((blob) => blob.binary || blob.category === "image")) return "binary";
  if (sides.some((blob) => blob.size > TEXT_DIFF_LIMIT)) return "tooLarge";
  return "text";
}

type Change = "added" | "deleted" | "changed";

const changeOf = (base?: FileBlob | null, compare?: FileBlob | null): Change =>
  !base?.exists ? "added" : !compare?.exists ? "deleted" : "changed";

const sizeDelta = (from: number, to: number) => {
  const diff = to - from;
  if (diff === 0) return "same size";
  return `${diff > 0 ? "+" : "−"}${formatSize(Math.abs(diff))}`;
};

/** "84 KB → 134 KB (+50 KB)", or a single size when only one side exists. */
const SizeLine = ({ base, compare }: { base?: FileBlob | null; compare?: FileBlob | null }) => {
  const change = changeOf(base, compare);
  if (change !== "changed") return <span>{formatSize((change === "added" ? compare : base)?.size ?? 0)}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap justify-center">
      {formatSize(base!.size)}
      <ArrowRight size={11} aria-label="to" />
      {formatSize(compare!.size)}
      <span className={cn(compare!.size > base!.size ? "text-vcs-added" : compare!.size < base!.size ? "text-vcs-removed" : "text-comment")}>
        ({sizeDelta(base!.size, compare!.size)})
      </span>
    </span>
  );
};

const CHANGE_TEXT: Record<Change, string> = { added: "added", deleted: "deleted", changed: "changed" };
const CHANGE_CLASS: Record<Change, string> = { added: "text-vcs-added", deleted: "text-vcs-removed", changed: "text-vcs-modified" };

const CATEGORY_ICON: Record<FileBlob["category"], LucideIcon> = {
  image: FileImage,
  document: FileText,
  audio: FileAudio,
  video: FileVideo,
  font: Type,
  archive: Archive,
  executable: Cpu,
  database: Database,
  binary: File,
  text: FileText,
};

/** The common card for files that cannot be shown as text or as a picture. */
export const BinaryFileCard = ({ base, compare, filePath, single, renamedFrom }: { base?: FileBlob | null; compare?: FileBlob | null; filePath: string; single?: boolean; renamedFrom?: string }) => {
  const blob = compare?.exists ? compare : base;
  const change = changeOf(base, compare);
  const Icon = CATEGORY_ICON[blob?.category ?? "binary"];
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-lg border border-border bg-panel/40 px-6 py-6 text-center space-y-2">
        <Icon size={32} className="mx-auto text-comment" aria-hidden />
        <p className="text-sm text-text break-all">{filePath.split(/[\\/]/).pop()}</p>
        <p className="text-xs text-comment">
          {blob?.label ?? "Binary file"}
          {!single && <> <span className={CHANGE_CLASS[change]}>{renamedFrom ? "renamed" : CHANGE_TEXT[change]}</span></>}
        </p>
        {renamedFrom && <p className="text-[11px] text-comment break-all">from {renamedFrom}</p>}
        <p className="text-xs text-text">{single ? formatSize(blob?.size ?? 0) : <SizeLine base={base} compare={compare} />}</p>
        <p className="text-[11px] text-comment">
          {single ? "This file type cannot be previewed in Voiden." : "Changes to this file type can't be shown here."}
        </p>
      </div>
    </div>
  );
};

/** For text files too big to diff in the window without freezing it. */
export const TooLargeCard = ({ base, compare, filePath, single }: { base?: FileBlob | null; compare?: FileBlob | null; filePath: string; single?: boolean }) => (
  <div className="flex-1 flex items-center justify-center p-6">
    <div className="max-w-sm w-full rounded-lg border border-border bg-panel/40 px-6 py-6 text-center space-y-2">
      <FileText size={32} className="mx-auto text-comment" aria-hidden />
      <p className="text-sm text-text break-all">{filePath.split(/[\\/]/).pop()}</p>
      <p className="text-xs text-text">{single ? formatSize((compare ?? base)?.size ?? 0) : <SizeLine base={base} compare={compare} />}</p>
      <p className="text-[11px] text-comment">
        {single ? "This file is too large to show here. Open it in an editor to read it." : "This file is too large to show its changes here. Open it in an editor to compare."}
      </p>
    </div>
  </div>
);

const CHECKERBOARD = {
  backgroundImage:
    "conic-gradient(color-mix(in srgb, var(--editor-fg) 9%, transparent) 25%, transparent 0 50%, color-mix(in srgb, var(--editor-fg) 9%, transparent) 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
};

type PaneTone = "removed" | "added" | "neutral";
const PANE_HEADER: Record<PaneTone, string> = {
  removed: "bg-[color-mix(in_srgb,var(--vcs-removed)_12%,transparent)]",
  added: "bg-[color-mix(in_srgb,var(--vcs-added)_12%,transparent)]",
  neutral: "bg-active/40",
};

const ImagePane = memo(({ blob, label, note, tone }: { blob?: FileBlob | null; label: string; note: string; tone: PaneTone }) => {
  const [dimensions, setDimensions] = useState<string | null>(null);
  return (
    <div className="flex flex-col min-w-0 min-h-0 flex-1">
      <div className={cn("px-4 py-2 border-b border-border text-xs text-comment flex items-center gap-2 flex-shrink-0 min-w-0", PANE_HEADER[tone])}>
        <span className="font-semibold truncate">{label}</span>
        <span className="text-[10px] flex-shrink-0">({note})</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center gap-3 p-4">
        {!blob?.exists ? (
          <p className="text-xs text-comment italic">Not in this version</p>
        ) : blob.dataUrl ? (
          <>
            <div className="rounded border border-border p-2 max-w-full" style={CHECKERBOARD}>
              <img
                src={blob.dataUrl}
                alt={`${label} version`}
                className="block max-w-full max-h-[60vh] object-contain"
                onLoad={(e) => setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)}
              />
            </div>
            <p className="text-[11px] text-comment">{[dimensions, formatSize(blob.size)].filter(Boolean).join(" · ")}</p>
          </>
        ) : (
          <p className="text-xs text-comment text-center max-w-xs">
            {formatSize(blob.size)}. This image is too large to preview here.
          </p>
        )}
      </div>
    </div>
  );
});
ImagePane.displayName = "ImagePane";

interface ImageDiffProps {
  base?: FileBlob | null;
  compare?: FileBlob | null;
  baseLabel: string;
  compareLabel: string;
  mode: "split" | "unified";
  /** Old path when the image was renamed. */
  renamedFrom?: string;
  /** Replaces the "Image changed" line, e.g. for conflicts. */
  title?: string;
  /** Replaces the "base" / "compare" notes on each side. */
  notes?: [string, string];
}

/** Old and new picture side by side (or stacked in unified mode), with their sizes. */
export const ImageDiff = ({ base, compare, baseLabel, compareLabel, mode, renamedFrom, title, notes }: ImageDiffProps) => {
  const change = changeOf(base, compare);
  // With custom notes (conflicts) both sides are always shown, even when one side is missing.
  const panes = [
    (notes || change !== "added") && <ImagePane key="base" blob={base} label={baseLabel} note={notes?.[0] ?? (change === "deleted" ? "deleted" : "base")} tone="removed" />,
    (notes || change !== "deleted") && <ImagePane key="compare" blob={compare} label={compareLabel} note={notes?.[1] ?? (change === "added" ? "added" : "compare")} tone="added" />,
  ].filter(Boolean);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-1.5 border-b border-border text-xs text-comment flex items-center justify-center gap-2 flex-shrink-0">
        {title ? (
          <span className="text-text">{title}</span>
        ) : (
          <>
            <span className={CHANGE_CLASS[change]}>Image {renamedFrom ? "renamed" : CHANGE_TEXT[change]}</span>
            {renamedFrom && <span className="truncate">from {renamedFrom}</span>}
            <span>·</span>
            <SizeLine base={base} compare={compare} />
          </>
        )}
      </div>
      <div className={cn("flex-1 min-h-0 flex", mode === "split" ? "flex-row divide-x divide-border" : "flex-col divide-y divide-border overflow-auto")}>
        {panes}
      </div>
    </div>
  );
};

/** One picture with its size, for "Open File at This Commit". */
export const ImageFileView = ({ blob, label, note = "at this commit" }: { blob: FileBlob; label: string; note?: string }) => (
  <div className="flex-1 flex flex-col min-h-0">
    <ImagePane blob={blob} label={label} note={note} tone="neutral" />
  </div>
);

export const BlobDiffSkeleton = ({ columns = 2 }: { columns?: 1 | 2 }) => (
  <div className={cn("flex-1 grid overflow-hidden", columns === 2 ? "grid-cols-2 divide-x divide-border" : "grid-cols-1")} aria-busy="true">
    {Array.from({ length: columns }, (_, col) => (
      <div key={col} className="flex flex-col">
        <div className="h-8 border-b border-border px-4 flex items-center">
          <div className="h-2.5 w-1/3 rounded bg-active animate-pulse" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <div className="w-2/3 aspect-video rounded bg-active animate-pulse" />
          <div className="h-2.5 w-24 rounded bg-active animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);
