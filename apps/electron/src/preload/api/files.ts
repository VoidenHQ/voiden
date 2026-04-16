import { ipcRenderer } from "electron";
import { FileTreeItem } from "./types";

export const filesApi = {
  getFiles: (filePaths: string[], isExternal?: boolean) =>
    ipcRenderer.invoke("files:getFiles", filePaths, isExternal),
  tree: (directory: string) => ipcRenderer.invoke("files:tree", directory),
  expandDir: (dirPath: string) => ipcRenderer.invoke("files:expandDir", dirPath),
  flatList: (rootDir: string, sessionId?: string | null, query?: string, currentFilePath?: string): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke("files:flatList", rootDir, sessionId ?? null, query, currentFilePath),
  flatListCloseSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("files:flatListCloseSession", sessionId),
  read: (path: string) => ipcRenderer.invoke("files:read", path),
  readChunk: (path: string, offset: number, size: number): Promise<{ content: string; bytesRead: number; nextOffset: number; done: boolean; totalSize: number }> =>
    ipcRenderer.invoke("files:readChunk", path, offset, size),
  write: (path: string, content: string, tabId?: string) =>
    ipcRenderer.invoke("files:write", path, content, tabId),
  appendChunk: (path: string, chunk: string, isFirst: boolean, isLast: boolean): Promise<string> =>
    ipcRenderer.invoke("files:appendChunk", path, chunk, isFirst, isLast),
  createVoid: (projectName: string, fileName: string): Promise<string> =>
    ipcRenderer.invoke("files:create-void", projectName, fileName),
  create: (projectName: string, fileName: string): Promise<string> =>
    ipcRenderer.invoke("files:create", projectName, fileName),
  createDirectory: (path: string, dirName?: string): Promise<string> =>
    ipcRenderer.invoke("files:createDirectory", path, dirName),
  getDirectoryExist: (path: string, dirName?: string): Promise<boolean> =>
    ipcRenderer.invoke("files:getDirectoryExist", path, dirName),
  getFileExist: (path: string, fileName?: string): Promise<boolean> =>
    ipcRenderer.invoke("files:getFileExist", path, fileName),
  createProjectDirectory: (dirName?: string): Promise<string> =>
    ipcRenderer.invoke("files:create-new-project", dirName),
  bootstrapProject: (
    targetDirectory: string,
    withSampleProject: boolean,
    projectName?: string,
  ): Promise<{ projectPath: string; welcomeFile: string | null }> =>
    ipcRenderer.invoke(
      "files:bootstrap-project",
      targetDirectory,
      withSampleProject,
      projectName,
    ),
  delete: (path: string) => ipcRenderer.invoke("files:delete", path),
  rename: (
    oldPath: string,
    newName: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("files:rename", oldPath, newName),
  showFileContextMenu: (data: FileTreeItem) =>
    ipcRenderer.send("show-file-context-menu", data),
  showBulkDeleteMenu: (data: FileTreeItem[]) =>
    ipcRenderer.send("show-bulk-delete-menu", data),
  onFileMenuCommand: (
    callback: (command: string, data: FileTreeItem) => void,
  ) => {
    const handler = (
      _: unknown,
      args: { command: string; data: FileTreeItem },
    ) => {
      callback(args.command, args.data);
    };
    ipcRenderer.on("file-menu-command", handler);
    return () => {
      ipcRenderer.removeListener("file-menu-command", handler);
    };
  },
  move: (
    dragIds: string[],
    parentId: string,
  ): Promise<{
    success: boolean;
    moved: string[];
    conflicts: { dragId: string; targetPath: string; fileName: string }[];
    error?: string;
  }> => ipcRenderer.invoke("files:move", dragIds, parentId),
  moveForce: (
    conflicts: { dragId: string; targetPath: string; fileName: string }[],
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("files:moveForce", conflicts),
  drop: (
    targetPath: string,
    fileName: string,
    fileData: Uint8Array,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("files:drop", targetPath, fileName, fileData),
  dropFolder: (
    targetPath: string,
    sourcePath: string,
  ): Promise<{
    success: boolean;
    name?: string;
    path?: string;
    error?: string;
  }> => ipcRenderer.invoke("files:dropFolder", targetPath, sourcePath),
  deleteDirectory: (path: string) =>
    ipcRenderer.invoke("files:deleteDirectory", path),
  bulkDelete: (items: FileTreeItem[]) =>
    ipcRenderer.invoke("files:bulkDelete", items),
  getVoidFiles: () => ipcRenderer.invoke("files:getVoidFiles"),
  listDir: (dirPath: string): Promise<string[]> => ipcRenderer.invoke("files:listDir", dirPath),
  stat: (filePath: string): Promise<{ exists: boolean; size?: number; mtime?: number }> => ipcRenderer.invoke("files:stat", filePath),
  hash: (filePath: string): Promise<{ exists: boolean; hash?: string; size?: number }> => ipcRenderer.invoke("files:hash", filePath),
  onReferencesUpdated: (callback: (filePaths: string[]) => void) => {
    const handler = (_: unknown, filePaths: string[]) => callback(filePaths);
    ipcRenderer.on("files:referencesUpdated", handler);
    return () => ipcRenderer.removeListener("files:referencesUpdated", handler);
  },
  onSaveUnsavedForPaths: (callback: (requestId: string, paths: string[]) => void) => {
    const handler = (_: unknown, requestId: string, paths: string[]) => callback(requestId, paths);
    ipcRenderer.on("files:saveUnsavedForPaths", handler);
    return () => ipcRenderer.removeListener("files:saveUnsavedForPaths", handler);
  },
  acknowledgeUnsavedSaved: (requestId: string) => {
    ipcRenderer.send(`files:unsavedSavedAck:${requestId}`);
  },
};
