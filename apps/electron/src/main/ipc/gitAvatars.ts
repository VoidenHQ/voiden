// Author avatar lookup for the Commit History hover card.
// Order: GitHub noreply email (no network) -> GitHub commit API (GitHub remotes) -> Gravatar.
// Results are cached per email, including misses, so each author costs at most one request.
import { createHash } from "crypto";

const AVATAR_SIZE = 64;
const GITHUB_API_TIMEOUT_MS = 5000;
const MISS_TTL_MS = 60 * 60 * 1000;

/** `12345+login@users.noreply.github.com` or `login@users.noreply.github.com` -> avatar URL. */
export function githubNoreplyAvatar(email: string): string | null {
  const match = email.trim().match(/^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/i);
  if (!match) return null;
  const [, id, login] = match;
  return id
    ? `https://avatars.githubusercontent.com/u/${id}?s=${AVATAR_SIZE}&v=4`
    : `https://github.com/${encodeURIComponent(login)}.png?size=${AVATAR_SIZE}`;
}

/** Owner/repo for github.com remotes (https, ssh or scp-style); null for anything else. */
export function parseGithubRepo(remoteUrl: string | null | undefined): { owner: string; repo: string } | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** Gravatar URL that 404s when the email has no Gravatar, so the UI can fall back to initials. */
export function gravatarUrl(email: string): string {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=${AVATAR_SIZE}&d=404`;
}

// `final` = found on GitHub (or noreply); fallbacks are retried after MISS_TTL_MS in case GitHub was offline or rate limited.
const isCommitHash = (hash: string) => /^[0-9a-f]{7,64}$/i.test(hash);

const cache = new Map<string, { url: string; at: number; final: boolean }>();
const pending = new Map<string, Promise<string>>();

async function fetchGithubCommitAvatar(owner: string, repo: string, hash: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${hash}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Voiden" },
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
  });
  // 404 for private repos, 403 when the unauthenticated rate limit is hit: fall through.
  if (!res.ok) return null;
  const data = (await res.json()) as { author?: { avatar_url?: string } | null };
  const url = data.author?.avatar_url;
  return url ? `${url}${url.includes("?") ? "&" : "?"}s=${AVATAR_SIZE}` : null;
}

/**
 * Best avatar URL for a commit author. Never throws; the Gravatar fallback may still 404,
 * which the renderer handles by keeping the initials.
 */
export async function resolveAuthorAvatar(
  email: string,
  commitHash: string,
  remoteUrl: string | null,
  /** Another commit by this author that is already on the remote, for when `commitHash` is not pushed yet. */
  findPushedCommit?: () => Promise<string | null>,
): Promise<string | null> {
  const key = email.trim().toLowerCase();
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && (cached.final || Date.now() - cached.at < MISS_TTL_MS)) return cached.url;
  if (pending.has(key)) return pending.get(key)!;

  const lookup = (async (): Promise<string> => {
    let url = githubNoreplyAvatar(key);
    const repo = parseGithubRepo(remoteUrl);
    if (!url && repo) {
      try {
        if (isCommitHash(commitHash)) url = await fetchGithubCommitAvatar(repo.owner, repo.repo, commitHash);
        if (!url && findPushedCommit) {
          // Local commits are unknown to GitHub; any pushed commit by the same author has the same avatar.
          const pushed = await findPushedCommit();
          if (pushed && pushed !== commitHash && isCommitHash(pushed)) {
            url = await fetchGithubCommitAvatar(repo.owner, repo.repo, pushed);
          }
        }
      } catch {
        url = null; // offline or timed out
      }
    }
    const final = !!url;
    const resolved = url ?? gravatarUrl(key);
    cache.set(key, { url: resolved, at: Date.now(), final });
    return resolved;
  })().finally(() => pending.delete(key));

  pending.set(key, lookup);
  return lookup;
}
