import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export const useGetSidebarTabs = (sidebarId: "left" | "right") => {
  return useQuery({
    queryKey: ["sidebar:tabs", sidebarId],
    queryFn: async () => window.electron?.sidebar.getTabs(sidebarId),
  });
};

export const useActivateSidebarTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sidebarId, tabId }: { sidebarId: "left" | "right"; tabId: string }) =>
      window.electron?.sidebar.activateTab(sidebarId, tabId),
    onSuccess: ({ sidebarId }) => {
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs", sidebarId] });
    },
  });
};

/**
 * Listens for user-settings changes and adds/removes the history sidebar tabs
 * (left: globalHistory, right: history) when history.enabled is toggled.
 */
export const useHistoryTabSync = () => {
  const queryClient = useQueryClient();
  const prevEnabled = useRef<boolean | null>(null);

  useEffect(() => {
    const syncTabs = async (enabled: boolean) => {
      await (window as any).electron?.sidebar?.setHistoryEnabled(enabled);
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs", "left"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs", "right"] });
    };

    // On first load: sync tabs to match current setting
    (window as any).electron?.userSettings?.get().then((settings: any) => {
      const enabled = !!settings?.history?.enabled;
      prevEnabled.current = enabled;
      syncTabs(enabled);
    });

    const unsubscribe = (window as any).electron?.userSettings?.onChange(async (next: any) => {
      const enabled = !!next?.history?.enabled;
      if (prevEnabled.current === enabled) return;
      prevEnabled.current = enabled;
      syncTabs(enabled);
    });

    return () => unsubscribe?.();
  }, [queryClient]);
};
