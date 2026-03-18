/**
 * Static validation for script bodies.
 * Checks argument counts, operator validity, and common mistakes.
 * JavaScript env/variable access is synchronous (no await needed).
 */

export interface ScriptValidationError {
  line: number;
  column: number;
  method?: string;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

/** Supported function calls exposed by the scripting runtime. */
const SUPPORTED_VD_CALLS = new Set([
  'voiden.env.get',
  'voiden.variables.set',
  'voiden.variables.get',
  'voiden.request.headers.push',
  'voiden.request.queryParams.push',
  'voiden.request.pathParams.push',
  'voiden.log',
  'voiden.assert',
  'voiden.cancel',
]);

const SUPPORTED_ASSERT_OPERATORS = new Set([
  '==', '===', 'eq', 'equal',
  '!=', '!==', 'neq', 'notequal',
  'greater', 'greaterthan', 'gte',
  'less', 'lessthan', 'lte',
  '>', '>=', '<', '<=',
  'contains', 'includes',
  'matches', 'regex',
  'truthy', 'falsy',
]);

type VdCallWithArgs = {
  method: string;
  column: number;
  openParenIndex: number;
  closeParenIndex: number;
  argsRaw: string;
};

function isLikelyPlainTextLine(trimmedLine: string, language: 'javascript' | 'python'): boolean {
  if (!trimmedLine) return false;

  const jsKeywords = /^(const|let|var|if|else|for|while|do|return|await|async|function|try|catch|finally|throw|switch|case|break|continue|class|new|import|export|voiden)\b/;
  const pyKeywords = /^(if|elif|else|for|while|return|await|async|def|class|try|except|finally|raise|import|from|pass|break|continue|lambda|with|voiden)\b/;
  const keywordPattern = language === 'javascript' ? jsKeywords : pyKeywords;

  if (keywordPattern.test(trimmedLine)) return false;

  // If it clearly contains strong code symbols, treat as code.
  if (/[=()[\]{};+*/%<>$&|]/.test(trimmedLine)) return false;
  // Obvious call/access patterns should not be treated as plain text.
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+\s*(\(|$)/.test(trimmedLine)) return false;
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(trimmedLine)) return false;

  // Allow sentence punctuation and detect prose-like content.
  const normalized = trimmedLine.replace(/[.,!?;:]+$/g, '').trim();
  if (!normalized) return false;

  // Two or more words with letters and spaces are likely accidental prose.
  if (/^[A-Za-z][A-Za-z0-9_'"\-]*(\s+[A-Za-z0-9_'"\-]+)+$/.test(normalized)) {
    return true;
  }

  // Single-word bare identifiers can still be accidental text in scripts.
  // Keep this conservative to avoid false positives.
  return /^[A-Za-z]{3,}$/.test(normalized);
}

function findMatchingParen(line: string, openIndex: number): number {
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = openIndex; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelArgs(argsRaw: string): string[] {
  const trimmed = argsRaw.trim();
  if (!trimmed) return [];

  const args: string[] = [];
  let current = '';
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < argsRaw.length; i++) {
    const ch = argsRaw[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      current += ch;
      escaped = true;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      current += ch;
      inString = ch;
      continue;
    }

    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);

    if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim() || argsRaw.endsWith(',')) {
    args.push(current.trim());
  }

  return args.filter((a) => a.length > 0);
}

function findVdCallsWithArgs(line: string): VdCallWithArgs[] {
  const regex = /(^|[^.\w])((?:voiden)(?:\.[A-Za-z_$][\w$]*)+)\s*\(/g;
  const calls: VdCallWithArgs[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const prefixLen = match[1]?.length ?? 0;
    const method = match[2];
    const methodStart = match.index + prefixLen;
    const column = methodStart + 1;
    const openParenIndex = line.indexOf('(', methodStart + method.length);
    if (openParenIndex === -1) continue;
    const closeParenIndex = findMatchingParen(line, openParenIndex);
    if (closeParenIndex === -1) continue;
    const argsRaw = line.slice(openParenIndex + 1, closeParenIndex);
    calls.push({ method, column, openParenIndex, closeParenIndex, argsRaw });
  }

  return calls;
}

function lintVdCallArguments(
  method: string,
  args: string[],
  line: number,
  column: number,
): ScriptValidationError[] {
  const errors: ScriptValidationError[] = [];
  const argCount = args.length;

  if (method === 'voiden.log') {
    if (argCount < 1) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: "voiden.log expects at least 1 argument. Use: voiden.log(message) or voiden.log(level, ...args).",
      });
    }
    return errors;
  }

  if (method === 'voiden.cancel') {
    if (argCount !== 0) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: "voiden.cancel does not take any arguments. Use: voiden.cancel().",
      });
    }
    return errors;
  }

  if (method === 'voiden.variables.get') {
    if (argCount !== 1) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: "voiden.variables.get expects 1 argument: key.",
      });
    }
    return errors;
  }

  if (method === 'voiden.env.get') {
    if (argCount !== 1) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: "voiden.env.get expects 1 argument: key.",
      });
    }
    return errors;
  }

  if (method === 'voiden.variables.set') {
    if (argCount !== 2) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: "voiden.variables.set expects 2 arguments: key, value.",
      });
    }
    return errors;
  }

  if (method === 'voiden.assert') {
    if (argCount < 3 || argCount > 4) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: "voiden.assert expects 3 or 4 arguments: actual, operator, expectedValue, message?.",
      });
      return errors;
    }

    const operatorArg = args[1]?.trim() ?? '';
    const strMatch = operatorArg.match(/^(['"`])(.*)\1$/);
    if (strMatch) {
      const operator = strMatch[2].trim().toLowerCase().replace(/\s+/g, '');
      if (!SUPPORTED_ASSERT_OPERATORS.has(operator)) {
        errors.push({
          line,
          column,
          severity: 'warning',
          method,
          message: `Unknown assert operator '${strMatch[2]}'. This assertion will fail at runtime.`,
        });
      }
    }
    return errors;
  }

  if (
    method === 'voiden.request.headers.push' ||
    method === 'voiden.request.queryParams.push' ||
    method === 'voiden.request.pathParams.push'
  ) {
    if (argCount < 1) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: `${method} expects at least 1 argument. Use push({ key: "name", value: "value" }).`,
      });
      return errors;
    }
    if (argCount > 1) {
      errors.push({
        line,
        column,
        severity: 'warning',
        method,
        message: `${method} accepts one entry per call. Use push({ key, value }) or call push multiple times.`,
      });
    }
    return errors;
  }

  return errors;
}

/**
 * Remove single-line comments (//) and block comments from a line,
 * respecting string literals so commented-out code inside strings isn't stripped.
 */
function stripLineComments(line: string): string {
  let result = '';
  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }
    if (inString) {
      result += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      result += ch;
      continue;
    }
    // Single-line comment — skip rest of line
    if (ch === '/' && i + 1 < line.length && line[i + 1] === '/') {
      break;
    }
    result += ch;
  }

  return result;
}

/**
 * Validate a JavaScript script body for unawaited async vd calls.
 * Returns an array of errors (empty = valid).
 */
export function validateScript(scriptBody: string): ScriptValidationError[] {
  if (!scriptBody || !scriptBody.trim()) return [];

  const errors: ScriptValidationError[] = [];
  const lines = scriptBody.split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Handle block comments
    if (inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) continue; // entire line is inside block comment
      line = line.substring(endIdx + 2);
      inBlockComment = false;
    }

    // Strip block comment starts within this line
    let cleaned = '';
    let j = 0;
    while (j < line.length) {
      if (line[j] === '/' && j + 1 < line.length && line[j + 1] === '*') {
        const endIdx = line.indexOf('*/', j + 2);
        if (endIdx === -1) {
          inBlockComment = true;
          break;
        }
        j = endIdx + 2;
        continue;
      }
      cleaned += line[j];
      j++;
    }
    if (inBlockComment) continue;

    // Strip single-line comments (respecting strings)
    cleaned = stripLineComments(cleaned);
    const trimmed = cleaned.trim();
    if (!trimmed) continue;

    if (isLikelyPlainTextLine(trimmed, 'javascript')) {
      errors.push({
        line: i + 1,
        column: 1,
        severity: 'warning',
        message: "This line looks like plain text. Comment it with '//' or wrap it in quotes.",
      });
    }

    // Detect unknown vd function calls + argument lint for supported calls.
    for (const call of findVdCallsWithArgs(cleaned)) {
      if (!SUPPORTED_VD_CALLS.has(call.method)) {
        errors.push({
          line: i + 1,
          column: call.column,
          method: call.method,
          message: `Unknown function '${call.method}()'. Supported: voiden.env.get, voiden.variables.get/set, voiden.request.headers/queryParams/pathParams.push, voiden.log, voiden.assert, voiden.cancel.`,
        });
        continue;
      }

      errors.push(
        ...lintVdCallArguments(
          call.method,
          splitTopLevelArgs(call.argsRaw),
          i + 1,
          call.column,
        ),
      );
    }
  }

  return errors;
}

/**
 * Validate a Python script body with lightweight static checks.
 * Returns an array of errors (empty = valid).
 */
export function validatePythonScript(scriptBody: string): ScriptValidationError[] {
  if (!scriptBody || !scriptBody.trim()) return [];

  const errors: ScriptValidationError[] = [];
  const lines = scriptBody.split('\n');
  const stack: Array<{ ch: string; line: number; column: number }> = [];
  const openToClose: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closeToOpen: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  const stripPyComments = (line: string): string => {
    let result = '';
    let inString: string | null = null;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        result += ch;
        escaped = true;
        continue;
      }
      if (inString) {
        result += ch;
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        result += ch;
        continue;
      }
      if (ch === '#') break;
      result += ch;
    }
    return result;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cleaned = stripPyComments(raw);
    const trimmed = cleaned.trim();
    if (!trimmed) continue;

    if (isLikelyPlainTextLine(trimmed, 'python')) {
      errors.push({
        line: i + 1,
        column: 1,
        severity: 'warning',
        message: "This line looks like plain text. Comment it with '#' or wrap it in quotes.",
      });
    }

    // Python scripts are executed synchronously in this runtime.
    const awaitIdx = cleaned.indexOf('await ');
    if (awaitIdx >= 0) {
      errors.push({
        line: i + 1,
        column: awaitIdx + 1,
        message: "Python scripts run synchronously here; remove 'await'.",
      });
    }

    // Detect mixed tab/space indentation (common source of Python errors).
    const indentMatch = raw.match(/^[\t ]+/);
    if (indentMatch && indentMatch[0].includes('\t') && indentMatch[0].includes(' ')) {
      errors.push({
        line: i + 1,
        column: 1,
        message: 'Mixed tabs and spaces in indentation.',
      });
    }

    // Bracket pairing checks.
    let inString: string | null = null;
    let escaped = false;
    for (let j = 0; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }

      if (openToClose[ch]) {
        stack.push({ ch, line: i + 1, column: j + 1 });
      } else if (closeToOpen[ch]) {
        const last = stack[stack.length - 1];
        if (!last || last.ch !== closeToOpen[ch]) {
          errors.push({
            line: i + 1,
            column: j + 1,
            message: `Unexpected '${ch}'.`,
          });
        } else {
          stack.pop();
        }
      }
    }

    // Detect unknown vd function calls + argument lint for supported calls.
    for (const call of findVdCallsWithArgs(cleaned)) {
      if (!SUPPORTED_VD_CALLS.has(call.method)) {
        errors.push({
          line: i + 1,
          column: call.column,
          method: call.method,
          message: `Unknown function '${call.method}()'. Supported: voiden.env.get, voiden.variables.get/set, voiden.request.headers/queryParams/pathParams.push, voiden.log, voiden.assert, voiden.cancel.`,
        });
        continue;
      }

      errors.push(
        ...lintVdCallArguments(
          call.method,
          splitTopLevelArgs(call.argsRaw),
          i + 1,
          call.column,
        ),
      );
    }
  }

  for (const unclosed of stack) {
    errors.push({
      line: unclosed.line,
      column: unclosed.column,
      message: `Unclosed '${unclosed.ch}'.`,
    });
  }

  return errors;
}

/**
 * Validate a Shell (bash) script body with lightweight static checks.
 * Returns an array of errors (empty = valid).
 */
export function validateShellScript(scriptBody: string): ScriptValidationError[] {
  if (!scriptBody || !scriptBody.trim()) return [];

  const errors: ScriptValidationError[] = [];
  const lines = scriptBody.split('\n');

  const stripShComments = (line: string): string => {
    let result = '';
    let inString: string | null = null;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        result += ch;
        escaped = true;
        continue;
      }
      if (inString) {
        result += ch;
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        result += ch;
        continue;
      }
      if (ch === '#') break;
      result += ch;
    }
    return result;
  };

  const VOIDEN_SH_KEYWORDS = /^(voiden_log|voiden_env_get|voiden_variables_get|voiden_variables_set|voiden_assert|voiden_cancel|if|elif|else|fi|for|while|do|done|case|esac|function|return|export|local|echo|printf|source|\.)\b/;
  const SH_CODE_SYMBOLS = /[=\$\(\)\[\]{};|&<>]/;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cleaned = stripShComments(raw);
    const trimmed = cleaned.trim();
    if (!trimmed) continue;

    // Plain text detection for shell
    if (!VOIDEN_SH_KEYWORDS.test(trimmed) && !SH_CODE_SYMBOLS.test(trimmed)) {
      if (/^[A-Za-z][A-Za-z0-9_'"\-]*(\s+[A-Za-z0-9_'"\-]+)+$/.test(trimmed)) {
        errors.push({
          line: i + 1,
          column: 1,
          severity: 'warning',
          message: "This line looks like plain text. Comment it with '#' or quote it.",
        });
      }
    }

  }

  return errors;
}
