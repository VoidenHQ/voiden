import { describe, it, expect, beforeEach } from 'vitest';
import { readHistory, appendToHistory, clearHistory } from '../historyManager';
import type { HistoryEntry } from '../types';

/**
 * Regression test for #520:
 * Request histories for distinct .void files with the same basename must
 * be persisted (and cleared) independently, keyed by full file identity
 * rather than basename alone.
 */

// In-memory filesystem standing in for window.electron.files / utils / git.
class InMemoryFs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  pathJoin = async (...parts: string[]) => parts.filter(Boolean).join('/');

  getDirectoryExist = async (base: string, name: string) => this.dirs.has(`${base}/${name}`);
  createDirectory = async (base: string, name: string) => { this.dirs.add(`${base}/${name}`); };

  read = async (path: string) => this.files.get(path) ?? null;
  write = async (path: string, content: string) => { this.files.set(path, content); };
  listDir = async (dirPath: string) =>
    Array.from(this.files.keys())
      .filter((p) => p.startsWith(`${dirPath}/`))
      .map((p) => p.slice(dirPath.length + 1));
}

function makeEntry(id: string): HistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    source: 'test',
    request: { method: 'GET', url: 'https://example.com', headers: [] },
  } as unknown as HistoryEntry;
}

describe('historyManager - per-file identity (#520)', () => {
  let fs: InMemoryFs;

  beforeEach(() => {
    fs = new InMemoryFs();
    (globalThis as any).window = {
      electron: {
        files: {
          getDirectoryExist: fs.getDirectoryExist,
          createDirectory: fs.createDirectory,
          read: fs.read,
          write: fs.write,
          listDir: fs.listDir,
        },
        utils: { pathJoin: fs.pathJoin },
        git: { updateGitignore: async () => {} },
      },
    };
  });

  it('does not merge histories for two files sharing a basename', async () => {
    const projectPath = '/workspace';
    const fileA = '/workspace/team-a/login.void';
    const fileB = '/workspace/team-b/login.void';

    await appendToHistory(projectPath, fileA, makeEntry('first'), 90);
    await appendToHistory(projectPath, fileB, makeEntry('second'), 90);

    // Two distinct persisted history files must exist.
    const historyFileNames = Array.from(fs.files.keys()).filter((p) =>
      p.includes('/workspace/.voiden/history/'),
    );
    expect(historyFileNames.length).toBe(2);

    const historyA = await readHistory(projectPath, fileA, 90);
    const historyB = await readHistory(projectPath, fileB, 90);

    expect(historyA.entries.map((e) => e.id)).toEqual(['first']);
    expect(historyB.entries.map((e) => e.id)).toEqual(['second']);
    expect(historyA.filePath).toBe(fileA);
    expect(historyB.filePath).toBe(fileB);
  });

  it('clearing one file leaves the other file with entries intact', async () => {
    const projectPath = '/workspace';
    const fileA = '/workspace/team-a/login.void';
    const fileB = '/workspace/team-b/login.void';

    await appendToHistory(projectPath, fileA, makeEntry('first'), 90);
    await appendToHistory(projectPath, fileB, makeEntry('second'), 90);

    await clearHistory(projectPath, fileB);

    const historyA = await readHistory(projectPath, fileA, 90);
    const historyB = await readHistory(projectPath, fileB, 90);

    expect(historyA.entries.map((e) => e.id)).toEqual(['first']);
    expect(historyB.entries).toEqual([]);
  });
});