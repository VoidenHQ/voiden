/**
 * Request Engine
 *
 * Core HTTP request execution system for Voiden
 */

// Hooks
export * from "./hooks";

// Components
export { SendRequest } from "./components/SendRequest";

// Generic utilities (REST execution lives in core-extensions/src/voiden-rest-api/lib/execution.ts)
export { replaceBaseUrl, updateLocalStorageValue, replacePathParams } from "./requestState";
export type { Electron, Environment, EnvironmentVariable } from "./requestState";

export { getRequest, replaceEnvVariables, replaceEnvVariablesInRequest, getRequestWithPathParams } from "./getRequestFromJson";
export type { Doc } from "./getRequestFromJson";

// Utils
export { processFileNodes, attachFileDataToNodes } from "./utils/nodeProcessing";
