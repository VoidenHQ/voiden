/**
 * Hook Registry — shared between app (Electron renderer) and CLI (Node.js).
 *
 * Singleton: all plugins and the pipeline executor see the same instance
 * within a process, regardless of how many times this module is imported.
 */

import { Hook, HookHandler, PipelineStage } from './types.js'

export class HookRegistry {
  private static instance: HookRegistry
  private hooks: Map<PipelineStage, Hook[]> = new Map()

  private constructor() {
    Object.values(PipelineStage).forEach(stage => {
      this.hooks.set(stage, [])
    })
  }

  public static getInstance(): HookRegistry {
    const globalSymbol = Symbol.for('voiden.hookRegistry')
    const g = globalThis as any

    if (!g[globalSymbol]) {
      g[globalSymbol] = new HookRegistry()
    }
    return g[globalSymbol]
  }

  public registerHook(
    extensionId: string,
    stage: PipelineStage,
    handler: HookHandler,
    priority = 100,
  ): void {
    const hook: Hook = { extensionId, stage, handler, priority }
    const stageHooks = this.hooks.get(stage) || []
    stageHooks.push(hook)
    stageHooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
    this.hooks.set(stage, stageHooks)
  }

  public unregisterExtension(extensionId: string): void {
    this.hooks.forEach((hooks, stage) => {
      this.hooks.set(stage, hooks.filter(h => h.extensionId !== extensionId))
    })
  }

  public getHooks(stage: PipelineStage): Hook[] {
    return this.hooks.get(stage) || []
  }

  public async executeHooks<T>(stage: PipelineStage, context: T): Promise<void> {
    const stageHooks = this.getHooks(stage)
    for (const hook of stageHooks) {
      try {
        await hook.handler(context)
      } catch (err: any) {
        console.error(`[HookRegistry] Error in hook ${hook.extensionId} at ${stage}:`, err)
      }
    }
  }

  public clearAll(): void {
    this.hooks.forEach((_, stage) => this.hooks.set(stage, []))
  }

  public getStats(): Record<string, number> {
    const stats: Record<string, number> = {}
    this.hooks.forEach((hooks, stage) => { stats[stage] = hooks.length })
    return stats
  }
}

export const hookRegistry = HookRegistry.getInstance()
