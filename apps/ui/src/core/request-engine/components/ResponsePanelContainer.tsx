/**
 * Response Panel Container
 *
 * Displays HTTP responses as a read-only Voiden viewer with response nodes.
 * Keep-alive: ResponseViewer instances stay mounted (display:none) when switching tabs
 * so the TipTap editor is never destroyed/recreated on tab switch.
 * Layout: Sticky top bar with status | Scrollable middle content | Bottom bar (handled elsewhere)
 */

import { useResponseStore } from "../stores/responseStore";
import type { ResponseNodeType } from "../stores/responseStore";
import { SendRequestButton } from "./SendRequestButton";
import { ResponseViewer, type ResponseViewerHandle } from "./ResponseViewer";
import { useMemo, useEffect, useCallback, useState, useRef, useSyncExternalStore } from "react";
import { Search, ArrowUpIcon, ArrowDownIcon, X, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useGetPanelTabs } from "@/core/layout/hooks";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";
import { getSchema } from "@tiptap/core";
import { voidenExtensions } from "@/core/editors/voiden/extensions";
import { Input } from "@/core/components/ui/input";
import { escapeRegExp } from "@/core/editors/voiden/search/unifiedSearch";
import { getSectionBorderColor } from "@/core/editors/voiden/extensions/sectionIndicator";
import { Tip } from "@/core/components/ui/Tip";

/** Format relative time: "just now", "2m ago", "1h ago", etc. */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Hook that ticks every 10s to keep relative timestamps updating */
function useNow(intervalMs = 10_000) {
  return useSyncExternalStore(
    (cb) => { const id = setInterval(cb, intervalMs); return () => clearInterval(id); },
    () => Math.floor(Date.now() / intervalMs),
  );
}
import { unifiedSearchHighlight } from "@/core/editors/voiden/search/cmHighlightEffect";
import type { EditorView as CMEditorView } from "@codemirror/view";

const MAX_CACHED_RESPONSE_VIEWERS = 8;

/** Check if a tab has any section responses */
function hasAnyResponse(tabSections: Record<number, any> | undefined): boolean {
  if (!tabSections) return false;
  return Object.values(tabSections).some((s: any) => s?.responseDoc);
}

/** Hook to subscribe to stitch store for the active file */
function useStitchResults(activeFilePath: string | undefined) {
  const [hasResults, setHasResults] = useState(false);
  const [StitchComponent, setStitchComponent] = useState<React.ComponentType<{ sourceFilePath?: string }> | null>(null);

  useEffect(() => {
    const helpers = (window as any).__voidenHelpers__?.['voiden-stitch'];
    if (!helpers?.stitchStore) return;

    const store = helpers.stitchStore;
    const update = () => {
      if (activeFilePath) {
        const fileRun = store.getRun(activeFilePath);
        setHasResults(fileRun?.status !== 'idle' && !!fileRun?.id);
      } else {
        setHasResults(false);
      }
    };
    update();
    const unsub = store.subscribe(update);
    return unsub;
  }, [activeFilePath]);

  useEffect(() => {
    const helpers = (window as any).__voidenHelpers__?.['voiden-stitch'];
    if (helpers?.StitchResultsSidebar && !StitchComponent) {
      setStitchComponent(() => helpers.StitchResultsSidebar);
    }
  });

  return { hasResults, StitchComponent };
}

export function ResponsePanelContainer() {
  useNow(); // tick every 10s to update relative timestamps

  // Get the active tab from the main panel
  const { data: panelData } = useGetPanelTabs("main");
  const activeTabId = panelData?.activeTabId;
  const activeTab = panelData?.tabs?.find((tab) => tab.id === activeTabId);
  const isVoidFile = activeTab?.title?.endsWith(".void") ?? false;
  const activeFilePath = (activeTab as any)?.source || undefined;

  // Subscribe to stitch results for the active file
  const { hasResults: hasStitchResults, StitchComponent } = useStitchResults(activeFilePath);

  const {
    isLoading,
    responses,
    setActiveTabId,
    hydrateResponse,
    getActiveResponseNodeForTab,
    setActiveResponseNodeForTab,
    getResponsePanelScrollForTab,
    setResponsePanelScrollForTab,
    getResponseNodeScrollsForTab,
    setResponseNodeScrollForTab,
  } = useResponseStore();

  // Keep-alive: ordered list of tab IDs that have a mounted ResponseViewer
  const [cachedResponseTabIds, setCachedResponseTabIds] = useState<string[]>([]);

  // Collapsed state for stacked section responses (keyed by "tabId:sectionIndex")
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  // Refs to each ResponseViewer instance, keyed by "tabId:sectionIndex"
  const viewerRefs = useRef<Map<string, ResponseViewerHandle>>(new Map());
  const toggleSectionCollapse = useCallback((tabId: string, sectionIndex: number | string) => {
    const key = `${tabId}:${sectionIndex}`;
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const collapseAllSections = useCallback((tabId: string, sectionIndices: number[]) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const idx of sectionIndices) next.add(`${tabId}:${idx}`);
      return next;
    });
  }, []);
  const expandAllSections = useCallback((tabId: string, sectionIndices: number[]) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const idx of sectionIndices) next.delete(`${tabId}:${idx}`);
      return next;
    });
  }, []);

  // Stable per-tab onActiveNodeChange callbacks — avoids recreating TipTap editors on re-render
  const nodeChangeCallbacksRef = useRef<Record<string, (nodeType: ResponseNodeType) => void>>({});
  const panelScrollCallbacksRef = useRef<Record<string, (scrollTop: number) => void>>({});
  const nodeScrollCallbacksRef = useRef<Record<string, (nodeKey: string, scrollTop: number) => void>>({});
  const hydratedFromFileTabIdsRef = useRef<Set<string>>(new Set());
  const getNodeChangeCallback = useCallback(
    (tabId: string) => {
      if (!nodeChangeCallbacksRef.current[tabId]) {
        nodeChangeCallbacksRef.current[tabId] = (nodeType: ResponseNodeType) =>
          setActiveResponseNodeForTab(tabId, nodeType);
      }
      return nodeChangeCallbacksRef.current[tabId];
    },
    [setActiveResponseNodeForTab],
  );
  const getPanelScrollCallback = useCallback(
    (tabId: string) => {
      if (!panelScrollCallbacksRef.current[tabId]) {
        panelScrollCallbacksRef.current[tabId] = (scrollTop: number) =>
          setResponsePanelScrollForTab(tabId, scrollTop);
      }
      return panelScrollCallbacksRef.current[tabId];
    },
    [setResponsePanelScrollForTab],
  );
  const getNodeScrollCallback = useCallback(
    (tabId: string) => {
      if (!nodeScrollCallbacksRef.current[tabId]) {
        nodeScrollCallbacksRef.current[tabId] = (nodeKey: string, scrollTop: number) =>
          setResponseNodeScrollForTab(tabId, nodeKey, scrollTop);
      }
      return nodeScrollCallbacksRef.current[tabId];
    },
    [setResponseNodeScrollForTab],
  );

  // Update the active tab ID in response store when the panel tab changes
  useEffect(() => {
    if (activeTabId) setActiveTabId(activeTabId);
  }, [activeTabId, setActiveTabId]);

  // Hydrate response panel from the tab content once on first open/load.
  // Guarded per-tab so switching tabs does not re-fetch/re-parse repeatedly.
  useEffect(() => {
    if (!activeTabId || !activeTab || activeTab.type !== "document") return;
    if (hasAnyResponse(responses[activeTabId])) return;
    if (hydratedFromFileTabIdsRef.current.has(activeTabId)) return;

    hydratedFromFileTabIdsRef.current.add(activeTabId);

    let cancelled = false;
    void (async () => {
      try {
        const tabContent = await window.electron?.tab?.getContent(activeTab as any);
        if (cancelled || tabContent?.type !== "document") return;
        const markdown = tabContent?.content;
        if (typeof markdown !== "string" || !markdown.trim()) return;

        const schema = getSchema(voidenExtensions);
        const parsed = parseMarkdown(markdown, schema) as any;
        const nodes = Array.isArray(parsed?.content) ? parsed.content : [];
        const responseDoc = nodes.find((node: any) => node?.type === "response-doc") ?? null;
        if (!responseDoc) return;

        hydrateResponse(activeTabId, responseDoc, null);
      } catch {
        // Best-effort hydration; ignore parse/read errors.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTabId, activeTab, responses, hydrateResponse]);

  // When the active tab receives a response, add it to the keep-alive cache (LRU, max 8)
  useEffect(() => {
    if (!activeTabId || !hasAnyResponse(responses[activeTabId])) return;
    setCachedResponseTabIds((prev) => {
      const without = prev.filter((id) => id !== activeTabId);
      const next = [...without, activeTabId];
      return next.length > MAX_CACHED_RESPONSE_VIEWERS
        ? next.slice(next.length - MAX_CACHED_RESPONSE_VIEWERS)
        : next;
    });
  }, [activeTabId, responses]);

  // Evict cached viewers whose tabs have been closed
  useEffect(() => {
    const openTabIds = new Set((panelData?.tabs || []).map((tab: any) => tab.id));
    setCachedResponseTabIds((prev) => {
      const next = prev.filter((id) => openTabIds.has(id));
      return next.length === prev.length ? prev : next;
    });

    // Drop stale callback refs for tabs that are no longer open.
    Object.keys(nodeChangeCallbacksRef.current).forEach((tabId) => {
      if (!openTabIds.has(tabId)) delete nodeChangeCallbacksRef.current[tabId];
    });
    Object.keys(panelScrollCallbacksRef.current).forEach((tabId) => {
      if (!openTabIds.has(tabId)) delete panelScrollCallbacksRef.current[tabId];
    });
    Object.keys(nodeScrollCallbacksRef.current).forEach((tabId) => {
      if (!openTabIds.has(tabId)) delete nodeScrollCallbacksRef.current[tabId];
    });
  }, [panelData?.tabs]);

  // Active tab's response data — now supports multiple sections per tab
  const tabSections = activeTabId ? responses[activeTabId] : null;
  const sectionResponses = useMemo(() => {
    if (!tabSections) return [];
    return Object.entries(tabSections)
      .map(([key, response]) => ({
        sectionIndex: Number(key),
        response,
      }))
      .sort((a, b) => a.sectionIndex - b.sectionIndex);
  }, [tabSections]);

  // Auto-expand the section that just received a new response.
  // Track response doc references to detect which section changed.
  const prevSectionDocsRef = useRef<Record<string, Record<number, any>>>({});
  useEffect(() => {
    if (!activeTabId || !tabSections) return;

    const prevDocs = prevSectionDocsRef.current[activeTabId] || {};
    const currentKeys = Object.keys(tabSections).map(Number);

    // Find which section just received a new/updated response
    let changedKey: number | null = null;
    for (const key of currentKeys) {
      const currentDoc = tabSections[key]?.responseDoc;
      const prevDoc = prevDocs[key];
      if (currentDoc && currentDoc !== prevDoc) {
        changedKey = key;
      }
    }

    // For regular sections, collapse all others and expand only the changed one
    if (changedKey !== null && currentKeys.length > 1) {
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        for (const key of currentKeys) {
          const collapseKey = `${activeTabId}:${key}`;
          if (key === changedKey) {
            next.delete(collapseKey); // expand
          } else {
            next.add(collapseKey); // collapse
          }
        }
        // Also collapse stitch section when focusing on new request
        if (hasStitchResults) {
          next.add(`${activeTabId}:stitch`);
        }
        return next;
      });
    } else if (changedKey !== null) {
      // Single section — just make sure it's expanded
      setCollapsedSections((prev) => {
        const collapseKey = `${activeTabId}:${changedKey}`;
        if (!prev.has(collapseKey)) return prev;
        const next = new Set(prev);
        next.delete(collapseKey);
        return next;
      });
    }

    // Snapshot current docs for next comparison
    const snapshot: Record<number, any> = {};
    for (const key of currentKeys) {
      snapshot[key] = tabSections[key]?.responseDoc;
    }
    prevSectionDocsRef.current[activeTabId] = snapshot;
  }, [activeTabId, tabSections]);

  // Latest response — most recently updated section
  const latestResponse = useMemo(() => {
    if (sectionResponses.length === 0) return null;
    return sectionResponses[sectionResponses.length - 1].response;
  }, [sectionResponses]);

  const responseDoc = latestResponse?.responseDoc ?? null;
  const error = latestResponse?.error ?? null;

  // Extract status info from response document attrs for top bar
  const statusInfo = useMemo(() => {
    if (!responseDoc?.attrs) return null;
    return {
      statusCode: responseDoc.attrs.statusCode,
      statusMessage: responseDoc.attrs.statusMessage,
      elapsedTime: responseDoc.attrs.elapsedTime,
      wsId: responseDoc.attrs.wsId,
      grpcId: responseDoc.attrs.grpcId,
      url: responseDoc.attrs.url,
      requestMeta: responseDoc.attrs.requestMeta,
      protocol: responseDoc.attrs.protocol,
      sectionIndex: responseDoc.attrs.sectionIndex,
      sectionColorIndex: responseDoc.attrs.sectionColorIndex,
      sectionLabel: responseDoc.attrs.sectionLabel,
    };
  }, [responseDoc]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const isWssOrGrpc = statusInfo && (statusInfo.protocol === "wss" || statusInfo.protocol === "grpc");

  // Track live WSS connection state for the top bar status tag
  const [wsConnectedIds, setWsConnectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const electron = (window as any).electron;
    const listen = electron?.request?.listenSecure ?? electron?.request?.listen;
    if (!listen) return;
    const offOpen = listen('ws-open', (_e: any, d: any) => {
      if (d?.wsId) setWsConnectedIds((s) => { const n = new Set(s); n.add(d.wsId); return n; });
    });
    const offClose = listen('ws-close', (_e: any, d: any) => {
      if (d?.wsId) setWsConnectedIds((s) => { const n = new Set(s); n.delete(d.wsId); return n; });
    });
    const offError = listen('ws-error', (_e: any, d: any) => {
      if (d?.wsId && d?.code !== 'CLEANUP_WARNING') setWsConnectedIds((s) => { const n = new Set(s); n.delete(d.wsId); return n; });
    });
    return () => { offOpen?.(); offClose?.(); offError?.(); };
  }, []);
  const isSuccess =
    statusInfo && typeof statusInfo.statusCode === "number" && statusInfo.statusCode >= 200 && statusInfo.statusCode < 300;
  const isError =
    statusInfo &&
    ((typeof statusInfo.statusCode === "number" && statusInfo.statusCode >= 400) ||
      (isWssOrGrpc && !isSuccess));

  const showContent = !isLoading && !error && !!responseDoc;
  const showEmpty = !isLoading && !error && !responseDoc;
  const showError = !isLoading && !!error;

  const containerRef = useRef<HTMLDivElement>(null);

  // --- Unified find for response panel ---
  const [showResponseFind, setShowResponseFind] = useState(false);
  const [responseFindTerm, setResponseFindTerm] = useState("");
  const [responseMatchCase, setResponseMatchCase] = useState(false);
  const [responseCurrentMatch, setResponseCurrentMatch] = useState(-1);
  const responseFindInputRef = useRef<HTMLInputElement>(null);

  type ResponseMatch = { cmView: CMEditorView; from: number; to: number };
  const [responseMatches, setResponseMatches] = useState<ResponseMatch[]>([]);

  // Collect all visible CM views in the response panel
  const getResponseCmViews = useCallback((): CMEditorView[] => {
    const el = containerRef.current;
    if (!el) return [];
    const views: CMEditorView[] = [];
    const cmEditors = el.querySelectorAll('.cm-editor');
    for (const cmEl of cmEditors) {
      const htmlEl = cmEl as HTMLElement & { cmView?: CMEditorView };
      if (htmlEl.offsetParent === null) continue;
      if (htmlEl.cmView) views.push(htmlEl.cmView);
    }
    return views;
  }, []);

  // Build matches across all CM views in the response panel
  const recalcResponseMatches = useCallback(() => {
    if (!responseFindTerm) {
      setResponseMatches([]);
      setResponseCurrentMatch(-1);
      // Clear all highlights
      for (const cmView of getResponseCmViews()) {
        cmView.dispatch({
          effects: unifiedSearchHighlight.of({ ranges: [], currentIndex: -1 }),
        });
      }
      return;
    }

    const pattern = escapeRegExp(responseFindTerm);
    const flags = responseMatchCase ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      setResponseMatches([]);
      setResponseCurrentMatch(-1);
      return;
    }

    const allMatches: ResponseMatch[] = [];
    const cmViews = getResponseCmViews();

    for (const cmView of cmViews) {
      const text = cmView.state.doc.toString();
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        allMatches.push({ cmView, from: m.index, to: m.index + m[0].length });
        if (m.index === regex.lastIndex) regex.lastIndex++;
      }
    }

    setResponseMatches(allMatches);
    setResponseCurrentMatch(allMatches.length > 0 ? 0 : -1);

    // Dispatch highlights per CM view
    const grouped = new Map<CMEditorView, Array<{ from: number; to: number; globalIdx: number }>>();
    allMatches.forEach((match, idx) => {
      let group = grouped.get(match.cmView);
      if (!group) { group = []; grouped.set(match.cmView, group); }
      group.push({ from: match.from, to: match.to, globalIdx: idx });
    });

    for (const cmView of cmViews) {
      const group = grouped.get(cmView);
      if (!group) {
        cmView.dispatch({ effects: unifiedSearchHighlight.of({ ranges: [], currentIndex: -1 }) });
      } else {
        const currentGlobalIdx = allMatches.length > 0 ? 0 : -1;
        const localCurrentIdx = group.findIndex(g => g.globalIdx === currentGlobalIdx);
        cmView.dispatch({
          effects: unifiedSearchHighlight.of({
            ranges: group.map(g => ({ from: g.from, to: g.to })),
            currentIndex: localCurrentIdx,
          }),
        });
      }
    }
  }, [responseFindTerm, responseMatchCase, getResponseCmViews]);

  useEffect(() => {
    recalcResponseMatches();
  }, [responseFindTerm, responseMatchCase]);

  const navigateResponseMatch = useCallback((matchIndex: number) => {
    if (matchIndex < 0 || matchIndex >= responseMatches.length) return;
    const match = responseMatches[matchIndex];
    setResponseCurrentMatch(matchIndex);

    // Select in the CM view (don't focus — keep focus in find input)
    match.cmView.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true,
    });

    // Scroll the CM editor's parent into view
    const cmDom = match.cmView.dom.closest('.cm-editor') as HTMLElement | null;
    if (cmDom) cmDom.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // Update highlights to show current match
    const cmViews = getResponseCmViews();
    const grouped = new Map<CMEditorView, Array<{ from: number; to: number; globalIdx: number }>>();
    responseMatches.forEach((m, idx) => {
      let group = grouped.get(m.cmView);
      if (!group) { group = []; grouped.set(m.cmView, group); }
      group.push({ from: m.from, to: m.to, globalIdx: idx });
    });

    for (const cmView of cmViews) {
      const group = grouped.get(cmView);
      if (!group) {
        cmView.dispatch({ effects: unifiedSearchHighlight.of({ ranges: [], currentIndex: -1 }) });
      } else {
        const localCurrentIdx = group.findIndex(g => g.globalIdx === matchIndex);
        cmView.dispatch({
          effects: unifiedSearchHighlight.of({
            ranges: group.map(g => ({ from: g.from, to: g.to })),
            currentIndex: localCurrentIdx,
          }),
        });
      }
    }
  }, [responseMatches, getResponseCmViews]);

  const closeResponseFind = useCallback(() => {
    setShowResponseFind(false);
    setResponseFindTerm("");
    setResponseMatches([]);
    setResponseCurrentMatch(-1);
    for (const cmView of getResponseCmViews()) {
      cmView.dispatch({
        effects: unifiedSearchHighlight.of({ ranges: [], currentIndex: -1 }),
      });
    }
  }, [getResponseCmViews]);

  // Intercept Cmd+F / Ctrl+F to open unified find in response panel
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setShowResponseFind(true);
        setTimeout(() => responseFindInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && showResponseFind) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeResponseFind();
      }
    };

    // Use capture phase so we intercept before CodeMirror's own Mod-f handler
    el.addEventListener('keydown', handleKeyDown, true);
    return () => el.removeEventListener('keydown', handleKeyDown, true);
  }, [showResponseFind, closeResponseFind]);

  return (
    <div
      ref={containerRef}
      className="h-full bg-bg flex flex-col response-panel-root"
      tabIndex={-1}
    >
      {/* Sticky top bar — only rendered when there is something to show */}
      {(isLoading || showError || (showContent && statusInfo && (statusInfo.protocol === "wss" || statusInfo.protocol === "ws") && statusInfo.wsId)) && <div className="flex items-center h-10 border-b border-border px-3 flex-shrink-0 bg-bg gap-3 font-mono text-sm">
        {/* Loading indicator */}
        {isLoading && (
          <span className="text-comment text-xs">Loading...</span>
        )}

        {/* Error */}
        {showError && (
          <>
            <div className="size-2 rounded-full bg-red-500" />
            <span className="text-red-500 font-semibold text-xs">Failed</span>
          </>
        )}

        {/* WSS connection status */}
        {showContent && statusInfo && (statusInfo.protocol === "wss" || statusInfo.protocol === "ws") && statusInfo.wsId && (
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div className={`size-2 rounded-full ${wsConnectedIds.has(statusInfo.wsId) ? 'bg-green-500' : 'bg-border'}`} />
            <span className="font-bold font-mono text-xs">
              {wsConnectedIds.has(statusInfo.wsId) ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}
      </div>}

      {/* Hidden — mounts SendRequestButton for Cmd+Enter hotkey registration */}
      {isVoidFile && <div className="hidden"><SendRequestButton /></div>}

      {/* Find bar */}
      {showResponseFind && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-panel flex-shrink-0">
          <Input
            ref={responseFindInputRef}
            type="text"
            placeholder="Find in response"
            value={responseFindTerm}
            onChange={(e) => setResponseFindTerm(e.target.value)}
            className="flex-1 h-7 text-[13px] max-w-[250px] px-2 bg-editor border-panel-border focus-visible:ring-1 focus-visible:ring-accent focus-visible:border-accent"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (responseMatches.length > 0) {
                  navigateResponseMatch((responseCurrentMatch + 1) % responseMatches.length);
                }
              } else if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                if (responseMatches.length > 0) {
                  navigateResponseMatch((responseCurrentMatch - 1 + responseMatches.length) % responseMatches.length);
                }
              } else if (e.key === 'Escape') {
                closeResponseFind();
              }
            }}
          />
          <Tip label="Match Case" side="bottom">
            <button
              className={`p-1 rounded text-xs font-mono w-6 h-6 flex items-center justify-center border ${responseMatchCase
                ? "bg-accent text-white border-accent"
                : "bg-active text-comment border-panel-border hover:text-text hover:border-accent"
                }`}
              onClick={() => setResponseMatchCase(!responseMatchCase)}
            >
              Aa
            </button>
          </Tip>
          <button
            onClick={() => {
              if (responseMatches.length > 0) {
                navigateResponseMatch((responseCurrentMatch - 1 + responseMatches.length) % responseMatches.length);
              }
            }}
            disabled={responseMatches.length === 0}
            className="p-1 rounded w-6 h-6 flex items-center justify-center border bg-active text-comment border-panel-border hover:text-text hover:border-accent disabled:opacity-40"
          >
            <ArrowUpIcon size={12} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              if (responseMatches.length > 0) {
                navigateResponseMatch((responseCurrentMatch + 1) % responseMatches.length);
              }
            }}
            disabled={responseMatches.length === 0}
            className="p-1 rounded w-6 h-6 flex items-center justify-center border bg-active text-comment border-panel-border hover:text-text hover:border-accent disabled:opacity-40"
          >
            <ArrowDownIcon size={12} strokeWidth={2} />
          </button>
          <span className="text-xs text-comment min-w-[60px] text-center">
            {responseFindTerm && responseMatches.length > 0
              ? `${responseCurrentMatch + 1} of ${responseMatches.length}`
              : responseFindTerm
                ? "No results"
                : ""}
          </span>
          <button
            onClick={closeResponseFind}
            className="p-1 rounded w-6 h-6 flex items-center justify-center border bg-active text-comment border-panel-border hover:text-text hover:border-accent"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 relative overflow-x-hidden">
        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-text" />
              <div className="text-comment text-sm">Executing request...</div>
            </div>
          </div>
        )}

        {/* Error message */}
        {showError && (
          <div className="absolute inset-0 flex items-center justify-center px-8 py-8 overflow-auto">
            <div className="max-w-2xl w-full">
              <div className="bg-editor border border-red-500/20 rounded-lg p-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-red-500 mb-3">Unable to Complete Request</h3>
                    <div className="text-text text-sm space-y-2 whitespace-pre-wrap font-mono">{error}</div>
                    <div className="mt-6 pt-4 border-t border-border">
                      <p className="text-xs text-comment mb-2 font-semibold">Troubleshooting tips:</p>
                      <ul className="text-xs text-comment space-y-1 list-disc list-inside">
                        <li>Verify the URL is correct and accessible</li>
                        <li>Check your network connection</li>
                        {statusInfo?.protocol !== "grpc" && statusInfo?.protocol !== "wss" && (
                          <li>Ensure the HTTP method is appropriate for the endpoint</li>
                        )}
                        <li>Review headers and authentication settings</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stitch results as collapsible section when there are other responses */}
        {hasStitchResults && StitchComponent && activeFilePath && (
          <div
            key="stitch-runner"
            style={{ borderLeft: "3px solid var(--accent, #7c3aed)" }}
          >
            {/* Stitch section header — clickable to collapse/expand */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg cursor-pointer hover:bg-active transition-colors select-none"
              onClick={() => toggleSectionCollapse(activeTabId || "", "stitch")}
            >
              {collapsedSections.has(`${activeTabId}:stitch`)
                ? <ChevronRight size={14} className="text-comment flex-shrink-0" />
                : <ChevronDown size={14} className="text-comment flex-shrink-0" />
              }
              <div className="size-2 rounded-full flex-shrink-0 bg-success" />
              <span className="font-mono text-xs font-bold">
                Stitch Runner
              </span>
              <span
                className="text-xs font-semibold uppercase flex-shrink-0"
                style={{ color: "var(--accent, #7c3aed)", letterSpacing: "0.5px" }}
              >
                RESULTS
              </span>
            </div>
            {/* Stitch component content — hidden when collapsed */}
            {!collapsedSections.has(`${activeTabId}:stitch`) && (
              <div className="ml-2 bg-editor">
                <StitchComponent sourceFilePath={activeFilePath} />
              </div>
            )}
          </div>
        )}

        {/* Empty state — when no response or stitch results */}
        {showEmpty && !hasStitchResults && (
          <div className="absolute  ml-2 inset-0 flex items-center justify-center px-4">
            <div className="text-comment text-center">
              Press{" "}
              <kbd className="px-1 py-0.5 bg-active rounded text-xs">Cmd+Enter</kbd>{" "}
              to execute a request and see the response here.
            </div>
          </div>
        )}

        {/* Stitch results now appear as response panel sections (no longer overlay) */}
        {/* Stacked response viewers — one per section, scrollable */}
        <div
          className="overflow-y-auto bg-editor"
          style={{
            visibility: showContent ? "visible" : "hidden",
            pointerEvents: showContent ? "auto" : "none",
          }}
        >
          {cachedResponseTabIds.map((tabId) => {
            const tabIsActive = tabId === activeTabId;
            const tabSectionData = responses[tabId];
            if (!tabSectionData) return null;

            const sections = Object.entries(tabSectionData)
              .map(([key, resp]) => ({ sectionIndex: Number(key), response: resp }))
              .filter((s) => s.response?.responseDoc)
              .sort((a, b) => a.sectionIndex - b.sectionIndex);

            return (
              <div
                key={tabId}
                className="h-full"
                style={{ display: tabIsActive ? "block" : "none" }}
              >
                {sections.length === 1 && !hasStitchResults ? (() => {
                  const singleDoc = sections[0].response.responseDoc;
                  const singleStatus = singleDoc?.attrs?.statusCode;
                  const singleStatusMsg = singleDoc?.attrs?.statusMessage;
                  const singleLabel = singleDoc?.attrs?.sectionLabel;
                  const singleColorIndex = singleDoc?.attrs?.sectionColorIndex ?? 0;
                  const singleUrl = singleDoc?.attrs?.url;
                  const singleElapsed = singleDoc?.attrs?.elapsedTime;
                  const singleTimestamp = sections[0].response.timestamp;
                  const singleBorderColor = getSectionBorderColor(singleColorIndex);

                  return (
                    // Single response
                    <div className="h-full flex flex-col" style={{ borderLeft: `3px solid ${singleBorderColor}` }}>
                      {/* Section header with status + search */}
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg flex-shrink-0"
                      >
                        <div
                          className="size-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: singleStatus >= 200 && singleStatus < 300
                              ? "var(--success, #4ade80)"
                              : singleStatus >= 400
                                ? "var(--error, #f87171)"
                                : "var(--warning, #facc15)",
                          }}
                        />
                        <span className="font-mono text-xs font-bold">
                          {singleStatus} {singleStatusMsg}
                        </span>
                        {singleElapsed != null && (
                          <span className="text-comment text-xs font-mono flex-shrink-0">
                            {singleElapsed < 1000 ? `${Math.round(singleElapsed)}ms` : `${(singleElapsed / 1000).toFixed(1)}s`}
                          </span>
                        )}
                        <span
                          className="text-xs font-semibold uppercase flex-shrink-0"
                          style={{ color: singleBorderColor, letterSpacing: "0.5px" }}
                        >
                          {singleLabel || "Request 1"}
                        </span>
                        <span className="text-comment text-xs truncate flex-1">
                          {singleUrl}
                        </span>
                        {singleTimestamp && (
                          <Tip label={formatAbsoluteTime(singleTimestamp)} side="bottom">
                            <span className="text-comment text-[10px] flex-shrink-0 opacity-60 cursor-default">
                              {formatRelativeTime(singleTimestamp)}
                            </span>
                          </Tip>
                        )}
                        <Tip label="Find (⌘F)" side="bottom">
                          <button
                            className="p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0"
                            onClick={() => {
                              setShowResponseFind(true);
                              setTimeout(() => responseFindInputRef.current?.focus(), 50);
                            }}
                          >
                            <Search size={14} />
                          </button>
                        </Tip>
                        <Tip label="Expand all nodes" side="bottom">
                          <button
                            className="p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0"
                            onClick={() => viewerRefs.current.get(`${tabId}:0`)?.expandAll()}
                          >
                            <ChevronsUpDown size={13} />
                          </button>
                        </Tip>
                        <Tip label="Collapse all nodes" side="bottom">
                          <button
                            className="p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0"
                            onClick={() => viewerRefs.current.get(`${tabId}:0`)?.collapseAll()}
                          >
                            <ChevronsDownUp size={13} />
                          </button>
                        </Tip>
                      </div>
                      <div className="flex-1  ml-2 overflow-hidden" >
                        <ResponseViewer
                          ref={(handle) => {
                            if (handle) viewerRefs.current.set(`${tabId}:0`, handle);
                            else viewerRefs.current.delete(`${tabId}:0`);
                          }}
                          content={sections[0].response.responseDoc}
                          preferredActiveNode={getActiveResponseNodeForTab(tabId)}
                          onActiveNodeChange={getNodeChangeCallback(tabId)}
                          panelScrollTop={getResponsePanelScrollForTab(tabId)}
                          onPanelScrollChange={getPanelScrollCallback(tabId)}
                          nodeScrollPositions={getResponseNodeScrollsForTab(tabId)}
                          onNodeScrollChange={getNodeScrollCallback(tabId)}
                          isActive={tabIsActive}
                        />
                      </div>
                    </div>
                  );
                })() : (
                  // Multiple responses — sticky toolbar + scrollable sections
                  <div className="h-full flex flex-col">
                    {/* Sticky toolbar — search then expand/collapse all requests */}
                    {sections.length > 1 && (
                      <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-border bg-bg flex-shrink-0">
                        <Tip label="Find (⌘F)" side="bottom">
                          <button
                            className="p-1.5 text-comment hover:text-text transition-colors rounded"
                            onClick={() => {
                              setShowResponseFind(true);
                              setTimeout(() => responseFindInputRef.current?.focus(), 50);
                            }}
                          >
                            <Search size={13} />
                          </button>
                        </Tip>
                        <Tip label="Expand all requests" side="bottom">
                          <button
                            className="p-1.5 text-comment hover:text-text transition-colors rounded"
                            onClick={() => activeTabId && expandAllSections(activeTabId, sections.map((s) => s.sectionIndex))}
                          >
                            <ChevronsUpDown size={13} />
                          </button>
                        </Tip>
                        <Tip label="Collapse all requests" side="bottom">
                          <button
                            className="p-1.5 text-comment hover:text-text transition-colors rounded"
                            onClick={() => activeTabId && collapseAllSections(activeTabId, sections.map((s) => s.sectionIndex))}
                          >
                            <ChevronsDownUp size={13} />
                          </button>
                        </Tip>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto">
                      {sections.map(({ sectionIndex, response }) => {
                        const doc = response.responseDoc;
                        const colorIndex = doc?.attrs?.sectionColorIndex ?? sectionIndex;
                        const label = doc?.attrs?.sectionLabel;
                        const status = doc?.attrs?.statusCode;
                        const statusMsg = doc?.attrs?.statusMessage;
                        const elapsed = doc?.attrs?.elapsedTime;
                        const timestamp = response.timestamp;
                        const borderColor = getSectionBorderColor(colorIndex);

                        const isCollapsed = collapsedSections.has(`${tabId}:${sectionIndex}`);

                        return (
                          <div
                            key={sectionIndex}
                            style={{ borderLeft: `3px solid ${borderColor}` }}
                          >
                            {/* Section header — clickable to collapse/expand */}
                            <div
                              className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg cursor-pointer hover:bg-active transition-colors select-none"
                              onClick={() => toggleSectionCollapse(tabId, sectionIndex)}
                            >
                              {isCollapsed
                                ? <ChevronRight size={14} className="text-comment flex-shrink-0" />
                                : <ChevronDown size={14} className="text-comment flex-shrink-0" />
                              }
                              <div
                                className="size-2 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: status >= 200 && status < 300
                                    ? "var(--success, #4ade80)"
                                    : status >= 400
                                      ? "var(--error, #f87171)"
                                      : "var(--warning, #facc15)",
                                }}
                              />
                              <span className="font-mono text-xs font-bold">
                                {status} {statusMsg}
                              </span>
                              {elapsed != null && (
                                <span className="text-comment text-xs font-mono flex-shrink-0">
                                  {elapsed < 1000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1000).toFixed(1)}s`}
                                </span>
                              )}
                              <span
                                className="text-xs font-semibold uppercase flex-shrink-0"
                                style={{ color: borderColor, letterSpacing: "0.5px" }}
                              >
                                {label || "Request"}
                              </span>
                              <span className="text-comment text-xs truncate flex-1">
                                {doc?.attrs?.url}
                              </span>
                              {timestamp && (
                                <Tip label={formatAbsoluteTime(timestamp)} side="bottom">
                                  <span className="text-comment text-[10px] flex-shrink-0 opacity-60 cursor-default">
                                    {formatRelativeTime(timestamp)}
                                  </span>
                                </Tip>
                              )}
                              <Tip label="Find in this response" side="bottom">
                                <button
                                  className="p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Expand the section first if collapsed
                                    if (isCollapsed) {
                                      toggleSectionCollapse(tabId, sectionIndex);
                                    }
                                    setShowResponseFind(true);
                                    setTimeout(() => responseFindInputRef.current?.focus(), 50);
                                  }}
                                >
                                  <Search size={12} />
                                </button>
                              </Tip>
                              <Tip label="Expand all nodes" side="bottom">
                                <button
                                  className="p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0"
                                  onClick={(e) => { e.stopPropagation(); viewerRefs.current.get(`${tabId}:${sectionIndex}`)?.expandAll(); }}
                                >
                                  <ChevronsUpDown size={12} />
                                </button>
                              </Tip>
                              <Tip label="Collapse all nodes" side="bottom">
                                <button
                                  className="p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0"
                                  onClick={(e) => { e.stopPropagation(); viewerRefs.current.get(`${tabId}:${sectionIndex}`)?.collapseAll(); }}
                                >
                                  <ChevronsDownUp size={12} />
                                </button>
                              </Tip>
                            </div>
                            {/* Response content — hidden when collapsed */}
                            {!isCollapsed && (
                              <div className="flex-1  ml-2 overflow-hidden" >
                                <ResponseViewer
                                  ref={(handle) => {
                                    if (handle) viewerRefs.current.set(`${tabId}:${sectionIndex}`, handle);
                                    else viewerRefs.current.delete(`${tabId}:${sectionIndex}`);
                                  }}
                                  content={doc}
                                  preferredActiveNode={getActiveResponseNodeForTab(tabId)}
                                  onActiveNodeChange={getNodeChangeCallback(tabId)}
                                  isActive={tabIsActive}
                                />
                              </div>

                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
