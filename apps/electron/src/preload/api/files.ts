import { ipcRenderer } from "electron";
import { FileTreeItem } from "./types";

export const filesApi = {
  getFiles: (filePaths: string[], isExternal?: boolean) => ipcRenderer.invoke("files:getFiles", filePaths, isExternal),
  tree: (directory: string) => ipcRenderer.invoke("files:tree", directory),
  read: (path: string) => ipcRenderer.invoke("files:read", path),
  write: (path: string, content: string, tabId?: string) => ipcRenderer.invoke("files:write", path, content, tabId),
  createVoid: (projectName: string, fileName: string): Promise<string> => ipcRenderer.invoke("files:create-void", projectName, fileName),
  create: (projectName: string, fileName: string): Promise<string> => ipcRenderer.invoke("files:create", projectName, fileName),
  createDirectory: (path: string, dirName?: string): Promise<string> => ipcRenderer.invoke("files:createDirectory", path, dirName),
  getDirectoryExist: (path: string, dirName?: string): Promise<boolean> => ipcRenderer.invoke("files:getDirectoryExist", path, dirName),
  getFileExist: (path: string, fileName?: string): Promise<boolean> => ipcRenderer.invoke("files:getFileExist", path, fileName),
  createProjectDirectory: (dirName?: string): Promise<string> => ipcRenderer.invoke("files:create-new-project",  dirName),
  delete: (path: string) => ipcRenderer.invoke("files:delete", path),
  rename: (oldPath: string, newName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("files:rename", oldPath, newName),
  showFileContextMenu: (data: FileTreeItem) => ipcRenderer.send("show-file-context-menu", data),
  showBulkDeleteMenu: (data: FileTreeItem[]) => ipcRenderer.send("show-bulk-delete-menu", data),
  onFileMenuCommand: (callback: (command: string, data: FileTreeItem) => void) => {
    const handler = (_: unknown, args: { command: string; data: FileTreeItem }) => {
      callback(args.command, args.data);
    };
    ipcRenderer.on("file-menu-command", handler);
    return () => {
      ipcRenderer.removeListener("file-menu-command", handler);
    };
  },
  move: (dragIds: string[], parentId: string): Promise<{ success: boolean; moved: string[]; conflicts: { dragId: string; targetPath: string; fileName: string }[]; error?: string }> =>
    ipcRenderer.invoke("files:move", dragIds, parentId),
  moveForce: (conflicts: { dragId: string; targetPath: string; fileName: string }[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("files:moveForce", conflicts),
  drop: (targetPath: string, fileName: string, fileData: Uint8Array): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("files:drop", targetPath, fileName, fileData),
  dropFolder: (targetPath: string, sourcePath: string): Promise<{ success: boolean; name?: string; path?: string; error?: string }> =>
    ipcRenderer.invoke("files:dropFolder", targetPath, sourcePath),
  deleteDirectory: (path: string) => ipcRenderer.invoke("files:deleteDirectory", path),
  bulkDelete: (items: FileTreeItem[]) => ipcRenderer.invoke("files:bulkDelete", items),
  getVoidFiles: () => ipcRenderer.invoke("files:getVoidFiles"),
  onReferencesUpdated: (callback: (filePaths: string[]) => void) => {
    const handler = (_: unknown, filePaths: string[]) => callback(filePaths);
    ipcRenderer.on("files:referencesUpdated", handler);
    return () => ipcRenderer.removeListener("files:referencesUpdated", handler);
  },
};
