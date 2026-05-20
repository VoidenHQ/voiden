import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { SearchResult } from "@/types";
import { useDebounce } from "./useDebounce";
import { getParentPath } from "./treeData";

interface UseFullTextSearchArgs {
  storeIsSearching: boolean;
  openSearchTick: number;
  activeFileSource: string | undefined;
  activeDirectory: string | undefined;
}

export function useFullTextSearch({
  storeIsSearching,
  openSearchTick,
  activeFileSource,
  activeDirectory,
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

  const [allDirs, setAllDirs] = useState<string[]>([]);

  const dirSuggestions = useMemo(() => {
    const lastSlash = dirMask.lastIndexOf("/");
    const parentPrefix = lastSlash >= 0 ? dirMask.slice(0, lastSlash + 1) : "";
    const partial = dirMask.slice(lastSlash + 1).toLowerCase();
    return allDirs.filter((d) => {
      if (!d.toLowerCase().startsWith(parentPrefix.toLowerCase())) return false;
      const rest = d.slice(parentPrefix.length);
      if (rest.includes("/")) return false;
      if (partial && !rest.toLowerCase().startsWith(partial)) return false;
      return true;
    }).slice(0, 10);
  }, [allDirs, dirMask]);

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
    window.electron?.listDirs?.().then((dirs) => setAllDirs(dirs ?? [])).catch(() => {});
  }, [storeIsSearching]);

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
    setIsSearching(true);
    setSearchError(null);

    window.electron?.startSearch?.({
      query: searchQuery, matchCase, matchWholeWord, useRegex, useMultiline, searchId: currentId,
      fileMask: fileMaskEnabled ? fileMask.trim() || undefined : undefined,
      dirMask: dirMaskEnabled ? dirMask.trim() || undefined : undefined,
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
  }, [searchQuery, matchCase, matchWholeWord, useRegex, useMultiline, fileMaskEnabled, fileMask, dirMaskEnabled, dirMask, includeHidden]);

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
    // helpers
    resetSearch,
  };
}

export type FullTextSearch = ReturnType<typeof useFullTextSearch>;
