import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";
import type { YamlEnvTree } from "./useYamlEnvironments.ts";
import { toast } from "@/core/components/ui/sonner";
import { markGettingStartedStep, useGettingStartedStore } from "@/core/onboarding/gettingStartedStore";

/** Whether any environment in the tree defines `name`. */
const definesVar = (tree: YamlEnvTree | undefined, name: string): boolean =>
  Object.values(tree ?? {}).some((node) => (node.variables && name in node.variables) || definesVar(node.children, name));

/** The tour's env step asks for a private `token`: count it only once it is one, and nudge if it went in public. */
function trackTourToken(publicTree: YamlEnvTree, privateTree: YamlEnvTree) {
  if (definesVar(privateTree, "token")) return markGettingStartedStep("writeEnv");
  if (useGettingStartedStore.getState().tipStep === "writeEnv" && definesVar(publicTree, "token")) {
    // The editor autosaves as you type: one toast, updated in place, not a stack of them.
    toast.info("Make token private", { id: "tour-token-private", description: "Click Public next to it to switch it to Private. Secrets belong in the git-ignored env-private.yaml." });
  }
}

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
    onSuccess: (_data, { publicTree, privateTree }) => {
      invalidateEnvQueries(queryClient);
      trackTourToken(publicTree, privateTree);
    },
    onError: (error: unknown) => {
      toast.error("Couldn't save environment changes", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
};
