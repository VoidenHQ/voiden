import { useQuery } from "@tanstack/react-query";
import { useActiveEnvironment } from "./useActiveEnvironment";
import { useEnvironments } from "./useEnvironments";

/**
 * Variables visible to a request in this .void file, including ancestor .env files.
 * @param requestFilePath Absolute path to the request file.
 * @returns Resolved values, or the selected environment for an unsaved document.
 * @example const variables = useFileEnvironment(source)
 */
export const useFileEnvironment = (requestFilePath?: string) => {
  const selected = useActiveEnvironment();
  const { data } = useEnvironments();
  const { data: fileEnvironment } = useQuery({
    queryKey: ["file-environment", requestFilePath, data?.activeEnv, data?.activeProfile],
    queryFn: () => window.electron.env.forRequest(requestFilePath!),
    enabled: !!requestFilePath,
  });
  return requestFilePath ? (fileEnvironment ?? selected) : selected;
};
