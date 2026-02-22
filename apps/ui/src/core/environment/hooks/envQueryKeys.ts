import type { QueryClient } from "@tanstack/react-query";

const ENV_QUERY_KEYS = ["environments", "environment-keys", "env-profiles", "yaml-environments"] as const;

export function invalidateEnvQueries(queryClient: QueryClient) {
  for (const key of ENV_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
