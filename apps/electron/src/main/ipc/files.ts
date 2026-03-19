import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
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
import { saveState, deleteAutosaveFile } from "../persistState";
import { FileTreeItem } from "../../types";
import { fold } from "fp-ts/lib/Tree";

export function registerFileIpcHandlers() {
  ipcMain.handle("files:tree", async (_event, directory: string) => {
    const gitStatusMap = await getCachedGitStatus(directory);
    const tree = await buildFileTree(directory, gitStatusMap);
    return tree;
  });

  ipcMain.handle("files:read", async (_event, filePath) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return content;
    } catch (error) {
      // console.error(`Error reading file: ${error.message}`);
      throw error;
    }
  });

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

  ipcMain.handle(
    "files:create-void",
    async (_event, projectName: string, fileName: string) => {
      const result = await createVoidFile(projectName, fileName);
      return result;
    },
  );

  ipcMain.handle(
    "files:create",
    async (_event, projectName: string, fileName: string) => {
      const result = await createFile(projectName, fileName);
      return result;
    },
  );

  ipcMain.handle(
    "files:createDirectory",
    async (_event, path: string, dirName?: string) => {
      return await createDirectory(path, dirName);
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
  });

  ipcMain.handle("files:deleteDirectory", async (_event, dirPath: string) => {
    return await deleteDirectory(dirPath);
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
            // console.error(`Error reading file at ${fullPath}:`, error);
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
      return await renameFileOrDirectory(
        oldPath,
        newName,
        getActiveStates,
        saveActiveStates,
      );
    },
  );

  ipcMain.handle(
    "files:move",
    async (_event, dragIds: string[], parentId: string) => {
      return await moveFiles(dragIds, parentId);
    },
  );

  ipcMain.handle(
    "files:moveForce",
    async (_event, conflicts: MoveConflict[]) => {
      return await moveFilesForce(conflicts);
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
      return await dropFiles(targetPath, fileName, fileData);
    },
  );

  ipcMain.handle(
    "files:dropFolder",
    async (_event, targetPath: string, sourcePath: string) => {
      return await dropFolder(targetPath, sourcePath);
    },
  );

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
