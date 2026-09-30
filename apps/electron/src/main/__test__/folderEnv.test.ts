import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFolderEnv } from "../folderEnv";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "voiden-folder-env-"));
  temporaryDirectories.push(project);
  const folderA = path.join(project, "A");
  const folderB = path.join(folderA, "B");
  const sibling = path.join(project, "Sibling");
  await Promise.all([folderB, sibling].map((directory) => fs.mkdir(directory, { recursive: true })));
  const request = path.join(folderB, "request.void");
  const siblingRequest = path.join(sibling, "request.void");
  await Promise.all([request, siblingRequest].map((file) => fs.writeFile(file, "")));
  return { project, folderA, folderB, request, siblingRequest };
}

describe("loadFolderEnv", () => {
  it("inherits root and parent values, with the closest folder winning", async () => {
    const { project, folderA, folderB, request } = await fixture();
    await fs.writeFile(path.join(project, ".env"), "HOST=root\nSHARED=root\n");
    await fs.writeFile(path.join(folderA, ".env"), "SHARED=parent\nPARENT=yes\n");
    await fs.writeFile(path.join(folderB, ".env"), "SHARED=child\nCHILD=yes\n");

    expect(await loadFolderEnv(project, request)).toEqual({
      HOST: "root", SHARED: "child", PARENT: "yes", CHILD: "yes",
    });
  });

  it("places the selected environment between the root and folder values", async () => {
    const { project, folderA, request } = await fixture();
    await fs.writeFile(path.join(project, ".env"), "HOST=root\nTOKEN=root\n");
    await fs.writeFile(path.join(folderA, ".env"), "HOST=folder\n");
    expect(await loadFolderEnv(project, request, { HOST: "selected", TOKEN: "selected" }))
      .toEqual({ HOST: "folder", TOKEN: "selected" });
  });

  it("does not read sibling folders or paths outside the project", async () => {
    const { project, folderA, request, siblingRequest } = await fixture();
    await fs.writeFile(path.join(folderA, ".env"), "SECRET=only-a\n");
    await fs.writeFile(path.join(project, ".env"), "ROOT=yes\n");

    expect(await loadFolderEnv(project, siblingRequest)).toEqual({ ROOT: "yes" });
    expect(await loadFolderEnv(folderA, siblingRequest)).toEqual({});
    expect(await loadFolderEnv(project, path.join(path.dirname(project), "outside.void"))).toEqual({});
    expect(await loadFolderEnv(project, "../request.void")).toEqual({});
    expect(await loadFolderEnv(project, request)).toEqual({ ROOT: "yes", SECRET: "only-a" });
  });

  it("ignores a .env symlink", async () => {
    const { project, folderA, request } = await fixture();
    await fs.writeFile(path.join(project, ".env"), "ROOT=yes\n");
    await fs.symlink(path.join(project, ".env"), path.join(folderA, ".env"));
    expect(await loadFolderEnv(project, request)).toEqual({ ROOT: "yes" });
  });
});
