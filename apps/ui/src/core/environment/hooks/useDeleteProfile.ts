import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";

export const useDeleteProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.deleteProfile(profile);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
  });
};
