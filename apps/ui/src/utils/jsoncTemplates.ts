/**
 * Template expressions such as {{user}} or {{process.token}} may stand unquoted
 * in a JSON body. A JSON formatter reads their braces as objects and splits
 * them across lines, so they are swapped for placeholder strings before
 * formatting and put back afterwards. Expressions inside strings and comments
 * are left alone: formatters never touch those.
 */

export type ProtectedTemplates = {
  text: string;
  placeholders: { placeholder: string; template: string }[];
};

const PLACEHOLDER_PREFIX = "__voiden_template_";

function uniquePrefix(text: string): string {
  let prefix = PLACEHOLDER_PREFIX;
  while (text.includes(prefix)) prefix = `_${prefix}`;
  return prefix;
}

/** Index just past the string, comment or template starting at `start`, or -1 if none starts there. */
function skipToken(text: string, start: number): number {
  const twoChars = text.slice(start, start + 2);
  if (text[start] === '"') {
    let index = start + 1;
    while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
    return index + 1;
  }
  if (twoChars === "//") {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  if (twoChars === "/*") {
    const end = text.indexOf("*/", start + 2);
    return end === -1 ? text.length : end + 2;
  }
  return -1;
}

/** Replaces each unquoted {{...}} in `text` with a unique quoted placeholder. */
export function protectTemplateExpressions(text: string): ProtectedTemplates {
  const prefix = uniquePrefix(text);
  const placeholders: ProtectedTemplates["placeholders"] = [];
  let output = "";
  let index = 0;
  while (index < text.length) {
    const tokenEnd = skipToken(text, index);
    if (tokenEnd !== -1) {
      output += text.slice(index, tokenEnd);
      index = tokenEnd;
      continue;
    }
    const templateEnd = text.startsWith("{{", index) ? text.indexOf("}}", index + 2) : -1;
    if (templateEnd !== -1) {
      const placeholder = `"${prefix}${placeholders.length}__"`;
      placeholders.push({ placeholder, template: text.slice(index, templateEnd + 2) });
      output += placeholder;
      index = templateEnd + 2;
      continue;
    }
    output += text[index];
    index++;
  }
  return { text: output, placeholders };
}

/** Puts back the template expressions that `protectTemplateExpressions` replaced. */
export function restoreTemplateExpressions(
  text: string,
  placeholders: ProtectedTemplates["placeholders"],
): string {
  return placeholders.reduce(
    (restored, { placeholder, template }) => restored.replace(placeholder, () => template),
    text,
  );
}
