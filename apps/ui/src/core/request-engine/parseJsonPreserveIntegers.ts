/**
 * Parse JSON without rounding integers outside Number.MAX_SAFE_INTEGER.
 * Large integers are kept as decimal strings so response display and
 * runtime variables (e.g. {{$res.body...}}) stay exact.
 * Fixes VoidenHQ/voiden#408.
 */
const UNSAFE_INTEGER_LITERAL =
  /(?<=^|[\[{:,]\s*)(-?\d+)(?=\s*[,\}\]])/g;

function quoteUnsafeIntegerLiterals(text: string): string {
  return text.replace(UNSAFE_INTEGER_LITERAL, (digits) => {
    const asNumber = Number(digits);
    return Number.isSafeInteger(asNumber) ? digits : `"${digits}"`;
  });
}

export function parseJsonPreserveIntegers(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegerLiterals(text));
}

export function stringifyJsonForDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Prettify raw JSON text for viewers without losing large integers. */
export function prettifyJsonText(text: string): string {
  return stringifyJsonForDisplay(parseJsonPreserveIntegers(text));
}
