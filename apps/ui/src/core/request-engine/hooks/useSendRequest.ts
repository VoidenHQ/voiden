/**
 * useSendRestRequest Hook
 *
 * Handles sending HTTP/REST requests from the editor content
 */

import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { useGetActiveDocument } from "@/core/documents/hooks";
import { useActiveEnvironment } from "@/core/environment/hooks";
import { usePanelStore } from "@/core/stores/panelStore";
import { useResponseStore } from "../stores/responseStore";
import { mapErrorToMessage } from "../utils/errorMessages";
import { requestOrchestrator } from "../requestOrchestrator";
import { toast } from "@/core/components/ui/sonner";

export const  useSendRestRequest = (editor: Editor) => {
  const { data: activeDocument } = useGetActiveDocument();
  const { openRightPanel } = usePanelStore();
  const activeEnv = useActiveEnvironment();
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const context = useQuery({
    queryKey: ["request", activeDocument?.id],
    queryFn: async () => {
      const wasPanelOpen = usePanelStore.getState().rightPanelOpen;
      openRightPanel();
      if (!wasPanelOpen) {
        // Panel was freshly opened — switch to the first (response) tab
        try {
          const tabs = await (window as any).electron?.sidebar?.getTabs?.("right");
          const firstTab = (tabs?.tabs as any[] | undefined)?.[0];
          if (firstTab) {
            await (window as any).electron?.sidebar?.activateTab?.("right", firstTab.id);
            queryClient.invalidateQueries({ queryKey: ["sidebar:tabs", "right"] });
          }
        } catch { /* best-effort */ }
      }
      if (activeDocument?.id) {
        useResponseStore.getState().setActiveResponseNodeForTab(activeDocument.id, "response-body");
      }
      useResponseStore.getState().setLoading(true, activeDocument?.id);
      abortControllerRef.current = new AbortController();
      try {
        const showScriptToastIfNeeded = (message: string) => {
          const isScriptCancel = message.includes("Request cancelled by pre-request script");
          const isScriptError =
            message.includes("Pre-request script error:") ||
            message.includes("Script validation failed") ||
            message.includes("Pre-request script blocked");

          if (isScriptCancel) {
            toast.error("Pre-request script cancelled request", {
              description: message,
              duration: 5000,
              closeButton: true,
            });
          } else if (isScriptError) {
            toast.error("Pre-request script error", {
              description: message,
              duration: 6000,
              closeButton: true,
            });
          }
        };

        // Use the orchestrator which will invoke plugin handlers for building and processing
        const response = await requestOrchestrator.executeRequest(
          editor,
          activeEnv,
          abortControllerRef.current.signal
        );

        // sendRequestHybrid returns error responses instead of throwing.
        // Handle script-related errors here so user still sees toast.
        if (response?.error && typeof response.error === "string") {
          showScriptToastIfNeeded(response.error);
        }

        queryClient.invalidateQueries({ queryKey: ["void-variable-keys"] });
        queryClient.invalidateQueries({ queryKey: ["void-variable-data"] });
        return response;
      } catch (error) {
        const friendlyMessage = mapErrorToMessage(error);
        useResponseStore.getState().setError(activeDocument?.id || null, friendlyMessage);

        const rawMessage = error instanceof Error ? error.message : String(error);
        const isScriptCancel = rawMessage.includes("Request cancelled by pre-request script");
        const isScriptError =
          rawMessage.includes("Pre-request script error:") ||
          rawMessage.includes("Script validation failed") ||
          rawMessage.includes("Pre-request script blocked");

        if (isScriptCancel) {
          toast.error("Pre-request script cancelled request", {
            description: rawMessage,
            duration: 5000,
            closeButton: true,
          });
        } else if (isScriptError) {
          toast.error("Pre-request script error", {
            description: rawMessage,
            duration: 6000,
            closeButton: true,
          });
        }

        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Request was cancelled");
        }

        throw error;
      }
    },
    enabled: false, // Manual trigger only
  });

  return {
    ...context,
    cancelRequest: () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    },
  };
};
