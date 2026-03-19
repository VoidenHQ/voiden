import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddPanelTab, useClosePanelTab } from "@/core/layout/hooks";
import { toast } from "@/core/components/ui/sonner";
import { cn } from "@/core/lib/utils";
import {
  AlertTriangle, Check, Eye, ArrowUp, ArrowDown,
  ChevronsUpDown, Loader2, RefreshCw,
} from "lucide-react";
import { Tip } from "@/core/components/ui/Tip";

import CodeMirror from "@uiw/react-codemirror";
import {
  EditorView,
  Decoration,
  DecorationSet,
  WidgetType,
} from "@codemirror/view";
import { StateField, RangeSetBuilder, Text } from "@codemirror/state";
import { voidenTheme } from "@/core/editors/code/CodeEditor.tsx";

// ── Types ─────────────────────────────────────────────────────────────────────

type Resolution = "current" | "incoming" | "both";

// ── In-memory bulk resolution ─────────────────────────────────────────────────

function applyResolutionInMemory(
  content: string,
  resolution: Resolution,
  sectionIndex?: number,
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;
  let cur = 0;

  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      const currentLines: string[] = [];
      const incomingLines: string[] = [];
      let state: "current" | "base" | "incoming" = "current";
      i++;
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        if (lines[i].startsWith("=======")) state = "incoming";
        else if (lines[i].startsWith("|||||||")) state = "base";
        else if (state === "current") currentLines.push(lines[i]);
        else if (state === "incoming") incomingLines.push(lines[i]);
        i++;
      }
      const shouldResolve = sectionIndex === undefined || sectionIndex === cur;
      if (shouldResolve) {
        if (resolution === "current") result.push(...currentLines);
        else if (resolution === "incoming") result.push(...incomingLines);
        else { result.push(...currentLines); result.push(...incomingLines); }
      } else {
        result.push("<<<<<<< HEAD");
        result.push(...currentLines);
        result.push("=======");
        result.push(...incomingLines);
        result.push(">>>>>>> incoming");
      }
      cur++;
    } else {
      result.push(lines[i]);
    }
    i++;
  }
  return result.join("\n");
}

// ── Conflict editor theme ─────────────────────────────────────────────────────

const conflictTheme = EditorView.theme({
  ".cm-line.cm-conflict-current-bg": {
    backgroundColor: "rgba(34, 197, 94, 0.08)",
  },
  ".cm-line.cm-conflict-incoming-bg": {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
  },
  ".cm-line.cm-conflict-marker-bg": {
    backgroundColor: "rgba(100, 116, 139, 0.12)",
    color: "var(--comment, #6b7280)",
  },
});

// ── Action widget (rendered above each <<<<<<< line) ──────────────────────────

class ConflictActionWidget extends WidgetType {
  constructor(
    private readonly getView: () => EditorView | null,
    private readonly conflictIndex: number,
  ) {
    super();
  }

  eq(other: ConflictActionWidget) {
    return other.conflictIndex === this.conflictIndex;
  }

  toDOM() {
    const container = document.createElement("div");
    container.style.cssText = [
      "display:flex", "align-items:center", "gap:0",
      "padding:2px 12px",
      "background:rgba(255,255,255,0.025)",
      "border-top:1px solid rgba(100,116,139,0.15)",
      "border-bottom:1px solid rgba(100,116,139,0.15)",
      "font-size:11px", "line-height:1.8",
      "user-select:none",
    ].join(";");

    const makeBtn = (label: string, color: string, resolution: Resolution) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = `color:${color};padding:1px 8px;background:none;border:none;cursor:pointer;font-size:11px;font-family:inherit;`;
      btn.addEventListener("mouseenter", () => { btn.style.textDecoration = "underline"; });
      btn.addEventListener("mouseleave", () => { btn.style.textDecoration = "none"; });
      btn.addEventListener("mousedown", (e) => { e.preventDefault(); });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const view = this.getView();
        if (!view) return;
        const content = view.state.doc.toString();
        const resolved = applyResolutionInMemory(content, resolution, this.conflictIndex);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: resolved } });
      });
      return btn;
    };

    const sep = () => {
      const s = document.createElement("span");
      s.textContent = "|";
      s.style.cssText = "color:rgba(100,116,139,0.4);font-size:11px;pointer-events:none;";
      return s;
    };

    container.appendChild(makeBtn("Accept Current Change", "#4ade80", "current"));
    container.appendChild(sep());
    container.appendChild(makeBtn("Accept Incoming Change", "#60a5fa", "incoming"));
    container.appendChild(sep());
    container.appendChild(makeBtn("Accept Both Changes", "rgba(148,163,184,0.7)", "both"));
    return container;
  }

  ignoreEvent() { return false; }
}

// ── Build decorations from a Text doc ─────────────────────────────────────────
// Uses StateField (not ViewPlugin) — required for block widgets.

function buildConflictDecos(
  doc: Text,
  getView: () => EditorView | null,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lines = doc.toString().split("\n");

  let conflictIdx = 0;
  let i = 0;
  let lineNum = 1; // 1-indexed

  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      const headerLine = doc.line(lineNum);

      // Block widget ABOVE the <<<<<<< line (requires StateField, not ViewPlugin)
      builder.add(
        headerLine.from,
        headerLine.from,
        Decoration.widget({
          widget: new ConflictActionWidget(getView, conflictIdx),
          side: -1,
          block: true,
        }),
      );
      // Color the <<<<<<< line
      builder.add(
        headerLine.from,
        headerLine.from,
        Decoration.line({ class: "cm-conflict-marker-bg" }),
      );

      let j = i + 1;
      let jln = lineNum + 1;
      let section: "current" | "incoming" = "current";

      while (j < lines.length && !lines[j].startsWith(">>>>>>>")) {
        if (lines[j].startsWith("=======") || lines[j].startsWith("|||||||")) {
          if (jln <= doc.lines) {
            builder.add(
              doc.line(jln).from,
              doc.line(jln).from,
              Decoration.line({ class: "cm-conflict-marker-bg" }),
            );
          }
          if (lines[j].startsWith("=======")) section = "incoming";
        } else {
          if (jln <= doc.lines) {
            const cls =
              section === "current"
                ? "cm-conflict-current-bg"
                : "cm-conflict-incoming-bg";
            builder.add(
              doc.line(jln).from,
              doc.line(jln).from,
              Decoration.line({ class: cls }),
            );
          }
        }
        j++;
        jln++;
      }

      // Color the >>>>>>> line
      if (j < lines.length && jln <= doc.lines) {
        builder.add(
          doc.line(jln).from,
          doc.line(jln).from,
          Decoration.line({ class: "cm-conflict-marker-bg" }),
        );
      }

      conflictIdx++;
      i = j;
      lineNum = jln;
    }
    i++;
    lineNum++;
  }

  return builder.finish();
}

// ── Main component ────────────────────────────────────────────────────────────

export const ConflictEditorTab = ({ tab }: { tab: any }) => {
  const file: string = tab.source ?? tab.meta?.file ?? "";
  const tabId: string = tab.tabId ?? tab.id ?? "";
  const fileName = file.split("/").pop() || file;
  const isVoid = fileName.endsWith(".void");
  const queryClient = useQueryClient();

  const [localContent, setLocalContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadKey, setLoadKey] = useState(0);

  const editorRef = useRef<EditorView | null>(null);
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: closeTab } = useClosePanelTab();

  const conflictCount = useMemo(
    () => (localContent.match(/^<{7}/gm) ?? []).length,
    [localContent],
  );
  const allResolved = !isLoading && conflictCount === 0;

  // ── StateField for conflict decorations (stable, created once per mount) ───

  const conflictDecoField = useMemo(() => {
    const getView = () => editorRef.current;
    return StateField.define<DecorationSet>({
      create(state) {
        return buildConflictDecos(state.doc, getView);
      },
      update(decos, tr) {
        if (tr.docChanged) return buildConflictDecos(tr.state.doc, getView);
        return decos.map(tr.changes);
      },
      provide: (f) => EditorView.decorations.from(f),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const extensions = useMemo(
    () => [conflictTheme, conflictDecoField, EditorView.lineWrapping],
    [conflictDecoField],
  );

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadContent = useCallback(async () => {
    if (!file) return;
    setIsLoading(true);
    try {
      const raw = await window.electron?.git.getFileContent(file);
      if (raw != null) {
        setLocalContent(raw);
        setLoadKey((k) => k + 1);
      }
    } catch (err: any) {
      toast.error("Failed to load file", { description: err?.message });
    } finally {
      setIsLoading(false);
    }
  }, [file]);

  useEffect(() => {
    loadContent();
  }, [file]);

  // ── Bulk accept all conflicts ──────────────────────────────────────────────

  const applyResolution = (resolution: Resolution) => {
    const view = editorRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    const resolved = applyResolutionInMemory(content, resolution);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: resolved },
    });
  };

  // ── Save, stage & close tab ───────────────────────────────────────────────

  const handleResolved = async () => {
    const view = editorRef.current;
    const content = view?.state.doc.toString() ?? localContent;
    setIsSaving(true);
    try {
      await window.electron?.git.saveResolvedFile(file, content);
      queryClient.invalidateQueries({ queryKey: ["git:conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      toast.success("File resolved & staged", { description: fileName });
      // Close this tab
      if (tabId) closeTab({ panelId: "main", tabId });
    } catch (err: any) {
      toast.error("Failed to save", { description: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Preview .void ─────────────────────────────────────────────────────────

  const handlePreview = async () => {
    try {
      const root = await window.electron?.git.getRepoRoot();
      if (!root) { toast.error("Could not resolve project path"); return; }
      const absolutePath = await window.electron?.utils.pathJoin(root, file);
      if (!absolutePath) return;
      addPanelTab({
        panelId: "main",
        tab: {
          id: `preview-resolved-${file}`,
          type: "document",
          title: fileName,
          source: absolutePath,
        } as any,
      });
    } catch {
      toast.error("Could not open preview");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-editor overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 h-9 px-4 flex items-center justify-between border-b border-border bg-panel">
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={13}
            className={cn(allResolved ? "text-green-400" : "text-orange-400")}
          />
          <span className="text-sm font-medium text-text truncate max-w-[200px]">
            {fileName}
          </span>
          {!isLoading && (
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium",
                allResolved
                  ? "bg-green-500/15 text-green-400"
                  : "bg-orange-500/15 text-orange-400",
              )}
            >
              {allResolved
                ? "Resolved"
                : `${conflictCount} conflict${conflictCount !== 1 ? "s" : ""}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!allResolved && !isLoading && (
            <>
              <Tip label="Accept all current (HEAD) changes" side="bottom">
                <button
                  onClick={() => applyResolution("current")}
                  className="flex items-center gap-1 text-[11px] text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 px-2.5 py-1 rounded transition-colors"
                >
                  <ArrowUp size={11} /> All Current
                </button>
              </Tip>
              <Tip label="Accept all incoming changes" side="bottom">
                <button
                  onClick={() => applyResolution("incoming")}
                  className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-2.5 py-1 rounded transition-colors"
                >
                  <ArrowDown size={11} /> All Incoming
                </button>
              </Tip>
              <Tip label="Accept all — keep both" side="bottom">
                <button
                  onClick={() => applyResolution("both")}
                  className="flex items-center gap-1 text-[11px] text-comment hover:text-text bg-active/40 hover:bg-active border border-border px-2.5 py-1 rounded transition-colors"
                >
                  <ChevronsUpDown size={11} /> Both
                </button>
              </Tip>
              <div className="w-px h-4 bg-border mx-0.5" />
            </>
          )}

          <Tip label="Reload from disk" side="bottom">
            <button
              onClick={loadContent}
              disabled={isLoading}
              className="p-1.5 text-comment hover:text-text hover:bg-active/50 rounded transition-colors"
            >
              <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
            </button>
          </Tip>
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-comment" />
          </div>
        ) : (
          <CodeMirror
            key={loadKey}
            value={localContent}
            theme={voidenTheme}
            extensions={extensions}
            basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
            onCreateEditor={(view) => { editorRef.current = view; }}
            onChange={(val) => setLocalContent(val)}
            style={{ height: "100%" }}
            height="100%"
          />
        )}
      </div>

      {/* ── Bottom bar ── */}
      {!isLoading && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-border bg-panel flex items-center justify-between gap-2">
          {isVoid ? (
            <button
              onClick={handlePreview}
              className="flex items-center gap-1.5 text-xs text-comment hover:text-text border border-border hover:bg-active/50 px-3 py-1.5 rounded transition-colors"
            >
              <Eye size={12} />
              Preview .void file
            </button>
          ) : (
            <span />
          )}

          {allResolved ? (
            <button
              onClick={handleResolved}
              disabled={isSaving}
              className="flex items-center gap-1.5 text-xs text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-1.5 rounded transition-colors font-medium"
            >
              {isSaving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              {isSaving ? "Saving…" : "Mark as Resolved"}
            </button>
          ) : (
            <span className="text-[10px] text-comment italic">
              Resolve all {conflictCount} conflict{conflictCount !== 1 ? "s" : ""} to continue
            </span>
          )}
        </div>
      )}
    </div>
  );
};
