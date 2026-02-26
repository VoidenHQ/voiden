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
}

const loadEnvironments = async (): Promise<EnvironmentData> => {
  const result = await window.electron?.env.load();
  return result || { activeEnv: null, activeProfile: null, data: {}, displayNames: {} };
};

export const useEnvironments = () => {
  return useQuery({
    queryKey: ["environments"],
    queryFn: loadEnvironments,
  });
};
