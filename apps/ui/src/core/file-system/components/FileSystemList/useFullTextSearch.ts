import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { SearchResult } from "@/types";
import { useDebounce } from "./useDebounce";
import { getParentPath } from "./treeData";

interface UseFullTextSearchArgs {
  storeIsSearching: boolean;
  openSearchTick: number;
  openWithReplaceTick: number;
  activeFileSource: string | undefined;
  activeDirectory: string | undefined;
  // Called with the paths whose contents were just rewritten by a replace, so
  // open editor tabs for those files can reload from disk.
  onFilesReplaced?: (paths: string[]) => void;
}

/**
 * A match the user has already replaced, kept on screen as a strikethrough
 * marker. It carries its own id (not a coordinate) so it never collides with
 * the refreshed coordinates of the remaining live matches, and the expanded
 * replacement text so $1-style previews render exactly as written to disk.
 */
export type ReplacedMatch = SearchResult & { replacement: string; markerId: number };

export function useFullTextSearch({
  storeIsSearching,
  openSearchTick,
  openWithReplaceTick,
  activeFileSource,
  activeDirectory,
  onFilesReplaced,
}: UseFullTextSearchArgs) {
  const [rawQuery, setRawQuery] = useState<string>("");
  const searchQuery = useDebounce(rawQuery, 300);
  const [matchCase, setMatchCase] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [useMultiline, setUseMultiline] = useState(false);
  const [fileMaskEnabled, setFileMaskEnabled] = useState(false);
  const [fileMask, setFileMask] = useState("*.void");
  const [dirMaskEnabled, setDirMaskEnabled] = useState(false);
  const [dirMask, setDirMask] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);

  const dirMaskUserEditedRef = useRef(false);
  const findInputRef = useRef<HTMLTextAreaElement>(null);

  // Debounce mask inputs so each keystroke doesn't kick off a new rg run.
  const debouncedFileMask = useDebounce(fileMask, 300);
  const debouncedDirMask = useDebounce(dirMask, 300);

  const [childDirs, setChildDirs] = useState<string[]>([]);
  const lastFetchedKeyRef = useRef<string | undefined>(undefined);

  const parentPrefix = useMemo(() => {
    const lastSlash = dirMask.lastIndexOf("/");
    return lastSlash >= 0 ? dirMask.slice(0, lastSlash + 1) : "";
  }, [dirMask]);

  const dirSuggestions = useMemo(() => {
    const partial = dirMask.slice(parentPrefix.length).toLowerCase();
    return childDirs.filter((d) => {
      const rest = d.slice(parentPrefix.length);
      if (!includeHidden && rest.startsWith(".")) return false;
      if (partial && !rest.toLowerCase().startsWith(partial)) return false;
      return true;
    }).slice(0, 10);
  }, [childDirs, dirMask, parentPrefix, includeHidden]);

  useEffect(() => {
    if (rawQuery.includes("\n")) setUseMultiline(true);
  }, [rawQuery]);

  useHotkeys(
    ["alt+f", "alt+d", "alt+."],
    (_e, handler) => {
      switch (handler.hotkey) {
        case "alt+f": setFileMaskEnabled((v) => !v); break;
        case "alt+d": setDirMaskEnabled((v) => !v); break;
        case "alt+.": setIncludeHidden((v) => !v); break;
      }
    },
    { enabled: storeIsSearching, enableOnFormTags: ["INPUT", "TEXTAREA"], preventDefault: true },
    [storeIsSearching],
  );

  useEffect(() => {
    if (!storeIsSearching) return;
    const key = `${activeDirectory ?? ""}::${parentPrefix}`;
    if (lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;
    const parent = parentPrefix.replace(/\/+$/, "");
    window.electron?.listDirs?.(parent || undefined)
      .then((dirs) => setChildDirs(dirs ?? []))
      .catch(() => {});
  }, [storeIsSearching, activeDirectory, parentPrefix]);

  useEffect(() => {
    if (storeIsSearching) {
      setTimeout(() => findInputRef.current?.focus(), 0);
    }
  }, [openSearchTick, storeIsSearching]);

  useEffect(() => {
    if (!storeIsSearching || dirMaskUserEditedRef.current) return;
    const projectRoot = activeDirectory ?? "";
    const fileParent = activeFileSource ? getParentPath(activeFileSource) : "";
    if (projectRoot && fileParent.startsWith(projectRoot)) {
      const rel = fileParent.slice(projectRoot.length).replace(/^[/\\]/, "");
      if (rel) setDirMask(rel);
    }
  }, [storeIsSearching, activeFileSource, activeDirectory]);

  const [rawReplaceQuery, setRawReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);

  useEffect(() => {
    if (openWithReplaceTick > 0) setShowReplace(true);
  }, [openWithReplaceTick]);
  const [isReplacing, setIsReplacing] = useState(false);
  const [replacedMatches, setReplacedMatches] = useState<ReplacedMatch[]>([]);
  const markerIdRef = useRef(0);

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchIdRef = useRef(0);
  const seenSearchResultsRef = useRef(new Set<string>());

  useEffect(() => {
    window.electron?.cancelSearch?.(searchIdRef.current);

    if (!searchQuery) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    searchIdRef.current += 1;
    const currentId = searchIdRef.current;

    seenSearchResultsRef.current = new Set();
    setSearchResults([]);
    setReplacedMatches([]);
    setIsSearching(true);
    setSearchError(null);

    window.electron?.startSearch?.({
      query: searchQuery, matchCase, matchWholeWord, useRegex, useMultiline, searchId: currentId,
      fileMask: fileMaskEnabled ? debouncedFileMask.trim() || undefined : undefined,
      dirMask: dirMaskEnabled ? debouncedDirMask.trim() || undefined : undefined,
      includeHidden,
    });

    let firstResult = true;
    const unsubResult = window.electron?.onSearchResult?.((data) => {
      if (data.searchId !== currentId) return;
      const key = `${data.result.path}:${data.result.line}:${data.result.col}`;
      if (!seenSearchResultsRef.current.has(key)) {
        seenSearchResultsRef.current.add(key);
        if (firstResult) {
          firstResult = false;
          setSearchResults([data.result]);
        } else {
          setSearchResults((prev) => [...prev, data.result]);
        }
      }
    });

    const unsubDone = window.electron?.onSearchDone?.((data) => {
      if (data.searchId !== currentId) return;
      setIsSearching(false);
      if (data.error) setSearchError(data.error);
      if (firstResult) setSearchResults([]);
    });

    return () => {
      unsubResult?.();
      unsubDone?.();
      window.electron?.cancelSearch?.(currentId);
    };
  }, [searchQuery, matchCase, matchWholeWord, useRegex, useMultiline, fileMaskEnabled, debouncedFileMask, dirMaskEnabled, debouncedDirMask, includeHidden]);

  // Replaces all entries for `path` in the live result list with `fresh`,
  // keeping them where the file first appeared (so file grouping is stable).
  const spliceFileResults = (prev: SearchResult[], path: string, fresh: SearchResult[]): SearchResult[] => {
    const out: SearchResult[] = [];
    let inserted = false;
    for (const r of prev) {
      if (r.path !== path) { out.push(r); continue; }
      if (!inserted) { inserted = true; out.push(...fresh); }
    }
    if (!inserted) out.push(...fresh);
    return out;
  };

  const refreshLiveMatches = (path: string) =>
    window.electron?.searchInFile?.({ path, query: searchQuery, matchCase, matchWholeWord, useRegex, useMultiline });

  const replaceMatch = async (path: string, line: number, col: number) => {
    if (!searchQuery) return;
    setIsReplacing(true);
    try {
      const orig = searchResults.find((r) => r.path === path && r.line === line && r.col === col);
      const result = await window.electron?.replaceMatch?.({
        path, line, col, query: searchQuery, replacement: rawReplaceQuery,
        matchCase, matchWholeWord, useRegex, useMultiline,
      });
      if (result?.success && orig) {
        // Reload any open editor for this file, then snapshot the replaced match
        // as a marker and re-scan so the remaining live matches pick up
        // coordinates shifted by the edit.
        onFilesReplaced?.(result.updatedPaths);
        setReplacedMatches((prev) => [...prev, { ...orig, replacement: result.replacement ?? rawReplaceQuery, markerId: markerIdRef.current++ }]);
        const refreshed = await refreshLiveMatches(path);
        if (refreshed?.results) setSearchResults((prev) => spliceFileResults(prev, path, refreshed.results));
      }
    } finally {
      setIsReplacing(false);
    }
  };

  const replaceInFilePaths = async (paths: string[]) => {
    if (!searchQuery || !paths.length) return;
    setIsReplacing(true);
    try {
      const result = await window.electron?.replaceInFiles?.({
        query: searchQuery, replacement: rawReplaceQuery,
        matchCase, matchWholeWord, useRegex, useMultiline, paths,
      });
      if (result?.updatedPaths?.length) {
        onFilesReplaced?.(result.updatedPaths);
        const updatedSet = new Set(result.updatedPaths);
        const replacements = result.replacements ?? {};

        // Snapshot the matched (pre-edit) results as markers — one expanded
        // replacement per match, in document order.
        setReplacedMatches((prev) => {
          const next = [...prev];
          for (const path of result.updatedPaths) {
            const expanded = replacements[path] ?? [];
            searchResults
              .filter((r) => r.path === path)
              .forEach((r, i) => next.push({ ...r, replacement: expanded[i] ?? rawReplaceQuery, markerId: markerIdRef.current++ }));
          }
          return next;
        });

        // Drop the replaced files' stale live matches, then re-scan for any that
        // survived (e.g. when the replacement text still matches the query).
        setSearchResults((prev) => prev.filter((r) => !updatedSet.has(r.path)));
        for (const path of result.updatedPaths) {
          const refreshed = await refreshLiveMatches(path);
          if (refreshed?.results?.length) setSearchResults((prev) => [...prev, ...refreshed.results]);
        }
      }
      return result;
    } finally {
      setIsReplacing(false);
    }
  };

  const replaceAll = () => {
    const paths = [...new Set(searchResults.map((r) => r.path))];
    return replaceInFilePaths(paths);
  };

  const replaceInFile = (path: string) => replaceInFilePaths([path]);

  const resetSearch = () => {
    setRawQuery("");
    dirMaskUserEditedRef.current = false;
  };

  return {
    // query
    rawQuery, setRawQuery, searchQuery,
    // toggles
    matchCase, setMatchCase, matchWholeWord, setMatchWholeWord,
    useRegex, setUseRegex, useMultiline, setUseMultiline,
    // masks
    fileMaskEnabled, setFileMaskEnabled, fileMask, setFileMask,
    dirMaskEnabled, setDirMaskEnabled, dirMask, setDirMask,
    includeHidden, setIncludeHidden,
    // suggestions
    dirSuggestions,
    // refs
    findInputRef,
    dirMaskUserEditedRef,
    // results
    searchResults, isSearching, searchError,
    // replace
    rawReplaceQuery, setRawReplaceQuery,
    showReplace, setShowReplace,
    isReplacing, replacedMatches,
    replaceMatch, replaceAll, replaceInFile,
    // helpers
    resetSearch,
  };
}

export type FullTextSearch = ReturnType<typeof useFullTextSearch>;
