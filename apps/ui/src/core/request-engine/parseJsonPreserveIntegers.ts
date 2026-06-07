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
