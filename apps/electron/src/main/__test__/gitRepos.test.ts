import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() } }));
vi.mock("../state", () => ({ getActiveProject: vi.fn(), getAppState: vi.fn() }));
vi.mock("../persistState", () => ({ saveState: vi.fn() }));
vi.mock("../logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { readBranch, scanForRepos } from "../gitRepos";

let root: string;

/** A fake repo: just enough of .git for discovery and branch reading. */
function makeRepo(dir: string, head = "ref: refs/heads/main\n") {
  fs.mkdirSync(path.join(root, dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, dir, ".git", "HEAD"), head);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "voiden-repos-"));
  makeRepo(".");
  makeRepo("api", "ref: refs/heads/feature/login\n");
  makeRepo("web", "4f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f\n");
  makeRepo("services/billing");
  makeRepo("a/b/c/too-deep");
  makeRepo("node_modules/some-pkg");
  makeRepo(".hidden/repo");
  fs.mkdirSync(path.join(root, "docs"));

  // A worktree/submodule: .git is a file pointing at the real git dir.
  fs.mkdirSync(path.join(root, "worktree"));
  fs.mkdirSync(path.join(root, ".gitdirs", "wt"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitdirs", "wt", "HEAD"), "ref: refs/heads/hotfix\n");
  fs.writeFileSync(path.join(root, "worktree", ".git"), "gitdir: ../.gitdirs/wt\n");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("scanForRepos", () => {
  it("finds the root and nested repos, root first", async () => {
    const repos = await scanForRepos(root);
    expect(repos.map((r) => path.relative(root, r))).toEqual(["", "api", "services/billing", "web", "worktree"]);
  });

  it("skips dependency folders, hidden folders and anything past the depth limit", async () => {
    const repos = (await scanForRepos(root)).map((r) => path.relative(root, r));
    expect(repos).not.toContain("node_modules/some-pkg");
    expect(repos).not.toContain(".hidden/repo");
    expect(repos).not.toContain("a/b/c/too-deep");
  });

  it("returns nothing for a folder without repos", async () => {
    expect(await scanForRepos(path.join(root, "docs"))).toEqual([]);
  });
});

describe("readBranch", () => {
  it("reads the branch from HEAD without running git", async () => {
    expect(await readBranch(path.join(root, "api"))).toBe("feature/login");
  });

  it("shows a short commit for a detached HEAD", async () => {
    expect(await readBranch(path.join(root, "web"))).toBe("4f2a9c1");
  });

  it("follows a .git file to the real git dir", async () => {
    expect(await readBranch(path.join(root, "worktree"))).toBe("hotfix");
  });

  it("returns null when HEAD can't be read", async () => {
    expect(await readBranch(path.join(root, "docs"))).toBeNull();
  });
});
