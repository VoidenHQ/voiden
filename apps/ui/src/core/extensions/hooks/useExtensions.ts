import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** Getting started: enabling, disabling or uninstalling a plugin is a tour step (lazy: the store imports UI code). */
const markPluginActionsStep = () =>
  import("@/core/onboarding/gettingStartedStore").then((m) => m.markGettingStartedStep("pluginActions")).catch(() => {});

export const useGetExtensions = () => {
  return useQuery({
    queryKey: ["extensions"],
    queryFn: async () => window.electron?.extensions.getAll(),
    refetchInterval: false,
  });
};

export const useGetExtension = (extensionId: string) => {
  return useQuery({
    queryKey: ["extension", extensionId],
    queryFn: async () => window.electron?.extensions.get(extensionId),
  });
};

export const useInstallExtension = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (extension: any) => window.electron?.extensions.install(extension),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to install extension");
    },
  });
};

export const useUninstallExtension = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (extensionId: string) => window.electron?.extensions.uninstall(extensionId),
    onSuccess: async () => {
      markPluginActionsStep();
      // Wait a bit before invalidating to allow current renders to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
    },
  });
};

export const useSetExtensionEnabled = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ extensionId, enabled }: { extensionId: string; enabled: boolean }) =>
      window.electron?.extensions.setEnabled(extensionId, enabled),
    onSuccess: async (_data, { enabled }) => {
      // Only once it's back on: a step that ticks on Disable could leave a plugin the tour needs switched off.
      if (enabled) markPluginActionsStep();
      // Wait a bit before invalidating to allow current renders to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
    },
  });
};

export const useOpenExtensionDetails = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (extension: any) => window.electron?.extensions.openDetails(extension),
    onSuccess: () => {
      // Optionally, invalidate the main panel tabs query to reflect changes.
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", "main"] });
    },
  });
};

export const useInstallExtensionFromZip = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => window.electron?.extensions.installFromZip(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to install extension from zip");
    },
  });
};

export const useUpdateExtension = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (extensionId: string) => {
      const result = await window.electron?.extensions.update(extensionId);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
    },
  });
};
