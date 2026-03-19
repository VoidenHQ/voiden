/**
 * Type definitions for the Voiden Scripting extension
 */

export type ScriptLanguage = "javascript" | "python" | "shell";

export type VdKeyValueCollection =
  | Record<string, string>
  | { key: string; value: string; enabled?: boolean }
  | Array<{ key: string; value: string; enabled?: boolean }>;

export interface VdRequest {
  url: string;
  method: string;
  headers: VdKeyValueCollection;
  body: any;
  queryParams: VdKeyValueCollection;
  pathParams: VdKeyValueCollection;
}

export interface VdResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  time: number;
  size: number;
}

export interface VdVariables {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
}

export interface VdEnv {
  get: (key: string) => Promise<any>;
}

export interface VdApi {
  request: VdRequest;
  response?: VdResponse;
  env: VdEnv;
  variables: VdVariables;
  log: (levelOrMessage: any, ...args: any[]) => void;
  assert?: (actual: any, operator: string, expectedValue: any, message?: string) => void;
  cancel: () => void;
}

export interface ScriptAssertionResult {
  passed: boolean;
  message: string;
  condition?: string;
  actualValue?: any;
  operator?: string;
  expectedValue?: any;
  reason?: string;
}

export interface ScriptLog {
  level: 'info' | 'warn' | 'error' | 'log' | 'debug' | string;
  args: any[];
}

export interface ScriptExecutionResult {
  success: boolean;
  logs: ScriptLog[];
  error?: string;
  cancelled: boolean;
  exitCode?: number;
  assertions?: ScriptAssertionResult[];
  modifiedRequest?: VdRequest;
  modifiedResponse?: VdResponse;
}
