import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useDeleteProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profile: string) => {
      await window.electron?.env.deleteProfile(profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["env-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["environment-keys"] });
      queryClient.invalidateQueries({ queryKey: ["yaml-environments"] });
    },
  });
};
