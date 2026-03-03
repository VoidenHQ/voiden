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
import { ResponseViewer } from "./ResponseViewer";
import { useMemo, useEffect, useCallback, useState, useRef } from "react";
import { Shield } from "lucide-react";
import { useGetPanelTabs } from "@/core/layout/hooks";

const MAX_CACHED_RESPONSE_VIEWERS = 8;

export function ResponsePanelContainer() {
  // Get the active tab from the main panel
  const { data: panelData } = useGetPanelTabs("main");
  const activeTabId = panelData?.activeTabId;
  const activeTab = panelData?.tabs?.find((tab) => tab.id === activeTabId);
  const isVoidFile = activeTab?.title?.endsWith(".void") ?? false;

  const {
    isLoading,
    responses,
    setActiveTabId,
    getActiveResponseNodeForTab,
    setActiveResponseNodeForTab,
    getResponsePanelScrollForTab,
    setResponsePanelScrollForTab,
    getResponseNodeScrollsForTab,
    setResponseNodeScrollForTab,
  } = useResponseStore();

  // Keep-alive: ordered list of tab IDs that have a mounted ResponseViewer
  const [cachedResponseTabIds, setCachedResponseTabIds] = useState<string[]>([]);

  // Stable per-tab onActiveNodeChange callbacks — avoids recreating TipTap editors on re-render
  const nodeChangeCallbacksRef = useRef<Record<string, (nodeType: ResponseNodeType) => void>>({});
  const panelScrollCallbacksRef = useRef<Record<string, (scrollTop: number) => void>>({});
  const nodeScrollCallbacksRef = useRef<Record<string, (nodeKey: string, scrollTop: number) => void>>({});
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

  // When the active tab receives a response, add it to the keep-alive cache (LRU, max 8)
  useEffect(() => {
    if (!activeTabId || !responses[activeTabId]?.responseDoc) return;
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
  }, [panelData?.tabs]);

  // Active tab's response data
  const tabResponse = activeTabId ? responses[activeTabId] : null;
  const responseDoc = tabResponse?.responseDoc ?? null;
  const error = tabResponse?.error ?? null;

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
    };
  }, [responseDoc]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const isWssOrGrpc = statusInfo && (statusInfo.protocol === "wss" || statusInfo.protocol === "grpc");
  const isSuccess =
    statusInfo && typeof statusInfo.statusCode === "number" && statusInfo.statusCode >= 200 && statusInfo.statusCode < 300;
  const isError =
    statusInfo &&
    ((typeof statusInfo.statusCode === "number" && statusInfo.statusCode >= 400) ||
      (isWssOrGrpc && !isSuccess));

  const showContent = !isLoading && !error && !!responseDoc;
  const showEmpty = !isLoading && !error && !responseDoc;
  const showError = !isLoading && !!error;

  return (
    <div className="h-full bg-bg flex flex-col">
      {/* Sticky top bar */}
      <div className="flex items-center justify-between h-10 border-b border-border px-3 flex-shrink-0 bg-bg">
        <div className="flex items-center space-x-3 font-mono text-sm min-w-0 flex-1">
          {/* Loading / empty */}
          {(isLoading || showEmpty) && (
            <span className="text-comment">Response</span>
          )}

          {/* Error */}
          {showError && (
            <>
              <div className="size-2 rounded-full bg-red-500" />
              <span className="text-red-500 font-semibold">Request Failed</span>
            </>
          )}

          {/* Success / content status */}
          {showContent &&
            statusInfo &&
            statusInfo.protocol !== "wss" &&
            statusInfo.protocol !== "grpc" &&
            statusInfo.protocol !== "graphql-subscription" && (
              <>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <div
                    className={`size-2 rounded-full ${
                      isSuccess ? "bg-green-500" : isError ? "bg-red-500" : "bg-yellow-500"
                    }`}
                  />
                  <span className="font-bold">
                    {statusInfo.statusCode} {statusInfo.statusMessage}
                  </span>
                </div>

                {!responseDoc.wsId && (
                  <span className="text-comment flex-shrink-0">{formatTime(statusInfo.elapsedTime)}</span>
                )}

                {statusInfo.requestMeta?.proxy && (
                  <div
                    className="flex items-center space-x-1 flex-shrink-0"
                    style={{ color: "var(--icon-primary)" }}
                    title={`Via proxy: ${statusInfo.requestMeta.proxy.name} (${statusInfo.requestMeta.proxy.host}:${statusInfo.requestMeta.proxy.port})`}
                  >
                    <Shield className="size-3.5" />
                    <span className="text-xs">Proxy</span>
                  </div>
                )}

                {statusInfo.url && (
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <span className="text-comment text-xs whitespace-nowrap">{statusInfo.url}</span>
                  </div>
                )}
              </>
            )}
        </div>
        {isVoidFile && <SendRequestButton />}
      </div>

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden">
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

        {/* Empty state */}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <div className="text-comment text-center">
              Press{" "}
              <kbd className="px-1 py-0.5 bg-active rounded text-xs">Cmd+Enter</kbd>{" "}
              to execute a request and see the response here.
            </div>
          </div>
        )}

        {/* Keep-alive response viewers — always mounted for cached tabs, shown/hidden via CSS */}
        <div
          className="absolute inset-0 overflow-auto bg-editor"
          style={{
            visibility: showContent ? "visible" : "hidden",
            pointerEvents: showContent ? "auto" : "none",
          }}
        >
          {cachedResponseTabIds.map((tabId) => (
            <div
              key={tabId}
              className="h-full"
              style={{ display: tabId === activeTabId ? "block" : "none" }}
            >
              <ResponseViewer
                content={responses[tabId]?.responseDoc}
                preferredActiveNode={getActiveResponseNodeForTab(tabId)}
                onActiveNodeChange={getNodeChangeCallback(tabId)}
                panelScrollTop={getResponsePanelScrollForTab(tabId)}
                onPanelScrollChange={getPanelScrollCallback(tabId)}
                nodeScrollPositions={getResponseNodeScrollsForTab(tabId)}
                onNodeScrollChange={getNodeScrollCallback(tabId)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
