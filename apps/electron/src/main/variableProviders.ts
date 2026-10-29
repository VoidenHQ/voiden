/**
 * Variable providers
 *
 * Lets main-process plugins resolve their own `{{namespace.key}}` references
 * at request time — e.g. a secrets plugin resolving `{{vault.api_token}}`
 * from HashiCorp Vault. Providers run only in the main process, so resolved
 * values never reach the renderer and are never written to disk by core.
 *
 * Resolution happens inside replaceVariablesSecure, before the regular
 * environment substitution. A reference whose provider fails or returns
 * nothing is left as-is, so the outgoing-request validation blocks the send
 * with an "unresolved variable" error instead of sending the literal text.
 */

import { logger } from "./logger";

export interface VariableProviderContext {
  /** Workspace root the request runs in. */
  projectPath: string;
  /** Selected environment path (e.g. "staging.eu"), or null when none is selected. */
  activeEnv: string | null;
  /** The request's resolved environment variables. */
  env: Readonly<Record<string, string>>;
}

/**
 * Resolve one key of a namespace — `{{vault.db/password}}` calls the "vault"
 * provider with key "db/password". Return undefined when the key can't be
 * resolved; throwing is treated the same way (and logged).
 */
export type VariableResolver = (
  key: string,
  context: VariableProviderContext,
) => string | undefined | Promise<string | undefined>;

interface RegisteredProvider {
  extensionId: string;
  resolve: VariableResolver;
}

const NAMESPACE_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Prefixes core already gives a meaning to.
const RESERVED_NAMESPACES = new Set(["process", "env"]);

const VARIABLE_REFERENCE_REGEX = /\{\{([^}]+)\}\}/g;

const providers = new Map<string, RegisteredProvider>();

/**
 * Register a provider for `{{namespace.*}}` references.
 * Returns a function that unregisters it.
 */
export function registerVariableProvider(
  extensionId: string,
  namespace: string,
  resolve: VariableResolver,
): () => void {
  if (!NAMESPACE_REGEX.test(namespace)) {
    throw new Error(`Invalid variable provider namespace "${namespace}" — use letters, digits, "_" or "-", starting with a letter.`);
  }
  if (RESERVED_NAMESPACES.has(namespace)) {
    throw new Error(`Variable provider namespace "${namespace}" is reserved by Voiden.`);
  }
  const existing = providers.get(namespace);
  if (existing && existing.extensionId !== extensionId) {
    throw new Error(`Variable provider namespace "${namespace}" is already registered by "${existing.extensionId}".`);
  }

  const entry: RegisteredProvider = { extensionId, resolve };
  providers.set(namespace, entry);
  logger.info("plugin", `[VariableProviders] ${extensionId} registered namespace "${namespace}"`);

  return () => {
    if (providers.get(namespace) === entry) providers.delete(namespace);
  };
}

/** Drop every provider an extension registered (called when it unloads). */
export function unregisterVariableProviders(extensionId: string): void {
  for (const [namespace, entry] of providers) {
    if (entry.extensionId === extensionId) providers.delete(namespace);
  }
}

/** Test helper — forget all providers. */
export function clearVariableProviders(): void {
  providers.clear();
}

function splitReference(name: string): { namespace: string; key: string } | null {
  const dot = name.indexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return { namespace: name.slice(0, dot), key: name.slice(dot + 1) };
}

/**
 * Resolve every provider-backed reference in `text`. Returns a map from the
 * full reference name (e.g. "vault.api_token") to its value; references that
 * failed to resolve are absent. Names already defined in the environment are
 * skipped, so an explicit environment variable always wins.
 */
export async function resolveProviderVariables(
  text: string,
  context: VariableProviderContext,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (providers.size === 0 || !text.includes("{{")) return resolved;

  const pending = new Map<string, { namespace: string; key: string; provider: RegisteredProvider }>();
  for (const match of text.matchAll(VARIABLE_REFERENCE_REGEX)) {
    const name = match[1].trim();
    if (pending.has(name) || context.env[name] !== undefined) continue;
    const ref = splitReference(name);
    const provider = ref && providers.get(ref.namespace);
    if (ref && provider) pending.set(name, { ...ref, provider });
  }

  await Promise.all(
    [...pending].map(async ([name, { namespace, key, provider }]) => {
      try {
        const value = await provider.resolve(key, context);
        if (value !== undefined && value !== null) resolved.set(name, String(value));
      } catch (error) {
        // Never log the value — only which reference failed and why.
        logger.warn("plugin", `[VariableProviders] ${provider.extensionId} failed to resolve {{${namespace}.${key}}}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return resolved;
}
