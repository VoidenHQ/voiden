import { execFile } from "node:child_process";
import * as path from "node:path";

/** The version of a file a request ran from, so its history entry can say which commit it was (#641). */
export interface FileCommit {
  /** Full hash of the last commit that changed the file */
  hash: string;
  /** First line of that commit's message */
  subject: string;
  /** True when the file has changes that are not committed yet (staged or not) */
  dirty: boolean;
}

// Stops a stuck git (a network drive, a hung credential helper) instead of leaving it running.
const GIT_TIMEOUT_MS = 10_000;

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    // --literal-pathspecs: a file named like `:(glob)*` is still just that file.
    execFile("git", ["--literal-pathspecs", ...args], { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

/**
 * Finding the last commit that changed a file walks history, which can take a while in a
 * large repository. For a given HEAD the answer never changes, so it is kept per HEAD + file.
 */
const MAX_CACHED = 500;
type LastChange = Pick<FileCommit, "hash" | "subject">;
const lastChangeCache = new Map<string, LastChange | null>();

async function lastChange(cwd: string, name: string, head: string, filePath: string): Promise<LastChange | null> {
  const key = `${head}\0${filePath}`;
  const cached = lastChangeCache.get(key);
  if (cached !== undefined) return cached;
  const [hash, subject = ""] = (await git(cwd, ["log", "-1", "--format=%H%x00%s", head, "--", name])).trim().split("\0");
  const change = hash ? { hash, subject } : null;
  if (lastChangeCache.size >= MAX_CACHED) lastChangeCache.delete(lastChangeCache.keys().next().value!);
  lastChangeCache.set(key, change);
  return change;
}

/**
 * The last commit that changed `filePath` (an absolute path) and whether the file differs from it.
 * That commit is the file's version: the file at HEAD is identical to it. Null when the file is not
 * in a Git repository, is ignored, or has never been committed.
 */
export async function readFileCommit(filePath: string): Promise<FileCommit | null> {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return null;
  const cwd = path.dirname(filePath);
  const name = path.basename(filePath);
  try {
    const [head, status] = await Promise.all([
      git(cwd, ["rev-parse", "--verify", "HEAD"]),
      // --no-optional-locks: don't take index.lock, which would race Source Control's own git calls.
      git(cwd, ["--no-optional-locks", "status", "--porcelain", "--", name]),
    ]);
    const change = await lastChange(cwd, name, head.trim(), filePath);
    return change && { ...change, dirty: status.trim() !== "" };
  } catch {
    // Not a repository, no commits yet, or git is missing.
    return null;
  }
}
