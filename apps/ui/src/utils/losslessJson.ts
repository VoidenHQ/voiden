import {
  isInteger,
  isLosslessNumber,
  isSafeNumber,
  parse,
  stringify,
} from "lossless-json";

/**
 * Parse a JSON numeric token without losing precision for integers outside
 * Number.MAX_SAFE_INTEGER. Safe integers remain numbers; larger integers become bigint.
 */
export function parseNumberSafe(value: string): number | bigint {
  if (isInteger(value) && isSafeNumber(value)) {
    return Number(value);
  }
  if (isInteger(value)) {
    return BigInt(value);
  }
  return Number(value);
}

/** Parse JSON text while preserving large integer precision. */
export function parseJsonLossless(text: string): unknown {
  return parse(text, undefined, parseNumberSafe);
}

/** Stringify JSON values, including bigint and LosslessNumber instances. */
export function stringifyJsonLossless(value: unknown, space?: number | string): string {
  return stringify(value, null, space) ?? "";
}

/** Parse and re-format JSON with indentation, preserving large integer precision. */
export function prettifyJsonLossless(json: string): string {
  try {
    return stringifyJsonLossless(parseJsonLossless(json), 2);
  } catch {
    return json;
  }
}

/** Convert a parsed JSON value to a string without rounding large integers. */
export function losslessValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isLosslessNumber(value)) return value.toString();
  return stringifyJsonLossless(value);
}
