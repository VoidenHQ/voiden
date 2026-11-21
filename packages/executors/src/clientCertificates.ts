/**
 * Client certificates (mTLS).
 *
 * A project may declare certificate profiles in `.voiden/certificates.yaml`:
 *
 * ```yaml
 * profiles:
 *   payments-mtls:
 *     hosts: ["*.payments.internal", "api.bank.com:8443"]
 *     cert: ./certs/{{ENV}}/client.pem
 *     key:  ./certs/{{ENV}}/client.key
 *     ca:   ./certs/ca.pem                # optional
 *     passphrase: "{{CLIENT_CERT_PASS}}"  # optional
 *   partner-pfx:
 *     hosts: ["partner.example.com"]
 *     pfx: ./certs/partner.p12
 *     passphrase: "{{PARTNER_PFX_PASS}}"
 * ```
 *
 * The file holds paths and variable references only. This module picks the
 * profile for a URL, reads the referenced files and returns undici/`tls`
 * `connect` options. Key material is only ever returned to the caller (the
 * main process / CLI) and is never part of an error message.
 */

import { createSecureContext } from 'node:tls'
import { readFile as fsReadFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Buffer } from 'node:buffer'
import { parse as parseYaml } from 'yaml'

/** Location of the profiles file, relative to the project root. */
export const CERTIFICATES_FILE = '.voiden/certificates.yaml'

/** A profile as declared in `certificates.yaml` (paths and variable references only). */
export interface ClientCertificateProfile {
  name: string
  hosts: string[]
  cert?: string
  key?: string
  pfx?: string
  ca?: string
  passphrase?: string
}

/** TLS options to merge into an undici `connect` option bag. */
export interface ClientCertificateConnectOptions {
  cert?: Buffer
  key?: Buffer
  pfx?: Buffer
  ca?: Buffer
  passphrase?: string
}

export interface ResolvedClientCertificate {
  /** Name of the profile that was selected. */
  profile: string
  connect: ClientCertificateConnectOptions
}

/** Thrown for any problem with the certificate configuration. The message is safe to show to the user. */
export class ClientCertificateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientCertificateError'
  }
}

const PATH_FIELDS = ['cert', 'key', 'pfx', 'ca'] as const

/**
 * Parse the contents of `certificates.yaml`. Profile order is preserved
 * because the first matching profile wins.
 */
export function parseCertificateProfiles(yamlText: string): ClientCertificateProfile[] {
  let doc: unknown
  try {
    doc = parseYaml(yamlText)
  } catch (err: any) {
    throw new ClientCertificateError(`${CERTIFICATES_FILE} is not valid YAML: ${err?.message ?? err}`)
  }
  if (doc === null || doc === undefined) return []

  const profilesNode = (doc as any)?.profiles
  if (profilesNode === null || profilesNode === undefined) return []
  if (typeof profilesNode !== 'object' || Array.isArray(profilesNode)) {
    throw new ClientCertificateError(`${CERTIFICATES_FILE}: "profiles" must be a map of profile name to settings`)
  }

  const profiles: ClientCertificateProfile[] = []
  for (const [name, raw] of Object.entries(profilesNode as Record<string, any>)) {
    const where = `${CERTIFICATES_FILE}: profile "${name}"`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ClientCertificateError(`${where} must be a map`)
    }

    const hostsRaw = typeof raw.hosts === 'string' ? [raw.hosts] : raw.hosts
    if (!Array.isArray(hostsRaw) || hostsRaw.length === 0 || hostsRaw.some((h: unknown) => typeof h !== 'string' || !h.trim())) {
      throw new ClientCertificateError(`${where} needs a non-empty "hosts" list`)
    }

    const profile: ClientCertificateProfile = { name, hosts: hostsRaw.map((h: string) => h.trim()) }
    for (const field of PATH_FIELDS) {
      if (raw[field] === undefined || raw[field] === null) continue
      if (typeof raw[field] !== 'string' || !raw[field].trim()) {
        throw new ClientCertificateError(`${where}: "${field}" must be a file path`)
      }
      profile[field] = raw[field].trim()
    }
    if (raw.passphrase !== undefined && raw.passphrase !== null) {
      profile.passphrase = String(raw.passphrase)
    }

    if (profile.pfx) {
      if (profile.cert || profile.key) {
        throw new ClientCertificateError(`${where}: use either "pfx" or "cert" + "key", not both`)
      }
    } else if (!profile.cert || !profile.key) {
      throw new ClientCertificateError(`${where} needs "pfx", or both "cert" and "key"`)
    }

    profiles.push(profile)
  }
  return profiles
}

function defaultPort(protocol: string): string {
  return protocol === 'http:' || protocol === 'ws:' ? '80' : '443'
}

/**
 * Whether a host pattern matches a URL.
 *
 * - Case-insensitive.
 * - `*.example.com` matches any subdomain (`a.example.com`, `a.b.example.com`)
 *   but not `example.com` itself — list both to cover both.
 * - An optional `:port` restricts the match to that port; the scheme's default
 *   port (80 for http/ws, 443 for https/wss) is used when the URL has none.
 *   Without a port in the pattern any port matches.
 */
export function hostMatchesPattern(pattern: string, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port = parsed.port || defaultPort(parsed.protocol)

  let host = pattern.trim().toLowerCase()
  let patternPort: string | undefined
  const portMatch = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(host)
  if (portMatch) {
    host = portMatch[1]
    patternPort = portMatch[2]
  }
  host = host.replace(/^\[|\]$/g, '')

  if (patternPort !== undefined && patternPort !== port) return false
  if (host.startsWith('*.')) {
    const suffix = host.slice(1) // ".example.com"
    return hostname.length > suffix.length && hostname.endsWith(suffix)
  }
  return hostname === host
}

/**
 * Pick the profile for a URL.
 *
 * @param choice `auto` (default) — first profile whose hosts match; `none` — never
 *   use a certificate; anything else — the profile with that name.
 * @returns the profile, or `null` when no certificate should be sent.
 */
export function selectClientCertificateProfile(
  profiles: ClientCertificateProfile[],
  url: string,
  choice?: string,
): ClientCertificateProfile | null {
  const wanted = (choice ?? '').trim()
  if (wanted.toLowerCase() === 'none') return null

  if (wanted && wanted.toLowerCase() !== 'auto') {
    const named = profiles.find(p => p.name === wanted)
    if (!named) {
      const available = profiles.map(p => p.name).join(', ') || 'none defined'
      throw new ClientCertificateError(
        `client_certificate "${wanted}" is not a profile in ${CERTIFICATES_FILE} (available: ${available})`,
      )
    }
    return named
  }

  return profiles.find(p => p.hosts.some(h => hostMatchesPattern(h, url))) ?? null
}

export interface ResolveClientCertificateParams {
  /** Absolute URL of the request. */
  url: string
  /** Value of the `client_certificate` option: `auto`, `none` or a profile name. */
  choice?: string
  /** Project root; `certificates.yaml` and relative paths are resolved against it. */
  projectRoot?: string
  /** Replaces `{{variables}}` in paths and the passphrase. */
  replaceVar?: (text: string) => Promise<string>
  /** File reader, defaults to `fs.readFile`. Receives an absolute path. */
  readFile?: (absolutePath: string) => Promise<Buffer>
}

/**
 * Resolve the client certificate for a request, or `null` when none applies
 * (plain http/ws URL, no project, no `certificates.yaml`, `none`, or no matching host).
 *
 * @throws ClientCertificateError when the configuration is invalid, a file is
 *   missing, or the key cannot be loaded (for example a wrong passphrase).
 */
export async function resolveClientCertificate(
  params: ResolveClientCertificateParams,
): Promise<ResolvedClientCertificate | null> {
  const { url, projectRoot } = params
  const choice = String(params.choice ?? '').trim()
  if (choice.toLowerCase() === 'none') return null

  // Client certificates are a TLS feature; plain http:/ws: requests have no handshake to present one in.
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'ws:') return null
  } catch {
    return null
  }

  const readFile = params.readFile ?? ((p: string) => fsReadFile(p))
  const replaceVar = params.replaceVar ?? (async (t: string) => t)
  const explicit = choice !== '' && choice.toLowerCase() !== 'auto'

  // A named profile in a project-less context cannot be honoured; ignoring it
  // would silently send the request without a certificate.
  if (!projectRoot) {
    if (explicit) {
      throw new ClientCertificateError(`client_certificate "${choice}" needs an open project with ${CERTIFICATES_FILE}`)
    }
    return null
  }

  let yamlText: string
  try {
    yamlText = (await readFile(join(projectRoot, CERTIFICATES_FILE))).toString('utf8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      if (explicit) {
        throw new ClientCertificateError(`client_certificate "${choice}" requires ${CERTIFICATES_FILE}, which does not exist`)
      }
      return null
    }
    throw new ClientCertificateError(`Cannot read ${CERTIFICATES_FILE}: ${err?.message ?? err}`)
  }

  const profile = selectClientCertificateProfile(parseCertificateProfiles(yamlText), url, choice)
  if (!profile) return null

  const where = `Client certificate profile "${profile.name}"`
  const connect: ClientCertificateConnectOptions = {}

  for (const field of PATH_FIELDS) {
    const template = profile[field]
    if (!template) continue
    const resolvedPath = (await replaceVar(template)).trim()
    if (!resolvedPath) throw new ClientCertificateError(`${where}: "${field}" resolved to an empty path`)
    const absolutePath = isAbsolute(resolvedPath) ? resolvedPath : resolve(projectRoot, resolvedPath)
    try {
      connect[field] = await readFile(absolutePath)
    } catch (err: any) {
      const reason = err?.code === 'ENOENT' ? 'file not found' : err?.code || err?.message || 'unreadable'
      throw new ClientCertificateError(`${where}: cannot read ${field} file ${absolutePath} (${reason})`)
    }
  }

  if (profile.passphrase !== undefined) {
    connect.passphrase = await replaceVar(profile.passphrase)
  }

  // Parse the key now so a wrong passphrase or malformed file is reported
  // clearly instead of surfacing later as an opaque "fetch failed".
  try {
    createSecureContext({ ...connect })
  } catch (err: any) {
    const detail = /bad decrypt|passphrase|mac verify|bad password/i.test(String(err?.message))
      ? 'wrong or missing passphrase'
      : 'the certificate or key could not be parsed'
    throw new ClientCertificateError(`${where}: ${detail}`)
  }

  return { profile: profile.name, connect }
}
