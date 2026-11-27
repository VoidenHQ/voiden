/**
 * Response panel Compare mode: pick two runs of the same request and see what changed in
 * method, URL, status, timing, size, headers and body. Runs come from responseRunsStore.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import * as Popover from "@radix-ui/react-popover";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  Ellipsis,
  EyeOff,
  GitCompareArrows,
  List,
  Rows2,
  Trash2,
  TrendingDown,
  TrendingUp,
  UnfoldVertical,
} from "lucide-react";
import { cn } from "@/core/lib/utils";
import { Tip } from "@/core/components/ui/Tip";
import { useResponseRunsStore, type DiffBodyView } from "../stores/responseRunsStore";
import {
  bodyForLines,
  countKinds,
  countSem,
  diffHeaders,
  diffJson,
  diffLines,
  emptyCounts,
  endpointOf,
  sameEndpoint,
  inlineRange,
  parseJsonBody,
  type ChangeCounts,
  type ChangeKind,
  foldLineOps,
  type LineOp,
  type ResponseRun,
  type SemNode,
} from "../utils/responseDiff";

// ─── Styling ─────────────────────────────────────────────────────────────────

const ROW_BG: Record<string, string> = {
  added: "bg-[color-mix(in_srgb,var(--vcs-added)_12%,transparent)]",
  removed: "bg-[color-mix(in_srgb,var(--vcs-removed)_12%,transparent)]",
  changed: "bg-[color-mix(in_srgb,var(--vcs-modified)_10%,transparent)]",
  ignored: "",
  same: "",
};
const MARK_FG: Record<string, string> = {
  added: "text-vcs-added",
  removed: "text-vcs-removed",
  changed: "text-vcs-modified",
  ignored: "text-comment",
  same: "text-comment",
};
const MARK: Record<string, string> = { added: "+", removed: "−", changed: "~", ignored: "◌", same: " " };
const HL_A = "rounded-sm bg-[color-mix(in_srgb,var(--vcs-removed)_30%,transparent)]";
const HL_B = "rounded-sm bg-[color-mix(in_srgb,var(--vcs-added)_30%,transparent)]";
const PILL = "font-mono text-[11px] px-1.5 rounded-sm whitespace-nowrap";

/** Status 0 (or anything below 100) means no HTTP response came back: the request failed. */
const isFailedStatus = (s?: number) => s !== undefined && s < 100;

const statusColor = (s?: number) =>
  s === undefined
    ? "var(--syntax-comment)"
    : isFailedStatus(s) || s >= 400
      ? "var(--error, #f87171)"
      : s < 300
        ? "var(--success, #4ade80)"
        : "var(--warning, #facc15)";

const methodColor = (m?: string) => (m ? `var(--http-${m.toLowerCase()}, var(--editor-fg))` : "var(--syntax-comment)");

function MethodTag({ method, strike }: { method?: string; strike?: boolean }) {
  return (
    <span className={cn("font-mono text-xs font-bold", strike && "line-through opacity-70")} style={{ color: methodColor(method) }}>
      {method ?? "—"}
    </span>
  );
}

const fmtMs = (ms?: number) => (ms === undefined || ms < 0 ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 5000) return "just now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86400_000)}d ago`;
}

const runLabel = (r: ResponseRun) =>
  `#${r.id} · ${r.method ? `${r.method} ` : ""}${r.status ?? "—"} · ${r.source === "file" ? "saved in file" : relTime(r.timestamp)}`;

// ─── Small pieces ────────────────────────────────────────────────────────────

function Counts({ c }: { c: ChangeCounts }) {
  const parts = [
    c.added > 0 && <span key="a" className={cn(PILL, "text-vcs-added", ROW_BG.added)}>+{c.added}</span>,
    c.removed > 0 && <span key="r" className={cn(PILL, "text-vcs-removed", ROW_BG.removed)}>−{c.removed}</span>,
    c.changed > 0 && <span key="c" className={cn(PILL, "text-vcs-modified", ROW_BG.changed)}>~{c.changed}</span>,
    c.ignored > 0 && (
      <Tip key="i" label="Volatile values (timestamps, request IDs) that are ignored" side="bottom">
        <span className={cn(PILL, "text-comment bg-hover")}>◌{c.ignored}</span>
      </Tip>
    ),
  ].filter(Boolean);
  return <span className="flex items-center gap-1">{parts.length ? parts : <span className={cn(PILL, "text-comment bg-hover")}>identical</span>}</span>;
}

function Highlight({ a, b, side }: { a: string; b: string; side: "a" | "b" }) {
  const [p, s] = inlineRange(a, b);
  const t = side === "a" ? a : b;
  if (p === 0 && s === 0) return <>{t}</>;
  return (
    <>
      {t.slice(0, p)}
      <span className={side === "a" ? HL_A : HL_B}>{t.slice(p, t.length - s)}</span>
      {t.slice(t.length - s)}
    </>
  );
}

function Row({ kind, children, lineNo, onClick, className, change }: { kind: ChangeKind | "fold" | "empty"; children: ReactNode; lineNo?: number | null; onClick?: () => void; className?: string; change?: boolean }) {
  // Rows marked data-change are what "next / previous change" steps through.
  const isChange = change ?? (kind === "added" || kind === "removed" || kind === "changed");
  return (
    <div
      data-change={isChange ? "" : undefined}
      className={cn(
        "grid grid-cols-[18px_minmax(0,1fr)] whitespace-pre leading-5",
        kind === "fold" ? "bg-panel text-comment cursor-pointer hover:text-text" : ROW_BG[kind] ?? "",
        kind === "empty" && "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--ui-hover)_6px_7px)]",
        className,
      )}
      onClick={onClick}
    >
      <span className={cn("text-center select-none", kind === "fold" ? "" : MARK_FG[kind] ?? "text-comment")}>
        {kind === "fold" ? "⋯" : kind === "empty" ? "" : MARK[kind]}
      </span>
      <span className={cn("pr-4", kind === "ignored" && "text-comment")}>
        {lineNo !== undefined && (
          <span className="inline-block w-8 pr-2 text-right text-comment opacity-60 select-none">{lineNo ?? ""}</span>
        )}
        {children}
      </span>
    </div>
  );
}

function Section({
  title,
  icon,
  meta,
  counts,
  sticky,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** Short context next to the title, e.g. "7 headers" */
  meta?: ReactNode;
  counts?: ChangeCounts;
  /** Pin the bar while its rows scroll (only inside the view's own scroller) */
  sticky?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-border">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 h-8 px-3 bg-panel border-b border-border text-left hover:bg-active transition-colors",
          sticky && "sticky top-0 z-[1]",
        )}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-comment">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        <span className="text-comment">{icon}</span>
        <span className="text-xs font-semibold text-text">{title}</span>
        {meta && <span className="text-[11px] text-comment font-mono truncate min-w-0">{meta}</span>}
        {counts && <span className="ml-auto flex-shrink-0"><Counts c={counts} /></span>}
      </button>
      {open && <div className="bg-editor py-1">{children}</div>}
    </section>
  );
}

// ─── Headers ─────────────────────────────────────────────────────────────────

function HeadersDiff({ changes, showUnchanged }: { changes: ReturnType<typeof diffHeaders>; showUnchanged: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = showUnchanged || expanded ? changes : changes.filter((c) => c.kind !== "same");
  const hidden = changes.length - visible.length;
  if (!changes.length) return <div className="px-3 py-2 text-xs text-comment">No headers in either response.</div>;
  return (
    <div className="overflow-x-auto font-mono text-xs">
      <div className="min-w-max">
        {visible.map((c) => (
          <Row key={c.key} kind={c.kind}>
            <span className={c.kind === "ignored" ? "text-comment" : "text-[var(--syntax-property,var(--editor-fg))]"}>{c.key}</span>
            <span className="text-comment">: </span>
            {c.kind === "changed" ? (
              <>
                <span className="line-through decoration-[color-mix(in_srgb,var(--vcs-removed)_60%,transparent)]"><Highlight a={c.a!} b={c.b!} side="a" /></span>
                <span className="text-comment px-1.5">→</span>
                <Highlight a={c.a!} b={c.b!} side="b" />
              </>
            ) : (
              <>{c.kind === "removed" ? c.a : c.b}</>
            )}
            {c.kind === "ignored" && <span className="ml-2 text-[10px] text-comment border border-border rounded px-1">ignored</span>}
          </Row>
        ))}
        {hidden > 0 && (
          <Row kind="fold" onClick={() => setExpanded(true)}>
            {hidden} unchanged header{hidden > 1 ? "s" : ""}
          </Row>
        )}
      </div>
    </div>
  );
}

// ─── Semantic body view ──────────────────────────────────────────────────────

function Value({ v }: { v: unknown }) {
  if (typeof v === "string") return <span className="text-[var(--syntax-string,var(--vcs-added))]">{JSON.stringify(v)}</span>;
  if (typeof v === "number" || typeof v === "boolean" || v === null)
    return <span className="text-[var(--syntax-number,var(--warning))]">{String(v)}</span>;
  return <span>{JSON.stringify(v)}</span>;
}

function KeyLabel({ k }: { k: string | number | null }) {
  if (k === null || typeof k === "number") return null;
  return (
    <>
      <span className="text-[var(--syntax-property,var(--editor-fg))]">{JSON.stringify(k)}</span>
      <span className="text-comment">: </span>
    </>
  );
}

const indent = (d: number) => "  ".repeat(d);

function SemanticTree({ node, depth, showUnchanged }: { node: SemNode; depth: number; showUnchanged: boolean }) {
  const [openFolds, setOpenFolds] = useState<Set<number>>(new Set());
  if (node.t === "leaf") return <SemLeaf node={node} depth={depth} />;

  const items: ReactNode[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0];
    const count = run.length;
    const ignored = run.reduce((n, i) => n + countSem(node.children[i]).ignored, 0);
    items.push(
      <Row key={`fold-${first}`} kind="fold" onClick={() => setOpenFolds((s) => new Set(s).add(first))}>
        {indent(depth + 1)}{count} unchanged {node.arr ? "item" : "field"}{count > 1 ? "s" : ""}{ignored ? ` (${ignored} ignored)` : ""}
      </Row>,
    );
    run = [];
  };
  // A fold is identified by the index of its first child, so an expanded fold stays expanded.
  let foldStart = -1;
  node.children.forEach((child, i) => {
    // Ignored (volatile) values fold away with the unchanged ones.
    const unchanged = child.t === "container" ? child.changes === 0 : child.kind === "same" || child.kind === "ignored";
    if (!unchanged) foldStart = -1;
    if (unchanged && !showUnchanged) {
      if (foldStart === -1) foldStart = i;
      if (openFolds.has(foldStart)) {
        items.push(<SemanticTree key={i} node={child} depth={depth + 1} showUnchanged />);
        return;
      }
      run.push(i);
      return;
    }
    flush();
    items.push(<SemanticTree key={i} node={child} depth={depth + 1} showUnchanged={showUnchanged} />);
  });
  flush();

  return (
    <>
      <Row kind="same">{indent(depth)}<KeyLabel k={node.key} />{node.arr ? "[" : "{"}</Row>
      {items}
      <Row kind="same">{indent(depth)}{node.arr ? "]" : "}"}</Row>
    </>
  );
}

function SemLeaf({ node, depth }: { node: Extract<SemNode, { t: "leaf" }>; depth: number }) {
  const prefix = <>{indent(depth)}<KeyLabel k={node.key} /></>;
  switch (node.kind) {
    case "added":
      return <Row kind="added">{prefix}<Value v={node.b} /></Row>;
    case "removed":
      return <Row kind="removed">{prefix}<Value v={node.a} /></Row>;
    case "changed":
      return (
        <Row kind="changed">
          {prefix}
          <span className="line-through decoration-[color-mix(in_srgb,var(--vcs-removed)_60%,transparent)] opacity-80"><Value v={node.a} /></span>
          <span className="text-comment px-1.5">→</span>
          <Value v={node.b} />
        </Row>
      );
    case "ignored":
      return (
        <Row kind="ignored">
          {prefix}{JSON.stringify(node.b)}
          <span className="ml-2 text-[10px] border border-border rounded px-1">ignored</span>
        </Row>
      );
    default:
      return <Row kind="same">{prefix}<Value v={node.b} /></Row>;
  }
}

// ─── Line views ──────────────────────────────────────────────────────────────

const foldLabel = (n: number, ignored: number) =>
  `${n} unchanged line${n > 1 ? "s" : ""}${ignored ? ` (${ignored} ignored)` : ""}`;

function UnifiedView({ ops, showUnchanged }: { ops: LineOp[]; showUnchanged: boolean }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const blocks = foldLineOps(ops, showUnchanged, open);
  const rows: ReactNode[] = [];
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i];
    if ("fold" in b) {
      rows.push(<Row key={`f${i}`} kind="fold" lineNo={null} onClick={() => setOpen((s) => new Set(s).add(b.start))}>{foldLabel(b.fold, b.ignored)}</Row>);
      i++;
      continue;
    }
    const op = b.op;
    if (op.t === "changed") {
      // A block of edited lines reads like git: every old line, then every new line.
      const edits: Extract<LineOp, { t: "changed" }>[] = [];
      while (i < blocks.length && "op" in blocks[i] && (blocks[i] as { op: LineOp }).op.t === "changed") {
        edits.push((blocks[i] as { op: Extract<LineOp, { t: "changed" }> }).op);
        i++;
      }
      edits.forEach((e) => rows.push(<Row key={`r${e.ai}`} kind="removed" lineNo={e.ai}><Highlight a={e.a} b={e.b} side="a" /></Row>));
      edits.forEach((e) => rows.push(<Row key={`a${e.bi}`} kind="added" lineNo={e.bi}><Highlight a={e.a} b={e.b} side="b" /></Row>));
      continue;
    }
    if (op.t === "added") rows.push(<Row key={`a${op.bi}`} kind="added" lineNo={op.bi}>{op.b}</Row>);
    else if (op.t === "removed") rows.push(<Row key={`r${op.ai}`} kind="removed" lineNo={op.ai}>{op.a}</Row>);
    else rows.push(<Row key={`s${op.ai}-${op.bi}`} kind={op.t} lineNo={op.bi}>{op.b}</Row>);
    i++;
  }
  return (
    <div className="overflow-x-auto font-mono text-xs">
      <div className="min-w-max">{rows}</div>
    </div>
  );
}

function SplitView({ ops, showUnchanged, runA, runB }: { ops: LineOp[]; showUnchanged: boolean; runA: ResponseRun; runB: ResponseRun }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const blocks = foldLineOps(ops, showUnchanged, open);
  const left: ReactNode[] = [];
  const right: ReactNode[] = [];
  blocks.forEach((b, i) => {
    if ("fold" in b) {
      const fold = <Row key={i} kind="fold" lineNo={null} onClick={() => setOpen((s) => new Set(s).add(b.start))}>{foldLabel(b.fold, b.ignored)}</Row>;
      left.push(fold);
      right.push(fold);
      return;
    }
    const op = b.op;
    if (op.t === "added") {
      left.push(<Row key={i} kind="empty" lineNo={null} change>{" "}</Row>);
      right.push(<Row key={i} kind="added" lineNo={op.bi} change={false}>{op.b}</Row>);
    } else if (op.t === "removed") {
      left.push(<Row key={i} kind="removed" lineNo={op.ai}>{op.a}</Row>);
      right.push(<Row key={i} kind="empty" lineNo={null} change={false}>{" "}</Row>);
    } else if (op.t === "changed") {
      left.push(<Row key={i} kind="removed" lineNo={op.ai}><Highlight a={op.a} b={op.b} side="a" /></Row>);
      right.push(<Row key={i} kind="added" lineNo={op.bi} change={false}><Highlight a={op.a} b={op.b} side="b" /></Row>);
    } else {
      left.push(<Row key={i} kind={op.t} lineNo={op.ai}>{op.a}</Row>);
      right.push(<Row key={i} kind={op.t} lineNo={op.bi} change={false}>{op.b}</Row>);
    }
  });
  const pane = (title: string, rows: ReactNode[]) => (
    <div className="min-w-0 overflow-x-auto">
      <div className="px-3 py-0.5 text-[11px] text-comment bg-panel border-b border-border truncate">{title}</div>
      <div className="min-w-max">{rows}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 font-mono text-xs divide-x divide-border">
      {pane(`A · ${runLabel(runA)}`, left)}
      {pane(`B · ${runLabel(runB)}`, right)}
    </div>
  );
}

// ─── Toolbar pieces ──────────────────────────────────────────────────────────

const ICON_BTN =
  "inline-flex items-center justify-center size-6 rounded text-comment hover:text-text hover:bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";
const ICON_ON = "text-accent bg-[color-mix(in_srgb,rgb(var(--common-accent))_14%,transparent)] hover:text-accent";
const POPOVER = "z-50 rounded-md border border-border bg-bg text-text shadow-lg p-1 outline-none";
const MENU_ITEM = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-left hover:bg-hover focus:bg-hover outline-none";

function IconToggle({ on, label, onClick, children }: { on: boolean; label: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={label} side="bottom" align="end">
      <button type="button" aria-pressed={on} className={cn(ICON_BTN, on && ICON_ON)} onClick={onClick}>
        {children}
      </button>
    </Tip>
  );
}

const StatusDot = ({ status }: { status?: number }) => (
  <span className="size-2 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(status) }} />
);

const SIDE_STYLE = {
  a: cn("text-vcs-removed", ROW_BG.removed),
  b: cn("text-vcs-added", ROW_BG.added),
};

function RunPicker({ side, run, runs, other, onPick }: { side: "a" | "b"; run: ResponseRun; runs: ResponseRun[]; other: ResponseRun; onPick: (id: number) => void }) {
  const otherId = other.id;
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label={side === "a" ? "Base run: what it was" : "Compared run: what it is now"} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            className="group flex items-center gap-1.5 h-7 pl-1 pr-1.5 rounded-md border border-border bg-editor hover:border-[var(--editor-gutter-normal)] transition-colors min-w-0"
            aria-label={side === "a" ? "Choose base run" : "Choose compared run"}
          >
            <span className={cn("font-mono text-[10px] font-bold size-5 grid place-items-center rounded", SIDE_STYLE[side])}>{side.toUpperCase()}</span>
            <StatusDot status={run.status} />
            <span className="font-mono text-xs font-semibold">{run.status ?? "—"}</span>
            <span className="text-xs text-comment truncate">
              #{run.id} · {run.source === "file" ? "saved in file" : relTime(run.timestamp)}
            </span>
            <ChevronDown size={12} className="text-comment group-hover:text-text flex-shrink-0" />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={cn(POPOVER, "w-80 max-h-80 overflow-y-auto")}>
          <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-comment">
            {side === "a" ? "Compare from" : "Compare to"}
          </div>
          {runs.map((r) => {
            const isOther = r.id === otherId;
            const selected = r.id === run.id;
            return (
              <button
                key={r.id}
                type="button"
                disabled={isOther}
                className={cn(MENU_ITEM, "font-mono", selected && "bg-active", isOther && "opacity-50 cursor-not-allowed hover:bg-transparent")}
                onClick={() => { onPick(r.id); setOpen(false); }}
              >
                <span className="w-3 flex-shrink-0 text-accent">{selected && <Check size={12} />}</span>
                <StatusDot status={r.status} />
                <span className="font-semibold w-8">{r.status ?? "—"}</span>
                <span className="w-12 font-bold" style={{ color: methodColor(r.method) }}>{r.method ?? ""}</span>
                <span className="flex-1 min-w-0 truncate font-sans">
                  #{r.id} · {r.source === "file" ? "saved in file" : relTime(r.timestamp)}
                </span>
                {!isOther && !sameEndpoint(r, other) && (
                  <Tip label={<span className="font-mono break-all">{endpointOf(r)}</span>} side="right">
                    <span className={cn(PILL, "font-sans font-normal text-vcs-modified", ROW_BG.changed)}>other endpoint</span>
                  </Tip>
                )}
                {isOther ? (
                  <span className={cn("text-[10px] font-bold px-1 rounded", SIDE_STYLE[side === "a" ? "b" : "a"])}>{side === "a" ? "B" : "A"}</span>
                ) : (
                  <span className="text-comment text-[11px] tabular-nums">{fmtMs(r.elapsedMs)}</span>
                )}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One figure in the summary strip: the new value large, the old one beneath. */
function Stat({ label, now, was, delta, tone }: { label: string; now: ReactNode; was?: ReactNode; delta?: ReactNode; tone?: "changed" }) {
  return (
    <div className={cn("flex flex-col gap-1 px-3 py-2 min-w-0", tone === "changed" && ROW_BG.changed)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-comment">{label}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[13px] font-semibold tabular-nums min-w-0">
        <span className="whitespace-nowrap min-w-0 max-w-full overflow-hidden">{now}</span>
        {delta}
      </span>
      <span className="font-mono text-[11px] text-comment tabular-nums truncate">{was ?? " "}</span>
    </div>
  );
}

/** `neutral`: the change says nothing good or bad (e.g. a failed run is "faster" only because it never got a response). */
function TrendDelta({ a, b, neutral }: { a?: number; b?: number; neutral?: boolean }) {
  if (a === undefined || b === undefined || a <= 0 || b < 0) return null;
  if (a === b) return <span className={cn(PILL, "text-comment bg-hover font-normal")}>±0</span>;
  const pct = Math.round(((b - a) / a) * 100);
  const up = b > a;
  const Icon = up ? TrendingUp : TrendingDown;
  const tone = neutral ? "text-comment bg-hover" : up ? cn("text-vcs-removed", ROW_BG.removed) : cn("text-vcs-added", ROW_BG.added);
  return (
    <span className={cn(PILL, "inline-flex items-center gap-0.5 font-normal", tone)}>
      <Icon size={11} />
      {pct > 0 ? "+" : ""}{pct === 0 ? "<1" : pct}%
    </span>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

const VIEWS: Array<{ id: DiffBodyView; label: string; hint: string; icon: ReactNode }> = [
  { id: "semantic", label: "By JSON key", hint: "Key order and formatting don't count as changes", icon: <Braces size={13} /> },
  { id: "split", label: "Side by side", hint: "A on the left, B on the right", icon: <Columns2 size={13} /> },
  { id: "unified", label: "Inline", hint: "Removed and added lines in one column", icon: <Rows2 size={13} /> },
];

export function ResponseDiffView({ runKey: key, fill = false }: { runKey: string; fill?: boolean }) {
  const runs = useResponseRunsStore((s) => s.runs[key]);
  const { bodyView, ignoreVolatile, showUnchanged, setBodyView, setIgnoreVolatile, setShowUnchanged, toggleCompare, forgetRuns } = useResponseRunsStore(
    useShallow((s) => ({
      bodyView: s.bodyView,
      ignoreVolatile: s.ignoreVolatile,
      showUnchanged: s.showUnchanged,
      setBodyView: s.setBodyView,
      setIgnoreVolatile: s.setIgnoreVolatile,
      setShowUnchanged: s.setShowUnchanged,
      toggleCompare: s.toggleCompare,
      forgetRuns: s.forgetRuns,
    })),
  );
  // null = follow the defaults: B is the newest run, A the one before it.
  const [pick, setPick] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [, tick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState({ index: -1, total: 0 });

  // Keep the "2m ago" labels fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const list = runs ?? [];
  const runB = list.find((r) => r.id === pick.b) ?? list[0];
  // By default A is the latest earlier run that called the same endpoint as B.
  const runA =
    list.find((r) => r.id === pick.a && r.id !== runB?.id) ??
    list.find((r) => r !== runB && sameEndpoint(r, runB)) ??
    list.find((r) => r !== runB);

  const diff = useMemo(() => {
    if (!runA || !runB) return null;
    const headers = diffHeaders(runA.headers, runB.headers, ignoreVolatile);
    const ja = parseJsonBody(runA.bodyText);
    const jb = parseJsonBody(runB.bodyText);
    const sem = ja.ok && jb.ok ? diffJson(ja.value, jb.value, ignoreVolatile) : null;
    const binary = runA.binary || runB.binary;
    const lines = binary ? [] : diffLines(bodyForLines(runA.bodyText), bodyForLines(runB.bodyText), ignoreVolatile);
    const bodyCounts = sem ? countSem(sem) : countKinds(lines.map((l) => l.t));
    return { headers, headerCounts: countKinds(headers.map((h) => h.kind)), sem, lines, bodyCounts, binary };
  }, [runA, runB, ignoreVolatile]);

  // ── Change navigation: each run of adjacent changed rows is one stop ──
  const hunks = useCallback((): HTMLElement[] => {
    const root = bodyRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-change]")).filter(
      (el) => !el.previousElementSibling?.hasAttribute("data-change"),
    );
  }, []);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const recount = () => setNav((n) => ({ index: Math.min(n.index, hunks().length - 1), total: hunks().length }));
    recount();
    const mo = new MutationObserver(recount);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [hunks, diff, bodyView, showUnchanged]);

  const go = (dir: 1 | -1) => {
    const all = hunks();
    if (!all.length) return;
    const index = nav.index < 0 ? (dir === 1 ? 0 : all.length - 1) : (nav.index + dir + all.length) % all.length;
    const el = all[index];
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.animate(
      [{ boxShadow: "inset 3px 0 0 rgb(var(--common-accent))" }, { boxShadow: "inset 3px 0 0 transparent" }],
      { duration: 1200, easing: "ease-out" },
    );
    setNav({ index, total: all.length });
  };

  if (!runA || !runB || !diff) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", fill && "h-full")}>
        <span className="grid place-items-center size-10 rounded-full bg-panel text-comment">
          <GitCompareArrows size={18} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text">Nothing to compare yet</p>
          <p className="text-xs text-comment max-w-xs">
            Send this request again and its responses will show up here side by side. The last 10 are kept on this device, outside the project.
          </p>
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-xs hover:bg-hover" onClick={() => toggleCompare(key, false)}>
          <ArrowLeft size={12} /> Back to response
        </button>
      </div>
    );
  }

  const view: DiffBodyView = bodyView === "semantic" && !diff.sem ? "unified" : bodyView;
  const total: ChangeCounts = emptyCounts();
  (Object.keys(total) as (keyof ChangeCounts)[]).forEach((k) => (total[k] = diff.headerCounts[k] + diff.bodyCounts[k]));
  const statusSame = runA.status === runB.status;
  const eitherFailed = isFailedStatus(runA.status) || isFailedStatus(runB.status);
  const methodChanged = !!runA.method && !!runB.method && runA.method !== runB.method;
  const urlChanged = !!runA.url && !!runB.url && runA.url !== runB.url;
  const sameBody = runA.bodyText === runB.bodyText;
  const endpointMismatch = !sameEndpoint(runA, runB);
  // The latest other run that does match B's endpoint, to offer as A instead.
  const matchingA = endpointMismatch ? list.find((r) => r !== runB && sameEndpoint(r, runB)) : undefined;
  const identical = !methodChanged && !urlChanged && statusSame && total.added + total.removed + total.changed === 0;

  return (
    <div className={cn("flex flex-col min-w-0 text-text", fill && "h-full")}>
      {/* Toolbar: which runs, how to show them */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-1.5 border-b border-border bg-panel flex-shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <RunPicker side="a" run={runA} runs={list} other={runB} onPick={(id) => setPick((p) => ({ ...p, a: id }))} />
          <Tip label="Swap A and B" side="bottom">
            <button type="button" className={ICON_BTN} onClick={() => setPick({ a: runB.id, b: runA.id })} aria-label="Swap A and B">
              <ArrowLeftRight size={13} />
            </button>
          </Tip>
          <RunPicker side="b" run={runB} runs={list} other={runA} onPick={(id) => setPick((p) => ({ ...p, b: id }))} />
        </div>

        <span className="flex-1" />

        {/* Change navigation */}
        <div className="flex items-center gap-0.5">
          <span className="text-[11px] text-comment tabular-nums px-1 min-w-[3.5rem] text-right">
            {nav.total === 0 ? "No changes" : nav.index < 0 ? `${nav.total} change${nav.total > 1 ? "s" : ""}` : `${nav.index + 1} of ${nav.total}`}
          </span>
          <Tip label="Previous change" side="bottom">
            <button type="button" className={ICON_BTN} disabled={!nav.total} onClick={() => go(-1)} aria-label="Previous change"><ArrowUp size={13} /></button>
          </Tip>
          <Tip label="Next change" side="bottom">
            <button type="button" className={ICON_BTN} disabled={!nav.total} onClick={() => go(1)} aria-label="Next change"><ArrowDown size={13} /></button>
          </Tip>
        </div>

        <span className="w-px h-4 bg-border" />

        {/* Body view */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-editor border border-border" role="radiogroup" aria-label="Body view">
          {VIEWS.map((v) => {
            const disabled = v.id === "semantic" && !diff.sem;
            const on = view === v.id;
            return (
              <Tip key={v.id} label={<span><span className="text-text">{v.label}</span> · {disabled ? "needs JSON on both sides" : v.hint}</span>} side="bottom" align="end">
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={v.label}
                  disabled={disabled}
                  className={cn(ICON_BTN, "size-[22px]", on && "bg-active text-text hover:bg-active")}
                  onClick={() => setBodyView(v.id)}
                >
                  {v.icon}
                </button>
              </Tip>
            );
          })}
        </div>

        <IconToggle
          on={ignoreVolatile}
          onClick={() => setIgnoreVolatile(!ignoreVolatile)}
          label={<span><span className="text-text">Hide noise {ignoreVolatile ? "(on)" : "(off)"}</span> · timestamps, request IDs and rate limits count as unchanged</span>}
        >
          <EyeOff size={13} />
        </IconToggle>
        <IconToggle
          on={showUnchanged}
          onClick={() => setShowUnchanged(!showUnchanged)}
          label={<span className="text-text">{showUnchanged ? "Fold unchanged parts" : "Show unchanged parts"}</span>}
        >
          <UnfoldVertical size={13} />
        </IconToggle>

        <Popover.Root open={menuOpen} onOpenChange={(o) => { setMenuOpen(o); if (!o) setConfirmForget(false); }}>
          <Popover.Trigger asChild>
            <button type="button" className={ICON_BTN} aria-label="More options"><Ellipsis size={14} /></button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={4} className={cn(POPOVER, "w-64")}>
              {confirmForget ? (
                <div className="flex flex-col gap-2 p-2">
                  <p className="text-xs">Forget all {list.length} runs of this request?</p>
                  <p className="text-[11px] text-comment">They&apos;re only stored on this device. Your file isn&apos;t changed.</p>
                  <div className="flex justify-end gap-1.5">
                    <button type="button" className="h-6 px-2 rounded text-xs hover:bg-hover" onClick={() => setConfirmForget(false)}>Keep</button>
                    <button
                      type="button"
                      className="h-6 px-2 rounded text-xs text-vcs-removed bg-[color-mix(in_srgb,var(--vcs-removed)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--vcs-removed)_24%,transparent)]"
                      onClick={() => { setMenuOpen(false); forgetRuns(key); }}
                    >
                      Forget runs
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className={MENU_ITEM} onClick={() => { setMenuOpen(false); toggleCompare(key, false); }}>
                    <ArrowLeft size={13} className="text-comment" /> Back to response
                  </button>
                  <div className="h-px bg-border my-1" />
                  <button type="button" className={cn(MENU_ITEM, "text-vcs-removed")} onClick={() => setConfirmForget(true)}>
                    <Trash2 size={13} /> Forget past runs…
                  </button>
                </>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div ref={bodyRef} className={cn("min-w-0", fill && "flex-1 min-h-0 overflow-y-auto")}>
        {/* Verdict + request line */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-editor min-w-0">
          {endpointMismatch ? (
            <span className={cn(PILL, "inline-flex items-center gap-1 text-vcs-modified py-0.5", ROW_BG.changed)}><AlertTriangle size={11} /> Different endpoint</span>
          ) : identical ? (
            <span className={cn(PILL, "inline-flex items-center gap-1 text-vcs-added py-0.5", ROW_BG.added)}><Check size={11} /> Same response</span>
          ) : (
            <Counts c={total} />
          )}
          <span className="w-px h-3.5 bg-border flex-shrink-0" />
          {methodChanged ? (
            <Tip label="The method changed between these runs" side="bottom">
              <span className={cn("flex items-center gap-1 flex-shrink-0 px-1.5 py-0.5 rounded", ROW_BG.changed)}>
                <MethodTag method={runA.method} strike />
                <ChevronRight size={11} className="text-comment" />
                <MethodTag method={runB.method} />
              </span>
            </Tip>
          ) : (
            <MethodTag method={runB.method} />
          )}
          <span className="font-mono text-xs min-w-0 truncate">
            {urlChanged ? (
              <Tip label={<span className="font-mono break-all">{runA.url}<br />→ {runB.url}</span>} side="bottom">
                <span className="cursor-default">
                  <Highlight a={runA.url ?? ""} b={runB.url ?? ""} side="b" />
                  <span className={cn(PILL, "ml-1.5 font-sans text-vcs-modified", ROW_BG.changed)}>URL changed</span>
                </span>
              </Tip>
            ) : (
              <span className="text-comment">{runB.url}</span>
            )}
          </span>
        </div>

        {endpointMismatch && (
          <div role="status" className={cn("flex items-start gap-2 px-3 py-2 border-b border-border text-xs", ROW_BG.changed)}>
            <AlertTriangle size={14} className="text-vcs-modified flex-shrink-0 mt-px" />
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <span className="font-semibold text-text">The endpoint doesn&apos;t match</span>
              <span className="text-comment">
                These runs called different endpoints, so they&apos;re probably different requests and the changes below may not mean much.
              </span>
              <span className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px] min-w-0">
                <span className={cn("font-bold px-1 rounded h-fit", SIDE_STYLE.a)}>A</span>
                <span className="break-all">{endpointOf(runA) ?? "unknown"}</span>
                <span className={cn("font-bold px-1 rounded h-fit", SIDE_STYLE.b)}>B</span>
                <span className="break-all">{endpointOf(runB) ?? "unknown"}</span>
              </span>
            </div>
            {matchingA && (
              <button
                type="button"
                className="flex-shrink-0 h-6 px-2 rounded-md border border-border bg-editor text-xs hover:bg-hover"
                onClick={() => setPick({ a: matchingA.id, b: runB.id })}
              >
                Compare with #{matchingA.id}
              </button>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-editor">
          <Stat
            label="Status"
            tone={statusSame ? undefined : "changed"}
            now={
              <span className="flex items-center gap-1.5 min-w-0" title={runB.statusMessage || undefined}>
                <StatusDot status={runB.status} />
                <span className="flex-shrink-0">{runB.status ?? "—"}</span>
                <span className="font-normal text-comment font-sans text-xs truncate min-w-0">{runB.statusMessage}</span>
              </span>
            }
            was={statusSame ? "unchanged" : `was ${runA.status ?? "—"} ${runA.statusMessage ?? ""}`}
          />
          <Stat label="Time" now={fmtMs(runB.elapsedMs)} was={`was ${fmtMs(runA.elapsedMs)}`} delta={<TrendDelta a={runA.elapsedMs} b={runB.elapsedMs} neutral={eitherFailed} />} />
          <Stat label="Size" now={fmtBytes(runB.bytes)} was={`was ${fmtBytes(runA.bytes)}`} delta={<TrendDelta a={runA.bytes} b={runB.bytes} neutral={eitherFailed} />} />
        </div>

        <Section title="Headers" icon={<List size={13} />} meta={`${runB.headers.length} in B`} counts={diff.headerCounts} sticky={fill}>
          <HeadersDiff changes={diff.headers} showUnchanged={showUnchanged} />
        </Section>

        <Section
          title="Body"
          icon={<Braces size={13} />}
          meta={[runB.contentType?.split(";")[0], VIEWS.find((v) => v.id === view)?.label.toLowerCase()].filter(Boolean).join(" · ")}
          counts={diff.bodyCounts}
          sticky={fill}
        >
          {diff.binary ? (
            <div className="px-3 py-2 text-xs text-comment">
              Binary body. {sameBody ? "Both runs returned the same bytes." : `The bytes differ (${fmtBytes(runA.bytes)} → ${fmtBytes(runB.bytes)}).`}
            </div>
          ) : runA.bodyText === null && runB.bodyText === null ? (
            <div className="px-3 py-2 text-xs text-comment">Neither run returned a body.</div>
          ) : view === "semantic" && diff.sem ? (
            <div className="overflow-x-auto font-mono text-xs">
              <div className="min-w-max">
                <SemanticTree key={`${runA.id}-${runB.id}`} node={diff.sem} depth={0} showUnchanged={showUnchanged} />
              </div>
            </div>
          ) : view === "split" ? (
            <SplitView key={`${runA.id}-${runB.id}`} ops={diff.lines} showUnchanged={showUnchanged} runA={runA} runB={runB} />
          ) : (
            <UnifiedView key={`${runA.id}-${runB.id}`} ops={diff.lines} showUnchanged={showUnchanged} />
          )}
        </Section>
      </div>
    </div>
  );
}
