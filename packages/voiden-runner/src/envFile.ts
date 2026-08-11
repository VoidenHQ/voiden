import { readFileSync } from 'fs'
import { extname } from 'path'
import YAML from 'yaml'

interface YamlEnvNode {
  variables?: Record<string, unknown>
  children?: Record<string, YamlEnvNode>
}

export function loadEnvFile(envPath: string): Record<string, string> {
  const content = readFileSync(envPath, 'utf-8')
  const ext = extname(envPath).toLowerCase()

  if (ext === '.yaml' || ext === '.yml') {
    return parseYamlEnv(content)
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

function parseYamlEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {}

  const collect = (tree: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(tree)) {
      if (value === null || value === undefined || Array.isArray(value)) continue

      if (typeof value !== 'object') {
        env[key] = String(value)
        continue
      }

      const node = value as YamlEnvNode
      const hasVariables = node.variables != null && typeof node.variables === 'object'
      const hasChildren = node.children != null && typeof node.children === 'object'

      if (hasVariables) {
        for (const [k, v] of Object.entries(node.variables as Record<string, unknown>)) {
          if (v != null && typeof v !== 'object') env[k] = String(v)
        }
      }
      if (hasChildren) collect(node.children as Record<string, unknown>)
    }
  }

  const parsed = YAML.parse(content)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    collect(parsed as Record<string, unknown>)
  }
  return env
}
