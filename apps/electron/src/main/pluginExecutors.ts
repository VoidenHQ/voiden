/**
 * Request executors contributed by plugins, keyed by `protocolType`.
 *
 * A plugin's onBuildRequest sets `protocolType` (e.g. "sql") on the request;
 * the send-secure-request handler then hands the request to the executor
 * registered for that protocol instead of the built-in HTTP/WS/gRPC path.
 * This is what lets a plugin add a whole protocol (Run, Cmd+Enter, response
 * panel, history) without its executor living in @voiden/executors.
 *
 * Built-in protocols can't be taken over.
 */

import { logger } from "./logger";

export interface PluginExecutorContext {
  /** Active project folder, if any. */
  projectPath?: string;
  /** The .void file the request came from, when it's saved. */
  requestFilePath?: string;
  /**
   * Resolves `{{variables}}` the same way built-in requests do: active
   * environment, folder-level .env files for `requestFilePath`, runtime
   * variables and plugin variable providers.
   */
  resolveVariables(text: string): Promise<string>;
}

/**
 * Returns the same shape the built-in HTTP path returns to the renderer:
 * `{ status, statusText, headers: [name, value][], body, protocol, requestMeta }`
 * on success, `{ status: 0, statusText, error, protocol, requestMeta }` on failure.
 */
export type PluginExecutor = (requestState: any, context: PluginExecutorContext) => Promise<any>;

const BUILT_IN = new Set(["rest", "http", "https", "graphql", "grpc", "grpcs", "ws", "wss", "mcp"]);

const executors = new Map<string, { extensionId: string; execute: PluginExecutor }>();

/** Registers `execute` for `protocol`. Returns a function that removes it. */
export function registerPluginExecutor(extensionId: string, protocol: string, execute: PluginExecutor): () => void {
  const key = protocol.trim().toLowerCase();
  if (!key) throw new Error("registerExecutor: protocol is required");
  if (BUILT_IN.has(key)) throw new Error(`registerExecutor: "${key}" is a built-in protocol`);

  const existing = executors.get(key);
  if (existing && existing.extensionId !== extensionId) {
    throw new Error(`registerExecutor: "${key}" is already registered by ${existing.extensionId}`);
  }
  executors.set(key, { extensionId, execute });
  logger.info("plugin", `[PluginExecutors] ${extensionId} registered executor for "${key}"`);

  return () => {
    if (executors.get(key)?.execute === execute) executors.delete(key);
  };
}

export function unregisterPluginExecutors(extensionId: string): void {
  for (const [key, entry] of executors) {
    if (entry.extensionId === extensionId) executors.delete(key);
  }
}

export function getPluginExecutor(protocolType: unknown): PluginExecutor | undefined {
  if (typeof protocolType !== "string") return undefined;
  return executors.get(protocolType.trim().toLowerCase())?.execute;
}
