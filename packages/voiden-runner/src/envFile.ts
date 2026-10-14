import { readFileSync } from 'fs'
import { extname } from 'path'
import YAML from 'yaml'

interface YamlEnvNode {
  variables?: Record<string, unknown>
  children?: Record<string, YamlEnvNode>
}

/**
 * Structurally merges two parsed YAML env trees (e.g. a profile's public +
 * private content) — `b`'s `variables:` win over `a`'s per node on key
 * conflict (matches the app's own public/private precedence, see env.ts's
 * loadYamlEnvironments), `children:` are merged recursively rather than one
 * replacing the other wholesale, so a child defined only in `a` still shows
 * up even if `b` also defines siblings under the same parent.
 */
export function mergeYamlEnvTrees(a: unknown, b: unknown): Record<string, unknown> {
  const treeA = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {}
  const treeB = b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
  const keys = new Set([...Object.keys(treeA), ...Object.keys(treeB)])
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const nodeA = treeA[key]
    const nodeB = treeB[key]
    const isNodeA = nodeA != null && typeof nodeA === 'object' && !Array.isArray(nodeA)
    const isNodeB = nodeB != null && typeof nodeB === 'object' && !Array.isArray(nodeB)
    if (!isNodeA && !isNodeB) { result[key] = nodeB ?? nodeA; continue }
    const a2 = (isNodeA ? nodeA : {}) as YamlEnvNode
    const b2 = (isNodeB ? nodeB : {}) as YamlEnvNode
    result[key] = {
      variables: { ...(a2.variables ?? {}), ...(b2.variables ?? {}) },
      ...(a2.children || b2.children
        ? { children: mergeYamlEnvTrees(a2.children ?? {}, b2.children ?? {}) }
        : {}),
    }
  }
  return result
}

/**
 * `environmentName`, when given, scopes YAML loading to exactly one named
 * environment (e.g. "dev") instead of the default "flatten every
 * environment in the file together" behavior — the latter merges every
 * top-level key's `variables:` (and nested `children:`) into one map
 * regardless of name, which silently lets same-named keys from different
 * environments collide (last one processed wins). Meaningless for a plain
 * .env file (nothing named to select) or a flat YAML mapping with no
 * `variables:`/`children:` structure — ignored in both cases rather than
 * treated as an error, since there's genuinely nothing to scope to.
 */
export function loadEnvFile(envPath: string, environmentName?: string): Record<string, string> {
  const content = readFileSync(envPath, 'utf-8')
  const ext = extname(envPath).toLowerCase()

  if (ext === '.yaml' || ext === '.yml') {
    return parseYamlEnv(content, environmentName)
  }

  return parseDotEnv(content)
}

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) throw new Error(`Malformed line ${i + 1} in .env file: missing "="`)
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!key) throw new Error(`Malformed line ${i + 1} in .env file: empty key`)
    env[key] = val
  }
  return env
}

function ownVariables(node: YamlEnvNode): Record<string, string> {
  const vars: Record<string, string> = {}
  if (node.variables != null && typeof node.variables === 'object') {
    for (const [k, v] of Object.entries(node.variables)) {
      if (v != null && typeof v !== 'object') vars[k] = String(v)
    }
  }
  return vars
}

/** Depth-first search for a named environment node anywhere in the tree
 *  (top-level or nested under some ancestor's `children:`), returning its
 *  resolved variables — its own `variables:` merged on top of every
 *  ancestor's, same inheritance order `collect()` below already produces
 *  implicitly for the whole-tree case, just scoped to one branch instead
 *  of every branch at once. */
function findEnvironment(
  tree: Record<string, unknown>,
  name: string,
  inherited: Record<string, string> = {},
): Record<string, string> | null {
  for (const [key, value] of Object.entries(tree)) {
    if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') continue
    const node = value as YamlEnvNode
    const resolved = { ...inherited, ...ownVariables(node) }
    if (key === name) return resolved
    if (node.children != null && typeof node.children === 'object') {
      const found = findEnvironment(node.children as Record<string, unknown>, name, resolved)
      if (found) return found
    }
  }
  return null
}

/** Top-level environment names only (for an error message listing what IS
 *  available) — deliberately not the full nested tree, to keep that
 *  message short and scannable. */
function topLevelEnvironmentNames(tree: Record<string, unknown>): string[] {
  return Object.entries(tree)
    .filter(([, value]) => value != null && typeof value === 'object' && !Array.isArray(value))
    .map(([key]) => key)
}

/**
 * Navigates a tree by an exact dotted path (as produced by
 * listYamlEnvironmentNames, e.g. "staging.eu") rather than searching for a
 * bare key anywhere — unlike findEnvironment above (kept as-is for the
 * CLI's existing --environment <name> flag, which intentionally matches by
 * bare name wherever it occurs), a dotted path must resolve deterministically:
 * two different parents can each have a child literally named "eu", and
 * only a full-path walk tells them apart. Same inheritance order (each
 * segment's own variables merge on top of everything above it).
 */
export function findEnvironmentByPath(tree: Record<string, unknown>, dottedPath: string): Record<string, string> | null {
  let current = tree
  let resolved: Record<string, string> = {}
  for (const segment of dottedPath.split('.')) {
    const value = current[segment]
    if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') return null
    const node = value as YamlEnvNode
    resolved = { ...resolved, ...ownVariables(node) }
    current = (node.children ?? {}) as Record<string, unknown>
  }
  return resolved
}

/** Every named environment in the tree, at any depth, as dotted paths
 *  (e.g. "staging", "staging.eu") — unlike topLevelEnvironmentNames, this
 *  IS meant to show the full nested shape (used by list_environments to
 *  show a profile's environment hierarchy, not just an error hint). */
export function listYamlEnvironmentNames(content: string): string[] {
  const parsed = YAML.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const names: string[] = []
  const walk = (tree: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(tree)) {
      if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') continue
      const path = prefix ? `${prefix}.${key}` : key
      names.push(path)
      const node = value as YamlEnvNode
      if (node.children != null && typeof node.children === 'object') {
        walk(node.children as Record<string, unknown>, path)
      }
    }
  }
  walk(parsed as Record<string, unknown>, '')
  return names
}

export function parseYamlEnv(content: string, environmentName?: string): Record<string, string> {
  const parsed = YAML.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const tree = parsed as Record<string, unknown>

  if (environmentName) {
    const found = findEnvironment(tree, environmentName)
    if (found) return found
    // No named-environment structure at all (a flat mapping) means nothing
    // to scope to — fall through to the flatten-everything behavior below
    // rather than erroring on a flag that's simply inapplicable to this file.
    const available = topLevelEnvironmentNames(tree)
    if (available.length > 0) {
      throw new Error(
        `Environment "${environmentName}" not found in this file. Available: ${available.join(', ')}`,
      )
    }
  }

  const env: Record<string, string> = {}
  const collect = (node: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(node)) {
      if (value === null || value === undefined || Array.isArray(value)) continue

      if (typeof value !== 'object') {
        env[key] = String(value)
        continue
      }

      const envNode = value as YamlEnvNode
      Object.assign(env, ownVariables(envNode))
      if (envNode.children != null && typeof envNode.children === 'object') {
        collect(envNode.children as Record<string, unknown>)
      }
    }
  }
  collect(tree)
  return env
}
