import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readCommittedBlob, readWorkingBlob } from "../gitBlob";

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "voiden-blob-"));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "logo.png"), PNG);
  fs.writeFileSync(path.join(repo, "notes.txt"), "hello\n");
  fs.writeFileSync(path.join(repo, "data.bin"), Buffer.from([1, 2, 0, 3, 4]));
  fs.writeFileSync(path.join(repo, "big.zip"), Buffer.alloc(3 * 1024 * 1024, 7));
  git("add", "-A");
  git("commit", "-qm", "init");
  fs.writeFileSync(path.join(repo, "logo.png"), Buffer.concat([PNG, Buffer.from("extra")]));
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("readCommittedBlob", () => {
  it("returns a preview for a committed image", async () => {
    const blob = await readCommittedBlob(repo, "HEAD", "logo.png");
    expect(blob).toMatchObject({ exists: true, size: PNG.length, binary: true, category: "image" });
    expect(blob.dataUrl).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
  });

  it("describes text and unknown binary files without a preview", async () => {
    expect(await readCommittedBlob(repo, "HEAD", "notes.txt")).toMatchObject({ exists: true, size: 6, binary: false, category: "text", dataUrl: undefined });
    expect(await readCommittedBlob(repo, "HEAD", "data.bin")).toMatchObject({ exists: true, binary: true, category: "binary" });
  });

  it("reports only the size of a large archive", async () => {
    const blob = await readCommittedBlob(repo, "HEAD", "big.zip");
    expect(blob).toMatchObject({ exists: true, size: 3 * 1024 * 1024, binary: true, category: "archive" });
    expect(blob.dataUrl).toBeUndefined();
  });

  it("marks files missing at that commit", async () => {
    expect((await readCommittedBlob(repo, "HEAD", "nope.png")).exists).toBe(false);
    expect((await readCommittedBlob(repo, "HEAD^", "logo.png")).exists).toBe(false);
  });
});

describe("readWorkingBlob", () => {
  it("reads the working copy", async () => {
    const blob = await readWorkingBlob(repo, "logo.png");
    expect(blob).toMatchObject({ exists: true, size: PNG.length + 5, binary: true });
    expect(blob.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("never reads outside the repository", async () => {
    expect((await readWorkingBlob(repo, "../../etc/passwd")).exists).toBe(false);
    expect((await readWorkingBlob(repo, "/etc/hosts")).exists).toBe(false);
  });

  it("marks deleted files as missing", async () => {
    expect((await readWorkingBlob(repo, "gone.png")).exists).toBe(false);
  });
});
