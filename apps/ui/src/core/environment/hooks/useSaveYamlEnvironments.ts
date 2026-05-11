import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";
import type { YamlEnvTree } from "./useYamlEnvironments.ts";

export const useSaveYamlEnvironments = (profile?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicTree, privateTree, projectPath }: { publicTree: YamlEnvTree; privateTree: YamlEnvTree; projectPath?: string }) => {
      await window.electron?.env.saveYamlTrees(publicTree, privateTree, profile, projectPath);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
  });
};
