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

export function safeParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return parseJsonPreserveIntegers(value);
  } catch {
    return value;
  }
}
