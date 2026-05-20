import React from "react";
import { Loader } from "lucide-react";
import type { SearchResult } from "@/types";
import { useSearchStore as useEditorSearchStore } from "@/core/stores/searchParamsStore";

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

  const splitter = buildSplitter(searchQuery, { matchCase, matchWholeWord, useRegex });

  // Group matches by file path.
  const byFile = searchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.path] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      {searchQuery && (
        <div className="flex items-center gap-2 text-xs text-gray-400 px-2 mb-1">
          {!isSearching && matchCount === 0 && rawQuery === searchQuery && (
            <span>No results for &ldquo;{rawQuery}&rdquo;</span>
          )}
          {matchCount > 0 && (
            <span>{matchCount} match{matchCount === 1 ? "" : "es"} in {fileCount} file{fileCount === 1 ? "" : "s"}</span>
          )}
          {isSearching && <Loader size={12} className="animate-spin text-accent shrink-0" />}
        </div>
      )}
      {searchResults.length > 0 && (
        <div className="space-y-1">
          {Object.entries(byFile).map(([filePath, matches]) => (
            <div key={filePath} className="rounded-lg border border-border overflow-hidden">
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-active cursor-pointer hover:bg-hover transition-colors"
                onClick={() => openMatch(filePath, matches[0].line, matches[0].col, 0)}
              >
                <span className="text-xs font-medium text-text truncate flex-1">{filePath.split("/").pop() || filePath}</span>
                <span className="text-xs text-comment shrink-0">{matches.length} match{matches.length !== 1 ? "es" : ""}</span>
              </div>
              {matches.map(({ line, col, preview }, matchIndex) => (
                <div
                  key={`${line}:${col}:${matchIndex}`}
                  className="flex items-start gap-3 px-3 py-1.5 border-t border-border cursor-pointer hover:bg-hover transition-colors"
                  onClick={() => openMatch(filePath, line, col, matchIndex)}
                >
                  <span className="text-xs text-comment shrink-0 tabular-nums w-5 text-right">{line}</span>
                  <p className="text-xs text-text break-all leading-5">
                    {splitter
                      ? preview.trim().split(splitter).map((part, idx) => (
                        <React.Fragment key={idx}>
                          {idx % 2 === 1 ? <mark className="bg-accent/60 text-text rounded px-0.5">{part}</mark> : part}
                        </React.Fragment>
                      ))
                      : preview.trim()}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function buildSplitter(
  searchQuery: string,
  flags: { matchCase: boolean; matchWholeWord: boolean; useRegex: boolean },
): RegExp | null {
  // The backend snippet is a single line, but a multiline query can match any
  // of its lines — build an alternation so every line gets highlighted.
  const lines = searchQuery.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const parts = lines.map((l) => flags.useRegex ? `(?:${l})` : l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const inner = parts.length === 1 ? parts[0] : `(?:${parts.join("|")})`;
  const wrapped = flags.matchWholeWord ? `\\b${inner}\\b` : inner;
  try {
    return new RegExp(`(${wrapped})`, flags.matchCase ? "" : "i");
  } catch {
    return null;
  }
}
