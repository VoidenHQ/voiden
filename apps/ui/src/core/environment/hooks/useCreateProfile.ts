import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";

export const useCreateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.createProfile(profile);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
  });
};
