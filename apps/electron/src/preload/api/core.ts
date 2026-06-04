import { ipcRenderer } from "electron";

export const coreApi = {
  isApp: true,
  removeListener: (channel: any) => ipcRenderer.removeAllListeners(channel),
  openExternal: (url: string) => ipcRenderer.send("open-external", url),
  onLogin: (callback: (event: Electron.IpcRendererEvent, url: string) => void) => ipcRenderer.on("handle-login", callback),
  sendRequest: (urlForRequest: string, fetchOptions: RequestInit, signalState: AbortSignal) =>
    ipcRenderer.invoke("send-request", {
      urlForRequest,
      fetchOptions,
      signalState,
    }),
  startSearch: (args: { query: string; matchCase: boolean; matchWholeWord: boolean; useRegex: boolean; useMultiline: boolean; searchId: number; fileMask?: string; dirMask?: string; includeHidden?: boolean }) =>
    ipcRenderer.send("search-files:start", args),
  listDirs: (parent?: string): Promise<string[]> => ipcRenderer.invoke("files:dirList", parent),
  cancelSearch: (searchId: number) => ipcRenderer.send("search-files:cancel", searchId),
  replaceMatch: (args: { path: string; line: number; col: number; query: string; replacement: string; matchCase: boolean; matchWholeWord: boolean; useRegex: boolean; useMultiline: boolean }): Promise<{ success: boolean; updatedPaths: string[]; replacement?: string; error?: string }> =>
    ipcRenderer.invoke("files:replaceMatch", args),
  replaceInFiles: (args: { query: string; replacement: string; matchCase: boolean; matchWholeWord: boolean; useRegex: boolean; useMultiline: boolean; paths: string[] }): Promise<{ replacedCount: number; updatedPaths: string[]; replacements?: Record<string, string[]>; error?: string }> =>
    ipcRenderer.invoke("files:replaceInFiles", args),
  searchInFile: (args: { path: string; query: string; matchCase: boolean; matchWholeWord: boolean; useRegex: boolean; useMultiline: boolean }): Promise<{ results: { path: string; line: number; col: number; preview: string; colInPreview: number; matchLength: number }[] }> =>
    ipcRenderer.invoke("files:searchInFile", args),
  onSearchResult: (cb: (data: { searchId: number; result: { path: string; line: number; col: number; preview: string } }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("search-files:result", handler);
    return () => ipcRenderer.removeListener("search-files:result", handler);
  },
  onSearchDone: (cb: (data: { searchId: number; error?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("search-files:done", handler);
    return () => ipcRenderer.removeListener("search-files:done", handler);
  },
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: (channel: "stable" | "early-access") => ipcRenderer.invoke("app:checkForUpdates", channel),
  onUpdateProgress: (callback: (progress: { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number; status: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
    ipcRenderer.on("update:progress", handler);
    return () => ipcRenderer.removeListener("update:progress", handler);
  },
  // Menu actions - File
  menuNewFile: () => ipcRenderer.invoke("menu:newFile"),
  menuOpenFolder: () => ipcRenderer.invoke("menu:openFolder"),
  menuSave: () => ipcRenderer.invoke("menu:save"),
  menuCloseProject: () => ipcRenderer.invoke("menu:closeProject"),
  // Menu actions - View
  menuToggleExplorer: () => ipcRenderer.invoke("menu:toggleExplorer"),
  menuToggleTerminal: () => ipcRenderer.invoke("menu:toggleTerminal"),
  menuReload: () => ipcRenderer.invoke("menu:reload"),
  menuForceReload: () => ipcRenderer.invoke("menu:forceReload"),
  menuResetZoom: () => ipcRenderer.invoke("menu:resetZoom"),
  menuZoomIn: () => ipcRenderer.invoke("menu:zoomIn"),
  menuZoomOut: () => ipcRenderer.invoke("menu:zoomOut"),
  menuToggleFullScreen: () => ipcRenderer.invoke("menu:toggleFullScreen"),
  menuToggleDevTools: () => ipcRenderer.invoke("menu:toggleDevTools"),
  // Application actions
  menuQuit: () => ipcRenderer.invoke("menu:quit"),
};
