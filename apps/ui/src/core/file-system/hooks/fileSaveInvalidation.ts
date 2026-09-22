import type { QueryClient } from "@tanstack/react-query";

type FileSaveInvalidationOptions = {
  activeDirectory?: string;
  fileTreeChanged?: boolean;
};

export function invalidateFileSaveQueries(
  queryClient: QueryClient,
  panelId: string,
  tabId: string,
  options: FileSaveInvalidationOptions = {},
): void {
  // Saving changes file contents, not the explorer structure. Invalidating
  // files:tree here rebuilds react-arborist nodes and loses expanded folders.
  void queryClient.invalidateQueries({ queryKey: ["panel:tabs", panelId] });
  void queryClient.invalidateQueries({
    queryKey: ["tab:content", panelId, tabId],
  });

  if (options.fileTreeChanged) {
    void queryClient.invalidateQueries({
      queryKey: ["files:tree", options.activeDirectory],
    });
  }
}
