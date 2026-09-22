/**
 * Best-effort read of the Voiden Electron app's own core-plugin enabled state.
 *
 * voiden-runner keeps its own plugin store (~/.voiden/plugins.json, see
 * store.ts) so it can run standalone with no Electron app installed at all.
 * But most users never touch that store directly — they enable/disable core
 * plugins from the app's Settings screen, which persists to a completely
 * different file: <userData>/plugins/core-disabled.json (see apps/electron's
 * extensionManager.ts / paths.ts). The two stores are never synced.
 *
 * Without this, a plugin the user just enabled in the app can still read as
 * disabled to voiden-runner / the MCP tools (list_requests, run_request,
 * write_result) — e.g. "Plugin \"voiden-graphql\" is installed but disabled"
 * even though Settings shows it enabled — because voiden-runner never looked
 * at the app's file, only its own.
 *
 * This is read-only and deliberately non-throwing: a pure CLI/MCP user with
 * no Electron app installed at all should see no difference in behaviour —
 * the file just won't exist, and isCorePluginEnabled falls through to its
 * existing "no record = enabled" default.
 */

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Matches Electron's own `app.getPath('userData')`, which is derived from
// the app's `productName` ("Voiden" — see apps/electron/package.json) and
// differs per OS. Duplicated here (rather than imported) because
// voiden-runner has no dependency on the `electron` package — it must work
// as a standalone Node CLI with no Electron app installed at all.
function getElectronUserDataDir(): string | null {
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Voiden')
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Voiden')
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Voiden')
  }
}

let cachedDisabled: Set<string> | undefined

/** Core plugin ids the Electron app has explicitly disabled, per its own store. Empty if the app isn't installed / has never run. */
function getAppDisabledCorePlugins(): Set<string> {
  if (cachedDisabled) return cachedDisabled

  cachedDisabled = new Set()
  const userDataDir = getElectronUserDataDir()
  if (!userDataDir) return cachedDisabled

  const disabledPath = join(userDataDir, 'plugins', 'core-disabled.json')
  if (!existsSync(disabledPath)) return cachedDisabled

  try {
    const ids = JSON.parse(readFileSync(disabledPath, 'utf-8'))
    if (Array.isArray(ids)) cachedDisabled = new Set(ids)
  } catch {
    // Malformed/unreadable — treat as "app has nothing disabled" rather than failing.
  }
  return cachedDisabled
}

/** True if the Electron app's own plugin store explicitly disabled this core plugin. */
export function isDisabledInElectronApp(pluginId: string): boolean {
  return getAppDisabledCorePlugins().has(pluginId)
}
