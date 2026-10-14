import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";
import { toast } from "@/core/components/ui/sonner";

export const useDeleteProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.deleteProfile(profile);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
    onError: (error: unknown, profile) => {
      toast.error(`Couldn't delete profile "${profile}"`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
};
