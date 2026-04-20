import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import mime from "mime-types";
import { logger } from "../logger";
import {
  buildFileTree,
  deleteFile,
  createDirectory,
  getDirectoryExist,
  getFileExist,
  createProjectDirectory,
  deleteDirectory,
  renameFileOrDirectory,
  moveFiles,
  moveFilesForce,
  createFile,
  createVoidFile,
  dropFiles,
  dropFolder,
} from "../fileSystem";
import type { MoveConflict } from "../fileSystem";
import { createEmptyProject, createSampleProject } from "../projectUtils";
import { getActiveStates, saveActiveStates } from "../tabs";
import { getCachedGitStatus } from "../git";
import { getActiveProject, findTabById, getAppState } from "../state";
import { scoreFiles, type MatchedFragment } from "../fileSearch";
import { saveState, deleteAutosaveFile } from "../persistState";
import { FileTreeItem } from "../../types";
import { PanelElement } from "../../../shared/types";
import { fold } from "fp-ts/lib/Tree";

// Module-level cache so mutating handlers can clear it immediately.
const treeResultCache = new Map<string, { result: any; at: number }>();
const TREE_RESULT_TTL = 3000; // ms — reuse a finished build for 3 s

/** Bust the tree cache — called by fileWatcher when external files appear/disappear. */
export function clearTreeResultCache() {
  treeResultCache.clear();
}

type FlatListSession = {
  sessionId: string;
  rootDir: string;
  allPaths: string[];
  firstBatchReady: Promise<void>;
  completion: Promise<void>;
  cancel: () => void;
};

let activeFlatListSession: FlatListSession | null = null;

function startFlatListSession(sessionId: string, rootDir: string, topN: number): FlatListSession {
  const allPaths: string[] = [];
  let resolveFirstBatch: () => void = () => {};
  const firstBatchReady = new Promise<void>((res) => { resolveFirstBatch = res; });
  let cancelled = false;
  let rgProc: ReturnType<typeof spawn> | null = null;

  const completion = (async () => {
    // Rely on PATH resolution — hardcoded homebrew paths don't work on every
    // Mac and don't exist on Linux/Windows at all.
    const rgPath = process.platform === "win32" ? "rg.exe" : "rg";

    const DEADLINE_MS = 15_000;
    let deadlineHit = false;
    const deadline = setTimeout(() => {
      deadlineHit = true;
      cancelled = true;
      try { rgProc?.kill(); } catch { /* already gone */ }
      resolveFirstBatch();
    }, DEADLINE_MS);
    deadline.unref?.();

    let rgFailed = false;
    try {
      await new Promise<void>((resolve, reject) => {
        rgProc = spawn(rgPath, ["--files", rootDir], { stdio: ["ignore", "pipe", "ignore"] });
        let tail = Buffer.alloc(0);
        rgProc.stdout!.on("data", (chunk: Buffer) => {
          if (cancelled) return;
          let search = chunk;
          if (tail.length > 0) {
            search = Buffer.concat([tail, chunk]);
            tail = Buffer.alloc(0);
          }
          let start = 0;
          let idx: number;
          while ((idx = search.indexOf(0x0a, start)) !== -1) {
            const line = search.toString("utf8", start, idx).trim();
            if (line.length > 0) {
              allPaths.push(line);
              if (allPaths.length >= topN) resolveFirstBatch();
            }
            start = idx + 1;
          }
          if (start < search.length) {
            tail = search.subarray(start);
          }
        });
        rgProc.on("close", (code) => {
          if (!cancelled && tail.length > 0) {
            const line = tail.toString("utf8").trim();
            if (line.length > 0) allPaths.push(line);
          }
          if (code !== 0 && allPaths.length === 0 && !deadlineHit) rgFailed = true;
          resolve();
        });
        rgProc.on("error", reject);
      });
    } catch {
      rgFailed = true;
    } finally {
      clearTimeout(deadline);
    }

    if (rgFailed && !cancelled) {
      logger.info('filesystem', 'files:flatList — rg unavailable or failed, falling back to BFS scan', { rootDir });
      const SKIP = new Set([
        "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".cache",
        ".turbo", ".svelte-kit", "out", ".output", ".vercel", "__pycache__",
        ".venv", "venv", ".tox", "vendor", "Pods", ".gradle", "target",
      ]);
      const queue: string[] = [rootDir];
      while (queue.length > 0 && !cancelled) {
        const dir = queue.shift()!;
        let entries: fs.Dirent[];
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
        catch { continue; }
        for (const entry of entries) {
          if (entry.name.startsWith(".") && !entry.name.startsWith(".env")) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!SKIP.has(entry.name)) queue.push(full);
          } else {
            allPaths.push(full);
            if (allPaths.length >= topN) resolveFirstBatch();
          }
        }
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    // Collection finished (or was cancelled) before reaching topN.
    resolveFirstBatch();
  })();

  return {
    sessionId,
    rootDir,
    allPaths,
    firstBatchReady,
    completion,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      if (rgProc) { try { rgProc.kill(); } catch { /* already gone */ } }
      resolveFirstBatch();
    },
  };
}

export function registerFileIpcHandlers() {
  // Deduplicate: if a tree build is already in-flight, share the result.
  const pendingTreeBuilds = new Map<string, Promise<any>>();

  ipcMain.handle("files:tree", async (_event, directory: string) => {
    try { await fs.promises.access(directory); } catch { return null; }
    if (pendingTreeBuilds.has(directory)) {
      logger.debug('filesystem', 'files:tree — deduped (build already in-flight)', { directory });
      return pendingTreeBuilds.get(directory);
    }
    const cached = treeResultCache.get(directory);
    if (cached && Date.now() - cached.at < TREE_RESULT_TTL) {
      logger.debug('filesystem', 'files:tree — cache hit', { directory });
      return cached.result;
    }
    const t0 = Date.now();
    const p = (async () => {
      // Race git status against a 400ms timeout so the file tree renders
      // immediately even on large repos where git status takes 1-4s.
      // The git cache warms in the background; the next files:tree call
      // (triggered by the git:changed event) will have full decorations.
      const GIT_TIMEOUT_MS = 400;
      const gitStatusMap = await Promise.race([
        getCachedGitStatus(directory),
        new Promise<Map<string, any>>((resolve) =>
          setTimeout(() => {
            logger.debug('filesystem', `files:tree — git status timed out (>${GIT_TIMEOUT_MS}ms), rendering without decorations`, { directory });
            resolve(new Map());
          }, GIT_TIMEOUT_MS)
        ),
      ]);

      const tree = await buildFileTree(directory, gitStatusMap);
      const ms = Date.now() - t0;
      if (ms > 1000) {
        logger.warn('filesystem', `files:tree SLOW (${ms}ms)`, { directory, ms });
      } else {
        // Use debug so periodic 30s refetches don't flood the logs panel.
        // Only slow builds (>1s) are surfaced at warn level above.
        logger.debug('filesystem', `files:tree (${ms}ms)`, { directory, ms });
      }
      treeResultCache.set(directory, { result: tree, at: Date.now() });
      return tree;
    })().finally(() => pendingTreeBuilds.delete(directory));
    pendingTreeBuilds.set(directory, p);
    return p;
  });

  ipcMain.handle("files:read", async (_event, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      return content;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  });

  // Reads a byte range from a file and returns it as a UTF-8 string.
  // Each call serialises at most CHUNK_SIZE bytes through IPC so the main
  // process event-loop is never blocked by a single large message.
  ipcMain.handle(
    "files:readChunk",
    async (_event, filePath: string, offset: number, size: number) => {
      const fd = await fs.promises.open(filePath, "r");
      try {
        const stat = await fd.stat();
        const actualSize = Math.min(size, stat.size - offset);
        if (actualSize <= 0) return { content: "", done: true };

        const buf = Buffer.alloc(actualSize);
        const { bytesRead } = await fd.read(buf, 0, actualSize, offset);
        const nextOffset = offset + bytesRead;

        // Convert to UTF-8. buf.toString handles multi-byte chars correctly
        // as long as we started on a codepoint boundary (we always read from 0
        // for the first chunk and use nextOffset as the start for subsequent
        // ones, so boundaries are preserved).
        const content = buf.slice(0, bytesRead).toString("utf8");
        return { content, bytesRead, nextOffset, done: nextOffset >= stat.size, totalSize: stat.size };
      } finally {
        await fd.close();
      }
    },
  );

  ipcMain.handle("files:getVoidFiles", async () => {
    const projectPath = await getActiveProject();
    if (!projectPath) {
      return [];
    }
    const voidFiles: object[] = [];

    async function walk(dir: string) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".void")) {
          const content = await fs.promises.readFile(fullPath, "utf8");
          voidFiles.push({
            id: fullPath,
            type: "document",
            title: entry.name,
            source: fullPath,
            content,
          });
        }
      }
    }

    await walk(projectPath);
    return voidFiles;
  });

  ipcMain.handle(
    "files:write",
    async (_event, filePath, content, tabId): Promise<string | null> => {
      const wasUnsaved = !filePath;

    if (!filePath) {
      let activeDirectory = await getActiveProject();
      if (!activeDirectory) {
        const os = await import("node:os");
        activeDirectory = os.default.homedir();
      }
      let defaultName = "untitled.void";
      if (tabId) {
        const appState = getAppState();
        const layout = appState.activeDirectory ? appState.directories[appState.activeDirectory]?.layout : appState.unsaved.layout;
        const tab = findTabById(layout, "main", tabId);
        if (tab?.title) {
          defaultName = tab.title.endsWith(".void") ? tab.title : tab.title + ".void";
        }
      }
      const defaultPath = path.join(activeDirectory, defaultName);
      const { canceled, filePath: chosenFilePath } = await dialog.showSaveDialog({
        title: "Save File",
        defaultPath,
        filters: [{ name: "Voiden Files", extensions: ["void"] }],
      });

      if (canceled || !chosenFilePath) {
        return null;
      }

      filePath = chosenFilePath;
    }

    await fs.promises.writeFile(filePath, content, "utf8");
    treeResultCache.clear();

    if (tabId) {
      const appState = getAppState();
      const layout = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;
      const tab = findTabById(layout, "main", tabId);
      if (tab) {
        tab.source = filePath;
        tab.title = path.basename(filePath);
        await saveState(appState);

        // Clean up autosaved file if this was an unsaved document
        if (wasUnsaved) {
          await deleteAutosaveFile(tabId);
        }
      }
    }

    return filePath;
  },
);

  // Chunked write — avoids sending a huge IPC message for large files.
  // isFirst=true truncates/creates the file; subsequent chunks are appended.
  // isLast=true busts the tree cache after the final chunk is flushed.
  ipcMain.handle(
    "files:appendChunk",
    async (_event, filePath: string, chunk: string, isFirst: boolean, isLast: boolean) => {
      if (isFirst) {
        await fs.promises.writeFile(filePath, chunk, "utf8");
      } else {
        await fs.promises.appendFile(filePath, chunk, "utf8");
      }
      if (isLast) treeResultCache.clear();
      return filePath;
    },
  );

  ipcMain.handle(
    "files:create-void",
    async (_event, projectName: string, fileName: string) => {
      const result = await createVoidFile(projectName, fileName);
      treeResultCache.clear();
      return result;
    },
  );

  ipcMain.handle(
    "files:create",
    async (_event, projectName: string, fileName: string) => {
      const result = await createFile(projectName, fileName);
      treeResultCache.clear();
      return result;
    },
  );

  ipcMain.handle(
    "files:createDirectory",
    async (_event, path: string, dirName?: string) => {
      const result = await createDirectory(path, dirName);
      treeResultCache.clear();
      return result;
    },
  );

  ipcMain.handle(
    "files:getDirectoryExist",
    async (_event, path: string, dirName?: string) => {
      return await getDirectoryExist(path, dirName);
    },
  );

  ipcMain.handle(
    "files:getFileExist",
    async (_event, path: string, fileName?: string) => {
      return await getFileExist(path, fileName);
    },
  );

  ipcMain.handle(
    "files:create-new-project",
    async (_event, dirName?: string) => {
      return await createProjectDirectory(dirName);
    },
  );

  ipcMain.handle(
    "files:bootstrap-project",
    async (
      _event,
      targetDirectory: string,
      withSampleProject: boolean,
      projectName?: string,
    ) => {
      if (withSampleProject) {
        return await createSampleProject(targetDirectory);
      }

      if (!projectName?.trim()) {
        throw new Error(
          "Project name is required when sample project is disabled.",
        );
      }

      return await createEmptyProject(targetDirectory, projectName.trim());
    },
  );

  ipcMain.handle("files:delete", async (_event, filePath: string) => {
    await deleteFile(filePath);
    treeResultCache.clear();
  });

  ipcMain.handle("files:deleteDirectory", async (_event, dirPath: string) => {
    const result = await deleteDirectory(dirPath);
    treeResultCache.clear();
    return result;
  });

  ipcMain.handle("files:bulkDelete", async (_event, items: FileTreeItem[]) => {
    const { response } = await dialog.showMessageBox({
      type: "none",
      buttons: ["Cancel", "Delete"],
      defaultId: 1,
      title: "Confirm Delete",
      message: "Are you sure you want to delete these items?",
      detail: `${items.length} items will be moved to trash.`,
    });

    if (response === 1) {
      for (const item of items) {
        await shell.trashItem(item.path);
      }
      treeResultCache.clear();
      return true;
    }
    return false;
  });

  ipcMain.handle(
    "files:getFiles",
    async (_event, filePaths: string[], isExternal?: boolean) => {
      const files = await Promise.all(
        filePaths.map(async (filePath) => {
          // If isExternal is true or undefined, treat path as absolute
          // If isExternal is explicitly false, join with project path (for backward compatibility)
          let fullPath = filePath;

          if (isExternal === false) {
            // Backward compatibility: explicitly false means it's a project-relative path
            const projectPath = await getActiveProject();
            fullPath = path.join(projectPath, filePath);
          }
          // Otherwise (true or undefined), treat as absolute path

          try {
            const fileBuffer = fs.readFileSync(fullPath);
            const fileName = path.basename(fullPath);
            const mimeType =
              mime.lookup(fullPath) || "application/octet-stream";
            return { fullPath, fileName, mimeType, data: fileBuffer };
          } catch (error) {
            return {
              fullPath,
              fileName: path.basename(fullPath),
              mimeType: null,
              data: null,
              error: error.message,
            };
          }
        }),
      );
      return files;
    },
  );

  ipcMain.handle(
    "files:rename",
    async (_event, oldPath: string, newName: string) => {
      const result = await renameFileOrDirectory(
        oldPath,
        newName,
        getActiveStates,
        saveActiveStates,
      );
      treeResultCache.clear();
      return result;
    },
  );

  ipcMain.handle(
    "files:move",
    async (event, dragIds: string[], parentId: string) => {
      const result = await moveFiles(dragIds, parentId);
      treeResultCache.clear();
      
      // Update tabs with new paths for moved files
      if (result.success && result.pathMappings) {
        const appState = getAppState(event);
        
        const updateTabsInLayout = (layout: PanelElement) => {
          if (layout.type === "panel") {
            layout.tabs.forEach((tab) => {
              if (tab.source) {
                for (const mapping of result.pathMappings!) {
                  if (tab.source === mapping.oldPath) {
                    tab.source = mapping.newPath;
                    break;
                  }
                }
              }
            });
          } else if (layout.type === "group") {
            layout.children.forEach((child) => updateTabsInLayout(child));
          }
        };
        
        if (appState.activeDirectory) {
          const dirState = appState.directories[appState.activeDirectory];
          if (dirState && dirState.layout) {
            updateTabsInLayout(dirState.layout);
          }
        }
        
        if (appState.unsaved && appState.unsaved.layout) {
          updateTabsInLayout(appState.unsaved.layout);
        }
        
        await saveState(appState);
      }
      
      return result;
    },
  );

  ipcMain.handle(
    "files:moveForce",
    async (event, conflicts: MoveConflict[]) => {
      const result = await moveFilesForce(conflicts);
      treeResultCache.clear();
      
      // Update tabs with new paths for moved files
      if (result.success && result.pathMappings) {
        const appState = getAppState(event);
        
        const updateTabsInLayout = (layout: PanelElement) => {
          if (layout.type === "panel") {
            layout.tabs.forEach((tab) => {
              if (tab.source) {
                for (const mapping of result.pathMappings!) {
                  if (tab.source === mapping.oldPath) {
                    tab.source = mapping.newPath;
                    break;
                  }
                }
              }
            });
          } else if (layout.type === "group") {
            layout.children.forEach((child) => updateTabsInLayout(child));
          }
        };
        
        if (appState.activeDirectory) {
          const dirState = appState.directories[appState.activeDirectory];
          if (dirState && dirState.layout) {
            updateTabsInLayout(dirState.layout);
          }
        }
        
        if (appState.unsaved && appState.unsaved.layout) {
          updateTabsInLayout(appState.unsaved.layout);
        }
        
        await saveState(appState);
      }
      
      return result;
    },
  );

  ipcMain.handle(
    "files:drop",
    async (
      _event,
      targetPath: string,
      fileName: string,
      fileData: Uint8Array,
    ) => {
      const result = await dropFiles(targetPath, fileName, fileData);
      treeResultCache.clear();
      return result;
    },
  );

  ipcMain.handle(
    "files:dropFolder",
    async (_event, targetPath: string, sourcePath: string) => {
      const result = await dropFolder(targetPath, sourcePath);
      treeResultCache.clear();
      return result;
    },
  );

  ipcMain.handle("files:expandDir", async (_event, dirPath: string) => {
    const t0 = Date.now();
    try {
      const activeProject = await getActiveProject();
      // Race git status against 200ms — expandDir is user-triggered so it must
      // feel instant. On large repos (homebrew-cask, linux kernel) git status
      // takes 3-6s which would block every folder expand. Decorations show on
      // the next tree refresh once the git cache has warmed.
      const GIT_EXPAND_TIMEOUT_MS = 200;
      const gitStatusMap = activeProject
        ? await Promise.race([
            getCachedGitStatus(activeProject),
            new Promise<Map<string, any>>((resolve) =>
              setTimeout(() => resolve(new Map()), GIT_EXPAND_TIMEOUT_MS)
            ),
          ])
        : new Map();

      const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

      const filtered = items.filter((item) => {
        if (!item.name.startsWith(".")) return true;
        if (
          item.isFile() &&
          (item.name === ".gitignore" ||
            item.name === ".env" ||
            item.name.startsWith(".env") ||
            item.name.endsWith(".env"))
        ) return true;
        return false;
      });

      const children = filtered.map((item) => {
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          return { name: item.name, path: fullPath, type: "folder" as const, children: [], lazy: true };
        }
        return {
          name: item.name,
          path: fullPath,
          type: "file" as const,
          ...(gitStatusMap?.has(fullPath) ? { git: gitStatusMap.get(fullPath) } : {}),
        };
      });

      // Sort: folders first, then files, both alphabetically
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      const ms = Date.now() - t0;
      if (ms > 300) {
        logger.warn('filesystem', `files:expandDir SLOW (${ms}ms)`, { dirPath, count: children.length, ms });
      } else {
        logger.debug('filesystem', 'files:expandDir', { dirPath, count: children.length, ms });
      }

      return children;
    } catch {
      return [];
    }
  });

  // Flat file list for the '@' file-link feature and the command palette.
  // Uses `rg --files` for near-instant listing; falls back to BFS if rg is unavailable.
  //
  // Session cache: callers pass a sessionId (one per picker open). First call for
  // a new sessionId kicks off collection. Empty query returns the first TOP_N
  // paths as soon as they arrive while collection continues in the background;
  // subsequent non-empty queries for the same session wait for collection to
  // finish so they can score against the complete list. Only one session is
  // active at a time — a new sessionId cancels the prior session's work.
  ipcMain.handle("files:flatList", async (_event, rootDir: string, sessionId?: string | null, query?: string, currentFileDir?: string) => {
    const TOP_N = 50;
    const t0 = Date.now();
    const normalizedQuery = (query ?? "").toLowerCase();
    const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
    const rootPrefixLen = rootPrefix.length;

    let session: FlatListSession;
    if (sessionId) {
      if (!activeFlatListSession || activeFlatListSession.sessionId !== sessionId || activeFlatListSession.rootDir !== rootDir) {
        activeFlatListSession?.cancel();
        activeFlatListSession = startFlatListSession(sessionId, rootDir, TOP_N);
      }
      session = activeFlatListSession;
    } else {
      // No session: one-off load, not cached. Always wait for the full list so
      // the caller gets a deterministic result whether or not it has a query.
      session = startFlatListSession("__transient__", rootDir, TOP_N);
    }

    if (sessionId && !normalizedQuery) {
      await session.firstBatchReady;
    } else {
      await session.completion;
    }

    const allPaths = session.allPaths;

    type FragmentTuple = [number, number];
    type Result = {
      name: string;
      path: string;
      pathFragments?: FragmentTuple[];
      filenameFragments?: FragmentTuple[];
    };
    const tuplize = (frags: MatchedFragment[]): FragmentTuple[] | undefined =>
        frags.length === 0 ? undefined : frags.map((f) => [f.startOffset, f.endOffset]);
    let results: Result[];

    if (!normalizedQuery) {
      results = allPaths.slice(0, TOP_N).map((p) => ({
        name: path.basename(p),
        path: p,
      }));
    } else {
      // Score against the rootDir-relative path so the root prefix doesn't dominate matches
      const normalize = (p: string) => p.replace(/\\/g, "/");
      const relPaths = allPaths.map((p) => normalize(p.startsWith(rootPrefix) ? p.slice(rootPrefixLen) : p));
      const relCurrentDir = currentFileDir
        ? normalize(currentFileDir.startsWith(rootPrefix) ? currentFileDir.slice(rootPrefixLen) : currentFileDir)
        : undefined;
      const matches = scoreFiles(normalizedQuery, relPaths, relCurrentDir);
      const scored = matches
        .map((match, i) => ({ path: allPaths[i], match }))
        .filter(({ match }) => match.score > 0);
      scored.sort((a, b) => (b.match.score - a.match.score) || a.path.localeCompare(b.path));
      results = scored.slice(0, TOP_N).map(({ path: p, match }) => ({
        name: path.basename(p),
        path: p,
        pathFragments: tuplize(match.pathFragments),
        filenameFragments: tuplize(match.filenameFragments),
      }));
    }

    const ms = Date.now() - t0;
    logger.debug('filesystem', 'files:flatList', { rootDir, sessionId, query: normalizedQuery, scanned: allPaths.length, returned: results.length, ms });
    return results;
  });

  // Callers invoke this when their picker closes so the main-process cache
  // can release the collected path list. No-op if the session id doesn't
  // match the currently-active session (late close after preemption).
  ipcMain.handle("files:flatListCloseSession", (_event, sessionId: string) => {
    if (!activeFlatListSession || activeFlatListSession.sessionId !== sessionId) return;
    activeFlatListSession.cancel();
    activeFlatListSession = null;
  });

  ipcMain.handle("files:listDir", async (_event, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath);
      return entries;
    } catch {
      return [];
    }
  });

  ipcMain.handle("files:stat", async (_event, filePath: string) => {
    try {
      const stat = await fs.promises.stat(filePath);
      return { size: stat.size, mtime: stat.mtimeMs, exists: true };
    } catch {
      return { exists: false };
    }
  });

  ipcMain.handle("files:hash", async (_event, filePath: string) => {
    try {
      const { createHash } = await import("node:crypto");
      const content = await fs.promises.readFile(filePath);
      const hash = createHash("sha256").update(content).digest("hex");
      const size = content.byteLength;
      return { exists: true, hash, size };
    } catch {
      return { exists: false };
    }
  });

  ipcMain.handle("dialog:openFile", async (_event, options) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWindow, options);
    if (result.canceled) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle(
    "dialog:showMessageBox",
    async (_event, options: Electron.MessageBoxOptions) => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      const result = focusedWindow
        ? await dialog.showMessageBox(focusedWindow, options)
        : await dialog.showMessageBox(options);
      return result.response;
    },
  );
}
