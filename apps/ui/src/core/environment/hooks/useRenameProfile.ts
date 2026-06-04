import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useRenameProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      await window.electron?.env.renameProfile(oldName, newName);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["yaml-environments"] });
    },
  });
}
