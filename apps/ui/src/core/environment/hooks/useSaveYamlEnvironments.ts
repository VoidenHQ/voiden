import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";
import type { YamlEnvTree } from "./useYamlEnvironments.ts";
import { toast } from "@/core/components/ui/sonner";

export const useSaveYamlEnvironments = (profile?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicTree, privateTree, projectPath, profile: profileOverride }: { publicTree: YamlEnvTree; privateTree: YamlEnvTree; projectPath?: string; profile?: string }) => {
      // profileOverride lets a single mutation instance save to a different
      // profile per call — used for discovered nested sub-projects, which
      // can each have several profiles (e.g. "default" and a legacy
      // root-level one) unlike the hook's usual one-profile-per-instance use.
      await window.electron?.env.saveYamlTrees(publicTree, privateTree, profileOverride ?? profile, projectPath);
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
