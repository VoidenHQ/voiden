/**
 * Compose one plugin's request contribution without requiring every handler to
 * spread fields produced by earlier plugins. Declared fields replace previous
 * values as-is (including arrays); nullish results mean "no contribution".
 */
export function mergeRequestHandlerResult<T extends Record<string, unknown>>(
  previous: T,
  contribution: Partial<T> | Record<string, unknown> | null | undefined,
): T {
  if (contribution == null) return previous
  return { ...previous, ...contribution }
}
