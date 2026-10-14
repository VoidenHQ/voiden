/**
 * Request Container Registry — lets each protocol plugin (REST, GraphQL,
 * sockets/gRPC, or any third-party protocol plugin) declare its own "this
 * block is the request" shape, instead of voiden-runner's core hardcoding
 * knowledge of every plugin's block types.
 *
 * Mirrors blockSchemaRegistry.ts exactly: plugins call
 * context.registerRequestContainer() in their runner.ts onload(), and the
 * registry is cleared/rebuilt fresh on every loadEnabledPlugins() call (same
 * as block schemas — a disabled plugin's registration shouldn't linger).
 *
 * Used by list_requests (preview) and write_result (finding which block to
 * attach a response to) so both work across whatever protocol plugins happen
 * to be installed, not just the ones bundled with voiden-runner by default.
 */

export interface RequestContainerDef {
  /** Block type string, e.g. 'gqlquery'. Matches the YAML `type:` field. */
  type: string
  /** Child block type holding the request URL as its (string) content. */
  urlType: string
  /** Child block type holding the method/protocol tag as its (string) content, if any. */
  methodType?: string
  /** Fixed method when the protocol has no explicit method child (e.g. GraphQL is always POST). */
  defaultMethod?: string
}

const containers = new Map<string, RequestContainerDef>()

export function registerRequestContainer(def: RequestContainerDef): void {
  containers.set(def.type, def)
}

export function clearRequestContainers(): void {
  containers.clear()
}

export function getRequestContainerDef(type: string): RequestContainerDef | undefined {
  return containers.get(type)
}

/**
 * Finds the block that represents "the request" in a section, across
 * whichever protocol plugins are currently registered.
 */
export function findRequestBlock(blocks: any[]): any | undefined {
  for (const type of containers.keys()) {
    const req = blocks.find((b: any) => b.type === type)
    if (req) return req
  }
  return undefined
}

/** Returns all registered container type names — useful for debugging. */
export function getRegisteredContainerTypes(): string[] {
  return Array.from(containers.keys())
}
