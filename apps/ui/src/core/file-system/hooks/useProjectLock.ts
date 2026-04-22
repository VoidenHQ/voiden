import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetAppState } from "@/core/state/hooks";

export const projectLockQueryKey = (projectRoot: string | null | undefined) =>
  ["project:locked", projectRoot ?? ""] as const;

/**
 * True when the given file path belongs to a project whose lock is on AND
 * the path is not inside the project's own `.voiden/` internals (which must
 * keep writing for history, runtime variables, and the lock file itself).
 *
 * Delegates to the electron layer so the check runs against authoritative
 * main-process state rather than a UI query-cache snapshot.
 */
export async function isPathInsideLockedProject(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false;
  return (await window.electron?.project.isPathInsideLocked(filePath)) ?? false;
}

export const useProjectLock = () => {
  const queryClient = useQueryClient();
  const { data: appState } = useGetAppState();
  const projectRoot: string | null = appState?.activeDirectory ?? null;

  const { data: locked = false } = useQuery({
    queryKey: projectLockQueryKey(projectRoot),
    enabled: !!projectRoot,
    queryFn: async () => {
      if (!projectRoot) return false;
      return (await window.electron?.project.getLocked(projectRoot)) ?? false;
    },
  });

  const { mutateAsync: setLocked, isPending } = useMutation({
    mutationFn: async (next: boolean) => {
      if (!projectRoot) return false;
      return (await window.electron?.project.setLocked(projectRoot, next)) ?? false;
    },
    onSuccess: (next) => {
      if (!projectRoot) return;
      queryClient.setQueryData(projectLockQueryKey(projectRoot), !!next);
    },
  });

  useEffect(() => {
    const unsubscribe = window.electron?.project.onLockedChanged(({ projectRoot: root, locked: next }) => {
      queryClient.setQueryData(projectLockQueryKey(root), !!next);
    });
    return () => {
      unsubscribe?.();
    };
  }, [queryClient]);

  const toggle = async () => {
    if (!projectRoot) return;
    await setLocked(!locked);
  };

  return {
    projectRoot,
    locked: !!locked,
    toggle,
    setLocked,
    isToggling: isPending,
  };
};
