/**
 * Plugin-management MCP tools — lets an AI agent connected over MCP install a
 * missing plugin or pull down an available update itself, instead of failing
 * on a missing builder and leaving a human to run `voiden-runner plugin
 * install`/`update` out of band.
 *
 * Deliberately NOT wired into registerFixedTools() (the 6 tools shared by
 * every MCP surface — @voiden/mcp included) — register this separately, and
 * only from surfaces that want an agent to have write access to the local
 * plugin cache. Currently: `voiden mcp-stdio` only (apps/electron's bundled
 * CLI) — see its own doc comment for why that surface in particular has no
 * bundled-runners fallback of its own and depends entirely on
 * ~/.voiden/extensions being populated.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getCorePlugins, findPlugin, hasCoreRunner, getCoreRunnerVersion } from './registry.js'
import { downloadCoreRunner, loadEnabledPlugins, isCorePluginEnabled } from './loader.js'
import { installPlugin, setPluginEnabled, setPluginVersion, getAllInstalledPlugins } from './store.js'
import { fetchCommunityPlugins, findCommunityPlugin, installCommunityRunner, hasCommunityRunner } from './community.js'
import { checkForPluginUpdates } from './updateCheck.js'

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

// Mirrors mcpServing.ts's own registerTool — see that file's comment for why
// the wrapper (works around a pre-existing TS2589 in the SDK's own
// registerTool overload; schemas still validate for real at runtime).
function registerTool(server: McpServer, name: string, config: any, handler: any): void {
  server.registerTool(name, config, handler)
}

/**
 * Re-runs plugin discovery/loading and refreshes `activePlugins` IN PLACE
 * (same array object every other registered tool's closure already holds a
 * reference to — mcpServing.ts's run_request/list_requests included), so a
 * plugin installed or updated mid-session is usable on the very next tool
 * call, with no server restart. loadEnabledPlugins() itself already clears
 * and re-registers every plugin's request-orchestrator handlers.
 */
async function reloadActivePlugins(activePlugins: string[]): Promise<string[]> {
  const fresh = await loadEnabledPlugins()
  activePlugins.length = 0
  activePlugins.push(...fresh)
  return fresh
}

/** Registers list_plugins / install_plugin / update_plugin. */
export function registerPluginManagementTools(server: McpServer, activePlugins: string[]): void {
  registerTool(
    server,
    'list_plugins',
    {
      title: 'List plugins',
      description:
        'List every core plugin, plus any community plugin already installed — enabled state, whether its runner is actually present locally, installed version, latest version in the plugin registry, and whether an update is available. ' +
        'Call this before install_plugin/update_plugin, and after either fails, to see current state.',
      inputSchema: {},
    },
    async () => {
      const corePlugins = await getCorePlugins()
      const updates = await checkForPluginUpdates()
      const updateFor = (id: string) => updates.find((u) => u.id === id)

      const core = corePlugins.map((def) => {
        const installedVersion = getCoreRunnerVersion(def.name)
        return {
          id: def.name,
          type: 'core' as const,
          description: def.description,
          enabled: isCorePluginEnabled(def.name),
          runnerPresent: hasCoreRunner(def.name),
          installedVersion,
          latestVersion: def.version,
          updateAvailable: !!updateFor(def.name),
        }
      })

      const coreIds = new Set(corePlugins.map((p) => p.name))
      const community = getAllInstalledPlugins()
        .filter((p) => !coreIds.has(p.name))
        .map((p) => ({
          id: p.name,
          type: 'community' as const,
          enabled: p.enabled,
          runnerPresent: hasCommunityRunner(p.name),
          installedVersion: p.version,
          updateAvailable: !!updateFor(p.name),
        }))

      return textResult({ activePlugins, plugins: [...core, ...community] })
    },
  )

  registerTool(
    server,
    'install_plugin',
    {
      title: 'Install a plugin',
      description:
        'Download a core or community plugin\'s runner and enable it, then reload the active plugin set for this server — takes effect immediately, no restart needed. ' +
        'A no-op (besides re-enabling if it was disabled) when the plugin already has a working runner locally and no version is pinned; pass version to force re-downloading a specific one (e.g. to fix a "Block ... requires plugin X vY" mismatch).',
      inputSchema: {
        name: z.string().describe('Plugin id, e.g. "voiden-rest-api" (from list_plugins).'),
        version: z.string().optional().describe('Pin an exact version instead of the registry\'s latest. Also forces a fresh download even if a runner is already present.'),
      },
    },
    async ({ name, version }: { name: string; version?: string }) => {
      const coreDef = await findPlugin(name)
      const commDef = !coreDef ? findCommunityPlugin(name, await fetchCommunityPlugins()) : undefined
      if (!coreDef && !commDef) {
        return textResult({ installed: false, error: `Unknown plugin "${name}" — not in the plugin registry.` })
      }

      try {
        if (coreDef) {
          const targetVersion = version ?? coreDef.version
          if (version || !hasCoreRunner(name)) {
            const ok = await downloadCoreRunner(coreDef.name, coreDef.repo, coreDef.runnerAsset, targetVersion, false)
            if (!ok) {
              return textResult({ installed: false, error: `No "${coreDef.runnerAsset}" asset in release v${targetVersion} of ${coreDef.repo}.` })
            }
          }
          installPlugin(name, targetVersion)
          setPluginEnabled(name, true)
        } else {
          const def = version ? { ...commDef!, version } : commDef!
          const result = await installCommunityRunner(def)
          if (result === 'no-runner') {
            return textResult({ installed: false, error: `No runner.js in release v${def.version} of ${def.repo}.` })
          }
          setPluginVersion(name, def.version)
          installPlugin(name, def.version)
          setPluginEnabled(name, true)
        }
      } catch (err: any) {
        return textResult({ installed: false, error: err?.message ?? String(err) })
      }

      const active = await reloadActivePlugins(activePlugins)
      return textResult({ installed: true, name, active: active.includes(name) })
    },
  )

  registerTool(
    server,
    'update_plugin',
    {
      title: 'Update a plugin',
      description:
        'Download the latest registry version of one plugin, or every plugin that has an update available if name is omitted, then reload the active plugin set for this server. ' +
        'Only touches plugins list_plugins reports updateAvailable: true for — a no-op result for anything already current.',
      inputSchema: {
        name: z.string().optional().describe('Plugin id to update. Omit to update every plugin with an available update.'),
      },
    },
    async ({ name }: { name?: string }) => {
      const updates = await checkForPluginUpdates()
      const targets = name ? updates.filter((u) => u.id === name) : updates
      if (name && targets.length === 0) {
        const known = updates.some((u) => u.id === name) || (await findPlugin(name))
        return textResult({
          updated: [],
          note: known ? `"${name}" is already up to date.` : `"${name}" is not installed or not in the plugin registry.`,
        })
      }
      if (targets.length === 0) {
        return textResult({ updated: [], note: 'Every installed plugin is already up to date.' })
      }

      const corePlugins = await getCorePlugins()
      const communityPlugins = await fetchCommunityPlugins()
      const updated: { id: string; from: string; to: string }[] = []
      const failed: { id: string; error: string }[] = []

      for (const u of targets) {
        try {
          if (u.type === 'core') {
            const def = corePlugins.find((p) => p.name === u.id)
            if (!def) throw new Error('plugin no longer in core registry')
            const ok = await downloadCoreRunner(def.name, def.repo, def.runnerAsset, def.version, false)
            if (!ok) throw new Error(`No "${def.runnerAsset}" asset in release v${def.version}`)
          } else {
            const def = communityPlugins.find((p) => p.id === u.id)
            if (!def) throw new Error('plugin no longer in community registry')
            const result = await installCommunityRunner(def)
            if (result === 'no-runner') throw new Error(`No runner.js in release v${def.version}`)
            setPluginVersion(u.id, def.version)
          }
          updated.push({ id: u.id, from: u.installedVersion, to: u.latestVersion })
        } catch (err: any) {
          failed.push({ id: u.id, error: err?.message ?? String(err) })
        }
      }

      const active = await reloadActivePlugins(activePlugins)
      return textResult({ updated, failed, activePlugins: active })
    },
  )
}
