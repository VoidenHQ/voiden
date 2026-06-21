import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { discoverFiles } from './stitchEngine';

describe('stitchEngine sorting / discovery', () => {
  beforeAll(() => {
    (global as any).window = {
      electron: {
        files: {
          getVoidFiles: async () => [
            { source: '/path/to/project/b.void' },
            { source: '/path/to/project/a.void' },
            { source: '/path/to/project/subdir/c.void' },
          ],
        },
        state: {
          getProjects: async () => ({
            activeProject: '/path/to/project',
          }),
        },
      },
    };
  });

  afterAll(() => {
    delete (global as any).window;
  });

  it('sorts alphabetically by default when no fileOrder is present', async () => {
    const config: any = {
      include: [],
      exclude: [],
      fileOrder: [],
    };
    const result = await discoverFiles(config, '/path/to/project/current.void');
    expect(result.files).toEqual([
      'a.void',
      'b.void',
      'subdir/c.void',
    ]);
  });

  it('respects fileOrder array', async () => {
    const config: any = {
      include: [],
      exclude: [],
      fileOrder: ['b.void', 'subdir/c.void', 'a.void'],
    };
    const result = await discoverFiles(config, '/path/to/project/current.void');
    expect(result.files).toEqual([
      'b.void',
      'subdir/c.void',
      'a.void',
    ]);
  });

  it('respects fileOrder stringified JSON array', async () => {
    const config: any = {
      include: [],
      exclude: [],
      fileOrder: JSON.stringify(['subdir/c.void', 'a.void', 'b.void']),
    };
    const result = await discoverFiles(config, '/path/to/project/current.void');
    expect(result.files).toEqual([
      'subdir/c.void',
      'a.void',
      'b.void',
    ]);
  });

  it('normalizes backslashes in fileOrder (Windows paths)', async () => {
    const config: any = {
      include: [],
      exclude: [],
      fileOrder: ['subdir\\c.void', 'a.void'],
    };
    const result = await discoverFiles(config, '/path/to/project/current.void');
    expect(result.files).toEqual([
      'subdir/c.void',
      'a.void',
      'b.void', // 'b.void' is not in fileOrder, so it sorts alphabetically after
    ]);
  });
});
