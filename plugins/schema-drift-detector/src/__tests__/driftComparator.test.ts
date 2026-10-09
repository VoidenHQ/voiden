import { describe, it, expect } from 'vitest';
import { inferJsonSchema } from '../utils/schemaInferrer';
import { compareSchemas, isFieldIgnored, generateDriftReport } from '../utils/driftComparator';
import type { IgnoreRule } from '../types';

describe('driftComparator', () => {
  describe('isFieldIgnored', () => {
    const rules: IgnoreRule[] = [
      { id: '1', pattern: '*.timestamp', type: 'wildcard', enabled: true },
      { id: '2', pattern: 'id', type: 'exact', enabled: true },
      { id: '3', pattern: 'data[].token', type: 'wildcard', enabled: true },
      { id: '4', pattern: '/_at$/', type: 'regex', enabled: true },
      { id: '5', pattern: 'disabled.rule', type: 'exact', enabled: false },
    ];

    it('matches wildcard rules', () => {
      expect(isFieldIgnored('meta.timestamp', rules).ignored).toBe(true);
      expect(isFieldIgnored('timestamp', rules).ignored).toBe(true);
      expect(isFieldIgnored('data[0].token', rules).ignored).toBe(true);
    });

    it('matches exact rules', () => {
      expect(isFieldIgnored('id', rules).ignored).toBe(true);
      expect(isFieldIgnored('userId', rules).ignored).toBe(false);
    });

    it('matches regex rules', () => {
      expect(isFieldIgnored('created_at', rules).ignored).toBe(true);
      expect(isFieldIgnored('updated_at', rules).ignored).toBe(true);
      expect(isFieldIgnored('user_name', rules).ignored).toBe(false);
    });

    it('respects disabled rules', () => {
      expect(isFieldIgnored('disabled.rule', rules).ignored).toBe(false);
    });
  });

  describe('compareSchemas', () => {
    it('detects breaking field removal', () => {
      const baseline = inferJsonSchema({ id: 1, name: 'Alice', email: 'alice@example.com' });
      const current = inferJsonSchema({ id: 1, name: 'Alice' });

      const diffs = compareSchemas(baseline, current);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].kind).toBe('FIELD_REMOVED');
      expect(diffs[0].path).toBe('email');
      expect(diffs[0].severity).toBe('breaking');
    });

    it('detects field addition (non-breaking)', () => {
      const baseline = inferJsonSchema({ id: 1, name: 'Alice' });
      const current = inferJsonSchema({ id: 1, name: 'Alice', avatar: 'https://img.com/a.png' });

      const diffs = compareSchemas(baseline, current);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].kind).toBe('FIELD_ADDED');
      expect(diffs[0].path).toBe('avatar');
      expect(diffs[0].severity).toBe('info');
    });

    it('detects breaking type changes', () => {
      const baseline = inferJsonSchema({ id: '123', count: 42 });
      const current = inferJsonSchema({ id: 123, count: '42' });

      const diffs = compareSchemas(baseline, current);
      expect(diffs).toHaveLength(2);
      expect(diffs.some((d) => d.path === 'id' && d.kind === 'TYPE_CHANGED')).toBe(true);
      expect(diffs.some((d) => d.path === 'count' && d.kind === 'TYPE_CHANGED')).toBe(true);
    });

    it('detects nullability changes', () => {
      const baseline = inferJsonSchema({ profile: { bio: 'Hello' } });
      const current = inferJsonSchema({ profile: { bio: null } });

      const diffs = compareSchemas(baseline, current);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].path).toBe('profile.bio');
      expect(diffs[0].kind).toBe('NULLABILITY_CHANGED');
      expect(diffs[0].severity).toBe('breaking');
    });

    it('applies ignore rules during comparison', () => {
      const baseline = inferJsonSchema({ id: 1, timestamp: 1600000000, name: 'Alice' });
      const current = inferJsonSchema({ id: 1, timestamp: '2026-10-06T00:00:00Z', name: 'Alice' });

      const rules: IgnoreRule[] = [
        { id: '1', pattern: '*.timestamp', type: 'wildcard', enabled: true },
      ];

      const diffs = compareSchemas(baseline, current, { ignoreRules: rules });
      expect(diffs).toHaveLength(1);
      expect(diffs[0].path).toBe('timestamp');
      expect(diffs[0].ignored).toBe(true);
    });
  });

  describe('generateDriftReport', () => {
    it('summarizes drift metrics accurately', () => {
      const baseline = inferJsonSchema({ id: 1, name: 'Alice', token: 'xyz', oldField: true });
      const current = inferJsonSchema({ id: 1, name: 'Alice', token: 999, newField: 'hello' });

      const report = generateDriftReport({
        baselineSchema: baseline,
        currentSchema: current,
        requestUrl: 'https://api.example.com/user',
        requestMethod: 'GET',
      });

      expect(report.hasBreakingChanges).toBe(true);
      expect(report.hasNonBreakingChanges).toBe(true);
      expect(report.summary.breaking).toBe(2); // token (type changed) + oldField (removed)
      expect(report.summary.additions).toBe(1); // newField
      expect(report.differences).toHaveLength(3);
    });
  });
});
