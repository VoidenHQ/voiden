import { useQuery } from "@tanstack/react-query";

export interface YamlEnvNode {
  variables?: Record<string, string>;
  children?: Record<string, YamlEnvNode>;
}

export type YamlEnvTree = Record<string, YamlEnvNode>;

export interface YamlEnvTrees {
  public: YamlEnvTree;
  private: YamlEnvTree;
}

const loadYamlTrees = async (): Promise<YamlEnvTrees> => {
  const result = await window.electron?.env.getYamlTrees();
  return result || { public: {}, private: {} };
};

export const useYamlEnvironments = () => {
  return useQuery({
    queryKey: ["yaml-environments"],
    queryFn: loadYamlTrees,
    staleTime: Infinity,
  });
};
