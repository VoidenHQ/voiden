
/**
 * useVariableCapture Hook
 *
 * Returns only the variable names (keys) from the active environment.
 * This is secure - no actual values are exposed to the UI.
 *
 * Use this for:
 * - Autocomplete suggestions in editor
 * - Variable validation
 * - Showing available variables to user
 *
 * @security Only returns variable names, not values
 */

import { useQuery} from "@tanstack/react-query";
const loadVoidVariablesKeys = async (): Promise<string[]> => {
  try {
    const keys = await window.electron?.variables.getKeys();
    return keys || [];
  } catch (error) {
    console.error("[useVoidVariablesKeys] Error loading keys:", error);
    return [];
  }
}

export const useVoidVariables = () => {
  return useQuery({
    queryKey: ["void-variable-keys"],
    queryFn: loadVoidVariablesKeys,
    staleTime: 3000, // Keys don't change often, cache for 30s
  });
}

/**
 * Returns the full key→value map from .voiden/.process.env.json.
 * Used by the editor highlighter to show variable values in tooltips.
 */
const loadVoidVariableData = async (): Promise<Record<string, string>> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (window as any).electron?.variables?.read();
    return (data as Record<string, string>) ?? {};
  } catch (error) {
    console.error("[useVoidVariableData] Error loading data:", error);
    return {};
  }
}

export const useVoidVariableData = () => {
  return useQuery({
    queryKey: ["void-variable-data"],
    queryFn: loadVoidVariableData,
    staleTime: 3000,
  });
}