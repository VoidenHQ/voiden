import { useQuery } from "@tanstack/react-query";

export interface YamlEnvNode {
  intermediate?: boolean;
  displayName?: string;
  variables?: Record<string, string>;
  children?: Record<string, YamlEnvNode>;
}

export type YamlEnvTree = Record<string, YamlEnvNode>;

export interface YamlEnvTrees {
  public: YamlEnvTree;
  private: YamlEnvTree;
}

const loadYamlTrees = async (profile?: string): Promise<YamlEnvTrees> => {
  const result = await window.electron?.env.getYamlTrees(profile);
  return result || { public: {}, private: {} };
};

export const useYamlEnvironments = (profile?: string) => {
  return useQuery({
    queryKey: ["yaml-environments", profile],
    queryFn: () => loadYamlTrees(profile),
    staleTime: Infinity,
  });
};
