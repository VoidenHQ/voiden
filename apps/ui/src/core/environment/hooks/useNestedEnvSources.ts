/**
 * useNestedEnvSources Hook
 *
 * Loads every nested sub-project .voiden/ directory found elsewhere in the
 * active project (a monorepo whose sub-packages were each opened as their
 * own Voiden project at some point). Each source's "default" profile YAML
 * trees come back pre-loaded so the Environment Editor doesn't need a query
 * per discovered folder.
 */

import { useQuery } from "@tanstack/react-query";
import { useGetAppState } from "@/core/state/hooks";
import type { YamlEnvTree } from "./useYamlEnvironments.ts";

export interface NestedEnvSource {
  projectPath: string;
  // Project-relative folder only — never the yaml filename.
  relPath: string;
  // A folder can have more than one profile (e.g. a not-yet-migrated
  // legacy root-level profile sitting alongside its own .voiden/ default
  // profile) — "default" for the ordinary case.
  profile: string;
  public: YamlEnvTree;
  private: YamlEnvTree;
}

const loadNestedEnvSources = async (): Promise<NestedEnvSource[]> => {
  const result = await window.electron?.env.getNestedEnvSources();
  return (result as NestedEnvSource[] | undefined) || [];
};

export const useNestedEnvSources = () => {
  const { data: appState } = useGetAppState();
  const projectPath = appState?.activeDirectory ?? null;
  return useQuery({
    queryKey: ["nested-env-sources", projectPath],
    queryFn: loadNestedEnvSources,
    enabled: !!projectPath,
    staleTime: Infinity,
  });
};
