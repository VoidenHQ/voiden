/**
 * Git Error Message Mapping
 *
 * Errors from git IPC handlers reach the renderer as raw git stderr wrapped in
 * Electron's "Error invoking remote method 'git:…': Error: …" prefix. This turns
 * them into a short explanation of what went wrong plus what to do about it.
 */

const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/;

// Server progress chatter that also arrives on "remote:" lines.
const REMOTE_NOISE = /^(Enumerating|Counting|Compressing|Total|Resolving|Delta|Writing|Processing|To create a merge request|To create a pull request|https?:\/\/|=+$|-+$)/i;

/**
 * The explanation the git server sent back on its "remote:" lines (e.g. a
 * GitLab / GitHub rule that blocked a push), with host / error-code prefixes
 * dropped. Null when the server didn't say anything useful.
 */
function remoteReason(raw: string): string | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim().match(/^remote:\s*(.*)$/)?.[1]?.trim())
    .filter((line): line is string => !!line && !REMOTE_NOISE.test(line))
    .map((line) => line.replace(/^((GitLab|GitHub|Bitbucket|Gitea|error|GH\d+):\s*)+/i, ""));
  if (!lines.length) return null;
  const reason = lines.slice(0, 2).join(" ");
  return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

/**
 * Known git failures, checked in order — first match wins.
 */
const gitErrorPatterns: Array<{ test: RegExp; message: string | ((raw: string) => string) }> = [
  {
    test: /protected branch|GH006|protected branch hook declined/i,
    message: (raw) =>
      `${remoteReason(raw) ?? "This branch is protected on the remote."} Push your commits to a new branch and open a merge/pull request, or ask a maintainer for push access.`,
  },
  {
    test: /\[remote rejected\]|pre-receive hook declined/,
    message: (raw) =>
      `The server rejected the push${remoteReason(raw) ? `: ${remoteReason(raw)}` : "."} Fix what it reports, or ask a repository maintainer about its push rules.`,
  },
  {
    test: /index\.lock/,
    message: "Another git process is using this repository. Wait for it to finish — if nothing else is running, delete .git/index.lock and try again.",
  },
  {
    test: /Please tell me who you are|unable to auto-detect email address|empty ident name/,
    message: "Git doesn't know who you are yet. Run git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\", then try again.",
  },
  {
    test: /\[rejected\][^\n]*\((fetch first|non-fast-forward)\)|Updates were rejected because/,
    message: "The remote has commits you don't have yet. Pull first, then push again.",
  },
  {
    test: /Need to specify how to reconcile divergent branches|have diverged/,
    message: "Your branch and the remote have both changed. Choose how pulls combine them — run git config pull.rebase false (merge) or true (rebase) — then pull again.",
  },
  {
    test: /would be overwritten by (merge|checkout)|Your local changes to the following files would be overwritten|Please commit your changes or stash them/,
    message: "You have uncommitted changes that would be overwritten. Commit or stash them first, then try again.",
  },
  {
    test: /untracked working tree files would be (overwritten|removed)/,
    message: "Untracked files in your project would be overwritten. Move, delete or commit them first, then try again.",
  },
  {
    test: /CONFLICT \(|Automatic merge failed|fix conflicts|unmerged files|you need to resolve your current index first/,
    message: "There are merge conflicts. Resolve them in the Source Control panel, stage the files, then commit.",
  },
  {
    test: /Permission denied \(publickey\)|Host key verification failed/,
    message: "SSH authentication with the remote failed. Make sure your SSH key is loaded (ssh-add) and registered with your git host.",
  },
  {
    test: /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Invalid username or (password|token)|\b40[13]\b/,
    message: "The remote rejected your credentials. Sign in once from a terminal (git pull) so they're saved to your system credential manager, or switch the remote to SSH.",
  },
  {
    test: /Repository not found|does not appear to be a git repository|repository '[^']*' not found/,
    message: "The remote repository wasn't found. Check the remote URL and that your account has access to it.",
  },
  {
    test: /Could not resolve host|Failed to connect|Connection timed out|Connection refused|Network is unreachable|Could not read from remote repository/,
    message: "Couldn't reach the git server. Check your internet connection and the remote URL.",
  },
  {
    test: /SSL certificate problem|server certificate verification failed/,
    message: "The server's SSL certificate couldn't be verified. If you're behind a corporate proxy, configure git's http.sslCAInfo.",
  },
  {
    test: /No remote configured|No configured push destination|'origin' does not appear/,
    message: "This repository has no remote yet. Add a remote URL before pushing or pulling.",
  },
  {
    test: /has no upstream branch|no tracking information/,
    message: "This branch isn't linked to a remote branch yet. Push it first to publish it.",
  },
  {
    test: /src refspec .* does not match any/,
    message: "There's nothing to push yet. Make a commit first.",
  },
  {
    test: /detached HEAD/,
    message: "You're not on a branch (detached HEAD). Switch to or create a branch first.",
  },
  {
    test: /ambiguous argument 'HEAD~1'|unknown revision.*HEAD~1/,
    message: "There's no earlier commit to undo to — this is the first commit in the repository.",
  },
  {
    test: /No local changes to save/,
    message: "There are no changes to stash.",
  },
  {
    test: /nothing to commit|no changes added to commit/,
    message: "There's nothing staged to commit. Stage some changes first.",
  },
  {
    test: /is not a valid branch name/,
    message: "That isn't a valid branch name. Avoid spaces and special characters such as ~ ^ : ? * [ \\.",
  },
  {
    test: /a branch named '[^']+' already exists/i,
    message: "A branch with that name already exists. Pick a different name.",
  },
  {
    test: /pathspec .* did not match any/,
    message: "The file no longer exists or isn't tracked by git. Refresh and try again.",
  },
  {
    test: /Not a git repository/i,
    message: "This folder isn't a git repository. Initialize one from the Source Control panel first.",
  },
  {
    test: /No active project selected/,
    message: "No project is open. Open a project folder first.",
  },
];

const MAX_FALLBACK_LENGTH = 200;

/**
 * Pull the most useful line out of an unmapped git error: skip hints and
 * progress noise, prefer fatal:/error: lines, and drop those prefixes.
 */
function summarizeRawError(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(hint:|warning:|remote:|To |From |Cloning into|\s*!\s)/.test(line));
  const fatal = lines.find((line) => /^(fatal|error):/i.test(line));
  // "failed to push some refs" only says that it failed — the server's own
  // "remote:" lines say why, so prefer those when there are any.
  const important = (fatal && !/failed to push some refs/.test(fatal) ? fatal : null)
    ?? remoteReason(raw) ?? fatal ?? lines[lines.length - 1] ?? raw.trim();
  const summary = important.replace(/^(fatal|error):\s*/i, "");
  const capitalised = summary.charAt(0).toUpperCase() + summary.slice(1);
  return capitalised.length > MAX_FALLBACK_LENGTH ? `${capitalised.slice(0, MAX_FALLBACK_LENGTH - 1).trimEnd()}…` : capitalised;
}

/**
 * Map a git error to a user-friendly message with a hint on how to fix it.
 * Falls back to the most relevant line of git's own output.
 */
export function getGitErrorMessage(error: unknown): string {
  const raw = ((error as any)?.message ?? String(error ?? "")).replace(IPC_PREFIX, "");
  if (!raw.trim()) return "Something went wrong. Please try again.";

  for (const { test, message } of gitErrorPatterns) {
    if (test.test(raw)) return typeof message === "function" ? message(raw) : message;
  }
  return summarizeRawError(raw);
}

/**
 * For errors main already made user-friendly (e.g. clone): strip only the IPC
 * wrapper and condense any raw git output, without remapping the message.
 */
export function getGitErrorSummary(error: unknown): string {
  const raw = ((error as any)?.message ?? String(error ?? "")).replace(IPC_PREFIX, "");
  return raw.trim() ? summarizeRawError(raw) : "Something went wrong. Please try again.";
}
