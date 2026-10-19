// Pure helpers for the Commit History panel (no React).

export interface CommitWebLink {
  url: string;
  /** Host display name, e.g. "GitHub". */
  provider: string;
}

export interface CoAuthor {
  name: string;
  email: string;
}

export interface CommitRef {
  name: string;
  kind: "head" | "branch" | "remote" | "tag";
}

/**
 * Converts a remote URL (https, ssh or scp-style) into the web page for a commit.
 * Returns null for remotes without a known web UI (local paths, unknown protocols).
 */
export function toCommitWebLink(remoteUrl: string | null | undefined, hash: string): CommitWebLink | null {
  if (!remoteUrl || !hash) return null;
  const trimmed = remoteUrl.trim();

  let host: string;
  let repoPath: string;
  const scp = trimmed.match(/^[\w.-]+@([^:/]+):(.+)$/);
  if (scp) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    repoPath = parsed.pathname;
  }

  repoPath = repoPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!host || !repoPath) return null;
  const base = `https://${host}/${repoPath}`;

  if (host.includes("gitlab")) return { url: `${base}/-/commit/${hash}`, provider: "GitLab" };
  if (host.includes("bitbucket")) return { url: `${base}/commits/${hash}`, provider: "Bitbucket" };
  if (host.includes("github")) return { url: `${base}/commit/${hash}`, provider: "GitHub" };
  return { url: `${base}/commit/${hash}`, provider: host };
}

/** Reads `Co-authored-by: Name <email>` trailers (case-insensitive) from a commit body. */
export function parseCoAuthors(body: string | null | undefined): CoAuthor[] {
  if (!body) return [];
  const result: CoAuthor[] = [];
  const re = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (!result.some((a) => a.email === match![2])) result.push({ name: match[1], email: match[2] });
  }
  return result;
}

/** Splits git's `%D` decoration (`HEAD -> main, origin/main, tag: v1`) into typed refs. */
export function parseRefs(refs: string | null | undefined): CommitRef[] {
  if (!refs?.trim()) return [];
  const result: CommitRef[] = [];
  for (const part of refs.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (part.startsWith("HEAD -> ")) {
      result.push({ name: part.slice("HEAD -> ".length), kind: "head" });
    } else if (part === "HEAD") {
      result.push({ name: "HEAD", kind: "head" });
    } else if (part.startsWith("tag: ")) {
      result.push({ name: part.slice("tag: ".length), kind: "tag" });
    } else if (part.endsWith("/HEAD")) {
      continue; // origin/HEAD is noise next to origin/<default>
    } else if (part.includes("/")) {
      result.push({ name: part, kind: "remote" });
    } else {
      result.push({ name: part, kind: "branch" });
    }
  }
  return result;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "1 week ago", "3 hours ago", "now". */
export function formatRelativeTime(date: string | Date, now: Date = new Date()): string {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((now.getTime() - time) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) return rtf.format(-Math.floor(seconds / unitSeconds), unit);
  }
  return rtf.format(0, "second");
}

/** "7 October 2026 at 17:42" in the user's locale. */
export function formatAbsoluteDate(date: string | Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

const KEEP_LINE_BREAK = /^\s*([-*+•]|\d+[.)]|[\w-]+:\s|>)/;

/**
 * Undoes git's hard wrapping (~72 cols) so a paragraph flows as one line, like VS Code's hover.
 * Blank lines, list items, quotes and trailers (`Co-authored-by: ...`) keep their own line.
 */
export function reflowCommitMessage(message: string): string {
  return message
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .reduce<string[]>((lines, line) => {
          if (lines.length === 0 || KEEP_LINE_BREAK.test(line)) lines.push(line);
          else lines[lines.length - 1] = `${lines[lines.length - 1].trimEnd()} ${line.trimStart()}`;
          return lines;
        }, [])
        .join("\n"),
    )
    .join("\n\n")
    .trim();
}

/** Splits a repo-relative path into file name and parent directory. */
export function splitFilePath(filePath: string): { name: string; dir: string } {
  const idx = filePath.lastIndexOf("/");
  if (idx === -1) return { name: filePath, dir: "" };
  return { name: filePath.slice(idx + 1), dir: filePath.slice(0, idx) };
}

/** Up to two initials for an avatar fallback. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
