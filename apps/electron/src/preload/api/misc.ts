import { ipcRenderer } from "electron";
import { Tab } from "../../shared/types";
import type { Settings } from "../../main/settings";
import { connect } from "http2";

export const directoriesApi = {
  list: () => ipcRenderer.invoke("directories:list"),
  getActive: () => ipcRenderer.invoke("directory:getActive"),
  onChange: (callback: (directoryPath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, directoryPath: string) => {
      callback(directoryPath);
    };
    ipcRenderer.on("directory:changed", handler);
    return () => ipcRenderer.removeListener("directory:changed", handler);
  },
};

export const dialogApi = {
  openFile: (options: Electron.OpenDialogOptions) => ipcRenderer.invoke("dialog:openFile", options),
  showMessageBox: (options: Electron.MessageBoxOptions): Promise<number> =>
    ipcRenderer.invoke("dialog:showMessageBox", options),
};

export const editorApi = {
  showContextMenu: (info: { x: number; y: number; selectedText?: string }) => ipcRenderer.send("show-editor-context-menu", info),
  showCopyContextMenu: (info: { x: number; y: number; selectedText?: string }) =>
    ipcRenderer.send("show-editor-copy-context-menu", info),
};

export const pluginsApi = {
  get: async () => {
    try {
      return await ipcRenderer.invoke("plugins:list");
    } catch (error) {
      return [];
    }
  },
};

export const tabApi = {
  getContent: (tab: Tab) => ipcRenderer.invoke("tab:getContent", tab),
  activate: (panelId: string, tabId: string) => ipcRenderer.invoke("tab:activate", panelId, tabId),
  add: (tabId: string, tab: any) => ipcRenderer.invoke("tab:add", tabId, tab),
  registerPanel: (panelId: string, tab: any) => ipcRenderer.invoke("tab:registerPanel", panelId, tab),
  getActiveTab :() => ipcRenderer.invoke('tab:getActiveTab')
};

export const sidebarApi = {
  getTabs: (sidebarId: "left" | "right") => ipcRenderer.invoke("sidebar:getTabs", sidebarId),
  activateTab: (sidebarId: "left" | "right", tabId: string) => ipcRenderer.invoke("sidebar:activateTab", sidebarId, tabId),
  registerSidebarTab: (
    sidebarId: "left" | "right",
    tab: {
      extensionId: string;
      id: string;
      title: string;
    },
  ) => ipcRenderer.invoke("sidebar:registerSidebarTab", sidebarId, tab),
  setHistoryEnabled: (enabled: boolean) => ipcRenderer.invoke("sidebar:setHistoryEnabled", enabled),
};

export const settingsApi = {
  get: () => ipcRenderer.invoke("settings:get"),
};

export const extensionsApi = {
  getAll: () => ipcRenderer.invoke("extensions:getAll"),
  get: (extensionId: string) => ipcRenderer.invoke("extensions:get", extensionId),
  install: (extension: any) => ipcRenderer.invoke("extensions:install", extension),
  installFromZip: () => ipcRenderer.invoke("extensions:installFromZip"),
  uninstall: (extensionId: string) => ipcRenderer.invoke("extensions:uninstall", extensionId),
  setEnabled: (extensionId: string, enabled: boolean) => ipcRenderer.invoke("extensions:setEnabled", extensionId, enabled),
  openDetails: (extension: any) => ipcRenderer.invoke("extensions:openDetails", extension),
  update: (extensionId: string) => ipcRenderer.invoke("extensions:update", extensionId),
};

export const ipcApi = {
  on: (channel: string, listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.removeAllListeners(channel);
    ipcRenderer.on(channel, listener);
  },
  removeListener: (channel: string, listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, listener);
  },
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
};

export const voidenApi = {
  getApyFiles: (directory: string) => ipcRenderer.invoke("voiden-wrapper:getApyFiles", directory),
  getBlockContent: (filePath: string) => ipcRenderer.invoke("voiden-wrapper:getBlockContent", filePath),
};

export const envApi = {
  load: () => ipcRenderer.invoke("env:load"),
  setActive: (envPath: string) => ipcRenderer.invoke("env:setActive", envPath),
  /**
   * Securely replace {{VARIABLE}} patterns in text.
   * Variables are replaced in Electron main process - UI never sees actual values.
   * @param text - Text containing {{VARIABLE}} patterns
   * @returns Text with variables replaced
   */
  replaceVariables: (text: string) => ipcRenderer.invoke("env:replaceVariables", text),
  /**
   * Get environment variable keys (names only) for autocomplete.
   * @returns Array of variable names (no values)
   */
  getKeys: () => ipcRenderer.invoke("env:getKeys"),
  extendEnvs: (comment: string, variables: [{ key: string, value: string }]) => ipcRenderer.invoke('env:extend-env-files', { comment, variables }),
  getYamlTrees: (profile?: string) => ipcRenderer.invoke("env:getYamlTrees", profile ? { profile } : undefined) as Promise<{ public: Record<string, unknown>; private: Record<string, unknown> }>,
  saveYamlTrees: (publicTree: Record<string, unknown>, privateTree: Record<string, unknown>, profile?: string) =>
    ipcRenderer.invoke("env:saveYamlTrees", { publicTree, privateTree, profile }),
  getProfiles: () => ipcRenderer.invoke("env:getProfiles") as Promise<string[]>,
  setActiveProfile: (profile: string) => ipcRenderer.invoke("env:setActiveProfile", profile),
  createProfile: (profile: string) => ipcRenderer.invoke("env:createProfile", profile),
  deleteProfile: (profile: string) => ipcRenderer.invoke("env:deleteProfile", profile),
};

export const requestApi = {
  /**
   * Send a request with environment variable replacement handled securely in Electron.
   * UI sends raw request with {{variables}}, Electron replaces and executes.
   * @param requestState - Request state with potential {{VARIABLE}} patterns
   * @param signalState - Abort signal state
   * @returns Response with status, headers, and body
   */
  sendSecure: (requestState: any, signalState?: any) => ipcRenderer.invoke("send-secure-request", { requestState, signalState }),
  connectWss: (wsId: string) => ipcRenderer.invoke("ws-connect", wsId),
  sendMessage: (wsId: any, msg?: any) => ipcRenderer.send("ws-send", { wsId, data: msg }),
  pauseWss: (obj:{wsId:string,reason:string}) => ipcRenderer.send("ws-pause",obj),
  resumeWss: (wsId: string) => ipcRenderer.send("ws-resume", { wsId }),
  closeWss: (wsId: string) => ipcRenderer.send("ws-close", wsId),
  clearClosedWss: (wsId: string) => ipcRenderer.invoke("ws-clear-closed", wsId),
  listenSecure: (eventName: string, callback: (e: Electron.IpcRendererEvent, data: any) => void) => {
    const wrapped = (e: Electron.IpcRendererEvent, d: any) => callback(e, d);
    ipcRenderer.on(eventName, wrapped);
    return () => ipcRenderer.removeListener(eventName, wrapped);
  },
  connectGrpc:(grpcId:string)=>ipcRenderer.invoke('grpc:connect',grpcId),
  sendGrpcMessage:(grpcId:string,payload:string)=>ipcRenderer.invoke('grpc:send',grpcId,payload),
  endGrpc:(grpcId:string)=>ipcRenderer.invoke('grpc:end',grpcId),
  cancelGrpc:(grpcId:string)=>ipcRenderer.invoke('grpc:cancel',grpcId),
  closeGrpc:(grpcId:string)=>ipcRenderer.invoke('grpc:close',grpcId),
  
  // GraphQL Subscription methods
  connectGraphQLSubscription: (subscriptionId: string) => ipcRenderer.invoke('connect-graphql-subscription', subscriptionId),
  closeGraphQLSubscription: (subscriptionId: string, reason?: string) => ipcRenderer.invoke('close-graphql-subscription', { subscriptionId, reason }),

};

export const scriptApi = {
  executePython: (payload: any) => ipcRenderer.invoke("script:executePython", payload),
  executeNode: (payload: any) => ipcRenderer.invoke("script:executeNode", payload),
};

export const fileLinkApi = {
  exists: (absolutePath: string) => ipcRenderer.invoke("fileLink:exists", absolutePath),
};

export const utilsApi = {
  pathJoin: (...paths: string[]) => ipcRenderer.invoke("utils:pathJoin", ...paths),
};

export const userSettingsApi = {
  get: (): Promise<Settings> => ipcRenderer.invoke("usersettings:get"),
  set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke("usersettings:set", patch),
  reset: (): Promise<Settings> => ipcRenderer.invoke("usersettings:reset"),
  toggleEarlyAccess: (enable: boolean): Promise<{ confirmed: boolean; settings?: Settings }> => 
    ipcRenderer.invoke("usersettings:toggleEarlyAccess", enable),
  onChange: (cb: (next: Settings) => void) => {
    const handler = (_: unknown, next: Settings) => cb(next);
    ipcRenderer.on("settings:changed", handler);
    // return unsubscribe
    return () => ipcRenderer.removeListener("settings:changed", handler);
  },
};

export const fontsApi = {
  install: (): Promise<{ success: boolean; error?: string; alreadyInstalled?: boolean }> => ipcRenderer.invoke("fonts:install"),
  uninstall: (): Promise<{ success: boolean }> => ipcRenderer.invoke("fonts:uninstall"),
  getPath: (): Promise<string | null> => ipcRenderer.invoke("fonts:getPath"),
  getAsBase64: (fontFileName: string): Promise<string | null> => ipcRenderer.invoke("fonts:getAsBase64", fontFileName),
};

export const cliApi = {
  isInstalled: (): Promise<boolean> => ipcRenderer.invoke("cli:isInstalled"),
  install: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke("cli:install"),
  uninstall: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke("cli:uninstall"),
  showInstructions: (): Promise<void> => ipcRenderer.invoke("cli:showInstructions"),
};

export const skillsApi = {
  setClaude: (enabled: boolean): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke("skills:setClaude", enabled),
  setCodex: (enabled: boolean): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke("skills:setCodex", enabled),
};

export const variablesApi = {
  getKeys: () => ipcRenderer.invoke("variables:getKeys"),
  read: () => ipcRenderer.invoke("variables:read"),
  get: (key: string) => ipcRenderer.invoke("variables:get", key),
  set: (key: string, value: any) => ipcRenderer.invoke("variables:set", key, value),
  writeVariables: (content: string | Record<string, any>) => ipcRenderer.invoke("variables:writeVariables", content),
}

export const projectApi = {
  getLocked: (projectRoot: string): Promise<boolean> =>
    ipcRenderer.invoke("project:getLocked", projectRoot),
  setLocked: (projectRoot: string, locked: boolean): Promise<boolean> =>
    ipcRenderer.invoke("project:setLocked", projectRoot, locked),
  isPathInsideLocked: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("project:isPathInsideLocked", filePath),
  onLockedChanged: (
    cb: (payload: { projectRoot: string; locked: boolean }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { projectRoot: string; locked: boolean },
    ) => cb(payload);
    ipcRenderer.on("project:locked-changed", handler);
    return () => ipcRenderer.removeListener("project:locked-changed", handler);
  },
};

export const mainWindow = {
  minimize: () => ipcRenderer.invoke("mainwindow:minimize"),
  maximize: () => ipcRenderer.invoke("mainwindow:maximize"),
  close: () => ipcRenderer.invoke("mainwindow:close"),
  closeAndDeleteState: () => ipcRenderer.invoke("mainwindow:closeAndDeleteState"),
  isMaximized:()=>ipcRenderer.invoke("mainwindow:isMaximized")
}
