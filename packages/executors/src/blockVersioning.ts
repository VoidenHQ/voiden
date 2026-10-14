/**
 * Compares a block's declared plugin+version tag (stamped by the app when
 * the file was saved) against what's actually installed. Used by
 * voiden-runner, which refuses to run a section whose blocks the installed
 * plugin can't handle (and by extension @voiden/mcp, which runs /tool
 * requests through it). The app itself doesn't enforce versions — it only
 * flags a block whose plugin isn't installed at all.
 */

export interface DeclaredBlockVersion {
  pluginId: string
  pluginVersion: string
  blockType: string
}

export type BlockVersionStatus = 'ok' | 'not-installed' | 'disabled' | 'version-mismatch'

export interface InstalledPluginInfo {
  version?: string
  enabled?: boolean
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease?: string
}

function parseVersion(version: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim())
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] }
}

/** Semver precedence: <0 if a < b, 0 if equal, >0 if a > b. A prerelease
 *  sorts before its release (2.3.0-beta.1 < 2.3.0). */
function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return a[k] - b[k]
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === undefined) return 1
  if (b.prerelease === undefined) return -1
  const ap = a.prerelease.split('.')
  const bp = b.prerelease.split('.')
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined) return -1
    if (bp[i] === undefined) return 1
    const an = /^\d+$/.test(ap[i]) ? +ap[i] : NaN
    const bn = /^\d+$/.test(bp[i]) ? +bp[i] : NaN
    if (!isNaN(an) && !isNaN(bn)) { if (an !== bn) return an - bn; continue }
    if (!isNaN(an)) return -1
    if (!isNaN(bn)) return 1
    if (ap[i] !== bp[i]) return ap[i] < bp[i] ? -1 : 1
  }
  return 0
}

/** Same compatibility range as npm's `^`: same major; for 0.x the same
 *  minor too (0.x minors may break); for 0.0.x the exact patch. Within it a
 *  newer plugin reads blocks saved by an older one — plugins migrate their
 *  own older block shapes — so only an older, or a newer-but-incompatible,
 *  plugin is a mismatch. */
function sameCompatibilityRange(a: ParsedVersion, b: ParsedVersion): boolean {
  if (a.major !== b.major) return false
  if (a.major !== 0) return true
  if (a.minor !== b.minor) return false
  if (a.minor !== 0) return true
  return a.patch === b.patch
}

/** Why an installed plugin can't run a block — undefined when it can. */
export function blockVersionMismatchKind(
  installedVersion: string,
  declaredVersion: string,
): 'too-old' | 'incompatible-newer' | 'different' | undefined {
  if (installedVersion === declaredVersion) return undefined
  const installed = parseVersion(installedVersion)
  const declared = parseVersion(declaredVersion)
  // Not semver — nothing to reason about, so only an exact match runs.
  if (!installed || !declared) return 'different'
  const cmp = compareParsed(installed, declared)
  if (cmp < 0) return 'too-old'
  if (!sameCompatibilityRange(installed, declared)) return 'incompatible-newer'
  return undefined
}

export function classifyBlockVersion(
  declared: DeclaredBlockVersion,
  installed: InstalledPluginInfo | undefined,
): BlockVersionStatus {
  if (!installed || !installed.version) return 'not-installed'
  if (installed.enabled === false) return 'disabled'
  if (blockVersionMismatchKind(installed.version, declared.pluginVersion)) return 'version-mismatch'
  return 'ok'
}
