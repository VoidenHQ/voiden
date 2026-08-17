import { readFileSync } from 'fs'
import { extname } from 'path'
import YAML from 'yaml'

interface YamlEnvNode {
  variables?: Record<string, unknown>
  children?: Record<string, YamlEnvNode>
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

function parseYamlEnv(content: string, environmentName?: string): Record<string, string> {
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
