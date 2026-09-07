/**
 * Headless env-profile discovery/resolution for the `list_environments`/
 * `select_environment` fixed MCP tools (mcpServing.ts). A deliberately
 * simplified port of apps/electron/src/main/env.ts's profile logic — same
 * precedent as plugins/voiden-mcp-tool/src/lib/toolCapability.ts's
 * loadProjectEnvironmentVars, which already does this for its own narrower
 * needs. No Electron dependency (this package is a standalone CLI/library),
 * no UI "active profile" state, no nested sub-project scanning, no legacy
 * dotted `.env.foo.bar` hierarchy chain — see mcpServing.ts's callers for
 * what's actually needed here.
 */

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseYamlEnv, listYamlEnvironmentNames, mergeYamlEnvTrees, findEnvironmentByPath } from './envFile.js'
import YAML from 'yaml'

const VOIDEN_DIR = '.voiden'
const PROFILE_FILE_PATTERN = /^env-([a-z0-9-]+)-(public|private)\.yaml$/

export interface EnvProfileInfo {
  name: string
  source: 'yaml' | 'legacy-dotenv'
  /** Present only when source === 'yaml' and the file actually exists. */
  publicFile?: string
  privateFile?: string
  /** Dotted environment paths (e.g. "staging", "staging.eu") — only when source === 'yaml'. */
  environments?: string[]
  /** Discovered .env* files (project root + .voiden/) — only when source === 'legacy-dotenv'. */
  dotEnvFiles?: string[]
}

function profileFileNames(projectRoot: string, profile: string): { publicFile: string; privateFile: string } {
  const dir = join(projectRoot, VOIDEN_DIR)
  if (profile === 'default') {
    return { publicFile: join(dir, 'env-public.yaml'), privateFile: join(dir, 'env-private.yaml') }
  }
  return { publicFile: join(dir, `env-${profile}-public.yaml`), privateFile: join(dir, `env-${profile}-private.yaml`) }
}

/** Mirrors env.ts's discoverProfiles — scan .voiden/ for named profile
 *  files, "default" always included even with no files on disk yet. */
function discoverProfileNames(projectRoot: string): string[] {
  const names = new Set<string>(['default'])
  const dir = join(projectRoot, VOIDEN_DIR)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return Array.from(names)
  }
  for (const entry of entries) {
    const match = PROFILE_FILE_PATTERN.exec(entry)
    if (match) names.add(match[1])
  }
  return Array.from(names)
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf-8') : undefined
}

/** project root + .voiden/, non-recursive — same scope as env.ts's
 *  loadProjectEnv fallback, minus the dotted-chain hierarchy machinery
 *  (out of scope here, see the plan's "Not doing" section). */
function discoverDotEnvFiles(projectRoot: string): string[] {
  const dirs = [projectRoot, join(projectRoot, VOIDEN_DIR)]
  const found: string[] = []
  for (const dir of dirs) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.startsWith('.env')) found.push(join(dir, entry))
    }
  }
  return found
}

export function discoverEnvProfiles(projectRoot: string): EnvProfileInfo[] {
  return discoverProfileNames(projectRoot).map((name): EnvProfileInfo => {
    const { publicFile, privateFile } = profileFileNames(projectRoot, name)
    const publicContent = readIfExists(publicFile)
    const privateContent = readIfExists(privateFile)

    if (publicContent || privateContent) {
      const merged = mergeYamlEnvTrees(
        publicContent ? YAML.parse(publicContent) : {},
        privateContent ? YAML.parse(privateContent) : {},
      )
      const environments = listYamlEnvironmentNames(YAML.stringify(merged))
      if (environments.length > 0) {
        return {
          name,
          source: 'yaml',
          ...(publicContent ? { publicFile } : {}),
          ...(privateContent ? { privateFile } : {}),
          environments,
        }
      }
    }

    return { name, source: 'legacy-dotenv', dotEnvFiles: discoverDotEnvFiles(projectRoot) }
  })
}

/** Resolves the final variable map for one profile (+ optional named
 *  environment within it). Throws if the profile doesn't exist or the
 *  named environment isn't found in it (same "available: ..." style error
 *  envFile.ts's own parseYamlEnv already throws for an unknown name). */
export function resolveEnvProfile(
  projectRoot: string,
  profile: string,
  environmentName?: string,
): Record<string, string> {
  const profiles = discoverEnvProfiles(projectRoot)
  const info = profiles.find((p) => p.name === profile)
  if (!info) {
    throw new Error(`Unknown profile "${profile}". Available: ${profiles.map((p) => p.name).join(', ')}`)
  }

  if (info.source === 'legacy-dotenv') {
    const env: Record<string, string> = {}
    for (const path of info.dotEnvFiles ?? []) {
      try {
        Object.assign(env, parseDotEnvLoose(readFileSync(path, 'utf-8')))
      } catch {
        // A malformed .env* file shouldn't block resolving the others —
        // select_environment's job is "best available", not strict parsing.
      }
    }
    return env
  }

  const { publicFile, privateFile } = profileFileNames(projectRoot, profile)
  const publicContent = readIfExists(publicFile) ?? ''
  const privateContent = readIfExists(privateFile) ?? ''
  const merged = mergeYamlEnvTrees(
    publicContent ? YAML.parse(publicContent) : {},
    privateContent ? YAML.parse(privateContent) : {},
  )

  if (environmentName) {
    // Path-based, not envFile.ts's own bare-name findEnvironment — that one
    // searches for a matching key ANYWHERE in the tree (fine for the CLI's
    // simpler --environment <name> flag), but list_environments returns
    // full dotted paths specifically to disambiguate same-named children
    // under different parents (e.g. "staging.eu" vs "prod.eu") — only a
    // full-path walk resolves the right one.
    const resolved = findEnvironmentByPath(merged, environmentName)
    if (!resolved) {
      const available = listYamlEnvironmentNames(YAML.stringify(merged))
      throw new Error(`Environment "${environmentName}" not found in profile "${profile}". Available: ${available.join(', ')}`)
    }
    return resolved
  }

  return parseYamlEnv(YAML.stringify(merged))
}

/** Same shape as envFile.ts's private parseDotEnv, duplicated rather than
 *  exported from there since that one throws on a malformed line (correct
 *  for an explicit --env <path>) where discovery here wants best-effort. */
function parseDotEnvLoose(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}
