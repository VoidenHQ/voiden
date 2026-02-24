import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetAppState } from "@/core/state/hooks";
import { usePanelStore } from "@/core/stores/panelStore";
import { useEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { useCodeEditorStore } from "@/core/editors/code/CodeEditorStore";
import { Tab } from "apps/electron/src/shared/types";
import { panels } from "@codemirror/view";

export const useGetPanelTabs = (panelId: string) => {
  const { data: appState } = useGetAppState();
  return useQuery({
    queryKey: ["panel:tabs", panelId],
    queryFn: async () => window.electron?.state.getPanelTabs(panelId),
    enabled: !!appState,
  });
};

export const useGetTabContent = (panelId: string) => {
  const { data: panelData } = useGetPanelTabs(panelId);

  const activeTabId = panelData?.activeTabId;
  const tab = panelData?.tabs?.find((tab) => tab.id === activeTabId);
  return useQuery({
    queryKey: ["tab:content", panelId, tab?.id, tab?.source],
    enabled: !!tab,
    queryFn: async () => {
      const content = await window.electron?.tab.getContent(tab);

      // If this is an autosaved document, pre-populate the Zustand store
      // so the editor treats it as unsaved content
      if (content?.type === "document" && content?.isAutosaved && tab?.id) {
        useEditorStore.getState().setUnsaved(tab.id, content.content);
      }

      return content;
    },
  });
};

export const useActivateTab = () => {
  const queryClient = useQueryClient();
  const closeRightPanel = usePanelStore((state: { closeRightPanel: () => void }) => state.closeRightPanel);
  return useMutation({
    mutationFn: async ({ panelId, tabId }: { panelId: string; tabId: string }) => window.electron?.tab.activate(panelId, tabId),
    onSuccess: async ({ panelId, tabId }: { panelId: string; tabId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", panelId] });
      // Remove (not just invalidate) so ErrorBoundary gets a fresh fetch on reset
      queryClient.removeQueries({ queryKey: ["tab:content", panelId, tabId] });

      // Get the active tab content to check its type
      const tabContent = await window.electron?.tab.getContent({ id: tabId, type: "document", title: "", source: null });

      // Retrieve stored panel state for this tab from localStorage
      const storedStates = localStorage.getItem('panelStates');
      let panelStateForTab;
      if (storedStates) {
        const panelStates = JSON.parse(storedStates);
        panelStateForTab = panelStates.find((state: any) => state.tabId === tabId);
      }

      // Close the right panel if the stored state for the tab indicates that it should be closed,
      // or fallback to the existing condition if no state is stored
      if (panelStateForTab) {
        if (!panelStateForTab.rightPanelOpen) {
          closeRightPanel();
        }
      } else if (tabContent && tabContent.type === "document" && !tabContent.title.endsWith(".void")) {
        closeRightPanel();
      }
    },
  });
};

export const useClosePanelTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ panelId, tabId, unsavedContent }: { panelId: string; tabId: string; unsavedContent?: string }) => {
      return window.electron?.state.closePanelTab(panelId, tabId, unsavedContent);
    },
    onSuccess: (result: { panelId: string; tabId: string; canceled?: boolean } | undefined) => {
      // If the user cancelled the close operation, do not update the UI.
      if (result?.canceled) return;
      if (!result?.panelId) return;
      if (result.panelId === 'main') {
        useEditorStore.getState().clearUnsaved(result.tabId);
      }
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", result.panelId] });
    },
  });
};

export const useClosePanelTabs = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ panelId, tabs }: { panelId: string; tabs: Array<{ tabId: string; unsavedContent?: string }> }) => {
      return window.electron?.state.closePanelTabs(panelId, tabs);
    },
    onSuccess: (result: { panelId: string, closedTabs: Array<{ tabId: string, panelId: string }>, canceledTabs: [], allClosed: boolean } | undefined) => {
      // If the user cancelled the close operation, do not update the UI.
      if (result?.closedTabs.length === 0) return;
      if (result?.panelId === 'main') {
        result?.closedTabs.forEach((clsTab) => {
          useEditorStore.getState().clearUnsaved(clsTab.tabId);
        })
      }
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", result?.panelId] });
    },
  });
};

export const useDuplicatePanelTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ panelId, tabId }: { panelId: string; tabId: string }) => {
      // Use the state-level duplicate API
      return window.electron?.state.duplicatePanelTab(panelId, tabId);
    },
    onSuccess: (result, variables) => {
      if (!result?.panelId) return;
      // Refresh the panel's tabs list (titles now include "copy" from the main process)
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", result.panelId] });
      // Duplicate any unsaved editor content for the new tab
      const newTabId = (result as any).tabId;
      const originalUnsaved = useEditorStore.getState().unsaved[variables.tabId];
      if (originalUnsaved) {
        useEditorStore.getState().setUnsaved(newTabId, originalUnsaved);
      }
      // If the duplicated tab was the active code editor, carry over its content
      const { activeEditor } = useCodeEditorStore.getState();
      if (activeEditor.tabId === variables.tabId) {
        const { content, source, panelId } = activeEditor;
        useCodeEditorStore.getState().setActiveEditor(
          newTabId,
          content,
          source ?? "",
          panelId ?? ""
        );
      }
    },
  });
};

export const useReloadPanelTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      panelId,
      tabId,
      source,
    }: {
      panelId: string;
      tabId: string;
      source?: string;
    }) => {
      // No IPC call needed; pass identifiers through
      return { panelId, tabId, source };
    },
    onSuccess: (_result, variables) => {
      const { panelId, tabId, source } = variables;
      // Invalidate the exact content query key including source
      queryClient.invalidateQueries({
        queryKey: ["tab:content", panelId, tabId, source],
      });
    },
  });
};

export const useAddPanelTab = () => {
  const queryClient = useQueryClient();
  const { mutate: activateTab } = useActivateTab();
  const closeRightPanel = usePanelStore((state: { closeRightPanel: () => void }) => state.closeRightPanel);
  return useMutation({
    mutationFn: async ({
      panelId,
      tab,
    }: {
      panelId: string;
      tab: {
        id: string;
        type: string;
        title: string;
        source: string | null;
      };
    }) => window.electron?.state.addPanelTab(panelId, tab),
    onSuccess: (result, variables) => {
      if (!result) return;

      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
      // Check if the new tab is not an .void file and close right panel
      if (!variables.tab.title.endsWith(".void")) {
        closeRightPanel();
      }

      activateTab({ panelId: variables.panelId, tabId: result.tabId });
    },
  });
};

export const useSetTabsOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      panelId,
      tabs,
    }: {
      panelId: string;
      tabs: Tab[]
    }) => window.electron?.state.reorderTabs(panelId, tabs),
    onSuccess: (result, variables) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
    },
  });
}
