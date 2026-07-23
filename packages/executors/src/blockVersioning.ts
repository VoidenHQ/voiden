/**
 * Shared classifier for comparing a block's declared plugin+version tag
 * against what's actually installed. Used by both the Electron app (open-time
 * check) and voiden-runner (run-time check) — each side extracts blocks and
 * looks up installed state differently, but the ok/missing/disabled/mismatch
 * classification itself is identical, so it lives here rather than being
 * duplicated.
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

export function classifyBlockVersion(
  declared: DeclaredBlockVersion,
  installed: InstalledPluginInfo | undefined,
): BlockVersionStatus {
  if (!installed || !installed.version) return 'not-installed'
  if (installed.enabled === false) return 'disabled'
  if (installed.version !== declared.pluginVersion) return 'version-mismatch'
  return 'ok'
}
