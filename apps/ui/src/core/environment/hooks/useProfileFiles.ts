/**
 * useProfileFiles Hook
 *
 * Maps each environment profile name to its public YAML file's actual
 * on-disk location, project-relative (e.g. "default" -> ".voiden/env-public.yaml",
 * or "env-public.yaml" for an unmigrated project with the file still at the
 * project root). Kept separate from useProfiles (a plain string[] of names,
 * relied on elsewhere e.g. the Environment Editor) purely for display use —
 * e.g. showing a profile's real file path in the env selector.
 */

import { useQuery } from "@tanstack/react-query";

const loadProfileFiles = async (): Promise<Record<string, string>> => {
  const result = await window.electron?.env.getProfileFiles();
  return result || {};
};

export const useProfileFiles = () => {
  return useQuery({
    queryKey: ["env-profile-files"],
    queryFn: loadProfileFiles,
  });
};
