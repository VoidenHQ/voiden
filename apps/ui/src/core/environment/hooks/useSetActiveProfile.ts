import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";

export const useSetActiveProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.setActiveProfile(profile);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
  });
};
