/**
 * Parse JSON without rounding integers outside Number.MAX_SAFE_INTEGER.
 * Large integers are kept as decimal strings so API variables stay exact.
 * Fixes VoidenHQ/voiden#395.
 */

const UNSAFE_INTEGER_PATTERN =
  /(?<=^|[\[{:,]\s*)(-?\d+)(?=\s*[,\}\]])/g;

function quoteUnsafeIntegers(text: string): string {
  return text.replace(UNSAFE_INTEGER_PATTERN, (digits) => {
    const asNumber = Number(digits);
    return Number.isSafeInteger(asNumber) ? digits : `"${digits}"`;
  });
}

export function parseJsonPreserveIntegers(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegers(text));
}

export function stringifyJsonForDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function prettifyJsonPreserveIntegers(text: string): string {
  try {
    return stringifyJsonForDisplay(parseJsonPreserveIntegers(text));
  } catch {
    return text;
  }
}
