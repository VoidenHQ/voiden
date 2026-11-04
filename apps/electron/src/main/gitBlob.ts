import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  IMAGE_PREVIEW_LIMIT,
  SNIFF_BYTES,
  categoryLabel,
  fileCategory,
  isBinaryCategory,
  previewImageType,
  type FileCategory,
} from "./fileKind";

/** One side of a diff, described without ever reading a binary file as text (#610). */
export interface FileBlob {
  exists: boolean;
  size: number;
  binary: boolean;
  category: FileCategory;
  label: string;
  /** Set for images small enough to preview. */
  dataUrl?: string;
}

const missing = (filePath: string): FileBlob => {
  const category = fileCategory(filePath);
  return { exists: false, size: 0, binary: isBinaryCategory(category, filePath), category, label: categoryLabel(category, filePath) };
};

const gitBuffer = (cwd: string, args: string[], maxBuffer: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "buffer", maxBuffer }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

/** The first bytes of a committed file, without loading the rest of it. */
const gitHead = (cwd: string, spec: string): Promise<Buffer> =>
  new Promise((resolve) => {
    const child = spawn("git", ["cat-file", "blob", spec], { cwd });
    const chunks: Buffer[] = [];
    let length = 0;
    const finish = () => resolve(Buffer.concat(chunks).subarray(0, SNIFF_BYTES));
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= SNIFF_BYTES) child.kill();
    });
    child.on("close", finish);
    child.on("error", finish);
  });

const describe = (filePath: string, size: number, head: Buffer, data?: Buffer): FileBlob => {
  const category = fileCategory(filePath, head);
  const imageType = previewImageType(filePath);
  return {
    exists: true,
    size,
    binary: isBinaryCategory(category, filePath),
    category,
    label: categoryLabel(category, filePath),
    dataUrl: imageType && data ? `data:${imageType};base64,${data.toString("base64")}` : undefined,
  };
};

const wantsPreview = (filePath: string, size: number) => !!previewImageType(filePath) && size <= IMAGE_PREVIEW_LIMIT;

/** A file as committed at `ref` (a commit, branch or `hash^`). */
export async function readCommittedBlob(repoRoot: string, ref: string, filePath: string): Promise<FileBlob> {
  const spec = `${ref}:${filePath.replace(/\\/g, "/")}`;
  let size: number;
  try {
    size = Number((await gitBuffer(repoRoot, ["cat-file", "-s", spec], 1024)).toString().trim());
  } catch {
    return missing(filePath);
  }
  if (wantsPreview(filePath, size)) {
    const data = await gitBuffer(repoRoot, ["cat-file", "blob", spec], size + 1024 * 1024);
    return describe(filePath, size, data.subarray(0, SNIFF_BYTES), data);
  }
  return describe(filePath, size, await gitHead(repoRoot, spec));
}

/** A file as it is on disk right now. Only paths inside the repository are read. */
export async function readWorkingBlob(repoRoot: string, filePath: string): Promise<FileBlob> {
  const root = path.resolve(repoRoot);
  const full = path.resolve(root, filePath);
  if (full !== root && !full.startsWith(root + path.sep)) return missing(filePath);
  let size: number;
  try {
    const stat = await fs.promises.stat(full);
    if (!stat.isFile()) return missing(filePath);
    size = stat.size;
  } catch {
    return missing(filePath);
  }
  if (wantsPreview(filePath, size)) {
    const data = await fs.promises.readFile(full);
    return describe(filePath, size, data.subarray(0, SNIFF_BYTES), data);
  }
  const handle = await fs.promises.open(full, "r");
  try {
    const head = Buffer.alloc(Math.min(SNIFF_BYTES, size));
    await handle.read(head, 0, head.length, 0);
    return describe(filePath, size, head);
  } finally {
    await handle.close();
  }
}
