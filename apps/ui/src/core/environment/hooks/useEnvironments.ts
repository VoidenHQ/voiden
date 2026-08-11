/**
 * useEnvironments Hook
 *
 * Loads all .env files from the active project via Electron
 * Returns: { activeEnv: string | null, data: Record<filepath, Record<key, value>> }
 */

import { useQuery } from "@tanstack/react-query";

export interface EnvironmentData {
  activeEnv: string | null;
  activeProfile: string | null;
  data: Record<string, Record<string, string>>;
  displayNames: Record<string, string>;
  // Project-relative path of the active profile's YAML file (e.g.
  // ".voiden/env-public.yaml", or "env-public.yaml" for an unmigrated
  // project). Undefined when data came from the legacy per-file .env
  // fallback instead of the YAML system.
  profileFile?: string;
  // For environments discovered inside a nested .voiden/ directory
  // elsewhere in a monorepo: maps that env's data key to the folder
  // (project-relative, no filename) it was found in.
  sourcePaths?: Record<string, string>;
  // Same keys as sourcePaths — the profile that nested env came from
  // (e.g. "default" or a legacy root-level named profile).
  sourceProfiles?: Record<string, string>;
}

const loadEnvironments = async (): Promise<EnvironmentData> => {
  const result = await window.electron?.env.load();
  return result || { activeEnv: null, activeProfile: null, data: {}, displayNames: {} };
};

export const useEnvironments = () => {
  return useQuery({
    queryKey: ["environments"],
    queryFn: loadEnvironments,
    refetchInterval: false,
  });
};
