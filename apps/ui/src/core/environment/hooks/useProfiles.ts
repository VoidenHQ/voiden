import { useQuery } from "@tanstack/react-query";

const loadProfiles = async (): Promise<string[]> => {
  const result = await window.electron?.env.getProfiles();
  return result || ["default"];
};

export const useProfiles = () => {
  return useQuery({
    queryKey: ["env-profiles"],
    queryFn: loadProfiles,
  });
};
