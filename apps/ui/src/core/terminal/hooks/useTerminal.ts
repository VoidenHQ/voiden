import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useElectronEvent } from "@/core/providers";

export type ShellProfile = { id: string; name: string; path: string; args: string[] };

/**
 * Installed shells and the default. Detection only checks for files and is
 * cached by the main process, but it's still only fetched once something
 * (the new-terminal menu, Settings) asks for it.
 */
export const useTerminalShells = (enabled = true) => {
  const queryClient = useQueryClient();
  // The default can change from Settings or from the menu.
  useElectronEvent("settings:changed", () => queryClient.invalidateQueries({ queryKey: ["terminal:shells"] }));
  return useQuery({
    queryKey: ["terminal:shells"],
    queryFn: async () => (await window.electron?.terminal.listShells()) ?? { shells: [], defaultId: "", configured: "" },
    enabled,
    staleTime: Infinity,
  });
};

/** Save the shell new terminals start with ("" = automatic). */
export const setDefaultShell = (shell: string) =>
  window.electron?.userSettings.set({ terminal: { default_shell: shell } } as any);

export const useNewTerminalTab = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // A plain panel id opens the default shell; { panelId, shell } opens a specific one.
    mutationFn: async (arg: string | { panelId: string; shell?: string }) =>
      typeof arg === "string" ? window.electron?.terminal.new(arg) : window.electron?.terminal.new(arg.panelId, arg.shell),
    onSuccess: (variables) => {
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", variables?.panelId] });
      queryClient.invalidateQueries({ queryKey: ["tab:content", variables?.panelId, variables?.tabId] });
    },
  });
};
