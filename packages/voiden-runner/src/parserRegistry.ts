/**
 * Parser Registry — collects block-to-request builders registered by plugins.
 *
 * Parser plugins (voiden-graphql, voiden-sockets, voiden-rest-api) call
 * `context.registerRequestBuilder(fn)` in their runner.ts `onload()`.
 * The runner then calls `parseBlocks()` which tries each builder in order
 * and returns the first non-null result.
 *
 * The registry is cleared at the start of each `loadEnabledPlugins()` call
 * so plugins are always re-registered fresh.
 */

type Builder = (blocks: any[]) => any | null | Promise<any | null>

const builders: Builder[] = []

export function registerRequestBuilder(fn: Builder): void {
  builders.push(fn)
}

export async function parseBlocks(blocks: any[]): Promise<any | null> {
  for (const builder of builders) {
    const result = await builder(blocks)
    if (result !== null && result !== undefined) return result
  }
  return null
}

export function clearBuilders(): void {
  builders.length = 0
}
