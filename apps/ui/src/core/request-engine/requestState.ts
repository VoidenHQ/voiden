/**
 * Generic request-engine types and utilities.
 *
 * REST-specific execution logic (body building, auth header injection,
 * request sending, response parsing) has moved to the voiden-rest-api plugin:
 *   core-extensions/src/voiden-rest-api/lib/execution.ts
 *
 * The active request pipeline runs through:
 *   requestOrchestrator → sendRequestHybrid → Electron IPC
 */

import { RequestParam } from "@/core/types";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface EnvironmentVariable {
  key: string;
  value: string;
  currentValue?: string;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  cloud: boolean;
  created_at: string;
}

export interface Electron {
  isApp?: boolean;
  onLogin?: () => void;
  openExternal?: () => void;
  removeListener?: () => void;
  sendRequest?: any;
}

// ── Generic utilities (still used by core pipeline and other modules) ─────────

/**
 * Swap the base URL of a request while preserving path/query/hash.
 * Used by the mock-server feature.
 */
export function replaceBaseUrl(url: string, newBase: string): string {
  const { pathname, search, hash } = new URL(url);
  const newBaseUrl = new URL(newBase);
  return `${newBaseUrl.origin}${newBaseUrl.pathname}${pathname}${search}${hash}`;
}

/**
 * Persist environment variable updates from a test-runner result to localStorage.
 */
export const updateLocalStorageValue = (testRunnerResult: any, environment: Environment) => {
  try {
    const envArray = testRunnerResult?.right?.envs?.selected || [];
    const storedEnv = localStorage.getItem(environment?.id || "");
    const parsedEnv = storedEnv ? JSON.parse(storedEnv) : null;

    const updatedVariables = environment.variables
      .map((variable: EnvironmentVariable) => {
        const current = envArray.find((v: any) => v?.key === variable?.key);
        return current ? { key: variable.key, value: variable.value, currentValue: current.value } : variable;
      })
      .filter((v: any) => !!v.currentValue)
      .map((v: any) => ({ key: v.key, currentValue: v.currentValue }));

    if (environment.id) {
      localStorage.setItem(
        environment.id,
        JSON.stringify({ ...(parsedEnv || environment), variables: updatedVariables }),
      );
    }
  } catch { }
};

/**
 * Replace `{param}` placeholders in a URL with URL-encoded values.
 */
export const replacePathParams = (url: string, pathParams: RequestParam[]): string => {
  let updatedUrl = url;
  pathParams.forEach((param) => {
    if (param.enabled && param.key && param.value) {
      const regex = new RegExp(`{${param.key}}`, "g");
      updatedUrl = updatedUrl.replace(regex, encodeURIComponent(param.value));
    }
  });
  return updatedUrl;
};

/**
 * @deprecated Use sendRequestHybrid (via requestOrchestrator) for all request sending.
 * REST execution logic lives in core-extensions/src/voiden-rest-api/lib/execution.ts
 */
export const sendRequest = async (..._args: any[]): Promise<any> => {
  throw new Error(
    "sendRequest is deprecated. Use requestOrchestrator.executeRequest() which routes through the active hybrid pipeline.",
  );
};
