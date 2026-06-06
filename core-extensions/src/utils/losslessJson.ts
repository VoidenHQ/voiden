import {
  isInteger,
  isLosslessNumber,
  isSafeNumber,
  parse,
  stringify,
} from "lossless-json";

export function parseNumberSafe(value: string): number | bigint {
  if (isInteger(value) && isSafeNumber(value)) {
    return Number(value);
  }
  if (isInteger(value)) {
    return BigInt(value);
  }
  return Number(value);
}

export function parseJsonLossless(text: string): unknown {
  return parse(text, undefined, parseNumberSafe);
}

export function stringifyJsonLossless(value: unknown, space?: number | string): string {
  return stringify(value, null, space) ?? "";
}

export function prettifyJsonLossless(json: string): string {
  try {
    return stringifyJsonLossless(parseJsonLossless(json), 2);
  } catch {
    return json;
  }
}

export function losslessValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isLosslessNumber(value)) return value.toString();
  return stringifyJsonLossless(value);
}
