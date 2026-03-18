import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useGetAppState } from "@/core/state/hooks";
import { reloadVoidenEditor } from "@/core/editors/voiden/VoidenEditor";

export const useGetGitBranches = () => {
  return useQuery({
    queryKey: ["git:branches"],
    queryFn: async () => {
      // Assumes window.electron.git.branches calls your IPC handler "git:getBranches"
      const response = await window.electron?.git.getBranches();

      return response;
    },
  });
};

// Helper function to reload all tabs (shared between checkout and git:changed)
export const reloadAllTabs = async (queryClient: any) => {
  const queryCache = queryClient.getQueryCache();
  const panelTabsQueries = queryCache.findAll({ queryKey: ["panel:tabs"] });

  // For each panel, get its tabs and reload void editors
  for (const query of panelTabsQueries) {
    const panelData = query.state.data as any;
    if (panelData?.tabs && Array.isArray(panelData.tabs)) {
      const panelId = query.queryKey[1] as string;

      // Reload each tab
      for (const tab of panelData.tabs) {
        if (tab.id && tab.source) {
          if (tab.title.endsWith('.void')) {
            // For .void files: call the reload function directly
            await reloadVoidenEditor(tab.id);
          } else {
            // For other files (CodeMirror): invalidate the query to force refetch
            queryClient.removeQueries({
              queryKey: ["tab:content", panelId, tab.id, tab.source],
              exact: true,
            });
            queryClient.invalidateQueries({
              queryKey: ["tab:content", panelId, tab.id, tab.source],
              exact: true,
            });
          }
        }
      }
    }
  }
};

export const useCheckoutBranch = () => {
  const queryClient = useQueryClient();
  const { data: appState } = useGetAppState();
  const activeDirectory = appState?.activeDirectory;

  return useMutation({
    mutationFn: async ({ projectPath, branch }: { projectPath: string; branch: string }) => {
      // Call the IPC function "git:checkout" with the active project and branch name.
      return window.electron?.git.checkout(projectPath, branch);
    },
    onSuccess: async () => {
      // Invalidate the git branches query to refresh the list (and active branch) after a checkout.
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
      queryClient.invalidateQueries({ queryKey: ["git:log"] });

      // Don't reload tabs here - the git:changed file watcher event will handle it
      // This prevents double reloading
    },
  });
};

export const useCreateBranch = () => {
  const queryClient = useQueryClient();
  const { data: appState } = useGetAppState();
  const activeDirectory = appState?.activeDirectory;

  return useMutation({
    mutationFn: async ({ projectPath, branch }: { projectPath: string; branch: string }) => {
      return window.electron?.git.createBranch(projectPath, branch);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeDirectory] });
    },
  });
};

export const useCreateBranchFrom = () => {
  const queryClient = useQueryClient();
  const { data: appState } = useGetAppState();
  const activeProject = appState?.activeProject;

  return useMutation({
    mutationFn: async ({ projectPath, branch, fromBranch }: { projectPath: string; branch: string; fromBranch: string }) => {
      return window.electron?.git.createBranchFrom(projectPath, branch, fromBranch);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
      queryClient.invalidateQueries({ queryKey: ["files:tree", activeProject] });
    },
  });
};

export const useGetBranchDiff = (baseBranch?: string, compareBranch?: string) => {
  return useQuery({
    queryKey: ["git:diff", baseBranch, compareBranch],
    queryFn: async () => {
      if (!baseBranch || !compareBranch) {
        return null;
      }
      return window.electron?.git.diffBranches(baseBranch, compareBranch);
    },
    enabled: !!baseBranch && !!compareBranch,
  });
};

export const useGetFileDiff = (baseBranch?: string, compareBranch?: string, filePath?: string) => {
  return useQuery({
    queryKey: ["git:diff:file", baseBranch, compareBranch, filePath],
    queryFn: async () => {
      if (!baseBranch || !compareBranch || !filePath) {
        return null;
      }
      return window.electron?.git.diffFile(baseBranch, compareBranch, filePath);
    },
    enabled: !!baseBranch && !!compareBranch && !!filePath,
  });
};

export const useGetFileAtBranch = (branch?: string, filePath?: string) => {
  return useQuery({
    queryKey: ["git:file:branch", branch, filePath],
    queryFn: async () => {
      if (!branch || !filePath) {
        return null;
      }
      return window.electron?.git.getFileAtBranch(branch, filePath);
    },
    enabled: !!branch && !!filePath,
  });
};

export const useGetGitLog = (limit: number = 50) => {
  return useQuery({
    queryKey: ["git:log", limit],
    queryFn: async () => {
      return window.electron?.git.getLog(limit);
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });
};

export const useGetCommitFiles = (commitHash: string | null) => {
  return useQuery({
    queryKey: ["git:commitFiles", commitHash],
    queryFn: async () => {
      if (!commitHash) return null;
      return window.electron?.git.getCommitFiles(commitHash);
    },
    enabled: !!commitHash,
  });
};

export const useGetGitStatus = () => {
  return useQuery({
    queryKey: ["git:status"],
    queryFn: async () => {
      return window.electron?.git.getStatus();
    },
    refetchInterval: 1000, // Refetch every second to keep it updated
  });
};

export const useInitializeGit = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return window.electron?.git.initialize();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
    },
  });
}

export const useCloneRepo = () => {
  return useMutation({
    mutationFn: async ({ repoUrl, token }: { repoUrl: string; token?: string }) => {
      return window.electron?.git.clone(repoUrl, token);
    },
  });
}

export const useStageFiles = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: string[]) => {
      return window.electron?.git.stage(files);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
    },
  });
};

export const useUnstageFiles = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: string[]) => {
      return window.electron?.git.unstage(files);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
    },
  });
};

export const useCommit = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (message: string) => {
      return window.electron?.git.commit(message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
      queryClient.invalidateQueries({ queryKey: ["git:log"] });
    },
  });
};

export const useDiscardFiles = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: string[]) => {
      return window.electron?.git.discard(files);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
    },
  });
};

export const usePushToRemote = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return window.electron?.git.push();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
      queryClient.invalidateQueries({ queryKey: ["git:log"] });
    },
  });
};

export const usePullFromRemote = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return window.electron?.git.pull();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:branches"] });
      queryClient.invalidateQueries({ queryKey: ["git:log"] });
    },
  });
};

export const useGetGitRemote = () => {
  return useQuery({
    queryKey: ["git:remoteUrl"],
    queryFn: async () => window.electron?.git.getRemoteUrl() ?? null,
  });
};

export const useSetGitRemote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (remoteUrl: string) => window.electron?.git.setRemoteUrl(remoteUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:remoteUrl"] });
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
    },
  });
};

export const useRemoveGitRemote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => window.electron?.git.removeRemote(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:remoteUrl"] });
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
    },
  });
};

export const useStashList = () => {
  return useQuery({
    queryKey: ["git:stashList"],
    queryFn: async () => window.electron?.git.stashList() ?? [],
    refetchInterval: 5000,
  });
};

export const useStash = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (message?: string) => window.electron?.git.stash(message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:stashList"] });
    },
  });
};

export const useStashPop = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (index: number) => window.electron?.git.stashPop(index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:stashList"] });
    },
  });
};

export const useUncommit = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => window.electron?.git.uncommit(),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["git:status"] });
      queryClient.refetchQueries({ queryKey: ["git:log"] });
      queryClient.refetchQueries({ queryKey: ["git:branches"] });
    },
  });
};

export const useGetConflicts = () => {
  return useQuery({
    queryKey: ["git:conflicts"],
    queryFn: async () => window.electron?.git.getConflicts() ?? [],
    refetchInterval: 2000,
  });
};

export const useResolveConflict = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      resolution,
      sectionIndex,
    }: {
      file: string;
      resolution: 'current' | 'incoming' | 'both';
      sectionIndex?: number;
    }) => window.electron?.git.resolveConflict(file, resolution, sectionIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["git:conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
    },
  });
};

export const useGetFileContent = (file: string | null) => {
  return useQuery({
    queryKey: ["git:fileContent", file],
    queryFn: async () => {
      if (!file) return null;
      return window.electron?.git.getFileContent(file) ?? null;
    },
    enabled: !!file,
  });
};

// Periodically fetches from remote so ahead/behind counts stay accurate.
// Returns a manual trigger for use in refresh actions.
export const useFetchRemote = () => {
  const queryClient = useQueryClient();

  const invalidateAfterFetch = () => {
    queryClient.invalidateQueries({ queryKey: ["git:status"] });
    queryClient.invalidateQueries({ queryKey: ["git:branches"] });
    queryClient.invalidateQueries({ queryKey: ["git:remoteUrl"] });
  };

  // Background fetch every 30 seconds — errors silenced (no remote / offline)
  useEffect(() => {
    const run = async () => {
      try {
        await window.electron?.git.fetchRemote();
        invalidateAfterFetch();
      } catch { /* no remote or network unavailable */ }
    };
    run();
    const id = setInterval(run, 30000);
    return () => clearInterval(id);
  }, []);

  // Manual trigger — lets the caller handle errors
  const triggerFetch = async () => {
    await window.electron?.git.fetchRemote();
    invalidateAfterFetch();
  };

  return { triggerFetch };
};
