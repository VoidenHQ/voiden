import { ipcRenderer } from "electron";
import { Tab } from "../../shared/types";

export const stateApi = {
  get: () => ipcRenderer.invoke("state:get"),
  save: (chosenPath: string) => ipcRenderer.invoke("state:save", chosenPath),
  getPanelTabs: (panelId: string) => ipcRenderer.invoke("state:getPanelTabs", panelId),
  getProjects: () => ipcRenderer.invoke("state:getProjects"),
  openProject: (projectPath: string) => ipcRenderer.invoke("state:openProject", projectPath),
  setActiveProject: (projectPath: string) => ipcRenderer.invoke("state:setActiveProject", projectPath),
  removeProjectFromList: (projectPath: string) => ipcRenderer.invoke("state:removeProjectFromList", projectPath),
  emptyActiveProject: () => ipcRenderer.invoke("state:emptyActiveProject"),
  addPanelTab: (panelId: string, tab: Tab) => ipcRenderer.invoke("state:addPanelTab", panelId, tab),
  activatePanelTab: (panelId: string, tabId: string) => ipcRenderer.invoke("state:activatePanelTab", panelId, tabId),
  closePanelTab: (panelId: string, tabId: string, unsavedContent?: string) =>
    ipcRenderer.invoke("state:closePanelTab", panelId, tabId, unsavedContent),
  closePanelTabs: (panelId: string, tabs:{tabId:string,unsavedContent:string}) =>
    ipcRenderer.invoke("state:closePanelTabs", panelId,tabs),
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke("state:renameFile", oldPath, newName),
  getOnboarding: () => ipcRenderer.invoke("state:getOnboarding"),
  updateOnboarding: (onboarding: boolean) => ipcRenderer.invoke("state:updateOnboarding", onboarding),
  duplicatePanelTab: (panelId: string, tabId: string) => ipcRenderer.invoke("state:duplicatePanelTab", panelId, tabId),
  reloadPanelTab: (panelId: string, tabId: string) => ipcRenderer.invoke("state:reloadPanelTab", panelId, tabId),
  reorderTabs:(panelId:string,tabs:any[])=>ipcRenderer.invoke('state:reorder-tabs',panelId,tabs)
};
