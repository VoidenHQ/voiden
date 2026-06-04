/**
 * Block Schema Registry — headless equivalent of TipTap node registration.
 *
 * In the electron app, plugins call context.registerVoidenExtension(tiptapNode)
 * where the TipTap node's addAttributes() defines the block schema (attribute
 * names and their default values).  The editor uses that schema to normalise
 * every block before handing it to request-building logic.
 *
 * In voiden-runner there is no TipTap / DOM, but we need the same normalisation
 * so that:
 *   • Missing attrs are filled with their declared defaults (no more defensive
 *     `?.` chains scattered through every buildRequest implementation)
 *   • Block ownership is explicit — the runner knows which plugin owns which
 *     block type, matching the manifest.json capabilities.blocks.owns contract
 *
 * Plugins call context.registerBlockSchema() in their runner.ts onload().
 * The runner normalises parsed blocks via normalizeBlocks() before passing
 * them to any registered request builder.
 */

/** Mirrors TipTap's Attribute definition — only the parts relevant headlessly. */
export interface BlockAttrDef {
  default?: any
}

/** Headless equivalent of a TipTap Node definition. */
export interface BlockSchemaDef {
  /** Block type string, e.g. 'gqlquery'.  Matches the YAML `type:` field. */
  name: string
  /** Map of attribute name → definition.  Only `default` is used at runtime. */
  attrs: Record<string, BlockAttrDef>
}

const schemas = new Map<string, BlockSchemaDef>()

export function registerBlockSchema(def: BlockSchemaDef): void {
  schemas.set(def.name, def)
}

/**
 * Apply registered schemas to a single block.
 * Fills in any attrs that are missing from the YAML with their declared defaults.
 * Blocks whose type has no registered schema are returned unchanged.
 */
export function normalizeBlock(block: any): any {
  const schema = schemas.get(block.type)
  if (!schema) return block

  const normalizedAttrs: Record<string, any> = {}

  // Apply declared defaults first, then overlay whatever the YAML provided
  for (const [key, def] of Object.entries(schema.attrs)) {
    normalizedAttrs[key] = def.default
  }
  if (block.attrs && typeof block.attrs === 'object') {
    Object.assign(normalizedAttrs, block.attrs)
  }

  return { ...block, attrs: normalizedAttrs }
}

/**
 * Normalise an array of blocks (a full section) against all registered schemas.
 * Recurses into nested content arrays so child blocks (e.g. url inside request)
 * are also normalised.
 */
export function normalizeBlocks(blocks: any[]): any[] {
  return blocks.map(block => {
    const normalized = normalizeBlock(block)
    if (Array.isArray(normalized.content)) {
      return { ...normalized, content: normalizeBlocks(normalized.content) }
    }
    return normalized
  })
}

export function clearSchemas(): void {
  schemas.clear()
}

/** Returns the registered schema for a block type, or undefined. */
export function getBlockSchema(type: string): BlockSchemaDef | undefined {
  return schemas.get(type)
}

/** Returns all registered block type names — useful for debugging. */
export function getRegisteredBlockTypes(): string[] {
  return Array.from(schemas.keys())
}
