import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { YamlEnvTree } from "./useYamlEnvironments.ts";

export const useSaveYamlEnvironments = (profile?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicTree, privateTree }: { publicTree: YamlEnvTree; privateTree: YamlEnvTree }) => {
      await window.electron?.env.saveYamlTrees(publicTree, privateTree, profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yaml-environments"] });
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["environment-keys"] });
    },
  });
};
