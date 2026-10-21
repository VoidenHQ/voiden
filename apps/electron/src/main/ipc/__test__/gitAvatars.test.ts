import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { githubNoreplyAvatar, gravatarUrl, parseGithubRepo, resolveAuthorAvatar } from '../gitAvatars';

const HASH = '0ecc37a1234567890abcdef1234567890abcdef1';

describe('githubNoreplyAvatar', () => {
  it('uses the numeric id when present', () => {
    expect(githubNoreplyAvatar('66750157+lucas@users.noreply.github.com')).toBe(
      'https://avatars.githubusercontent.com/u/66750157?s=64&v=4',
    );
  });
  it('falls back to the login for old-style noreply emails', () => {
    expect(githubNoreplyAvatar('Simran@users.noreply.github.com')).toBe('https://github.com/Simran.png?size=64');
  });
  it('ignores other emails', () => {
    expect(githubNoreplyAvatar('simranjot@apyhub.com')).toBeNull();
    expect(githubNoreplyAvatar('noreply@github.com')).toBeNull();
  });
});

describe('parseGithubRepo', () => {
  it.each([
    'https://github.com/VoidenHQ/voiden.git',
    'https://github.com/VoidenHQ/voiden',
    'https://user:token@github.com/VoidenHQ/voiden.git',
    'git@github.com:VoidenHQ/voiden.git',
    'ssh://git@github.com/VoidenHQ/voiden.git',
  ])('%s', (remote) => {
    expect(parseGithubRepo(remote)).toEqual({ owner: 'VoidenHQ', repo: 'voiden' });
  });
  it.each([null, '', 'https://gitlab.com/a/b.git', 'git@git.apy.team:ardoise/ui.git', 'C:\\repos\\voiden', 'https://github.com.evil.io/a/b'])(
    'returns null for %s',
    (remote) => {
      expect(parseGithubRepo(remote)).toBeNull();
    },
  );
});

describe('gravatarUrl', () => {
  it('hashes the normalized email with sha256 and asks for a 404 when missing', () => {
    const hash = createHash('sha256').update('dev@example.com').digest('hex');
    expect(gravatarUrl('  Dev@Example.com ')).toBe(`https://www.gravatar.com/avatar/${hash}?s=64&d=404`);
  });
});

describe('resolveAuthorAvatar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the GitHub commit author avatar and caches it per email', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ author: { avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const remote = 'git@github.com:VoidenHQ/voiden.git';
    const first = await resolveAuthorAvatar('cached@example.com', HASH, remote);
    const second = await resolveAuthorAvatar('Cached@Example.com', 'abcdef1', remote);

    expect(first).toBe('https://avatars.githubusercontent.com/u/1?v=4&s=64');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.github.com/repos/VoidenHQ/voiden/commits/${HASH}`);
  });

  it('falls back to Gravatar when GitHub is rate limited, private or offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await resolveAuthorAvatar('limited@example.com', HASH, 'https://github.com/a/b.git')).toBe(gravatarUrl('limited@example.com'));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await resolveAuthorAvatar('offline@example.com', HASH, 'https://github.com/a/b.git')).toBe(gravatarUrl('offline@example.com'));
  });

  it('never calls GitHub for non-GitHub remotes, noreply emails or invalid hashes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await resolveAuthorAvatar('gl@example.com', HASH, 'git@gitlab.com:a/b.git')).toBe(gravatarUrl('gl@example.com'));
    expect(await resolveAuthorAvatar('9+bot@users.noreply.github.com', HASH, 'https://github.com/a/b')).toContain('/u/9?');
    expect(await resolveAuthorAvatar('weird@example.com', '../../evil', 'https://github.com/a/b')).toBe(gravatarUrl('weird@example.com'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a pushed commit by the same author when this commit is not on GitHub yet', async () => {
    const PUSHED = 'b1a985b8b86039cbc5b2106a4e41b468ce30fa36';
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith(PUSHED)
        ? { ok: true, json: async () => ({ author: { avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4' } }) }
        : { ok: false, status: 422 },
    );
    vi.stubGlobal('fetch', fetchMock);
    const findPushedCommit = vi.fn().mockResolvedValue(PUSHED);

    const url = await resolveAuthorAvatar('local@example.com', HASH, 'https://github.com/a/b.git', findPushedCommit);

    expect(url).toBe('https://avatars.githubusercontent.com/u/7?v=4&s=64');
    expect(findPushedCommit).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null without an email', async () => {
    expect(await resolveAuthorAvatar('  ', HASH, null)).toBeNull();
  });
});
