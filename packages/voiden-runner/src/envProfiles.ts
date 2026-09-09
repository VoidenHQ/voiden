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
import { join, resolve, extname } from 'path'
import { parseYamlEnv, listYamlEnvironmentNames, mergeYamlEnvTrees, findEnvironmentByPath, loadEnvFile } from './envFile.js'
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

export interface EnvCliOpts {
  /** Path to one plain .env (dotenv) file — for a file outside the
   *  project's profile convention entirely (e.g. a CI-provided secrets
   *  path). Deliberately NOT for YAML: a real profile is always a *pair*
   *  of files (env-<profile>-public.yaml + -private.yaml, merged), which a
   *  single --env path could never represent correctly anyway — that's
   *  what --profile is for. */
  env?: string
  /** Which profile to use — same profile system list_environments/
   *  select_environment already expose to an MCP agent, now also reachable
   *  from the command line instead of only knowing a raw file path. `true`
   *  (commander's value for a bare flag with no argument) means "default",
   *  the same profile discoverEnvProfiles/resolveEnvProfile already treat
   *  as the unnamed one. */
  profile?: string | true
  /** Scopes either of the above down to one named environment inside
   *  whichever file/profile was actually loaded. */
  environment?: string
}

/** Thrown by resolveCliEnv for a usage mistake (not found, ambiguous
 *  flags) — callers already wrap their existing --env loading in a
 *  try/catch that prints the message and exits with EXIT_USAGE_ERROR; this
 *  just gives that same catch something to catch for the --profile path
 *  too, instead of duplicating that error-reporting shape here. */
export class EnvCliOptsError extends Error {}

/**
 * Resolves the env-selection flags shared across voiden-runner's
 * run/mcp serve/tool verify commands into a merged variable map, layered on
 * top of whatever base env the caller already has (typically process.env).
 *
 * Two independent ways to point at variables — --profile and --env — are
 * deliberately mutually exclusive: mixing "use the profile system" and
 * "use this one specific file instead" has no obvious shared meaning, so
 * this throws rather than silently picking one. Passing neither is
 * unchanged from before this existed: nothing gets loaded, only baseEnv
 * comes back — an existing invocation with no env flags at all keeps
 * working exactly as it did.
 */
export function resolveCliEnv(
  opts: EnvCliOpts,
  projectRoot: string,
  baseEnv: Record<string, string>,
): Record<string, string> {
  if (opts.env && opts.profile) {
    throw new EnvCliOptsError('--env and --profile are mutually exclusive — pick one way to point at variables.')
  }

  const env = { ...baseEnv }

  if (opts.profile !== undefined) {
    const profileName = opts.profile === true ? 'default' : opts.profile
    try {
      Object.assign(env, resolveEnvProfile(projectRoot, profileName, opts.environment))
    } catch (err: any) {
      throw new EnvCliOptsError(err?.message ?? String(err))
    }
    return env
  }

  if (opts.env) {
    const envPath = resolve(opts.env)
    if (!existsSync(envPath)) {
      throw new EnvCliOptsError(`Env file not found: ${envPath}`)
    }
    const ext = extname(envPath).toLowerCase()
    if (ext === '.yaml' || ext === '.yml') {
      throw new EnvCliOptsError(
        '--env only accepts a plain .env file now. A YAML profile is always a pair of files ' +
        '(env-<profile>-public.yaml + -private.yaml, merged) — a single --env path can\'t represent ' +
        'that correctly. Use --profile <name> instead (bare --profile means "default").'
      )
    }
    if (opts.environment) {
      throw new EnvCliOptsError('--environment only applies with --profile — a plain .env file has no named-environment concept to scope to.')
    }
    try {
      Object.assign(env, loadEnvFile(envPath))
    } catch (err: any) {
      throw new EnvCliOptsError(err?.message ?? String(err))
    }
  }

  return env
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
