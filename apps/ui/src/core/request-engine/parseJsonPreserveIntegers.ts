/**
 * Parse JSON without rounding integers outside Number.MAX_SAFE_INTEGER.
 * Large integers are kept as decimal strings so API variables stay exact.
 * Fixes VoidenHQ/voiden#395 and VoidenHQ/voiden#408.
 */

const UNSAFE_INTEGER_TOKEN =
  /(?<=^|[\[{:,]\s*)(-?\d+)(?=\s*[,\}\]])/g;

function quoteUnsafeIntegerTokens(text: string): string {
  return text.replace(UNSAFE_INTEGER_TOKEN, (digits) => {
    const asNumber = Number(digits);
    return Number.isSafeInteger(asNumber) ? digits : `"${digits}"`;
  });
}

export function parseJsonPreserveIntegers(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegerTokens(text));
}

export function stringifyJsonForDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function isStructuredJsonString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!isStructuredJsonString(value)) return value;

  try {
    return parseJsonPreserveIntegers(value);
  } catch {
    try {
      const fixedJson = value
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/,\s*$/, "");
      return parseJsonPreserveIntegers(fixedJson);
    } catch {
      return value;
    }
  }
}

export function prettifyJsonText(text: string): string {
  return stringifyJsonForDisplay(parseJsonPreserveIntegers(text));
}
