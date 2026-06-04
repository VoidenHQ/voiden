import { parse, stringify, LosslessNumber } from 'lossless-json';

function numberParser(value: string): number | LosslessNumber {
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      return new LosslessNumber(value);
    }
    return n;
  }
  return Number(value);
}

export function parseJsonSafe(text: string): unknown {
  try {
    return parse(text, undefined, numberParser);
  } catch {
    return JSON.parse(text);
  }
}

export function stringifyJsonSafe(value: unknown, indent?: number): string {
  try {
    return stringify(value, undefined, indent) ?? JSON.stringify(value, null, indent);
  } catch {
    return JSON.stringify(value, null, indent);
  }
}
