import { describe, expect, it } from 'vitest';
import { shouldHideFromFileSearch } from '../fileSearchFilters';

describe('shouldHideFromFileSearch', () => {
  it('shows all files when no filters are enabled', () => {
    expect(
      shouldHideFromFileSearch('docs/api.json', {
        hideJson: false,
        hideVoid: false,
      }),
    ).toBe(false);
  });

  it('hides json and jsonc when hideJson is enabled', () => {
    const opts = { hideJson: true, hideVoid: false };
    expect(shouldHideFromFileSearch('api.json', opts)).toBe(true);
    expect(shouldHideFromFileSearch('config.jsonc', opts)).toBe(true);
    expect(shouldHideFromFileSearch('handler.ts', opts)).toBe(false);
  });

  it('hides void files when hideVoid is enabled', () => {
    const opts = { hideJson: false, hideVoid: true };
    expect(shouldHideFromFileSearch('request.void', opts)).toBe(true);
    expect(shouldHideFromFileSearch('readme.md', opts)).toBe(false);
  });

  it('applies include patterns from file mask', () => {
    expect(
      shouldHideFromFileSearch('handler.ts', {
        hideJson: false,
        hideVoid: false,
        fileMask: '*.ts',
      }),
    ).toBe(false);
    expect(
      shouldHideFromFileSearch('api.json', {
        hideJson: false,
        hideVoid: false,
        fileMask: '*.ts',
      }),
    ).toBe(true);
  });

  it('applies exclude patterns from file mask', () => {
    expect(
      shouldHideFromFileSearch('api.json', {
        hideJson: false,
        hideVoid: false,
        fileMask: '!*.json',
      }),
    ).toBe(true);
    expect(
      shouldHideFromFileSearch('handler.ts', {
        hideJson: false,
        hideVoid: false,
        fileMask: '!*.json',
      }),
    ).toBe(false);
  });
});
