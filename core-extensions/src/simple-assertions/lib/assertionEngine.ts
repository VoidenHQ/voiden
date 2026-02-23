/**
 * Simple Assertions Engine
 * Executes assertions against HTTP responses
 */

import { parseCookies } from '../../shared/utils/cookieParser';

export interface Assertion {
  description: string;
  field: string;
  operator: string;
  expectedValue: string;
  enabled?: boolean;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actualValue: any;
  error?: string;
}

export interface AssertionContext {
  response: {
    status: number;
    statusText: string;
    headers: Array<{ key: string; value: string }>;
    body: any;
    contentType: string | null;
    timing?: { duration: number };
  };
}

/**
 * Extract value from response using field path
 * Supports:
 * - JSONPath-like syntax: response.body.data[0].id
 * - Special keywords: status, statusText, responseTime
 * - Header access: header.Content-Type
 */
export function extractFieldValue(field: string, context: AssertionContext): any {
  const normalizedField = field.trim();

  // Handle special keywords
  if (normalizedField === 'status' || normalizedField === 'statusCode') {
    return context.response.status;
  }
  if (normalizedField === 'statusText') {
    return context.response.statusText;
  }
  if (normalizedField === 'responseTime' || normalizedField === 'duration') {
    return context.response.timing?.duration || 0;
  }

  // Handle header access: header.Content-Type or headers.Content-Type
  if (normalizedField.startsWith('header.') || normalizedField.startsWith('headers.')) {
    const parts = normalizedField.split('.');
    const headerName = parts[1];

    if (headerName.toLowerCase() === 'set-cookie') {
      const cookies = parseCookies(context.response.headers);

      if (parts.length === 2) {
        return cookies;
      }

      const remainingPath = parts.slice(2).join('.');
      return extractFromObject(cookies, remainingPath);
    }

    const header = context.response.headers.find(
      (h) => h.key.toLowerCase() === headerName.toLowerCase()
    );
    return header?.value;
  }

  // Handle body field access
  if (normalizedField.startsWith('body.') || normalizedField.startsWith('response.body.')) {
    const bodyPath = normalizedField.replace(/^(response\.)?body\./, '');
    return extractFromObject(context.response.body, bodyPath);
  }

  // Handle root response field access
  if (normalizedField.startsWith('response.')) {
    const path = normalizedField.replace(/^response\./, '');
    return extractFromObject(context.response, path);
  }

  // Default: try to extract from body
  return extractFromObject(context.response.body, normalizedField);
}

/**
 * Extract value from nested object using path notation
 * Supports: obj.prop, obj.arr[0], obj.arr[0].prop
 */
function extractFromObject(obj: any, path: string): any {
  if (!obj) return undefined;

  // Parse path and handle array notation
  const parts = path.split(/\.|\[/).map(p => p.replace(/\]$/, ''));

  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle numeric array index
    if (/^\d+$/.test(part)) {
      current = current[parseInt(part, 10)];
    } else {
      current = current[part];
    }
  }

  return current;
}

/**
 * Execute a single assertion
 */
export function executeAssertion(assertion: Assertion, context: AssertionContext): AssertionResult {
  try {
    // Skip disabled assertions
    if (assertion.enabled === false) {
      return {
        assertion,
        passed: true,
        actualValue: null,
        error: 'Skipped (disabled)',
      };
    }

    // Parse the field to extract operator if embedded
    const parsed = parseAssertionField(assertion.field);
    const field = parsed.field;
    const operator = parsed.operator || assertion.operator || 'equals';
    const expectedValue = assertion.expectedValue;

    // Extract actual value from response
    const actualValue = extractFieldValue(field, context);

    // Execute operator
    const passed = executeOperator(operator, actualValue, expectedValue);

    return {
      assertion,
      passed,
      actualValue,
    };
  } catch (error: any) {
    return {
      assertion,
      passed: false,
      actualValue: null,
      error: error.message || String(error),
    };
  }
}

/**
 * Parse assertion field to extract embedded operator
 * Examples:
 * - "status equals" -> { field: "status", operator: "equals" }
 * - "body.data[0].name contains" -> { field: "body.data[0].name", operator: "contains" }
 * - "response.headers.Content-Type" -> { field: "response.headers.Content-Type", operator: null }
 */
function parseAssertionField(fieldStr: string): { field: string; operator: string | null } {
  const operators = [
    'equals', 'eq', '==', '===',
    'not-equals', 'ne', '!=', '!==',
    'contains', 'includes',
    'not-contains', 'not-includes',
    'starts-with', 'startswith',
    'ends-with', 'endswith',
    'matches', 'regex',
    'exists', 'is-defined',
    'not-exists', 'is-null', 'is-undefined',
    'greater-than', 'gt', '>',
    'less-than', 'lt', '<',
    'greater-equal', 'gte', '>=',
    'less-equal', 'lte', '<=',
    'is-empty', 'empty',
    'not-empty',
    'is-truthy', 'truthy',
    'is-falsy', 'falsy',
    'type-is', 'typeof',
  ];

  const parts = fieldStr.trim().split(/\s+/);

  // Check if last part is an operator
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1].toLowerCase();
    if (operators.includes(lastPart)) {
      const field = parts.slice(0, -1).join(' ');
      return { field, operator: lastPart };
    }
  }

  return { field: fieldStr.trim(), operator: null };
}

/**
 * Execute comparison operator
 */
function executeOperator(operator: string, actualValue: any, expectedValue: string): boolean {
  const normalizedOp = operator.toLowerCase().trim();

  switch (normalizedOp) {
    // Equality
    case 'equals':
    case 'eq':
    case '==':
    case '===':
      return String(actualValue) === expectedValue;

    case 'not-equals':
    case 'ne':
    case '!=':
    case '!==':
      return String(actualValue) !== expectedValue;

    // String operations
    case 'contains':
    case 'includes':
      return String(actualValue).includes(expectedValue);

    case 'not-contains':
    case 'not-includes':
      return !String(actualValue).includes(expectedValue);

    case 'starts-with':
    case 'startswith':
      return String(actualValue).startsWith(expectedValue);

    case 'ends-with':
    case 'endswith':
      return String(actualValue).endsWith(expectedValue);

    case 'matches':
    case 'regex':
      try {
        const regex = new RegExp(expectedValue);
        return regex.test(String(actualValue));
      } catch {
        return false;
      }

    // Existence
    case 'exists':
    case 'is-defined':
      return actualValue !== null && actualValue !== undefined;

    case 'not-exists':
    case 'is-null':
    case 'is-undefined':
      return actualValue === null || actualValue === undefined;

    // Numeric comparisons
    case 'greater-than':
    case 'gt':
    case '>':
      return Number(actualValue) > Number(expectedValue);

    case 'less-than':
    case 'lt':
    case '<':
      return Number(actualValue) < Number(expectedValue);

    case 'greater-equal':
    case 'gte':
    case '>=':
      return Number(actualValue) >= Number(expectedValue);

    case 'less-equal':
    case 'lte':
    case '<=':
      return Number(actualValue) <= Number(expectedValue);

    // Empty checks
    case 'is-empty':
    case 'empty':
      if (Array.isArray(actualValue)) return actualValue.length === 0;
      if (typeof actualValue === 'string') return actualValue.length === 0;
      if (typeof actualValue === 'object' && actualValue !== null) {
        return Object.keys(actualValue).length === 0;
      }
      return !actualValue;

    case 'not-empty':
      if (Array.isArray(actualValue)) return actualValue.length > 0;
      if (typeof actualValue === 'string') return actualValue.length > 0;
      if (typeof actualValue === 'object' && actualValue !== null) {
        return Object.keys(actualValue).length > 0;
      }
      return !!actualValue;

    // Boolean checks
    case 'is-truthy':
    case 'truthy':
      return !!actualValue;

    case 'is-falsy':
    case 'falsy':
      return !actualValue;

    // Type checks
    case 'type-is':
    case 'typeof':
      return typeof actualValue === expectedValue.toLowerCase();

    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

/**
 * Execute all assertions from a table
 */
export function executeAssertions(
  assertions: Assertion[],
  context: AssertionContext
): AssertionResult[] {
  return assertions.map(assertion => executeAssertion(assertion, context));
}
