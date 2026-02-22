import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useSetActiveProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.setActiveProfile(profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["environment-keys"] });
      queryClient.invalidateQueries({ queryKey: ["env-profiles"] });
    },
  });
};
