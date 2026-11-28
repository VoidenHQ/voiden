import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileCommit } from "../gitFileCommit";

let repo: string;
let outside: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};
const commit = (message: string, ...files: string[]) => {
  git("add", "--", ...files);
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
};

let loginCommit: string;
let usersCommit: string;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "voiden-file-commit-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "voiden-no-repo-"));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  write("requests/login.void", "# Login\n");
  write("requests/users.void", "# Users\n");
  loginCommit = commit("Add login request", "requests/login.void", "requests/users.void");
  write("requests/users.void", "# Users v2\n");
  usersCommit = commit("Change users request", "requests/users.void");
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("readFileCommit", () => {
  it("returns the last commit that changed the file, not HEAD", async () => {
    expect(await readFileCommit(path.join(repo, "requests/login.void"))).toEqual({
      hash: loginCommit,
      subject: "Add login request",
      dirty: false,
    });
    expect(await readFileCommit(path.join(repo, "requests/users.void"))).toEqual({
      hash: usersCommit,
      subject: "Change users request",
      dirty: false,
    });
  });

  it("marks unstaged and staged changes as dirty", async () => {
    const file = path.join(repo, "requests/login.void");
    write("requests/login.void", "# Login edited\n");
    expect(await readFileCommit(file)).toEqual({ hash: loginCommit, subject: "Add login request", dirty: true });

    git("add", "--", "requests/login.void");
    expect((await readFileCommit(file))?.dirty).toBe(true);

    git("reset", "-q", "--", "requests/login.void");
    git("checkout", "--", "requests/login.void");
    expect((await readFileCommit(file))?.dirty).toBe(false);
  });

  it("follows new commits to the file", async () => {
    const file = path.join(repo, "requests/users.void");
    expect((await readFileCommit(file))?.hash).toBe(usersCommit);
    write("requests/users.void", "# Users v3\n");
    usersCommit = commit("Change users request again", "requests/users.void");
    expect(await readFileCommit(file)).toEqual({ hash: usersCommit, subject: "Change users request again", dirty: false });
  });

  it("returns null for a file that was never committed", async () => {
    write("requests/draft.void", "# Draft\n");
    expect(await readFileCommit(path.join(repo, "requests/draft.void"))).toBeNull();
  });

  it("returns null outside a repository and for relative paths", async () => {
    fs.writeFileSync(path.join(outside, "loose.void"), "# Loose\n");
    expect(await readFileCommit(path.join(outside, "loose.void"))).toBeNull();
    expect(await readFileCommit("requests/login.void")).toBeNull();
    expect(await readFileCommit("")).toBeNull();
  });

  // `*` is not allowed in Windows file names.
  it.skipIf(process.platform === "win32")("treats the file name literally, not as a pathspec pattern", async () => {
    write("a*.void", "# Star\n");
    write("ab.void", "# AB\n");
    const starCommit = commit("Add star and ab", "a*.void", "ab.void");
    write("ab.void", "# AB v2\n");
    commit("Change ab", "ab.void");
    expect((await readFileCommit(path.join(repo, "a*.void")))?.hash).toBe(starCommit);
  });
});
