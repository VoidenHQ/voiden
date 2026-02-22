/**
 * Environment Hooks
 *
 * Unified environment management system for Voiden
 * - Load .env files from the project
 * - Get active environment variables for substitution
 * - Set active environment file
 * - Manage environment profiles
 */

export { invalidateEnvQueries } from "./envQueryKeys";

export { useEnvironments } from "./useEnvironments";
export { useActiveEnvironment } from "./useActiveEnvironment";
export { useSetActiveEnvironment } from "./useSetActiveEnvironment";
export { useEnvironmentKeys } from "./useEnvironmentKeys";
export { useYamlEnvironments } from "./useYamlEnvironments.ts";
export { useSaveYamlEnvironments } from "./useSaveYamlEnvironments.ts";
export { useProfiles } from "./useProfiles";
export { useSetActiveProfile } from "./useSetActiveProfile";
export { useCreateProfile } from "./useCreateProfile";
export { useDeleteProfile } from "./useDeleteProfile";

export type { EnvironmentData } from "./useEnvironments";
export type { YamlEnvNode, YamlEnvTree, YamlEnvTrees } from "./useYamlEnvironments.ts";

// Deprecated: use useEnvironments instead
export { useLoadEnv, useSetActiveEnv } from "./useEnvironment";
