import { memo, useMemo } from "react";
import { Extension, type JSONContent } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { AlertTriangle, Code, Eye, Info } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";
import { proseClasses, useVoidenExtensionsAndSchema } from "@/core/editors/voiden/VoidenEditor";
import { sanitizeDoc } from "@/core/editors/voiden/utils/sanitizeDoc";
import { changedRanges } from "../utils/voidInlineDiff";
import { FrontmatterChange, VoidDiffSection, diffFrontmatter, diffVoidBlocks, hasBlockChanges } from "../utils/voidBlockDiff";

/** How .void files are shown: as Voiden blocks, or as their raw text. */
export type VoidView = "rendered" | "source";

export const VoidViewToggle = ({ value, onChange }: { value: VoidView; onChange: (view: VoidView) => void }) => (
  <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label="File view">
    {([
      { view: "rendered", label: "Rendered", Icon: Eye },
      { view: "source", label: "Source", Icon: Code },
    ] as const).map(({ view, label, Icon }) => (
      <button
        key={view}
        onClick={() => onChange(view)}
        aria-pressed={value === view}
        className={cn("px-2 py-0.5 text-xs rounded flex items-center gap-1 transition-colors",
          value === view ? "bg-accent text-bg" : "bg-active/50 text-comment hover:text-text")}
      >
        <Icon size={11} /> {label}
      </button>
    ))}
  </div>
);

type Tone = "added" | "removed" | "neutral";
export type Extensions = ReturnType<typeof useVoidenExtensionsAndSchema>["finalExtensions"];

const TONE_CLASSES: Record<Tone, string> = {
  added: "border-l-2 border-vcs-added bg-[color-mix(in_srgb,var(--vcs-added)_12%,transparent)]",
  removed: "border-l-2 border-vcs-removed bg-[color-mix(in_srgb,var(--vcs-removed)_12%,transparent)]",
  neutral: "border-l-2 border-transparent",
};

const LABEL_CLASSES: Record<string, string> = {
  Added: "text-vcs-added",
  Removed: "text-vcs-removed",
  Modified: "text-vcs-modified",
  Before: "text-vcs-removed",
  After: "text-vcs-added",
};

/** Same extension set the linked-file preview uses: everything except keyboard navigation between files. */
export const usePreviewExtensions = () => {
  const { finalExtensions, memoizedSchema } = useVoidenExtensionsAndSchema();
  const extensions = useMemo(() => finalExtensions.filter((ext) => ext?.name !== "seamlessNavigation"), [finalExtensions]);
  // finalExtensions is a new array whenever variables or environments refresh;
  // keying on names keeps the previews from being rebuilt on every refresh.
  const extensionsKey = useMemo(() => extensions.map((ext) => ext.name).join(","), [extensions]);
  return { extensions, extensionsKey, schema: memoizedSchema };
};

/** Parses a .void file into top-level blocks. Returns null when the file cannot be parsed. */
export function parseVoidBlocks(markdown: string | null | undefined, schema: ReturnType<typeof usePreviewExtensions>["schema"]): JSONContent[] | null {
  if (!markdown || !markdown.trim()) return [];
  try {
    return (parseMarkdown(markdown, schema)?.content as JSONContent[] | undefined) ?? [];
  } catch (error) {
    console.error("[VoidDiffView] Could not parse .void file", error);
    return null;
  }
}

const useParsedBlocks = (markdown: string | null | undefined, schema: ReturnType<typeof usePreviewExtensions>["schema"]) =>
  useMemo(() => parseVoidBlocks(markdown, schema), [markdown, schema]);

/** Which version a preview shows: the two sides of a diff, or of a merge conflict. */
export type Side = "removed" | "added" | "current" | "incoming";

const WORD_CLASSES: Record<Side, string> = {
  removed: "rounded-sm bg-[color-mix(in_srgb,var(--vcs-removed)_30%,transparent)]",
  added: "rounded-sm bg-[color-mix(in_srgb,var(--vcs-added)_30%,transparent)]",
  current: "rounded-sm bg-[color-mix(in_srgb,var(--vcs-added)_30%,transparent)]",
  incoming: "rounded-sm bg-[color-mix(in_srgb,var(--vcs-modified)_30%,transparent)]",
};

// sanitizeDoc mutates, and the same blocks render on both sides of a split diff.
const toDoc = (blocks: JSONContent[]): JSONContent => sanitizeDoc({ type: "doc", content: structuredClone(blocks) });

/** Highlights the words of a modified block that differ from its other version. */
const createWordDiffExtension = (other: JSONContent[], side: Side) =>
  Extension.create({
    name: "voidWordDiff",
    addProseMirrorPlugins() {
      const schema = this.editor.schema;
      let otherDoc: PMNode | null = null;
      let cache: { doc: PMNode; set: DecorationSet } | null = null;
      return [
        new Plugin({
          props: {
            decorations: (state) => {
              if (cache?.doc === state.doc) return cache.set;
              try {
                otherDoc ??= schema.nodeFromJSON(toDoc(other));
                // Either way the marked words are the ones this version has and the other lacks.
                const direction = side === "removed" || side === "current" ? "removed" : "added";
                const decorations = changedRanges(state.doc, otherDoc, direction).map((range) =>
                  Decoration.inline(range.from, range.to, { class: WORD_CLASSES[side] }),
                );
                cache = { doc: state.doc, set: DecorationSet.create(state.doc, decorations) };
              } catch {
                // Highlights are a bonus; the block itself still renders.
                cache = { doc: state.doc, set: DecorationSet.empty };
              }
              return cache.set;
            },
          },
        }),
      ];
    },
  });

interface PreviewProps {
  blocks: JSONContent[];
  extensions: Extensions;
  extensionsKey: string;
  /** The other version of a modified block, to highlight changed words against. */
  compareTo?: JSONContent[];
  side?: Side;
}

/** Read-only Voiden editor for a run of blocks. */
export const BlocksPreview = memo(({ blocks, extensions, extensionsKey, compareTo, side }: PreviewProps) => {
  const wordDiff = useMemo(() => (compareTo && side ? createWordDiffExtension(compareTo, side) : null), [compareTo, side]);
  const editor = useEditor(
    {
      content: toDoc(blocks),
      extensions: wordDiff ? [...extensions, wordDiff] : extensions,
      editorProps: { attributes: { class: proseClasses } },
      editable: false,
    },
    [blocks, extensionsKey, wordDiff],
  );
  // Block actions (Run, Copy as cURL, + Description...) would act on an old
  // version of the file, so a diff only shows the content.
  return <EditorContent editor={editor} className="[&_button]:!hidden" />;
});
BlocksPreview.displayName = "BlocksPreview";

interface CellProps {
  blocks: JSONContent[];
  compareTo?: JSONContent[];
  tone: Tone;
  label?: string;
  extensions: Extensions;
  extensionsKey: string;
  /** Right-hand column of a split diff: draws the divider between the columns. */
  right?: boolean;
}

const COLUMN_DIVIDER = "shadow-[-1px_0_0_var(--border)]";

const DiffCell = ({ blocks, compareTo, tone, label, extensions, extensionsKey, right }: CellProps) => (
  <div className={cn("min-w-0 px-5 py-3", TONE_CLASSES[tone], right && COLUMN_DIVIDER)}>
    {label && (
      <div className={cn("mb-1 text-[10px] font-semibold uppercase tracking-wide select-none", LABEL_CLASSES[label])}>{label}</div>
    )}
    {blocks.length > 0 && (
      <BlocksPreview
        blocks={blocks}
        extensions={extensions}
        extensionsKey={extensionsKey}
        compareTo={compareTo}
        side={compareTo && tone !== "neutral" ? tone : undefined}
      />
    )}
  </div>
);

/** Empty side of a split row, so both columns stay aligned. */
const EmptyCell = ({ right }: { right?: boolean }) => (
  <div className={cn("min-w-0 bg-[color-mix(in_srgb,var(--fg-secondary)_4%,transparent)]", right && COLUMN_DIVIDER)} />
);

const MetadataChanges = ({ changes }: { changes: FrontmatterChange[] }) => (
  <div className="px-5 py-2 border-b border-border text-xs text-comment flex gap-2">
    <Info size={13} className="flex-shrink-0 mt-px text-vcs-modified" />
    <div className="min-w-0 space-y-0.5">
      <div className="text-text">File metadata changed</div>
      {changes.map((change) => (
        <div key={change.key} className="font-mono truncate" title={`${change.key}: ${change.before ?? "(none)"} → ${change.after ?? "(none)"}`}>
          {change.key}: <span className="text-vcs-removed line-through">{change.before ?? "(none)"}</span>{" "}
          <span className="text-vcs-added">{change.after ?? "(none)"}</span>
        </div>
      ))}
    </div>
  </div>
);

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div className="px-5 py-2 border-b border-border text-xs text-comment flex items-center gap-2">
    <Info size={13} className="flex-shrink-0 text-comment" />
    {children}
  </div>
);

/** Mirrors the diff layout while the two versions load. */
export const VoidDiffSkeleton = ({ columns = 2 }: { columns?: 1 | 2 }) => (
  <div className={cn("flex-1 grid gap-px overflow-hidden", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
    {Array.from({ length: columns }, (_, col) => (
      <div key={col} className="px-5 py-4 space-y-4">
        <div className="h-5 w-2/3 rounded bg-active animate-pulse" />
        <div className="h-3 w-full rounded bg-active animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-active animate-pulse" />
        <div className="h-10 w-full rounded bg-active animate-pulse" />
        <div className="h-24 w-full rounded bg-active animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-active animate-pulse" />
      </div>
    ))}
  </div>
);

const ParseError = () => (
  <div className="flex-1 flex items-center justify-center text-comment">
    <div className="text-center text-xs max-w-xs">
      <AlertTriangle size={28} className="mx-auto mb-3 opacity-50" />
      <p>This .void file could not be displayed as blocks. Switch to Source to see the text changes.</p>
    </div>
  </div>
);

interface SectionProps {
  section: VoidDiffSection;
  extensions: Extensions;
  extensionsKey: string;
}

/** Single-block arrays for a modified pair, kept stable so the previews are not rebuilt. */
const useModifiedPair = (section: VoidDiffSection) =>
  useMemo(() => (section.kind === "modified" ? { before: [section.before], after: [section.after] } : null), [section]);

const SplitSection = memo(({ section, extensions, extensionsKey }: SectionProps) => {
  const cell = { extensions, extensionsKey };
  const pair = useModifiedPair(section);
  if (section.kind === "unchanged") {
    return (
      <>
        <DiffCell blocks={section.blocks} tone="neutral" {...cell} />
        <DiffCell blocks={section.blocks} tone="neutral" right {...cell} />
      </>
    );
  }
  if (pair) {
    return (
      <>
        <DiffCell blocks={pair.before} compareTo={pair.after} tone="removed" label="Modified" {...cell} />
        <DiffCell blocks={pair.after} compareTo={pair.before} tone="added" label="Modified" right {...cell} />
      </>
    );
  }
  if (section.kind !== "changed") return null;
  return (
    <>
      {section.removed.length ? <DiffCell blocks={section.removed} tone="removed" label="Removed" {...cell} /> : <EmptyCell />}
      {section.added.length ? <DiffCell blocks={section.added} tone="added" label="Added" right {...cell} /> : <EmptyCell right />}
    </>
  );
});
SplitSection.displayName = "SplitSection";

const UnifiedSection = memo(({ section, extensions, extensionsKey }: SectionProps) => {
  const cell = { extensions, extensionsKey };
  const pair = useModifiedPair(section);
  if (section.kind === "unchanged") return <DiffCell blocks={section.blocks} tone="neutral" {...cell} />;
  if (pair) {
    return (
      <>
        <DiffCell blocks={pair.before} compareTo={pair.after} tone="removed" label="Before" {...cell} />
        <DiffCell blocks={pair.after} compareTo={pair.before} tone="added" label="After" {...cell} />
      </>
    );
  }
  if (section.kind !== "changed") return null;
  return (
    <>
      {section.removed.length > 0 && <DiffCell blocks={section.removed} tone="removed" label="Removed" {...cell} />}
      {section.added.length > 0 && <DiffCell blocks={section.added} tone="added" label="Added" {...cell} />}
    </>
  );
});
UnifiedSection.displayName = "UnifiedSection";

const sectionKey = (section: VoidDiffSection, index: number) => `${section.kind}-${index}`;

interface VoidDiffViewProps {
  baseContent: string | null | undefined;
  compareContent: string | null | undefined;
  mode: "split" | "unified";
  baseLabel: string;
  compareLabel: string;
}

/** Renders the changes to a .void file as Voiden blocks, in split or unified mode. */
export const VoidDiffView = ({ baseContent, compareContent, mode, baseLabel, compareLabel }: VoidDiffViewProps) => {
  const { extensions, extensionsKey, schema } = usePreviewExtensions();
  const before = useParsedBlocks(baseContent, schema);
  const after = useParsedBlocks(compareContent, schema);
  const sections = useMemo(() => (before && after ? diffVoidBlocks(before, after) : null), [before, after]);
  // For an added or deleted file every header key "changes", which says nothing new.
  const metadata = useMemo(
    () => (baseContent?.trim() && compareContent?.trim() ? diffFrontmatter(baseContent, compareContent) : []),
    [baseContent, compareContent],
  );

  if (!sections) return <ParseError />;

  const contentChanged = hasBlockChanges(sections);
  const notices = (
    <>
      {metadata.length > 0 && <MetadataChanges changes={metadata} />}
      {!contentChanged && <Notice>No changes to the blocks in this file.</Notice>}
    </>
  );

  if (mode === "unified") {
    return (
      <div className="flex-1 overflow-auto" data-testid="void-diff-unified">
        {notices}
        <div className="divide-y divide-border">
          {sections.map((section, i) => (
            <UnifiedSection key={sectionKey(section, i)} section={section} extensions={extensions} extensionsKey={extensionsKey} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="void-diff-split">
      <div className="grid grid-cols-2 flex-shrink-0 border-b border-border text-xs text-comment">
        <div className="px-4 py-2 truncate bg-[color-mix(in_srgb,var(--vcs-removed)_8%,transparent)]" title={baseLabel}>
          <span className="font-semibold">{baseLabel}</span> <span className="text-[10px]">(base)</span>
        </div>
        <div className="px-4 py-2 truncate border-l border-border bg-[color-mix(in_srgb,var(--vcs-added)_8%,transparent)]" title={compareLabel}>
          <span className="font-semibold">{compareLabel}</span> <span className="text-[10px]">(compare)</span>
        </div>
      </div>
      {/* One scroll container keeps both columns in step; each section is one aligned grid row. */}
      <div className="flex-1 overflow-auto">
        {notices}
        <div className="grid grid-cols-2">
          {sections.map((section, i) => (
            <SplitSection key={sectionKey(section, i)} section={section} extensions={extensions} extensionsKey={extensionsKey} />
          ))}
        </div>
      </div>
    </div>
  );
};

/** Read-only view of a .void file at one commit. */
export const VoidFileView = ({ content }: { content: string | null | undefined }) => {
  const { extensions, extensionsKey, schema } = usePreviewExtensions();
  const blocks = useParsedBlocks(content, schema);
  if (!blocks) return <ParseError />;
  return (
    <div className="flex-1 overflow-auto px-5 py-4">
      <BlocksPreview blocks={blocks} extensions={extensions} extensionsKey={extensionsKey} />
    </div>
  );
};
