import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../types';

let unsaved: Record<string, string> = {};
vi.mock('@/core/editors/voiden/VoidenEditor', () => ({
  useEditorStore: { getState: () => ({ unsaved }) },
}));

const appended: HistoryEntry[] = [];
vi.mock('../historyManager', () => ({
  appendToHistory: async (_projectPath: string, filePath: string, entry: HistoryEntry) => {
    appended.push(entry);
    return { version: '1.0.0', filePath, entries: [entry] };
  },
}));

const { captureFileCommit, matchesCommit, shortCommitHash } = await import('../fileCommit');
const { initHistoryContext, preProcessingHistoryHook, postProcessingHistoryHook, COMMIT_LOOKUP_GRACE_MS } = await import('../pipelineHooks');

const FILE = '/proj/requests/users.void';
const HASH = '3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39';

const getFileCommit = vi.fn();
const getPanelTabs = vi.fn();
let historyEnabled = true;

beforeEach(() => {
  unsaved = {};
  appended.length = 0;
  historyEnabled = true;
  getFileCommit.mockReset().mockResolvedValue({ hash: HASH, subject: 'Change users request', dirty: false });
  getPanelTabs.mockReset().mockResolvedValue({ tabs: [{ id: 'tab-1', type: 'document', source: FILE }] });
  (globalThis as any).window.electron = {
    git: { getFileCommit },
    state: { getPanelTabs },
    userSettings: { get: async () => ({ history: { enabled: historyEnabled, retention_days: 7 } }) },
  };
});

describe('captureFileCommit', () => {
  it('returns the commit the file is at', async () => {
    expect(await captureFileCommit(FILE)).toEqual({ hash: HASH, subject: 'Change users request', dirty: false });
    expect(getFileCommit).toHaveBeenCalledWith(FILE);
  });

  it('counts unsaved edits in the file\'s tab as uncommitted changes', async () => {
    unsaved = { 'tab-1': '{"type":"doc"}' };
    expect((await captureFileCommit(FILE))?.dirty).toBe(true);
  });

  it('ignores unsaved edits in other files', async () => {
    getPanelTabs.mockResolvedValue({
      tabs: [
        { id: 'tab-1', type: 'document', source: FILE },
        { id: 'tab-2', type: 'document', source: '/proj/requests/other.void' },
      ],
    });
    unsaved = { 'tab-2': '{"type":"doc"}' };
    expect((await captureFileCommit(FILE))?.dirty).toBe(false);
  });

  it('keeps a dirty file dirty when it has no unsaved edits', async () => {
    getFileCommit.mockResolvedValue({ hash: HASH, subject: 's', dirty: true });
    expect((await captureFileCommit(FILE))?.dirty).toBe(true);
  });

  it('returns undefined when the file was never committed or Git fails', async () => {
    getFileCommit.mockResolvedValue(null);
    expect(await captureFileCommit(FILE)).toBeUndefined();
    getFileCommit.mockRejectedValue(new Error('git missing'));
    expect(await captureFileCommit(FILE)).toBeUndefined();
  });

  it('still records the commit when the open tabs cannot be read', async () => {
    getPanelTabs.mockRejectedValue(new Error('ipc'));
    expect((await captureFileCommit(FILE))?.hash).toBe(HASH);
  });
});

describe('matchesCommit', () => {
  const entry = { commit: { hash: HASH, subject: '', dirty: false } };

  it('matches a hash prefix of at least 4 characters, case-insensitively', () => {
    expect(matchesCommit(entry, shortCommitHash(HASH))).toBe(true);
    expect(matchesCommit(entry, ' 3F2A ')).toBe(true);
    expect(matchesCommit(entry, HASH)).toBe(true);
  });

  it('does not match short queries, other hashes or entries without a commit', () => {
    expect(matchesCommit(entry, '3f2')).toBe(false);
    expect(matchesCommit(entry, '2a9c')).toBe(false);
    expect(matchesCommit({}, '3f2a')).toBe(false);
  });
});

initHistoryContext(async () => '/proj', async () => {});

describe('history pipeline hooks', () => {
  const run = async (protocolType = 'rest') => {
    await preProcessingHistoryHook({ editor: { storage: { source: FILE } }, requestState: { protocolType } });
    await postProcessingHistoryHook({
      requestState: { protocolType, method: 'GET', url: 'https://api.example.com/users', headers: [] },
      responseState: { status: 200, statusText: 'OK', headers: [], body: '[]' },
    });
  };

  it('records the commit on the saved entry', async () => {
    await run();
    expect(appended).toHaveLength(1);
    expect(appended[0].commit).toEqual({ hash: HASH, subject: 'Change users request', dirty: false });
  });

  it('saves the entry without a commit when the file is not committed', async () => {
    getFileCommit.mockResolvedValue(null);
    await run();
    expect(appended).toHaveLength(1);
    expect(appended[0]).not.toHaveProperty('commit');
  });

  it('does not hold up the response for a slow Git lookup', async () => {
    vi.useFakeTimers();
    try {
      getFileCommit.mockReturnValue(new Promise(() => {}));
      const done = run();
      await vi.advanceTimersByTimeAsync(COMMIT_LOOKUP_GRACE_MS);
      await done;
    } finally {
      vi.useRealTimers();
    }
    expect(appended).toHaveLength(1);
    expect(appended[0]).not.toHaveProperty('commit');
  });

  it('does not ask Git when history is off', async () => {
    historyEnabled = false;
    await run();
    expect(getFileCommit).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it('leaves socket sessions to the plugin that saves them', async () => {
    await run('wss');
    expect(getFileCommit).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });
});
