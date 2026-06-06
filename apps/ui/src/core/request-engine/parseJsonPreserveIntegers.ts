/**
 * Parse JSON without rounding integers outside Number.MAX_SAFE_INTEGER.
 * Large integers are kept as decimal strings so API variables stay exact.
 * Fixes VoidenHQ/voiden#395.
 */
export function parseJsonPreserveIntegers(text: string): unknown {
  const normalized = text.replace(
    /(?<=^|[\[{:,]\s*)(-?\d+)(?=\s*[,\}\]])/g,
    (digits) => {
      const asNumber = Number(digits);
      return Number.isSafeInteger(asNumber) ? digits : `"${digits}"`;
    },
  );
  return JSON.parse(normalized);
}

export function stringifyJsonForDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
