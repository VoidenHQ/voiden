import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const getProjects = async () => {
  const projects = await window.electron?.state.getProjects();
  return projects;
};

export const useGetProjects = () => {
  return useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
};

const clearGitQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.removeQueries({
    predicate: (query) => typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith("git:"),
  });
};

export const useOpenProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectPath: string) => window.electron?.state.openProject(projectPath),
    onSuccess: () => {
      clearGitQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    },
  });
};


export const removeProjectFromList = async (projectPath: string) => {
  await window.electron?.state.removeProjectFromList(projectPath);
};

export const useSetActiveProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectPath: string) => window.electron?.state.setActiveProject(projectPath),
    onSuccess: () => {
      clearGitQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
      queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
  });
};

export const useCloseActiveProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => window.electron?.state.emptyActiveProject(),
    onSuccess: () => {
      clearGitQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["files:tree"] });
      queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
  });
};
