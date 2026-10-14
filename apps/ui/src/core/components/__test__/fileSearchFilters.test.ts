import { describe, expect, it } from 'vitest';
import { shouldHideFromFileSearch } from '../fileSearchFilters';

describe('shouldHideFromFileSearch', () => {
  it('shows all files when no mask is set', () => {
    expect(shouldHideFromFileSearch('docs/api.json', {})).toBe(false);
  });

  it('applies include patterns from file mask', () => {
    expect(
      shouldHideFromFileSearch('handler.ts', { fileMask: '*.ts' }),
    ).toBe(false);
    expect(
      shouldHideFromFileSearch('api.json', { fileMask: '*.ts' }),
    ).toBe(true);
  });

  it('applies exclude patterns from file mask', () => {
    expect(
      shouldHideFromFileSearch('api.json', { fileMask: '!*.json' }),
    ).toBe(true);
    expect(
      shouldHideFromFileSearch('handler.ts', { fileMask: '!*.json' }),
    ).toBe(false);
    expect(
      shouldHideFromFileSearch('request.void', { fileMask: '!*.json, !*.void' }),
    ).toBe(true);
  });
});
