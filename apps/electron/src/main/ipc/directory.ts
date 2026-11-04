import { ipcMain, BrowserWindow } from "electron";
import { getActiveStates, saveActiveStates } from "../tabs";
import { addRecentPath } from "../fileSystem";
import { createMenuWithRecent } from "../window";

export async function getActiveDirectory() {
  const states = await getActiveStates();
  return states.activeDirectory || null;
}

export async function setActiveDirectory(directoryPath: string, window: BrowserWindow) {

  const states = await getActiveStates();
  states.activeDirectory = directoryPath;
  if (!states.directories[directoryPath]) {
    states.directories[directoryPath] = {
      tabs: [],
    };
  }
  // Only the tab list is saved here. Writing it with saveState() replaced the
  // window's full state and the window reopened blank (#608).
  await saveActiveStates(states);
  window.webContents.send("directory:changed", directoryPath);
  await addRecentPath(directoryPath);
  createMenuWithRecent(window);
}

async function setActiveDocument(documentPath: string) {
  const states = await getActiveStates();
  const activeDirectory = states.activeDirectory;
  if (!activeDirectory) return;

  if (!states.directories[activeDirectory]) {
    states.directories[activeDirectory] = {
      tabs: [],
    };
  }

  const activeTab = states.directories[activeDirectory].tabs.find((tab) => tab.filePath === documentPath);

  if (activeTab) {
    activeTab.isActive = true;
  }

  await saveActiveStates(states);
}

async function getActiveDocument() {
  const states = await getActiveStates();
  const activeDirectory = states.activeDirectory;
  if (!activeDirectory) return null;

  return states.directories[activeDirectory]?.tabs.find((tab) => tab.isActive)?.filePath || null;
}

export function registerDirectoryIpcHandlers() {
  ipcMain.handle("directory:getActive", async () => {
    return await getActiveDirectory();
  });

  ipcMain.handle("directory:setActive", async (_event, directoryPath: string, window: BrowserWindow) => {
    await setActiveDirectory(directoryPath, window);
  });

  ipcMain.handle("active:getDocument", async () => {
    return await getActiveDocument();
  });

  ipcMain.handle("active:setDocument", async (_event, documentPath: string) => {
    await setActiveDocument(documentPath);
  });
}
