import { app, dialog, shell, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { logger } from "./logger";
import { setDeleting } from "./fileWatcher";
import { TreeNode, FolderNode, FileTreeItem } from "../types";
import { addTab } from "./tabs";
import { aggregateGitStatus } from "./git";
import eventBus from "./eventBus";
import { windowManager } from "./windowManager";
import { getActiveProject } from "./state";
import { getSettings } from "./settings";
import { ensureVoidenProjectMetadata } from "./projectUtils";

// Files and Directory Operations
const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
  return nodes.sort((a, b) => {
    // Folders before files
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    // Alphabetical sorting with case sensitivity
    return a.name.localeCompare(b.name);
  });
};

/**
 * Bounded concurrency semaphore — limits parallel directory reads across the
 * entire recursive tree walk so we get parallelism without heap OOM.
 * 16 slots: fast on large projects while keeping memory usage stable.
 */
class IOSemaphore {
  private slots: number;
  private queue: Array<() => void> = [];
  constructor(max: number) { this.slots = max; }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) { next(); } else { this.slots++; }
  }
}

// Directories whose contents are too large to eagerly walk.
// Defined once outside the recursive function so the Set is not recreated
// on every directory level (buildFileTree can be called thousands of times).
const LAZY_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".svelte-kit",
  "out",
  ".output",
  ".vercel",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "vendor",
  "Pods",
  ".gradle",
  "target",
]);

export const buildFileTree = async (
  dir: string,
  gitStatusMap?: Map<string, any>,
  _sem?: IOSemaphore,
): Promise<TreeNode> => {
  const sem = _sem ?? new IOSemaphore(16);

  await sem.acquire();
  let items: fs.Dirent[];
  try {
    items = await fs.promises.readdir(dir, { withFileTypes: true });
  } finally {
    sem.release();
  }

  const filtered = items.filter((item) => {
    if (!item.name.startsWith(".")) return true;
    if (
      item.isFile() &&
      (item.name === ".gitignore" ||
        item.name === ".env" ||
        item.name.startsWith(".env") ||
        item.name.endsWith(".env"))
    ) {
      return true;
    }
    return false;
  });

  // Process all siblings in parallel, bounded by the shared semaphore.
  // This replaces the previous sequential for...of loop — same OOM safety
  // (semaphore caps concurrency at 16) but much faster for wide trees.
  const nodes = await Promise.all(filtered.map(async (item) => {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      // All subdirectories are lazy — never recurse at startup.
      // Children load on demand via files:expandDir when the user expands a folder.
      return {
        name: item.name,
        path: fullPath,
        type: "folder" as const,
        children: [],
        lazy: true,
      } as TreeNode;
    } else {
      return {
        name: item.name,
        path: fullPath,
        type: "file" as const,
        ...(gitStatusMap?.has(fullPath)
          ? { git: gitStatusMap.get(fullPath) }
          : {}),
      } as TreeNode;
    }
  }));

  const result: TreeNode = {
    name: path.basename(dir),
    path: dir,
    type: "folder" as const,
    children: sortNodes(nodes),
    aggregatedGitStatus: aggregateGitStatus(nodes),
  };

  return result;
};

export async function createFile(
  filePath: string,
  fileName: string,
): Promise<{ path: string; name: string }> {
  // Allow callers to pass nested/new paths by ensuring parent folders exist.
  await fs.promises.mkdir(filePath, { recursive: true });

  let finalName = fileName;
  let counter = 1;

  // Check if file exists and generate new name if needed
  while (fs.existsSync(path.join(filePath, finalName))) {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    finalName = `${baseName} ${counter}${ext}`;
    counter++;
  }

  const fullPath = path.join(filePath, finalName);
  await fs.promises.writeFile(fullPath, "");
  return { path: fullPath, name: finalName };
}

export async function createVoidFile(
  filePath: string,
  fileName: string,
): Promise<{ path: string; name: string }> {
  // Allow callers to pass nested/new paths by ensuring parent folders exist.
  await fs.promises.mkdir(filePath, { recursive: true });

  let finalName = fileName.endsWith(".void") ? fileName : fileName + ".void";
  let counter = 1;
  // console.debug("create voiden files");

  // Check if file exists and generate new name if needed
  while (fs.existsSync(path.join(filePath, finalName))) {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    finalName = `${baseName} ${counter}${ext}`;
    counter++;
  }

  const fullPath = path.join(filePath, finalName);
  await fs.promises.writeFile(fullPath, "");
  windowManager.browserWindow?.webContents.send("files:tree:changed", null);
  // eventBus.emitEvent("files:tree:changed",null);
  return { path: fullPath, name: finalName };
}

export async function deleteFile(filePath: string) {
  // Show confirmation dialog
  const { response } = await dialog.showMessageBox({
    type: "none",
    buttons: ["Cancel", "Delete"],
    defaultId: 1,
    title: "Confirm Delete",
    message: "Are you sure you want to delete this file?",
    detail: `The file "${path.basename(filePath)}" will be moved to trash.`,
  });

  if (response === 1) {
    logger.info('filesystem', `Delete file: ${path.basename(filePath)}`, { path: filePath });
    setDeleting(filePath, true);
    try {
      await shell.trashItem(filePath);
    } finally {
      setDeleting(filePath, false);
    }
    logger.info('filesystem', `File trashed: ${path.basename(filePath)}`, { path: filePath });
    return true;
  }
  return false;
}

export async function createDirectory(
  parentPath: string,
  dirName: string = "untitled",
) {
  // Ensure parent path exists for nested directory creation flows.
  await fs.promises.mkdir(parentPath, { recursive: true });

  let finalName = dirName;
  let counter = 1;

  // Check if directory exists and generate new name if needed
  while (fs.existsSync(path.join(parentPath, finalName))) {
    finalName = `${dirName}-${counter}`;
    counter++;
  }

  // Create the directory
  const fullPath = path.join(parentPath, finalName);
  await fs.promises.mkdir(fullPath);
  return finalName;
}

export async function getDirectoryExist(
  parentPath: string,
  dirName: string = "untitled",
) {
  return fs.existsSync(path.join(parentPath, dirName));
}

export async function getFileExist(
  parentPath: string,
  fileName: string = "untitled",
) {
  return fs.existsSync(path.join(parentPath, fileName));
}

export async function createProjectDirectory(dirName: string = "untitled") {
  const projectsDirectory = getSettings().projects.default_directory;
  let finalName = dirName;
  let counter = 1;

  await fs.promises.mkdir(projectsDirectory, { recursive: true });

  // Check if directory exists and generate new name if needed
  while (fs.existsSync(path.join(projectsDirectory, finalName))) {
    finalName = `${dirName}-${counter}`;
    counter++;
  }

  // Create the directory
  const fullPath = path.join(projectsDirectory, finalName);
  await ensureVoidenProjectMetadata(fullPath, finalName);

  return fullPath;
}

export async function deleteDirectory(dirPath: string) {
  const { response } = await dialog.showMessageBox({
    type: "none",
    buttons: ["Cancel", "Delete"],
    defaultId: 0,
    title: "Confirm Delete",
    message: "Are you sure you want to delete this folder?",
    detail: `The folder "${path.basename(dirPath)}" and its contents will be moved to trash.`,
  });

  if (response === 1) {
    logger.info('filesystem', `Delete folder: ${path.basename(dirPath)}`, { path: dirPath });
    setDeleting(dirPath, true);
    try {
      await shell.trashItem(dirPath);
    } finally {
      setDeleting(dirPath, false);
    }
    logger.info('filesystem', `Folder trashed: ${path.basename(dirPath)}`, { path: dirPath });
    return true;
  }
  return false;
}

export async function renameFileOrDirectory(oldPath: string, newName: string) {
  try {
    // Validate filename
    if (!newName || newName.trim() === "" || /[<>:"/\\|?*]/.test(newName)) {
      return { success: false, error: "Invalid name" };
    }

    const dirPath = path.dirname(oldPath);
    const isDirectory = fs.statSync(oldPath).isDirectory();

    let targetName = newName;

    // Preserve extension for files if no extension is provided
    if (!isDirectory && !path.extname(newName) && path.extname(oldPath)) {
      const extension = path.extname(oldPath);
      targetName += extension;
    }

    const newPath = path.join(dirPath, targetName);

    const oldResolved = path.resolve(oldPath);
    const newResolved = path.resolve(newPath);

    const samePathCaseInsensitive =
      oldResolved.toLowerCase() === newResolved.toLowerCase();
    const isSamePathButDifferentCase =
      samePathCaseInsensitive && oldResolved !== newResolved;

    if (!samePathCaseInsensitive && fs.existsSync(newPath)) {
      return {
        success: false,
        error: `A ${isDirectory ? "folder" : "file"} with this name already exists`,
      };
    }

    const movedVoidFiles: Array<{ oldPath: string; newPath: string }> = [];
    const activeProject = await getActiveProject();
    const activeProjectResolved = activeProject
      ? path.resolve(activeProject)
      : null;
    const isRootRename =
      activeProjectResolved && oldResolved === activeProjectResolved;
    const isUnderActiveProject =
      activeProjectResolved &&
      (oldResolved === activeProjectResolved ||
        oldResolved.startsWith(activeProjectResolved + path.sep));

    if (isUnderActiveProject && !isRootRename) {
      if (isDirectory) {
        await collectVoidFiles(oldPath, newPath, movedVoidFiles);
      } else {
        movedVoidFiles.push({ oldPath, newPath });
      }
    }

    // If we're only changing the case, go through an intermediate name (cross-platform safe)
    if (isSamePathButDifferentCase) {
      const tempPath = path.join(dirPath, `.__rename_temp__${Date.now()}`);
      await fs.promises.rename(oldPath, tempPath);
      await fs.promises.rename(tempPath, newPath);
    } else {
      await fs.promises.rename(oldPath, newPath);
    }

    await maybeUpdateLinkedBlockReferencesAfterMove(movedVoidFiles);
    return { success: true, data: { path: newPath, name: targetName } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function findVoidenProjects() {
  const searchPath = getSettings().projects.default_directory;
  const result: string[] = [];

  try {
    const entries = await fs.promises.readdir(searchPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(searchPath, entry.name);
      const voidenFile = path.join(dirPath, ".voiden/.voiden-projects");

      try {
        const stat = await fs.promises.stat(voidenFile);
        if (stat.isFile()) {
          result.push(dirPath);
        }
      } catch {
        // .voiden file doesn't exist, ignore
      }
    }
  } catch (err) {
    // console.error("Error scanning Voiden directory:", err);
  }

  return result;
}

export async function dropFiles(
  targetPath: string,
  fileName: string,
  fileData: Uint8Array,
) {
  try {
    const fullPath = path.join(targetPath, fileName);
    await fs.promises.writeFile(fullPath, Buffer.from(fileData));
    return { name: fileName, path: fullPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function copyDirRecursive(src: string, dest: string) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

export async function dropFolder(targetPath: string, sourcePath: string) {
  try {
    const folderName = path.basename(sourcePath);
    const destPath = path.join(targetPath, folderName);
    await copyDirRecursive(sourcePath, destPath);
    return { success: true, name: folderName, path: destPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export type MoveConflict = {
  dragId: string;
  targetPath: string;
  fileName: string;
};
export type MoveResult = {
  success: boolean;
  moved: string[];
  conflicts: MoveConflict[];
  error?: string;
  pathMappings?: Array<{ oldPath: string; newPath: string }>;
};

async function collectVoidFiles(
  oldBasePath: string,
  newBasePath: string,
  out: Array<{ oldPath: string; newPath: string }>,
) {
  const stat = await fs.promises.stat(oldBasePath);
  if (stat.isFile()) {
    out.push({ oldPath: oldBasePath, newPath: newBasePath });
    return;
  }
  if (!stat.isDirectory()) return;
  const entries = await fs.promises.readdir(oldBasePath, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const oldEntry = path.join(oldBasePath, entry.name);
    const newEntry = path.join(newBasePath, entry.name);
    if (entry.isDirectory()) {
      await collectVoidFiles(oldEntry, newEntry, out);
    } else if (entry.isFile()) {
      out.push({ oldPath: oldEntry, newPath: newEntry });
    }
  }
}

export async function moveFiles(
  dragIds: string[],
  parentId: string,
): Promise<MoveResult> {
  const moved: string[] = [];
  const conflicts: MoveConflict[] = [];
  const movedVoidFiles: Array<{ oldPath: string; newPath: string }> = [];
  const pathMappings: Array<{ oldPath: string; newPath: string }> = [];

  try {
    for (const dragId of dragIds) {
      const fileName = path.basename(dragId);
      const newPath = path.join(parentId, fileName);

      if (fs.existsSync(newPath)) {
        conflicts.push({ dragId, targetPath: newPath, fileName });
        continue;
      }

      await collectVoidFiles(dragId, newPath, movedVoidFiles);
      pathMappings.push({ oldPath: dragId, newPath });
      await fs.promises.rename(dragId, newPath);
      moved.push(dragId);
    }

    await maybeUpdateLinkedBlockReferencesAfterMove(movedVoidFiles);
    return { success: true, moved, conflicts, pathMappings };
  } catch (error) {
    return { success: false, moved, conflicts, error: error.message };
  }
}

export async function moveFilesForce(
  conflicts: MoveConflict[],
): Promise<{ success: boolean; error?: string; pathMappings?: Array<{ oldPath: string; newPath: string }> }> {
  const movedVoidFiles: Array<{ oldPath: string; newPath: string }> = [];
  const pathMappings: Array<{ oldPath: string; newPath: string }> = [];

  try {
    for (const { dragId, targetPath } of conflicts) {
      const targetStat = await fs.promises.stat(targetPath).catch(() => null);
      if (targetStat?.isDirectory()) {
        return {
          success: false,
          error: `Cannot replace folder "${path.basename(targetPath)}"`,
        };
      }
      if (targetStat?.isFile()) {
        await fs.promises.unlink(targetPath);
      }
      await collectVoidFiles(dragId, targetPath, movedVoidFiles);
      pathMappings.push({ oldPath: dragId, newPath: targetPath });
      await fs.promises.rename(dragId, targetPath);
    }

    await maybeUpdateLinkedBlockReferencesAfterMove(movedVoidFiles);
    return { success: true, pathMappings };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Apply void-file reference path updates to a source string.
 *  Returns the updated source and the number of references rewritten. */
function applyVoidFileReferenceUpdates(
  source: string,
  movedByOldRel: Map<string, string>,
): { updatedSource: string; count: number } {
  const normalizeRefPath = (value: string) =>
    value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const originalFileLineRegex = /^(\s*originalFile:\s*)(['"]?)([^'"\r\n]+)\2(\s*)$/gm;
  const filePathLineRegex = /^(\s*filePath:\s*)(['"]?)([^'"\r\n]+)\2(\s*)$/gm;
  const voidFenceRegex = /```void\s*\r?\n([\s\S]*?)```/g;

  let count = 0;

  function rewritePathLine(
    lineText: string,
    prefix: string,
    quote: string,
    refValue: string,
    suffix: string,
  ): string {
    const normalizedRef = normalizeRefPath(refValue.trim());
    const newRel = movedByOldRel.get(normalizedRef);
    if (!newRel) return lineText;
    const keepBackslash = refValue.includes("\\");
    const sep = keepBackslash ? "\\" : "/";
    const relWithSep = newRel.replace(/\//g, sep);
    let nextRefValue = relWithSep;
    if (refValue.startsWith("./") || refValue.startsWith(".\\")) {
      nextRefValue = `.${sep}${relWithSep}`;
    } else if (refValue.startsWith("/") || refValue.startsWith("\\")) {
      nextRefValue = `${sep}${relWithSep}`;
    }
    count++;
    return `${prefix}${quote}${nextRefValue}${quote}${suffix}`;
  }

  const updatedSource = source.replace(voidFenceRegex, (fenceText, body: string) => {
    if (/^\s*type:\s*linkedBlock\s*$/m.test(body)) {
      const uidMatch = body.match(/^\s*blockUid:\s*([^\r\n]+)\s*$/m);
      if (!uidMatch || !isUuid(uidMatch[1].trim())) return fenceText;
      const updatedBody = body.replace(originalFileLineRegex, (l, p, q, v, s) =>
        rewritePathLine(l, p, q, v, s),
      );
      return fenceText.replace(body, updatedBody);
    }
    if (/^\s*type:\s*fileLink\s*$/m.test(body)) {
      const updatedBody = body.replace(filePathLineRegex, (l, p, q, v, s) =>
        rewritePathLine(l, p, q, v, s),
      );
      return fenceText.replace(body, updatedBody);
    }
    return fenceText;
  });

  return { updatedSource, count };
}

/** Ask all renderer windows to flush unsaved content for the given file paths to disk.
 *  Waits up to 3 seconds for acknowledgment before proceeding. */
function flushRendererUnsavedForPaths(paths: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      resolve();
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ackChannel = `files:unsavedSavedAck:${requestId}`;
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(ackChannel);
      resolve();
    }, 3000);
    ipcMain.once(ackChannel, () => {
      clearTimeout(timeout);
      resolve();
    });
    for (const w of windows) {
      w.webContents.send("files:saveUnsavedForPaths", requestId, paths);
    }
  });
}

async function maybeUpdateLinkedBlockReferencesAfterMove(
  movedVoidFiles: Array<{ oldPath: string; newPath: string }>,
) {
  if (movedVoidFiles.length === 0) return;

  const activeProject = await getActiveProject();
  if (!activeProject) return;

  const normalizeRel = (projectRoot: string, absolutePath: string) =>
    path.relative(projectRoot, absolutePath).replace(/\\/g, "/");

  const movedByOldRel = new Map<string, string>();
  for (const moved of movedVoidFiles) {
    movedByOldRel.set(
      normalizeRel(activeProject, moved.oldPath),
      normalizeRel(activeProject, moved.newPath),
    );
  }
  if (movedByOldRel.size === 0) return;

  const allVoidFiles: string[] = [];
  const collectAllVoidFiles = async (dir: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectAllVoidFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".void")) {
        allVoidFiles.push(fullPath);
      }
    }
  };
  await collectAllVoidFiles(activeProject);

  const fileUpdates = new Map<string, string>();
  let totalReferences = 0;

  for (const voidFilePath of allVoidFiles) {
    const source = await fs.promises.readFile(voidFilePath, "utf8");
    const { updatedSource, count } = applyVoidFileReferenceUpdates(source, movedByOldRel);
    if (count > 0 && updatedSource !== source) {
      totalReferences += count;
      fileUpdates.set(voidFilePath, updatedSource);
    }
  }

  if (fileUpdates.size === 0) return;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  const { response } = await dialog.showMessageBox(focusedWindow ?? undefined, {
    type: "question",
    buttons: ["Keep current references", "Update references"],
    defaultId: 1,
    cancelId: 0,
    title: "Update References?",
    message: "A file was moved or renamed.",
    detail: `References in other file(s) still point to the old path. Found ${totalReferences} reference(s) in ${fileUpdates.size} file(s). Update them to the new location?`,
  });

  if (response !== 1) return;

  // Flush any unsaved renderer content for the files we're about to rewrite,
  // then re-read from disk so we apply reference updates on top of the latest content.
  await flushRendererUnsavedForPaths(Array.from(fileUpdates.keys()));

  for (const [filePath] of fileUpdates) {
    const freshSource = await fs.promises.readFile(filePath, "utf8");
    const { updatedSource, count } = applyVoidFileReferenceUpdates(freshSource, movedByOldRel);
    if (count > 0 && updatedSource !== freshSource) {
      fileUpdates.set(filePath, updatedSource);
    }
  }

  for (const [filePath, content] of fileUpdates) {
    await fs.promises.writeFile(filePath, content, "utf8");
  }

  // Notify the renderer so it can reload any open tabs whose content was rewritten
  const updatedPaths = Array.from(fileUpdates.keys());
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send("files:referencesUpdated", updatedPaths);
  }
}

// Recent paths
export const getRecentPaths = async () => {
  try {
    const recentPath = path.join(app.getPath("userData"), "recent-paths.json");
    const data = await fs.promises.readFile(recentPath, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
};

export const addRecentPath = async (projectPath: string) => {
  const recentPath = path.join(app.getPath("userData"), "recent-paths.json");
  const recent = await getRecentPaths();
  const newRecent = [
    projectPath,
    ...recent.filter((p: string) => p !== projectPath),
  ].slice(0, 5);
  await fs.promises.writeFile(recentPath, JSON.stringify(newRecent));
};

// New function for duplicating a file
export async function duplicateFile(
  originalPath: string,
  newName: string,
): Promise<{ path: string; name: string }> {
  const dirPath = path.dirname(originalPath);
  let finalName = newName;
  let counter = 1;

  // Check if file exists and generate new name if needed
  while (fs.existsSync(path.join(dirPath, finalName))) {
    const ext = path.extname(newName);
    const baseName = path.basename(newName, ext);
    finalName = `${baseName} ${counter}${ext}`;
    counter++;
  }

  const newPath = path.join(dirPath, finalName);
  await fs.promises.copyFile(originalPath, newPath);
  return { path: newPath, name: finalName };
}
