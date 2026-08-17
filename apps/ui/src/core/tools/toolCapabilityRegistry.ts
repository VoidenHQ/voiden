/**
 * Tool capability registry — the renderer-native counterpart to
 * @voiden/runner's mcpToolCapability.ts registry, for the same reason that
 * one exists: core (this app) shouldn't hardcode knowledge of the /tool
 * block's own semantics. The plugin that owns /tool (voiden-mcp-tool)
 * constructs a provider in its plugin.ts onload() and registers it here via
 * context.registerToolCapabilityProvider() (see plugins.tsx) — the MCP tab
 * reads discover/validate/verify/planServed results from whatever's
 * registered, without this file knowing anything about tool/toolparams/
 * toolverifies blocks itself.
 *
 * A zustand store, not a plain variable — registration happens asynchronously
 * during plugin load (after the MCP tab may already be mounted, e.g. on a
 * fresh app launch), so components need to re-render when the provider
 * actually arrives, not just read it once. Same reactive-registration
 * pattern usePluginStore already uses for other plugin-contributed state.
 *
 * Single optional slot, not a list — same reasoning as the headless
 * registry: there's only ever one plugin that owns the /tool capability.
 *
 * This is intentionally a SEPARATE implementation from
 * @voiden/runner's mcpToolCapability.ts, not a shared one — the app's real
 * plugin system (this file) and @voiden/runner's headless one are two
 * disconnected runtimes (see voiden-mcp-tool/src/lib/toolCapabilityElectron.ts's
 * own header comment for the full reasoning).
 */

import { create } from 'zustand'

export interface ToolCapabilityProvider {
  discoverTools(): Promise<any[]>
  validateTools(tools: any[]): Promise<{ validTools: any[]; issues: any[] }>
  verifyTools(tools: any[], opts?: { cadence?: string }): Promise<any[]>
  planServedTools(): Promise<any[]>
  /** Manual serve override, from the Serve preview tab's Add/Remove action —
   *  persisted to the tool block's own `enabled` attr, read fresh by
   *  decideServing() on the next planServedTools() call (here and headlessly). */
  setToolEnabled(tool: any, enabled: boolean): Promise<void>
  /** Real, discovered section labels for a file — powers the verify row's
   *  section-label dropdown, picking from what actually exists in that file
   *  instead of a typed/guessed value. */
  getFileSections(filePath: string): Promise<{ index: number; label: string }[]>
  /** A section's actual blocks, for a file that may not be open in any
   *  editor tab — powers "Auto-populate params" for a tool bound to an
   *  external request (requestFilePath set). Returns null if the section
   *  can't be found. */
  getSectionBlocks(filePath: string, sectionLabel: string): Promise<any[] | null>
}

interface ToolCapabilityState {
  provider: ToolCapabilityProvider | undefined
}

const useToolCapabilityStore = create<ToolCapabilityState>(() => ({ provider: undefined }))

export function registerToolCapabilityProvider(p: ToolCapabilityProvider): void {
  useToolCapabilityStore.setState({ provider: p })
}

export function clearToolCapabilityProvider(): void {
  useToolCapabilityStore.setState({ provider: undefined })
}

/** One-off read, outside a component (e.g. inside an event handler) — not
 *  reactive. Use useToolCapabilityProvider() in components instead. */
export function getToolCapabilityProvider(): ToolCapabilityProvider | undefined {
  return useToolCapabilityStore.getState().provider
}

/** Reactive hook — re-renders the calling component when the plugin
 *  registers (or clears) its provider, so a tab opened before plugin load
 *  finishes updates itself instead of staying stuck on "not registered." */
export function useToolCapabilityProvider(): ToolCapabilityProvider | undefined {
  return useToolCapabilityStore((s) => s.provider)
}
