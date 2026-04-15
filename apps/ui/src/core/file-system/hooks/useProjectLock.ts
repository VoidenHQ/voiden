import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetAppState } from "@/core/state/hooks";
import { getQueryClient } from "@/main";

export const projectLockQueryKey = (projectRoot: string | null | undefined) =>
  ["project:locked", projectRoot ?? ""] as const;

function normalize(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * True when the given file path belongs to a project whose lock is on AND
 * the path is not inside the project's own `.voiden/` internals (which must
 * keep writing for history, runtime variables, and the lock file itself).
 */
export function isPathInsideLockedProject(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const queryClient = getQueryClient();
  const appState = queryClient.getQueryData<any>(["app:state"]);
  const activeDirectory: string | null = appState?.activeDirectory ?? null;
  if (!activeDirectory) return false;

  const root = normalize(activeDirectory);
  const path = normalize(filePath);
  if (path !== root && !path.startsWith(root + "/")) return false;

  const locked = queryClient.getQueryData<boolean>(projectLockQueryKey(activeDirectory));
  if (!locked) return false;

  const voidenDir = root + "/.voiden";
  if (path === voidenDir || path.startsWith(voidenDir + "/")) return false;

  return true;
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
