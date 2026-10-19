import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COMMIT_DETAILS_FORMAT,
  mergeCommitFileStats,
  parseCommitDetails,
  parseNameStatusZ,
  parseNumstatZ,
} from '../gitCommitParsers';

describe('parseNameStatusZ', () => {
  it('parses plain and rename entries', () => {
    const raw = 'M\0src/a.ts\0R087\0old name.ts\0new name.ts\0D\0gone.txt\0';
    expect(parseNameStatusZ(raw)).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'new name.ts', oldPath: 'old name.ts', status: 'R' },
      { path: 'gone.txt', status: 'D' },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseNameStatusZ('')).toEqual([]);
  });
});

describe('parseNumstatZ', () => {
  it('parses counts, renames and binary files', () => {
    const raw = '3\t1\tsrc/a.ts\0' + '2\t0\t\0old.ts\0new.ts\0' + '-\t-\timg.png\0';
    expect(parseNumstatZ(raw)).toEqual([
      { path: 'src/a.ts', insertions: 3, deletions: 1 },
      { path: 'new.ts', insertions: 2, deletions: 0 },
      { path: 'img.png', insertions: 0, deletions: 0 },
    ]);
  });
});

describe('mergeCommitFileStats', () => {
  it('joins status with counts by path and defaults missing counts to 0', () => {
    expect(
      mergeCommitFileStats(
        [{ path: 'a', status: 'M' }, { path: 'b', status: 'A' }],
        [{ path: 'a', insertions: 4, deletions: 2 }],
      ),
    ).toEqual([
      { path: 'a', status: 'M', insertions: 4, deletions: 2, changes: 6 },
      { path: 'b', status: 'A', insertions: 0, deletions: 0, changes: 0 },
    ]);
  });
});

describe('parseCommitDetails', () => {
  it('keeps NUL-free multi-line bodies and splits parents', () => {
    const raw = ['abcdef1234567', 'Ann', 'ann@x.io', '2026-10-07T17:42:00+05:30', 'Bob', 'bob@x.io', '2026-10-08T10:00:00+05:30', 'p1 p2', 'HEAD -> main', 'fix: thing', 'Body line\n\nCo-authored-by: C <c@x.io>\n'].join('\0');
    expect(parseCommitDetails(raw)).toMatchObject({
      hash: 'abcdef1234567',
      shortHash: 'abcdef1',
      authorName: 'Ann',
      parents: ['p1', 'p2'],
      refs: 'HEAD -> main',
      subject: 'fix: thing',
      body: 'Body line\n\nCo-authored-by: C <c@x.io>',
    });
  });

  it('returns null for malformed output', () => {
    expect(parseCommitDetails('')).toBeNull();
    expect(parseCommitDetails('abc\0only')).toBeNull();
  });
});

// Runs the exact git commands the IPC handlers use against a real repository.
describe('against a real git repository', () => {
  let repo: string;
  let emptyConfig: string;
  // Isolate from the developer's global/system git config (signing, autocrlf, hooks...).
  // An empty file instead of /dev/null so this also works with Git for Windows.
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' } });
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  const filesFor = (hash: string, hasParent: boolean) => {
    const args = hasParent
      ? ['diff', '-M', '-z', `${hash}^`, hash]
      : ['diff-tree', '-r', '-M', '-z', '--root', '--no-commit-id', hash];
    return mergeCommitFileStats(parseNameStatusZ(git(...args, '--name-status')), parseNumstatZ(git(...args, '--numstat')));
  };
  const write = (file: string, content: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  const hashes: Record<string, string> = {};

  beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voiden-git-parsers-'));
    emptyConfig = path.join(tmp, 'empty.gitconfig');
    fs.writeFileSync(emptyConfig, '');
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test Author');
    git('config', 'user.email', 'author@example.com');

    write('readme.md', 'one\ntwo\n');
    write('dir with space/a file.void', 'request\n');
    hashes.root = commit('initial commit');

    write('readme.md', 'one\nTWO\nthree\n');
    write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0]));
    fs.renameSync(path.join(repo, 'dir with space/a file.void'), path.join(repo, 'dir with space/renamed.void'));
    hashes.second = commit('feat: second\n\nLonger body.\n\nCo-authored-by: Pair Person <pair@example.com>');

    fs.rmSync(path.join(repo, 'logo.png'));
    hashes.third = commit('chore: remove logo');

    git('checkout', '-q', '-b', 'side', hashes.second);
    write('side.txt', 'side\n');
    commit('side work');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side');
    hashes.merge = git('rev-parse', 'HEAD').trim();
  });

  afterAll(() => {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  });

  it('lists files of the root commit', () => {
    expect(filesFor(hashes.root, false)).toEqual([
      { path: 'dir with space/a file.void', status: 'A', insertions: 1, deletions: 0, changes: 1 },
      { path: 'readme.md', status: 'A', insertions: 2, deletions: 0, changes: 2 },
    ]);
  });

  it('reports modify, binary add and rename with counts', () => {
    const files = filesFor(hashes.second, true);
    expect(files).toContainEqual({ path: 'readme.md', status: 'M', insertions: 2, deletions: 1, changes: 3 });
    expect(files).toContainEqual({ path: 'logo.png', status: 'A', insertions: 0, deletions: 0, changes: 0 });
    expect(files).toContainEqual({
      path: 'dir with space/renamed.void',
      oldPath: 'dir with space/a file.void',
      status: 'R',
      insertions: 0,
      deletions: 0,
      changes: 0,
    });
  });

  it('reports deletions', () => {
    expect(filesFor(hashes.third, true)).toEqual([
      { path: 'logo.png', status: 'D', insertions: 0, deletions: 0, changes: 0 },
    ]);
  });

  it('diffs a merge commit against its first parent', () => {
    expect(filesFor(hashes.merge, true)).toEqual([
      { path: 'side.txt', status: 'A', insertions: 1, deletions: 0, changes: 1 },
    ]);
  });

  it('detects whether a commit has a parent the way the handler does', () => {
    expect(() => git('rev-parse', '--verify', '--quiet', `${hashes.root}^`)).toThrow();
    expect(git('rev-parse', '--verify', '--quiet', `${hashes.second}^`).trim()).toBe(hashes.root);
  });

  it('reads full commit details', () => {
    const details = parseCommitDetails(git('show', '-s', `--format=${COMMIT_DETAILS_FORMAT}`, hashes.second));
    expect(details).toMatchObject({
      hash: hashes.second,
      authorName: 'Test Author',
      authorEmail: 'author@example.com',
      parents: [hashes.root],
      subject: 'feat: second',
      body: 'Longer body.\n\nCo-authored-by: Pair Person <pair@example.com>',
    });
    expect(new Date(details!.authorDate).getTime()).not.toBeNaN();

    const merge = parseCommitDetails(git('show', '-s', `--format=${COMMIT_DETAILS_FORMAT}`, hashes.merge));
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.refs).toContain('main');
    expect(merge?.body).toBe('');
  });
});
