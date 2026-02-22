import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useCreateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.createProfile(profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["env-profiles"] });
    },
  });
};
