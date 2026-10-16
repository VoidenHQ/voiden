import { describe, it, expect } from "vitest";
import { getGitErrorMessage, getGitErrorSummary } from "../gitErrorMessage";

const ipcError = (channel: string, message: string) =>
  new Error(`Error invoking remote method '${channel}': Error: ${message}`);

describe("getGitErrorMessage", () => {
  it("explains a push rejected because the remote is ahead", () => {
    const err = ipcError(
      "git:pushBranch",
      "To https://github.com/acme/api.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/acme/api.git'\nhint: Updates were rejected because the remote contains work that you do not",
    );
    expect(getGitErrorMessage(err)).toMatch(/Pull first, then push again/);
  });

  it("explains a push to a GitLab protected branch, quoting the server's reason", () => {
    const err = new Error(
      "Error invoking remote method 'git:pushBranch': GitError: warning: redirecting to https://git.example.com/team/repo.git/\n" +
        "remote: GitLab: You are not allowed to push code to protected branches on this project.\n" +
        "To https://git.example.com/team/repo\n" +
        " ! [remote rejected] HEAD -> master (pre-receive hook declined)\n" +
        "error: failed to push some refs to 'https://git.example.com/team/repo'\n",
    );
    expect(getGitErrorMessage(err)).toBe(
      "You are not allowed to push code to protected branches on this project. Push your commits to a new branch and open a merge/pull request, or ask a maintainer for push access.",
    );
  });

  it("explains a push to a GitHub protected branch", () => {
    const err = ipcError(
      "git:pushBranch",
      "remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Changes must be made through a pull request.\n ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs",
    );
    expect(getGitErrorMessage(err)).toBe(
      "Protected branch update failed for refs/heads/main. Changes must be made through a pull request. Push your commits to a new branch and open a merge/pull request, or ask a maintainer for push access.",
    );
  });

  it("explains other server-side push rejections with the server's reason", () => {
    const err = ipcError(
      "git:pushBranch",
      "remote: Commit message must reference a ticket\n ! [remote rejected] HEAD -> feature (pre-receive hook declined)\nerror: failed to push some refs",
    );
    expect(getGitErrorMessage(err)).toBe(
      "The server rejected the push: Commit message must reference a ticket. Fix what it reports, or ask a repository maintainer about its push rules.",
    );
  });

  it("prefers the server's explanation over a generic 'failed to push some refs'", () => {
    const err = ipcError(
      "git:pushBranch",
      "remote: Enumerating objects: 5, done.\nremote: Quota exceeded for this namespace\nerror: failed to push some refs to 'https://x/y'",
    );
    expect(getGitErrorMessage(err)).toBe("Quota exceeded for this namespace.");
  });

  it("explains a missing git identity on commit", () => {
    const err = ipcError("git:commit", "Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email");
    expect(getGitErrorMessage(err)).toMatch(/git config --global user.name/);
  });

  it("explains uncommitted changes blocking a pull", () => {
    const err = ipcError("git:pull", "error: Your local changes to the following files would be overwritten by merge:\n\tapi.void\nPlease commit your changes or stash them before you merge.");
    expect(getGitErrorMessage(err)).toMatch(/Commit or stash them first/);
  });

  it("explains merge conflicts", () => {
    const err = ipcError("git:pull", "CONFLICT (content): Merge conflict in api.void\nAutomatic merge failed; fix conflicts and then commit the result.");
    expect(getGitErrorMessage(err)).toMatch(/Resolve them in the Source Control panel/);
  });

  it("explains rejected HTTPS credentials", () => {
    const err = ipcError("git:pushBranch", "fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    expect(getGitErrorMessage(err)).toMatch(/rejected your credentials/);
  });

  it("explains a locked index", () => {
    const err = ipcError("git:stage", "fatal: Unable to create '/p/.git/index.lock': File exists.");
    expect(getGitErrorMessage(err)).toMatch(/delete \.git\/index\.lock/);
  });

  it("explains undoing the very first commit", () => {
    const err = ipcError("git:uncommit", "fatal: ambiguous argument 'HEAD~1': unknown revision or path not in the working tree.");
    expect(getGitErrorMessage(err)).toMatch(/first commit/);
  });

  it("does not treat a file name containing 'conflict' as a merge conflict", () => {
    const err = ipcError("git:stage", "fatal: something odd happened in conflict-notes.void");
    expect(getGitErrorMessage(err)).toBe("Something odd happened in conflict-notes.void");
  });

  it("falls back to the fatal line of unmapped git output, without the IPC prefix", () => {
    const err = ipcError("git:stash", "hint: some hint\nfatal: some brand new git failure\nhint: another hint");
    expect(getGitErrorMessage(err)).toBe("Some brand new git failure");
  });

  it("handles non-Error values", () => {
    expect(getGitErrorMessage("fatal: boom")).toBe("Boom");
    expect(getGitErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
  });
});

describe("getGitErrorSummary", () => {
  it("keeps an already-friendly clone message intact", () => {
    const friendly = "Repository not found, or your access token can't see it. Check the URL and that the token has access to this repository.";
    expect(getGitErrorSummary(ipcError("git:clone", friendly))).toBe(friendly);
  });

  it("truncates long unmapped output", () => {
    const summary = getGitErrorSummary(ipcError("git:clone", `fatal: ${"x".repeat(400)}`));
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith("…")).toBe(true);
  });
});
