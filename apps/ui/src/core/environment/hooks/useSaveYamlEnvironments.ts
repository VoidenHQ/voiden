import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";
import type { YamlEnvTree } from "./useYamlEnvironments.ts";
import { toast } from "@/core/components/ui/sonner";

export const useSaveYamlEnvironments = (profile?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicTree, privateTree, projectPath }: { publicTree: YamlEnvTree; privateTree: YamlEnvTree; projectPath?: string }) => {
      await window.electron?.env.saveYamlTrees(publicTree, privateTree, profile, projectPath);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Couldn't save environment changes", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
};
