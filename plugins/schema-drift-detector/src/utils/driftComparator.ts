import type {
  DriftDifference,
  DriftReport,
  DriftSummary,
  IgnoreRule,
  SchemaNode,
  SchemaType,
} from '../types';

export interface CompareOptions {
  ignoreRules?: IgnoreRule[];
  strictArrays?: boolean;
  checkNullability?: boolean;
  ignoreAddedFields?: boolean;
}

/**
 * Check if a given dot-path matches an ignore pattern
 */
export function isFieldIgnored(
  path: string,
  ignoreRules: IgnoreRule[] = []
): { ignored: boolean; matchedRule?: IgnoreRule } {
  if (!ignoreRules || ignoreRules.length === 0) {
    return { ignored: false };
  }

  // Normalize path (e.g. users[0].id -> users[].id or users.id)
  const normalizedPath = path.replace(/\[\d+\]/g, '[]');
  const pathParts = normalizedPath.split('.');
  const lastField = pathParts[pathParts.length - 1]?.replace(/\[\]$/, '');

  for (const rule of ignoreRules) {
    if (!rule.enabled) continue;

    const pattern = rule.pattern.trim();

    // 1. Regex rule
    if (rule.type === 'regex' || (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0)) {
      try {
        let regex: RegExp;
        if (pattern.startsWith('/')) {
          const lastSlash = pattern.lastIndexOf('/');
          const expr = pattern.slice(1, lastSlash);
          const flags = pattern.slice(lastSlash + 1);
          regex = new RegExp(expr, flags);
        } else {
          regex = new RegExp(pattern);
        }

        if (regex.test(path) || regex.test(normalizedPath) || regex.test(lastField)) {
          return { ignored: true, matchedRule: rule };
        }
      } catch {
        // Invalid regex, skip
      }
      continue;
    }

    // 2. Exact match
    if (rule.type === 'exact') {
      if (
        pattern === path ||
        pattern === normalizedPath ||
        pattern === lastField ||
        pattern.toLowerCase() === lastField.toLowerCase()
      ) {
        return { ignored: true, matchedRule: rule };
      }
      continue;
    }

    // 3. Wildcard / Glob match (e.g. *.timestamp, data.*.id, id, timestamp)
    if (pattern === lastField || pattern.toLowerCase() === lastField.toLowerCase()) {
      return { ignored: true, matchedRule: rule };
    }

    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\[\]/g, '\\[\\]')
      .replace(/\*/g, '.*');

    const matcher = new RegExp(`^${regexPattern}$`, 'i');
    if (matcher.test(path) || matcher.test(normalizedPath) || matcher.test(lastField)) {
      return { ignored: true, matchedRule: rule };
    }
  }

  return { ignored: false };
}

/**
 * Format schema type description for display
 */
export function formatType(node?: SchemaNode): string {
  if (!node) return 'undefined';
  const types = Array.isArray(node.type) ? node.type.join(' | ') : node.type;
  const nullable = node.nullable ? ' (nullable)' : '';
  const format = node.format ? `<${node.format}>` : '';
  return `${types}${format}${nullable}`;
}

/**
 * Compare baseline and current schema trees
 */
export function compareSchemas(
  baseline: SchemaNode,
  current: SchemaNode,
  options: CompareOptions = {},
  currentPath = ''
): DriftDifference[] {
  const differences: DriftDifference[] = [];
  const ignoreRules = options.ignoreRules || [];

  // Helper to push diff with ignore check
  const pushDiff = (diff: Omit<DriftDifference, 'ignored' | 'ignoreReason'>) => {
    const { ignored, matchedRule } = isFieldIgnored(diff.path, ignoreRules);
    differences.push({
      ...diff,
      ignored,
      ignoreReason: ignored ? `Matched ignore rule: "${matchedRule?.pattern}"` : undefined,
    });
  };

  const baselineTypes = Array.isArray(baseline.type) ? baseline.type : [baseline.type];
  const currentTypes = Array.isArray(current.type) ? current.type : [current.type];

  // 1. Root / Primitive Type Change Check
  const isTypeCompatible = areTypesCompatible(baselineTypes, currentTypes);

  if (!isTypeCompatible) {
    pushDiff({
      path: currentPath || 'root',
      kind: 'TYPE_CHANGED',
      severity: 'breaking',
      baselineType: formatType(baseline),
      currentType: formatType(current),
      description: `Type changed from ${formatType(baseline)} to ${formatType(current)}`,
      baselineExample: baseline.example,
      currentExample: current.example,
    });
    return differences;
  }

  // 2. Nullability Check
  if (options.checkNullability !== false) {
    const wasNonNullable = !baseline.nullable && !baselineTypes.includes('null');
    const isNowNullable = current.nullable || currentTypes.includes('null');

    if (wasNonNullable && isNowNullable) {
      pushDiff({
        path: currentPath || 'root',
        kind: 'NULLABILITY_CHANGED',
        severity: 'breaking',
        baselineType: formatType(baseline),
        currentType: formatType(current),
        description: `Field became nullable (previously non-nullable ${formatType(baseline)})`,
        baselineExample: baseline.example,
        currentExample: current.example,
      });
    }
  }

  // 3. Object Properties Comparison
  if (baselineTypes.includes('object') && currentTypes.includes('object')) {
    const baselineProps = baseline.properties || {};
    const currentProps = current.properties || {};

    const baselineKeys = Object.keys(baselineProps);
    const currentKeys = Object.keys(currentProps);

    // Removed fields
    for (const key of baselineKeys) {
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;
      if (!(key in currentProps)) {
        pushDiff({
          path: fieldPath,
          kind: 'FIELD_REMOVED',
          severity: 'breaking',
          baselineType: formatType(baselineProps[key]),
          description: `Field "${key}" was removed from response structure`,
          baselineExample: baselineProps[key]?.example,
        });
      } else {
        // Recurse into nested property
        const nestedDiffs = compareSchemas(
          baselineProps[key],
          currentProps[key],
          options,
          fieldPath
        );
        differences.push(...nestedDiffs);
      }
    }

    // Added fields
    for (const key of currentKeys) {
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;
      if (!(key in baselineProps)) {
        pushDiff({
          path: fieldPath,
          kind: 'FIELD_ADDED',
          severity: options.ignoreAddedFields ? 'info' : 'info',
          currentType: formatType(currentProps[key]),
          description: `New field "${key}" added (${formatType(currentProps[key])})`,
          currentExample: currentProps[key]?.example,
        });
      }
    }
  }

  // 4. Array Items Comparison
  if (baselineTypes.includes('array') && currentTypes.includes('array')) {
    const arrayPath = currentPath ? `${currentPath}[]` : '[]';

    if (baseline.items && current.items) {
      const itemDiffs = compareSchemas(baseline.items, current.items, options, arrayPath);
      differences.push(...itemDiffs);
    }
  }

  return differences;
}

/**
 * Check if current types are backward-compatible with baseline types
 */
function areTypesCompatible(baseline: SchemaType[], current: SchemaType[]): boolean {
  if (baseline.includes('unknown') || current.includes('unknown')) return true;

  // Exact match
  if (baseline.some((b) => current.includes(b))) return true;

  // integer is compatible with number
  if (baseline.includes('integer') && current.includes('number')) return true;
  if (baseline.includes('number') && current.includes('integer')) return true;

  return false;
}

/**
 * Generate a complete Drift Report
 */
export function generateDriftReport(params: {
  id?: string;
  tabId?: string;
  filePath?: string;
  requestUrl?: string;
  requestMethod?: string;
  statusCode?: number;
  baselineSchema?: SchemaNode;
  currentSchema: SchemaNode;
  format?: 'json' | 'xml' | 'unknown';
  options?: CompareOptions;
}): DriftReport {
  const {
    id = `drift_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tabId,
    filePath,
    requestUrl,
    requestMethod,
    statusCode,
    baselineSchema,
    currentSchema,
    format = 'json',
    options = {},
  } = params;

  if (!baselineSchema) {
    return {
      id,
      tabId,
      filePath,
      requestUrl,
      requestMethod,
      statusCode,
      timestamp: Date.now(),
      hasBreakingChanges: false,
      hasNonBreakingChanges: false,
      isNewBaseline: true,
      summary: {
        total: 0,
        breaking: 0,
        warnings: 0,
        additions: 0,
        ignored: 0,
      },
      differences: [],
      currentSchema,
      format,
    };
  }

  const differences = compareSchemas(baselineSchema, currentSchema, options);

  const summary: DriftSummary = {
    total: differences.length,
    breaking: differences.filter((d) => !d.ignored && d.severity === 'breaking').length,
    warnings: differences.filter((d) => !d.ignored && d.severity === 'warning').length,
    additions: differences.filter((d) => !d.ignored && d.kind === 'FIELD_ADDED').length,
    ignored: differences.filter((d) => d.ignored).length,
  };

  return {
    id,
    tabId,
    filePath,
    requestUrl,
    requestMethod,
    statusCode,
    timestamp: Date.now(),
    hasBreakingChanges: summary.breaking > 0,
    hasNonBreakingChanges: summary.additions > 0 || summary.warnings > 0,
    isNewBaseline: false,
    summary,
    differences,
    baselineSchema,
    currentSchema,
    format,
  };
}
