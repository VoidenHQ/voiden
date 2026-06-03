import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateEnvQueries } from "./envQueryKeys";

export const useRenameProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      await window.electron?.env.renameProfile(oldName, newName);
    },
    onSuccess: () => {
      invalidateEnvQueries(queryClient);
    },
  });
};
