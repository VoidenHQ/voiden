import { inferPayloadSchema } from './utils/schemaInferrer';
import { compareSchemas, generateDriftReport } from './utils/driftComparator';
import { exportToMarkdown, exportToJson, exportToText } from './utils/reportExporter';
import type { DriftReport, IgnoreRule, SchemaNode } from './types';

export interface CliRunOptions {
  baselineJsonOrSchema: string | object;
  currentResponseOrPayload: string | object;
  ignoreRules?: IgnoreRule[];
  format?: 'json' | 'xml';
  strict?: boolean;
}

/**
 * Programmatic headless comparison for CI and automated tests
 */
export function runSchemaDriftCheck(options: CliRunOptions): {
  success: boolean;
  hasBreakingChanges: boolean;
  report: DriftReport;
  markdown: string;
  json: string;
  text: string;
} {
  const {
    baselineJsonOrSchema,
    currentResponseOrPayload,
    ignoreRules = [],
    format = 'json',
    strict = false,
  } = options;

  let baselineSchema: SchemaNode;
  if (
    typeof baselineJsonOrSchema === 'object' &&
    'type' in baselineJsonOrSchema &&
    !Array.isArray(baselineJsonOrSchema)
  ) {
    baselineSchema = baselineJsonOrSchema as SchemaNode;
  } else {
    const inferred = inferPayloadSchema(baselineJsonOrSchema, format);
    baselineSchema = inferred.schema;
  }

  const currentInferred = inferPayloadSchema(currentResponseOrPayload, format);
  const currentSchema = currentInferred.schema;

  const report = generateDriftReport({
    baselineSchema,
    currentSchema,
    format: currentInferred.format,
    options: {
      ignoreRules,
      strictArrays: strict,
      checkNullability: true,
      ignoreAddedFields: !strict,
    },
  });

  const markdown = exportToMarkdown(report);
  const json = exportToJson(report);
  const text = exportToText(report);

  return {
    success: !report.hasBreakingChanges,
    hasBreakingChanges: report.hasBreakingChanges,
    report,
    markdown,
    json,
    text,
  };
}
