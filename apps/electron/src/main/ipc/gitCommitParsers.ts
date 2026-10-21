// Parsers for `git diff -z` / `git show` output used by the Commit History panel.
// Kept free of electron/simple-git imports so they can be unit tested directly.

export type CommitFileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface CommitFileChange {
  path: string;
  /** Previous path for renames/copies. */
  oldPath?: string;
  status: CommitFileStatus;
  changes: number;
  insertions: number;
  deletions: number;
}

export interface CommitDetails {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  parents: string[];
  refs: string;
  subject: string;
  body: string;
}

interface NameStatusEntry {
  path: string;
  oldPath?: string;
  status: CommitFileStatus;
}

interface NumstatEntry {
  path: string;
  insertions: number;
  deletions: number;
}

/** Parses `--name-status -z`: `M\0path\0` or `R100\0old\0new\0`. */
export function parseNameStatusZ(raw: string): NameStatusEntry[] {
  const parts = raw.split('\0');
  const entries: NameStatusEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i];
    if (!code) { i++; continue; }
    const status = code[0] as CommitFileStatus;
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (newPath) entries.push({ path: newPath, oldPath, status });
      i += 3;
    } else {
      const filePath = parts[i + 1];
      if (filePath) entries.push({ path: filePath, status });
      i += 2;
    }
  }
  return entries;
}

/** Parses `--numstat -z`: `ins\tdel\tpath\0` or, for renames, `ins\tdel\t\0old\0new\0`. Binary files report `-`. */
export function parseNumstatZ(raw: string): NumstatEntry[] {
  const parts = raw.split('\0');
  const entries: NumstatEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const record = parts[i];
    if (!record) { i++; continue; }
    const [ins, del, ...rest] = record.split('\t');
    const inlinePath = rest.join('\t');
    let filePath = inlinePath;
    i++;
    if (!inlinePath) {
      // Rename/copy: old and new paths follow as separate NUL-terminated fields.
      filePath = parts[i + 1] ?? '';
      i += 2;
    }
    if (filePath) {
      entries.push({ path: filePath, insertions: parseInt(ins) || 0, deletions: parseInt(del) || 0 });
    }
  }
  return entries;
}

export function mergeCommitFileStats(nameStatus: NameStatusEntry[], numstat: NumstatEntry[]): CommitFileChange[] {
  const stats = new Map(numstat.map((entry) => [entry.path, entry]));
  return nameStatus.map((entry) => {
    const stat = stats.get(entry.path);
    const insertions = stat?.insertions ?? 0;
    const deletions = stat?.deletions ?? 0;
    return { ...entry, insertions, deletions, changes: insertions + deletions };
  });
}

/** Field separator for {@link COMMIT_DETAILS_FORMAT}; the body is last so it may contain anything. */
export const COMMIT_DETAILS_FORMAT = ['%H', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%P', '%D', '%s', '%b'].join('%x00');

export function parseCommitDetails(raw: string): CommitDetails | null {
  const fields = raw.split('\0');
  if (fields.length < 11 || !fields[0]) return null;
  const [hash, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, parents, refs, subject, ...bodyParts] = fields;
  return {
    hash: hash.trim(),
    shortHash: hash.trim().substring(0, 7),
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerEmail,
    committerDate,
    parents: parents.split(' ').filter(Boolean),
    refs,
    subject,
    body: bodyParts.join('\0').trim(),
  };
}
