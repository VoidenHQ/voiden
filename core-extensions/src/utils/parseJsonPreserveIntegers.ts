/**
 * JSON.parse rounds integers that exceed Number.MAX_SAFE_INTEGER (and other
 * integers not exactly representable as IEEE-754 doubles). Quote those
 * literals before parsing so they remain strings in the resulting object.
 *
 * @see https://github.com/VoidenHQ/voiden/issues/408, https://github.com/VoidenHQ/voiden/issues/395
 */

export function isUnsafeIntegerString(digits: string): boolean {
  if (!/^-?(?:0|[1-9]\d*)$/.test(digits)) {
    return false;
  }
  try {
    const asBigInt = BigInt(digits);
    const asNumber = Number(digits);
    if (!Number.isFinite(asNumber)) {
      return true;
    }
    return asBigInt !== BigInt(asNumber);
  } catch {
    return false;
  }
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

function quoteUnsafeIntegerLiterals(text: string): string {
  let out = "";
  let i = 0;
  const length = text.length;

  while (i < length) {
    const char = text[i];

    if (char === '"') {
      out += char;
      i += 1;
      while (i < length) {
        const inner = text[i];
        out += inner;
        if (inner === "\\") {
          i += 1;
          if (i < length) {
            out += text[i];
            i += 1;
          }
        } else if (inner === '"') {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      continue;
    }

    if (char === "-" || (char >= "0" && char <= "9")) {
      const rest = text.slice(i);
      const match = rest.match(JSON_NUMBER);
      if (match && match.index === 0) {
        const token = match[0];
        const isInteger = !token.includes(".") && !/[eE]/.test(token);
        if (isInteger && isUnsafeIntegerString(token)) {
          out += `"${token}"`;
        } else {
          out += token;
        }
        i += token.length;
        continue;
      }
    }

    out += char;
    i += 1;
  }

  return out;
}

export function parseJsonPreserveIntegers(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegerLiterals(text));
}

/** Render parsed JSON for UI, unquoting preserved large integer strings. */
export function stringifyJsonForDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /"(-?\d+)"/g,
    (match, digits: string) => (isUnsafeIntegerString(digits) ? digits : match),
  );
}

export function prettifyJsonPreserveIntegers(text: string): string {
  try {
    const parsed = parseJsonPreserveIntegers(text);
    return stringifyJsonForDisplay(parsed);
  } catch {
    return text;
  }
}
