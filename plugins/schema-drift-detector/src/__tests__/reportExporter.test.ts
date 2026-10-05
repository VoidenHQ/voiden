import { describe, it, expect } from 'vitest';
import { inferJsonSchema } from '../utils/schemaInferrer';
import { generateDriftReport } from '../utils/driftComparator';
import { exportToMarkdown, exportToJson, exportToText, exportToHtml } from '../utils/reportExporter';

describe('reportExporter', () => {
  const baseline = inferJsonSchema({ id: 1, name: 'Alice', active: true });
  const current = inferJsonSchema({ id: '1', name: 'Alice', role: 'admin' });

  const report = generateDriftReport({
    baselineSchema: baseline,
    currentSchema: current,
    requestUrl: 'https://api.example.com/v1/users/1',
    requestMethod: 'GET',
    statusCode: 200,
  });

  it('exports valid markdown table', () => {
    const md = exportToMarkdown(report);
    expect(md).toContain('# Schema Drift Report');
    expect(md).toContain('**BREAKING CHANGES DETECTED**');
    expect(md).toContain('| 🔴 Breaking | `TYPE_CHANGED` | `id` |');
    expect(md).toContain('| 🔴 Breaking | `FIELD_REMOVED` | `active` |');
    expect(md).toContain('| 🟢 Added | `FIELD_ADDED` | `role` |');
  });

  it('exports valid JSON', () => {
    const jsonStr = exportToJson(report);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.hasBreakingChanges).toBe(true);
    expect(parsed.summary.breaking).toBe(2);
    expect(parsed.summary.additions).toBe(1);
  });

  it('exports readable ASCII text', () => {
    const text = exportToText(report);
    expect(text).toContain('API SCHEMA DRIFT REPORT');
    expect(text).toContain('BREAKING');
    expect(text).toContain('https://api.example.com/v1/users/1');
  });

  it('exports HTML document', () => {
    const html = exportToHtml(report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Schema Drift Report');
    expect(html).toContain('badge-breaking');
  });
});
