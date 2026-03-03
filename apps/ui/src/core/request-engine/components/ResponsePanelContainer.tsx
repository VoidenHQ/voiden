/**
 * Response Panel Container
 *
 * Displays HTTP responses as a read-only Voiden viewer with response nodes
 * Layout: Sticky top bar with status | Scrollable middle content | Bottom bar (handled elsewhere)
 */

import { useResponseStore } from "../stores/responseStore";
import { SendRequestButton } from "./SendRequestButton";
import { ResponseViewer } from "./ResponseViewer";
import { useMemo, useEffect } from "react";
import { Shield } from "lucide-react";
import { useGetPanelTabs } from "@/core/layout/hooks";

export function ResponsePanelContainer() {
  // Get the active tab from the main panel
  const { data: panelData } = useGetPanelTabs("main");
  const activeTabId = panelData?.activeTabId;

  // Check if the active tab is a .void file
  const activeTab = panelData?.tabs?.find((tab) => tab.id === activeTabId);
  const isVoidFile = activeTab?.title?.endsWith(".void") ?? false;

  const { isLoading, setActiveTabId, getResponse } = useResponseStore();

  // Update the active tab ID in response store when the panel tab changes
  useEffect(() => {
    if (activeTabId) {
      setActiveTabId(activeTabId);
    }
  }, [activeTabId, setActiveTabId]);

  // Get response for the current active tab
  const tabResponse = activeTabId ? getResponse(activeTabId) : null;
  const responseDoc = tabResponse?.responseDoc || null;
  const error = tabResponse?.error || null;

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
      protocol: responseDoc.attrs.protocol, // 'wss', 'grpc', or undefined for regular HTTP
    };
  }, [responseDoc]);

  // Format elapsed time with 2 decimal places
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="h-full bg-bg flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between h-10 border-b border-border px-3 flex-shrink-0">
          <div className="flex items-center space-x-2 font-mono text-sm text-comment">
            Response
          </div>
          {isVoidFile && <SendRequestButton />}
        </div>

        {/* Loading indicator */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-text"></div>
            <div className="text-comment text-sm">Executing request...</div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="h-full bg-bg flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between h-10 border-b border-border px-3 flex-shrink-0">
          <div className="flex items-center space-x-2 font-mono text-sm">
            <div className="size-2 rounded-full bg-red-500" />
            <span className="text-red-500 font-semibold">Request Failed</span>
          </div>
          {isVoidFile && <SendRequestButton />}
        </div>

        {/* Error message */}
        <div className="flex-1 flex items-center justify-center px-8 py-8 overflow-auto">
          <div className="max-w-2xl w-full">
            <div className="bg-editor border border-red-500/20 rounded-lg p-6">
              {/* Error icon */}
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>

                {/* Error content */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-red-500 mb-3">
                    Unable to Complete Request
                  </h3>

                  <div className="text-text text-sm space-y-2 whitespace-pre-wrap font-mono">
                    {error}
                  </div>

                  {/* Troubleshooting tips */}
                  <div className="mt-6 pt-4 border-t border-border">
                    <p className="text-xs text-comment mb-2 font-semibold">
                      Troubleshooting tips:
                    </p>
                    <ul className="text-xs text-comment space-y-1 list-disc list-inside">
                      <li>Verify the URL is correct and accessible</li>
                      <li>Check your network connection</li>
                      {statusInfo?.protocol !== 'grpc' && statusInfo?.protocol !== 'wss' && (
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
      </div>
    );
  }

  // Show empty state
  if (!responseDoc) {
    return (
      <div className="h-full bg-bg flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between h-10 border-b border-border px-3 flex-shrink-0">
          <div className="flex items-center space-x-2 font-mono text-sm text-comment">
            Response
          </div>
          {isVoidFile && <SendRequestButton />}
        </div>

        {/* Middle content */}
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-comment text-center">
            Press <kbd className="px-1 py-0.5 bg-active rounded text-xs">Cmd+Enter</kbd> to execute a request and see the response here.
          </div>
        </div>
      </div>
    );
  }

  // For WSS/gRPC connections, status code might be 0 or 'ok'
  // If status code is not a valid 2xx, treat as error
  const isWssOrGrpc = statusInfo && (statusInfo.protocol === 'wss' || statusInfo.protocol === 'grpc');
  const isSuccess = statusInfo && typeof statusInfo.statusCode === 'number' && statusInfo.statusCode >= 200 && statusInfo.statusCode < 300;
  const isError = statusInfo && (
    (typeof statusInfo.statusCode === 'number' && statusInfo.statusCode >= 400) ||
    (isWssOrGrpc && !isSuccess)  // For WSS/gRPC, if not success (2xx), treat as error
  );

  return (
    <div className="h-full bg-bg flex flex-col">
      {/* Sticky top bar - Status summary */}
    
          <div className="flex items-center justify-between h-10 border-b border-border px-3 flex-shrink-0 bg-bg">
            <div className="flex items-center space-x-3 font-mono text-sm min-w-0 flex-1">
              {statusInfo && statusInfo.protocol !== 'wss' && statusInfo.protocol !== 'grpc' && !(statusInfo.protocol === 'graphql-subscription' ) && (
                <>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <div
                      className={`size-2 rounded-full ${isSuccess ? "bg-green-500" : isError ? "bg-red-500" : "bg-yellow-500"
                        }`}
                    />
                    <span className="font-bold">
                      {statusInfo.statusCode} {statusInfo.statusMessage}
                    </span>
                  </div>
                  
                  {
                    !responseDoc.wsId && (<span className="text-comment flex-shrink-0">{formatTime(statusInfo.elapsedTime)}</span>)
                  }


                  {/* Proxy indicator */}
                  {statusInfo.requestMeta?.proxy && (
                    <div
                      className="flex items-center space-x-1 flex-shrink-0"
                      style={{ color: 'var(--icon-primary)' }}
                      title={`Via proxy: ${statusInfo.requestMeta.proxy.name} (${statusInfo.requestMeta.proxy.host}:${statusInfo.requestMeta.proxy.port})`}
                    >
                      <Shield className="size-3.5" />
                      <span className="text-xs">Proxy</span>
                    </div>
                  )}

                  {/* URL - scrollable */}
                  {statusInfo.url && (
                    <div className="min-w-0 flex-1 overflow-x-auto">
                      <span className="text-comment text-xs whitespace-nowrap">
                        {statusInfo.url}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            {isVoidFile && <SendRequestButton />}
          </div>
       

      {/* Scrollable middle layer - Response content */}
      <div className="flex-1 overflow-auto bg-editor">
        <ResponseViewer content={responseDoc} tabId={activeTabId!} />
      </div>
    </div>
  );
}
