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
import { getResponsePanelPosition } from "@/core/stores/responsePanelPosition";
import { useResponseStore } from "../stores/responseStore";
import { mapErrorToMessage } from "../utils/errorMessages";
import { requestOrchestrator } from "../requestOrchestrator";
import { toast } from "@/core/components/ui/sonner";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { expandLinkedFilesInDoc } from "@/core/editors/voiden/utils/expandLinkedBlocks";

export const useSendRestRequest = (_editor: Editor) => {
  // Always use the main VoidenEditor, not the passed editor.
  // This is critical for imported/linked blocks whose editor prop
  // points to the linked block's sub-editor, not the main document.
  const editor = useVoidenEditorStore((state) => state.editor) ?? _editor;
  const { data: activeDocument } = useGetActiveDocument();
  const { openRightPanel } = usePanelStore();
  const activeEnv = useActiveEnvironment();
  const abortControllerRef = useRef<AbortController | null>(null);
  const sectionIndexOverrideRef = useRef<number | undefined>(undefined);
  const queryClient = useQueryClient();

  /** Open the response panel and activate the response tab. */
  const showResponsePanel = async () => {
    const { setBottomActiveView, openBottomPanel, bottomPanelRef } = usePanelStore.getState();
    const responsePanelPosition = getResponsePanelPosition();

    if (responsePanelPosition === "bottom") {
      // Bottom mode: always open bottom panel and switch to sidebar view
      setBottomActiveView("sidebar");
      openBottomPanel();
      if (bottomPanelRef?.current) {
        bottomPanelRef.current.expand();
      }
    } else {
      // Right mode: open the right panel
      openRightPanel();
    }

    // Activate the first (response) sidebar tab
    try {
      const tabs = await (window as any).electron?.sidebar?.getTabs?.("right");
      const firstTab = (tabs?.tabs as any[] | undefined)?.[0];
      if (firstTab) {
        await (window as any).electron?.sidebar?.activateTab?.("right", firstTab.id);
        queryClient.invalidateQueries({ queryKey: ["sidebar:tabs", "right"] });
      }
    } catch { /* best-effort */ }
  };

  const context = useQuery({
    queryKey: ["request", activeDocument?.id],
    queryFn: async () => {
      await showResponsePanel();
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

        // Determine which section to execute.
        // If an override was set (e.g., from a play button click via refetchFromElement),
        // use it directly. Otherwise detect from DOM or ProseMirror selection.
        let sectionIndex: number | undefined = sectionIndexOverrideRef.current;
        sectionIndexOverrideRef.current = undefined; // Clear after reading

        if (sectionIndex === undefined) {
          const nodePos = editor.state.selection.$from.pos;
          sectionIndex = 0;
          editor.state.doc.forEach((child: any, offset: number) => {
            if (child.type.name === "request-separator" && offset < nodePos) {
              sectionIndex++;
            }
          });
        }
        // Fallback to ProseMirror selection
        const cursorPos = sectionIndex !== undefined ? undefined : editor.state.selection.$from.pos;
        console.log('[useSendRequest] sectionIndex:', sectionIndex, 'cursorPos:', cursorPos);
        const response = await requestOrchestrator.executeRequest(
          editor,
          activeEnv,
          abortControllerRef.current.signal,
          sectionIndex !== undefined ? { sectionIndex } : { sectionPos: cursorPos }
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

  // Run all request sections sequentially
  const runAllRef = useRef(false);
  const runAll = async () => {
    if (!editor || runAllRef.current) return;
    runAllRef.current = true;

    await showResponsePanel();

    // Count total sections from the expanded document (linkedFile nodes are inlined so
    // their request-separator nodes are included in the count).
    let docForCounting = editor.getJSON();
    const hasLinkedFiles = docForCounting.content?.some((n: any) => n.type === "linkedFile");
    if (hasLinkedFiles) {
      try {
        docForCounting = await expandLinkedFilesInDoc(docForCounting, (editor as any).schema);
      } catch {
        toast.error("Could not load linked files. Fix any broken file links and try again.");
        return;
      }
    }

    let sectionCount = 1;
    let firstNodeIsSeparator = false;
    let firstChild = true;
    // docForCounting is JSON — node type is child.type (string), not child.type.name
    docForCounting.content?.forEach((child: any) => {
      const typeName: string = typeof child.type === "string" ? child.type : child.type?.name ?? "";
      if (firstChild && typeName === "request-separator") firstNodeIsSeparator = true;
      firstChild = false;
      if (typeName === "request-separator") sectionCount++;
    });
    const startSection = firstNodeIsSeparator ? 1 : 0;

    useResponseStore.getState().setLoading(true, activeDocument?.id);
    abortControllerRef.current = new AbortController();

    try {
      for (let sectionIdx = startSection; sectionIdx < sectionCount; sectionIdx++) {
        if (abortControllerRef.current?.signal.aborted) break;
        // Re-set currentRequestTabId before each section so the response handler
        // can find the correct tab (it gets cleared after each response)
        useResponseStore.getState().setCurrentRequestTabId(activeDocument?.id ?? null);
        try {
          await requestOrchestrator.executeRequest(
            editor,
            activeEnv,
            abortControllerRef.current.signal,
            { sectionIndex: sectionIdx }
          );
        } catch (err) {
          // Continue to next section on individual failure (unless aborted)
          if (err instanceof Error && err.name === "AbortError") break;
          console.warn(`[runAll] Section ${sectionIdx} failed:`, err);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["void-variable-keys"] });
      queryClient.invalidateQueries({ queryKey: ["void-variable-data"] });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        const friendlyMessage = mapErrorToMessage(error);
        useResponseStore.getState().setError(activeDocument?.id || null, friendlyMessage);
      }
    } finally {
      runAllRef.current = false;
    }
  };

  return {
    ...context,
    runAll,
    cancelRequest: () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    },
    runSection: async (sectionIndex: number) => {
      if (!editor) return;
      await showResponsePanel();
      if (activeDocument?.id) {
        useResponseStore.getState().setActiveResponseNodeForTab(activeDocument.id, "response-body");
      }
      useResponseStore.getState().setLoading(true, activeDocument?.id);
      useResponseStore.getState().setCurrentRequestTabId(activeDocument?.id ?? null);
      abortControllerRef.current = new AbortController();
      try {
        await requestOrchestrator.executeRequest(
          editor,
          activeEnv,
          abortControllerRef.current.signal,
          { sectionIndex }
        );
        queryClient.invalidateQueries({ queryKey: ["void-variable-keys"] });
        queryClient.invalidateQueries({ queryKey: ["void-variable-data"] });
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          const friendlyMessage = mapErrorToMessage(error);
          useResponseStore.getState().setError(activeDocument?.id || null, friendlyMessage);
        }
      }
    },
    refetchFromElement: (element: HTMLElement) => {
      // Compute section index by walking up from the clicked element to find
      // its top-level ProseMirror ancestor, then counting separators before it.
      // This works for both regular nodes and imported/linked blocks because
      // the DOM tree always leads to the main editor's top-level children.
      try {
        const proseDom = editor.view.dom;
        let topLevelNode: HTMLElement | null = element;
        while (topLevelNode && topLevelNode.parentElement !== proseDom) {
          topLevelNode = topLevelNode.parentElement;
        }
        if (topLevelNode) {
          let idx = 0;
          let sibling = proseDom.firstElementChild;
          while (sibling && sibling !== topLevelNode) {
            const isSeparator =
              sibling.getAttribute('data-type') === 'request-separator' ||
              sibling.querySelector?.('[data-type="request-separator"]') !== null;
            if (isSeparator) idx++;
            sibling = sibling.nextElementSibling;
          }
          sectionIndexOverrideRef.current = idx;
        }
      } catch {
        // Ignore — section detection will fall back to cursor/DOM-based approach
      }
      context.refetch();
    },
  };
};
