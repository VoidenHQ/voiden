import { Loader, Replace, ReplaceAll } from "lucide-react";
import type { SearchResult } from "@/types";
import { cn } from "@/core/lib/utils";
import { useSearchStore as useEditorSearchStore } from "@/core/stores/searchParamsStore";
import type { ReplacedMatch } from "./useFullTextSearch";

interface SearchResultsProps {
  rawQuery: string;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchError: string | null;
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
  useMultiline: boolean;
  activateTab: (args: { panelId: string; tabId: string }) => Promise<unknown> | void;
  onReplaceMatch?: (path: string, line: number, col: number) => void;
  onReplaceInFile?: (path: string) => void;
  isReplacing?: boolean;
  replacedMatches?: ReplacedMatch[];
}

// A row in a file group: either a live (still-matching) result or a marker for
// a match the user already replaced. `liveIndex` is the position among the
// file's live matches, used as the editor's target match index.
type Row =
  | { kind: "live"; r: SearchResult; liveIndex: number }
  | { kind: "marker"; r: ReplacedMatch };

function groupByFile<T extends { path: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.path);
    if (list) list.push(item);
    else map.set(item.path, [item]);
  }
  return map;
}

export function SearchResults({
  rawQuery,
  searchQuery,
  searchResults,
  isSearching,
  searchError,
  matchCase,
  matchWholeWord,
  useRegex,
  useMultiline,
  activateTab,
  onReplaceMatch,
  onReplaceInFile,
  isReplacing,
  replacedMatches = [],
}: SearchResultsProps) {
  if (searchError) {
    return <div className="text-red-500 text-sm">Error running search: {searchError}</div>;
  }

  const matchCount = searchResults.length;
  const fileCount = new Set(searchResults.map((r) => r.path)).size;

  const openMatch = async (path: string, line: number, col: number, matchIndex: number) => {
    const editorSearch = useEditorSearchStore.getState();
    // Set search params before opening tab so CM knows what to highlight.
    editorSearch.setTerm(searchQuery);
    editorSearch.setMatchCase(matchCase);
    editorSearch.setMatchWholeWord(matchWholeWord);
    editorSearch.setUseRegex(useRegex);
    editorSearch.setUseMultiline(useMultiline);
    const newTab = {
      id: crypto.randomUUID(),
      type: "document" as const,
      title: path.split("/").pop() || path,
      source: path,
      directory: null,
    };
    const response = await window.electron?.state.addPanelTab("main", newTab);
    const tabId = response?.tabId;
    if (tabId) await activateTab({ panelId: "main", tabId });
    // Target info set AFTER activateTab in same React batch as requestOpenSearchPanel
    // so navigation effects fire last and win.
    editorSearch.setTargetLine(line);
    editorSearch.setTargetCol(col);
    editorSearch.setTargetPath(path);
    editorSearch.setTargetMatchIndex(matchIndex);
    editorSearch.requestOpenSearchPanel();
  };

  // Union of files that have live matches and/or replaced markers, preserving
  // the order files first appear in the live results then any marker-only files.
  const liveByFile = groupByFile(searchResults);
  const markersByFile = groupByFile(replacedMatches);
  const fileName = (p: string) => p.split("/").pop() || p;
  const filePaths = [...new Set([...liveByFile.keys(), ...markersByFile.keys()])].sort((a, b) =>
    fileName(a).localeCompare(fileName(b)),
  );

  return (
    <>
      {searchQuery && (
        <div className="flex items-center gap-2 text-xs text-gray-400 px-2 mb-1">
          {!isSearching && matchCount === 0 && replacedMatches.length === 0 && rawQuery === searchQuery && (
            <span>No results for &ldquo;{rawQuery}&rdquo;</span>
          )}
          {matchCount > 0 && (
            <span>{matchCount} match{matchCount === 1 ? "" : "es"} in {fileCount} file{fileCount === 1 ? "" : "s"}</span>
          )}
          {isSearching && <Loader size={12} className="animate-spin text-accent shrink-0" />}
        </div>
      )}
      {filePaths.length > 0 && (
        <div className="space-y-1">
          {filePaths.map((filePath) => {
            const live = liveByFile.get(filePath) ?? [];
            const markers = markersByFile.get(filePath) ?? [];
            // Interleave live matches and replaced markers by position.
            const rows: Row[] = [
              ...live.map((r, liveIndex): Row => ({ kind: "live", r, liveIndex })),
              ...markers.map((r): Row => ({ kind: "marker", r })),
            ].sort((a, b) => a.r.line - b.r.line || a.r.col - b.r.col);
            const head = rows[0]?.r;

            return (
              <div key={filePath} className="rounded-lg border border-border overflow-hidden">
                <div
                  className="flex items-center gap-2 px-3 py-1.5 bg-active transition-colors cursor-pointer hover:bg-hover"
                  onClick={() => head && openMatch(filePath, head.line, head.col, 0)}
                >
                  <span className="text-xs font-medium text-text truncate flex-1">{filePath.split("/").pop() || filePath}</span>
                  <span className="text-xs text-comment shrink-0">{live.length} match{live.length !== 1 ? "es" : ""}</span>
                  {onReplaceInFile && live.length > 0 && (
                    <button
                      className="shrink-0 text-comment hover:text-amber-500 p-0.5 disabled:opacity-25"
                      title="Replace all in file"
                      disabled={isReplacing}
                      onClick={(e) => { e.stopPropagation(); onReplaceInFile(filePath); }}
                    >
                      <ReplaceAll size={13} />
                    </button>
                  )}
                </div>
                {rows.map((row) => {
                  const { line, col, preview, colInPreview, matchLength } = row.r;
                  const trimOffset = preview.length - preview.trimStart().length;
                  const start = Math.max(0, colInPreview - trimOffset);
                  const text = preview.trim();
                  const end = Math.min(text.length, start + matchLength);
                  const isMarker = row.kind === "marker";

                  return (
                    <div
                      key={isMarker ? `marker:${row.r.markerId}` : `live:${line}:${col}:${row.liveIndex}`}
                      className={cn(
                        "flex items-start gap-3 px-3 py-1.5 border-t border-border transition-colors",
                        isMarker ? "opacity-40 cursor-default" : "cursor-pointer hover:bg-hover",
                      )}
                      onClick={() => { if (!isMarker) openMatch(filePath, line, col, row.liveIndex); }}
                    >
                      <span className="text-xs text-comment shrink-0 tabular-nums w-5 text-right">{line}</span>
                      <p className="text-xs text-text break-all leading-5 flex-1 whitespace-pre-wrap">
                        {text.slice(0, start)}
                        {isMarker ? (
                          <>
                            <span className="line-through opacity-40">{text.slice(start, end)}</span>
                            <mark className="bg-green-500/20 text-green-400 rounded px-0.5 ml-0.5 no-underline">{row.r.replacement}</mark>
                          </>
                        ) : (
                          <mark className="bg-accent/60 text-text rounded px-0.5">{text.slice(start, end)}</mark>
                        )}
                        {text.slice(end)}
                      </p>
                      {onReplaceMatch && !isMarker && (
                        <button
                          className="shrink-0 text-comment hover:text-amber-500 p-0.5 disabled:opacity-25"
                          title="Replace match"
                          disabled={isReplacing}
                          onClick={(e) => { e.stopPropagation(); onReplaceMatch(filePath, line, col); }}
                        >
                          <Replace size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
