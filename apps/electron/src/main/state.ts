import fs from "fs/promises";
import fsSync from "fs";
import {
  AppSettings,
  AppState,
  ExtensionData,
  PanelElement,
  SidebarTab,
  Tab
} from "src/shared/types";
import { ExtensionManager } from "./extension/extensionManager";
import { getRemoteExtensions } from "./extension/extensionFetcher";
import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from "electron";
import {
  loadState,
  saveState,
  loadSettings,
  getDefaultLayout,
  saveAutosaveFile,
  loadAutosaveFile,
  deleteAutosaveFile,
  cleanupAutosaveFiles,
  saveOnboardingState,
  loadOnboardingState,
} from "./persistState";
import { renameFileOrDirectory, findVoidenProjects } from "./fileSystem";
import { getProjectLocked } from "./projectUtils";
import { killTerminal } from "./terminal";
import eventBus from "./eventBus";
import os from "os";
import path from "path";
import { updateFileWatcher } from "./fileWatcher";
import { windowManager } from "./windowManager";
import { getSettings } from "./settings";
import { recomposeAndInstall } from "./skillsInstaller";
import { logger } from "./logger";

function maybeRecomposeSkills(state: AppState): void {
  const skills = getSettings().skills;
  if (skills?.claude || skills?.codex) {
    recomposeAndInstall(state, { claude: skills.claude ?? false, codex: skills.codex ?? false }).catch(() => {});
  }
}

let appState: AppState;
let appSettings: AppSettings;
let extensionManager: ExtensionManager;

export const updateWindowState = () => {
  try {
    appState = windowManager.getWindowState();
  } catch (e) {
    // Window state may not be available yet during initialization
  }
};
export const initializeState = async (
  skipDefault?: boolean,
): Promise<AppState> => {
  const startupTimer = Date.now();
  logger.info('system', 'STARTUP [1/5] initializeState begin', { skipDefault });

  const t0 = Date.now();
  appState = await loadState(skipDefault);
  logger.perf('system', 'STARTUP [1/5] loadState complete', Date.now() - t0, {
    activeDirectory: appState.activeDirectory,
    dirCount: Object.keys(appState.directories || {}).length,
  });

  appSettings = await loadSettings();

  // Migration: ensure the history tab exists in the right sidebar
  const hasHistoryTab = appState.sidebars.right.tabs.some((t) => t.type === "history");
  if (!hasHistoryTab) {
    appState.sidebars.right.tabs.push({ id: crypto.randomUUID(), type: "history" });
  }

  // Migration: ensure the global history tab exists in the left sidebar (after extensionBrowser)
  // Also remove it from the right sidebar if it was previously placed there.
  appState.sidebars.right.tabs = appState.sidebars.right.tabs.filter((t: any) => t.type !== "globalHistory");
  const hasGlobalHistoryTab = appState.sidebars.left.tabs.some((t: any) => t.type === "globalHistory");
  if (!hasGlobalHistoryTab) {
    appState.sidebars.left.tabs.push({ id: crypto.randomUUID(), type: "globalHistory" });
  }

  const t1 = Date.now();
  extensionManager = new ExtensionManager(appState);
  await extensionManager.loadInstalledCommunityExtensions();
  logger.perf('system', 'STARTUP [2/5] loadInstalledCommunityExtensions complete', Date.now() - t1);

  const t2 = Date.now();
  await saveState(appState);
  logger.perf('system', 'STARTUP [3/5] saveState complete', Date.now() - t2);

  // Initialize file watcher in the background — do NOT await it.
  // The watcher does not need to be ready before the window opens, and on large
  // projects chokidar's setup can flood the event loop with EMFILE errors before
  // any window is created, making the app appear stuck at launch.
  if (appState.activeDirectory) {
    const _watchPath = appState.activeDirectory;
    const _watcherId = windowManager.activeWindowId as string;
    logger.info('system', 'STARTUP [4/5] updateFileWatcher scheduled (non-blocking)', { path: _watchPath });
    setImmediate(() => {
      updateFileWatcher(_watchPath, _watcherId).catch((err) => {
        logger.warn('system', 'FileWatcher: init error', { error: err?.message, path: _watchPath });
      });
    });
  }

  const activeTabIds = new Set<string>();
  const collectTabIds = (layout: PanelElement) => {
    if (layout.type === "panel") {
      layout.tabs.forEach((tab) => {
        if (tab.type === "document" && !tab.source) {
          activeTabIds.add(tab.id);
        }
      });
    } else if (layout.type === "group") {
      layout.children.forEach(collectTabIds);
    }
  };

  Object.values(appState.directories).forEach((dir) => {
    if (dir.layout) collectTabIds(dir.layout);
  });
  if (appState.unsaved?.layout) {
    collectTabIds(appState.unsaved.layout);
  }
  await cleanupAutosaveFiles(activeTabIds);

  logger.perf('system', 'STARTUP [5/5] initializeState complete', Date.now() - startupTimer, {
    activeDirectory: appState.activeDirectory,
  });

  return appState;
};

export const getAppState = (event?: IpcMainInvokeEvent): AppState => {
  let windowId = windowManager.activeWindowId;
  if (event && event.sender) {
    const wind = BrowserWindow.fromWebContents(event.sender);
    windowId = wind?.windowInfo?.id || windowManager.activeWindowId;
  }
  if (!windowManager.getActiveWindowId()) {
    throw new Error("App state not yet initialized");
  }
  return windowManager.getWindowState(windowId as string);
};

function getPanelTabs(layout: PanelElement, panelId: string): Tab[] | null {
  if (!layout) {
    return null;
  }
  if (layout.type === "panel") {
    if (layout.id === panelId) return layout.tabs;
    return null;
  }
  for (const child of layout.children) {
    const result = getPanelTabs(child, panelId);
    if (result) return result;
  }
  return null;
}

function findActiveTabId(layout: PanelElement, panelId: string): string | null {
  if (!layout) {
    return null;
  }
  if (layout.type === "panel") {
    return layout.id === panelId ? layout.activeTabId : null;
  }
  for (const child of layout.children) {
    const activeTabId = findActiveTabId(child, panelId);
    if (activeTabId !== null) return activeTabId;
  }
  return null;
}

const getSidebarTabs = (
  state: AppState,
  sidebarId: "left" | "right",
): SidebarTab[] => {
  const tabs = state.sidebars[sidebarId].tabs;
  // Filter out disabled extensions
  return tabs.filter((tab) => {
    if (tab.type === "custom" && tab.meta?.extensionId) {
      const ext = state.extensions.find((e) => e.id === tab.meta.extensionId);
      return ext ? ext.enabled : false;
    }
    return true;
  });
};

// Helper function to activate a tab in the given layout.
// Returns true if the panel was found and updated.
export function activateTabInLayout(
  layout: PanelElement,
  panelId: string,
  tabId: string,
): boolean {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      const tabExists = layout.tabs.some((tab) => tab.id === tabId);
      if (!tabExists) {
        return false;
      }
      layout.activeTabId = tabId;
      return true;
    }
    return false;
  }
  for (const child of layout.children) {
    if (activateTabInLayout(child, panelId, tabId)) {
      return true;
    }
  }
  return false;
}

export function findTabInPanel(
  layout: PanelElement,
  panelId: string,
  newTab: Tab,
): Tab | null {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      if (newTab.type === "extensionDetails" && newTab.meta?.extensionId) {
        return (
          layout.tabs.find(
            (tab) =>
              tab.type === "extensionDetails" &&
              tab.meta?.extensionId === newTab.meta!.extensionId,
          ) || null
        );
      } else if (newTab.source) {
        return layout.tabs.find((tab) => tab.source === newTab.source) || null;
      }
    }
    return null;
  }
  for (const child of layout.children) {
    const result = findTabInPanel(child, panelId, newTab);
    if (result) return result;
  }
  return null;
}

export function findCustomTabInPanel(
  layout: PanelElement,
  panelId: string,
  customTabKey: string,
): Tab | null {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      return (
        layout.tabs.find(
          (tab) =>
            tab.type === "custom" && tab.meta?.customTabKey === customTabKey,
        ) || null
      );
    }
    return null;
  }
  for (const child of layout.children) {
    const result = findCustomTabInPanel(child, panelId, customTabKey);
    if (result) return result;
  }
  return null;
}

export function addTabToPanel(
  layout: PanelElement,
  panelId: string,
  newTab: Tab,
): boolean {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      layout.tabs.push(newTab);
      return true;
    }
    return false;
  }
  for (const child of layout.children) {
    if (addTabToPanel(child, panelId, newTab)) {
      return true;
    }
  }
  return false;
}

export function reorderTabs(
  layout: PanelElement,
  panelId: string,
  tabs: Tab[],
) {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      layout.tabs = tabs;
      return layout;
    }
    return false;
  }
  for (const child of layout.children) {
    return reorderTabs(child, panelId, tabs);
  }
  return layout;
}

export function removeTabFromPanel(
  layout: PanelElement,
  panelId: string,
  tabId: string,
): boolean {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      const index = layout.tabs.findIndex((tab) => tab.id === tabId);
      if (index === -1) return false;

      layout.tabs.splice(index, 1);

      // If we removed the active tab, activate the next available tab
      if (layout.activeTabId === tabId) {
        const nextTab = layout.tabs[index] || layout.tabs[index - 1];
        layout.activeTabId = nextTab?.id || null;
      }
      return true;
    }
    return false;
  }

  for (const child of layout.children) {
    if (removeTabFromPanel(child, panelId, tabId)) {
      return true;
    }
  }
  return false;
}

// Helper function to remove any tabs (from panels) associated with a given extension id.
function removeExtensionTabsFromLayout(
  layout: PanelElement,
  extensionId: string,
): void {
  if (layout.type === "panel") {
    const remainingTabs = layout.tabs.filter(
      (tab) => !(tab.meta?.extensionId === extensionId),
    );
    layout.tabs = remainingTabs;
    if (!remainingTabs.some((tab) => tab.id === layout.activeTabId)) {
      layout.activeTabId =
        remainingTabs.length > 0 ? remainingTabs[0].id : null;
    }
  } else if (layout.type === "group") {
    for (const child of layout.children) {
      removeExtensionTabsFromLayout(child, extensionId);
    }
  }
}

// Helper function to remove extension-related tabs from sidebars.
function removeExtensionTabsFromSidebars(
  sidebars: {
    [key in "left" | "right"]: {
      activeTabId: string | null;
      tabs: SidebarTab[];
    };
  },
  extensionId: string,
): void {
  for (const key in sidebars) {
    const sidebar = sidebars[key as "left" | "right"];
    const filteredTabs = sidebar.tabs.filter(
      (tab) => !(tab.meta?.extensionId === extensionId),
    );
    if (
      sidebar.activeTabId &&
      !filteredTabs.some((tab) => tab.id === sidebar.activeTabId)
    ) {
      sidebar.activeTabId = filteredTabs.length > 0 ? filteredTabs[0].id : null;
    }
    sidebar.tabs = filteredTabs;
  }
}

// Helper function: find a tab in the layout by panelId and tabId.
export function findTabById(
  layout: PanelElement,
  panelId: string,
  tabId: string,
): Tab | null {
  if (layout.type === "panel") {
    if (layout.id === panelId) {
      return layout.tabs.find((tab) => tab.id === tabId) || null;
    }
    return null;
  } else if (layout.type === "group") {
    for (const child of layout.children) {
      const found = findTabById(child, panelId, tabId);
      if (found) return found;
    }
  }
  return null;
}

async function isClosingTabInLockedProject(
  appState: AppState,
  closingTab: Tab,
): Promise<boolean> {
  const source: string | undefined = closingTab?.source;
  if (!source) return false;
  const normSource = source.replace(/\\/g, "/");
  const candidateRoots = Object.keys(appState.directories || {});
  if (appState.activeDirectory && !candidateRoots.includes(appState.activeDirectory)) {
    candidateRoots.push(appState.activeDirectory);
  }
  const matchingRoot = candidateRoots
    .map((r) => r.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((r) => normSource === r || normSource.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (!matchingRoot) return false;
  const voidenDir = matchingRoot + "/.voiden";
  if (normSource === voidenDir || normSource.startsWith(voidenDir + "/")) return false;
  return await getProjectLocked(matchingRoot);
}

async function saveDocument(
  closingTab: any,
  unsavedContent: string,
): Promise<boolean> {
  if (closingTab.source) {
    try {
      await fs.writeFile(closingTab.source, unsavedContent, "utf8");
      return true;
    } catch (error) {
      return false;
    }
  } else {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save Document",
      defaultPath: closingTab.title,
    });
    if (!canceled && filePath) {
      try {
        await fs.writeFile(filePath, unsavedContent, "utf8");
        closingTab.source = filePath;
        closingTab.title = filePath.split(/[\\/]/).pop() || closingTab.title;
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }
}

export async function getActiveProject(event?: IpcMainInvokeEvent) {
  const appState = getAppState(event);
  return appState.activeDirectory;
}

export async function setActiveProject(projectPath: string) {
  const appState = getAppState();
  appState.activeDirectory = projectPath;
  // If this project isn't already in our directories, add it with a default layout.
  if (!appState.directories[projectPath]) {
    appState.directories[projectPath] = {
      layout: getDefaultLayout(),
    };
  }

  appState.directories[projectPath]["hidden"] = false;

  await saveState(appState);

  // Update the file watcher using the active window ID as the key so it
  // matches the key used by initializeState — preventing a second watcher
  // from being created for the same directory with a different key.
  const watcherId = windowManager.activeWindowId ?? undefined;
  await updateFileWatcher(projectPath || "", watcherId);

  return { activeProject: projectPath };
}

export async function emptyActiveProject() {
  const appState = getAppState();
  appState.activeDirectory = "";
  await saveState(appState);
  const watcherId = windowManager.activeWindowId ?? undefined;
  await updateFileWatcher("", watcherId);
  return { activeProject: null };
}

export async function removeProjectFromList(projectPath: string) {
  const appState = getAppState();

  if (appState.directories[projectPath]) {
    appState.directories[projectPath]["hidden"] = true;
  }

  await saveState(appState);
}

export async function createNewDocumentTab() {
  const activeDirectory = await getActiveProject();
  const appState = getAppState();
  const layout = appState.activeDirectory
    ? appState.directories[appState.activeDirectory]?.layout
    : appState.unsaved.layout;

  if (!layout) {
    return;
  }
  const createNewTabWithIncrement = (): Tab => {
    const files = getPanelTabs(layout, "main") || [];
    const untitledFiles = files
      .map((file: any) => file.title)
      .filter((title: string) => title.startsWith("untitled"));

    const indexes = untitledFiles
      .map((name: string) => {
        if (name === "untitled.void") return 0;
        const match = name.match(/untitled-(\d+)\.void$/);
        return match ? parseInt(match[1], 10) : -1;
      })
      .filter((index) => index !== -1);

    const indexSet = new Set(indexes);
    let nextIndex = 1;
    while (indexSet.has(nextIndex)) {
      nextIndex++;
    }
    let fileName: string;
    if (!indexSet.has(0)) {
      fileName = "untitled.void";
    } else {
      fileName = `untitled-${nextIndex}.void`;
    }
    const newTab = {
      id: crypto.randomUUID(),
      type: "document",
      title: fileName,
      source: null,
      directory: activeDirectory,
    };
    return newTab;
  };
  const newTab: Tab = createNewTabWithIncrement();
  addTabToPanel(layout, "main", newTab);
  activateTabInLayout(layout, "main", newTab.id);
  await saveState(appState);
  windowManager.browserWindow?.webContents.send("file:newTab", { tab: newTab });
}

export function getActiveTab(panelId: string): Tab | null {
  const appState = getAppState();
  const layout = appState.activeDirectory
    ? appState.directories[appState.activeDirectory]?.layout
    : appState.unsaved.layout;
  const activeTabId = findActiveTabId(layout, panelId);
  if (!activeTabId) return null;
  return findTabById(layout, panelId, activeTabId);
}

// IPC HANDLERS

export async function addPanelTab(
  event: IpcMainInvokeEvent | undefined,
  panelId: string,
  tab: Tab,
): Promise<any> {
  const state = getAppState(event);
  const layout = state.activeDirectory
    ? state.directories[state.activeDirectory]?.layout
    : state.unsaved.layout;

  if (!layout) {
    throw new Error("No layout found to add tab.");
  }

  const existingTab = findTabInPanel(layout, panelId, tab);
  if (existingTab) {
    return { tabId: existingTab.id, alreadyExists: true };
  }

  const added = addTabToPanel(layout, panelId, tab);
  if (!added) {
    throw new Error(`Panel with id ${panelId} not found.`);
  }

  await saveState(state);
  return { tabId: tab.id, alreadyExists: false, panelId };
}

export async function activateTab(
  event: IpcMainInvokeEvent | undefined,
  panelId: string,
  tabId: string,
): Promise<any> {
  const appState = getAppState(event);

  const layout = appState.activeDirectory
    ? appState.directories[appState.activeDirectory]?.layout
    : appState.unsaved.layout;

  if (!layout) {
    throw new Error("No layout found to update the active tab.");
  }

  const updated = activateTabInLayout(layout, panelId, tabId);
  if (!updated) {
    throw new Error(
      `Panel with id ${panelId} or tab with id ${tabId} not found.`,
    );
  }

  await saveState(appState);
  return { panelId, tabId };
}
export const ipcStateHandlers = () => {
  ipcMain.handle("state:get", (event) => {
    return getAppState(event);
  });

  ipcMain.handle("state:getPanelTabs", async (event, panelId: string) => {
    const appState = getAppState(event);
    const layout = appState.activeDirectory
      ? appState.directories[appState.activeDirectory]?.layout
      : appState.unsaved.layout;

    return {
      tabs: getPanelTabs(layout, panelId),
      activeTabId: findActiveTabId(layout, panelId),
    };
  });

  ipcMain.handle("state:openProject", async (event, defaultPath: string) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(browserWindow, {
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const projectPath = result.filePaths[0];

      if (windowManager.focusWindowByProject(projectPath)) {
        return;
      }
      await setActiveProject(projectPath);
      windowManager.browserWindow?.webContents.send("folder:opened", {
        path: projectPath,
      });
      return projectPath;
    } else {
      throw new Error("Project selection was canceled");
    }
  });

  ipcMain.handle("tab:getContent", async (_, tab: Tab) => {
    const { id: tabId, title, source } = tab;
    switch (tab.type) {
      case "welcome":
        return { type: "welcome", tabId, title };
      case "changelog":
        return { type: "changelog", tabId, title };
      case "logs":
        return { type: "logs", tabId, title };
      case "document": {
        if (!source) {
          const autosavedContent = await loadAutosaveFile(tabId);
          return {
            type: "document",
            tabId,
            title,
            content: autosavedContent || "",
            isAutosaved: !!autosavedContent,
          };
        }

        // Skip reading content for unsupported binary/media files
        const UNSUPPORTED_EXTENSIONS = new Set([
          "zip", "rar", "tar", "gz", "bz2", "7z", "xz", "tgz",
          "exe", "dll", "so", "dylib", "app", "dmg", "pkg", "deb", "rpm", "msi", "apk",
          "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tiff", "tif", "psd", "heic", "avif",
          "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm", "m4a", "m4v",
          "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
          "class", "pyc", "o", "a", "lib",
          "woff", "woff2", "ttf", "otf", "eot",
          "db", "sqlite", "sqlite3",
        ]);
        const fileExt = source.split(".").pop()?.toLowerCase() ?? "";
        if (UNSUPPORTED_EXTENSIONS.has(fileExt)) {
          return { type: "document", tabId, title, content: null, source, unsupported: true };
        }

        try {
          const STREAM_THRESHOLD = 1 * 1024 * 1024;
          const stat = await fs.stat(source);
          if (stat.size > STREAM_THRESHOLD) {
            return { type: "document", tabId, title, content: null, source, streamable: true, fullSize: stat.size };
          }
          const content = await fs.readFile(source, "utf8");
          return { type: "document", tabId, title, content, source };
        } catch (error) {
          return { type: "document", tabId, title, content: null, source };
        }
      }
      case "terminal":
        return { type: "terminal", tabId, title, source };
      case "settings":
        return { type: "settings", tabId, title, content: "settings" };

      case "extensionDetails": {
        if (!tab.meta?.extensionId) {
          throw new Error(
            "Missing extensionId in tab meta for extensionDetails tab",
          );
        }
        const appState = getAppState();
        let extension = appState.extensions.find(
          (ext) => ext.id === tab.meta!.extensionId,
        );
        if (!extension) {
          const remoteExtensions = await getRemoteExtensions();
          extension = remoteExtensions.find(
            (ext) => ext.id === tab.meta!.extensionId,
          );
        }
        if (!extension) {
          throw new Error(
            `Extension with id ${tab.meta.extensionId} not found`,
          );
        }

        const content = extension.readme || "";

        return {
          type: "extensionDetails",
          tabId,
          title,
          content,
          extensionData: extension, // Include the full ExtensionData object
          extensionId: extension.id,
        };
      }
      case "custom": {
        if (!tab.meta?.extensionId) {
          throw new Error("Missing extensionId in tab meta for extension tab");
        }
        return {
          type: "custom",
          tabId,
          title,
          content: "Interactive extension content placeholder",
          extensionId: tab.meta.extensionId,
          customTabKey: tab.meta.customTabKey,
        };
      }

      case "diff": {
        return {
          type: "diff",
          tabId,
          title,
          source,
          meta: tab.meta,
        };
      }

      case "conflict": {
        return {
          type: "conflict",
          tabId,
          title,
          source,
          meta: tab.meta,
        };
      }

      case "environmentEditor":
        return { type: "environmentEditor", tabId, title };

      default:
        throw new Error("unsupported tab type");
    }
  });

  ipcMain.handle(
    "tab:add",
    async (
      _,
      tabId: string,
      tab: {
        id: string;
        title: string;
        extensionId: string;
      },
    ) => {
      const appState = getAppState();
      const layout = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;

      // Dedup: if a custom tab with the same customTabKey already exists, just activate it
      const existing = findCustomTabInPanel(layout, tabId, tab.id);
      if (existing) {
        activateTabInLayout(layout, tabId, existing.id);
        await saveState(appState);
        return { panelId: tabId, tabId: existing.id, alreadyExists: true };
      }

      const newPanel: Tab = {
        id: crypto.randomUUID(),
        type: "custom",
        title: tab.title,
        source: null,
        directory: null,
        meta: {
          extensionId: tab.extensionId,
          customTabKey: tab.id,
        },
      };
      addTabToPanel(layout, tabId, newPanel);
      activateTabInLayout(layout, tabId, newPanel.id);
      await saveState(appState);
      return { panelId: tabId, tabId: newPanel.id };
    },
  );
  ipcMain.handle("tab:getActiveTab", async () => {
    return await getActiveTab("main");
  });

  ipcMain.handle(
    "sidebar:getTabs",
    async (event, sidebarId: "left" | "right") => {
      const appState = getAppState(event);
      const tabs = getSidebarTabs(appState, sidebarId);
      return {
        tabs,
        activeTabId: appState.sidebars[sidebarId].activeTabId,
      };
    },
  );

  ipcMain.handle(
    "sidebar:activateTab",
    async (event, sidebarId: "left" | "right", tabId: string) => {
      const appState = getAppState(event);
      appState.sidebars[sidebarId].activeTabId = tabId;
      await saveState(appState);
      return { sidebarId, tabId };
    },
  );

  ipcMain.handle(
    "state:renameFile",
    async (event, oldPath: string, newName: string) => {
      const result = await renameFileOrDirectory(oldPath, newName);
      if (!result.success) {
        return result;
      }

      const newPath = result.data.path;
      const isDirectory = fsSync.statSync(newPath).isDirectory();
      const appState = getAppState(event);

      const updateTabsInLayout = (layout: PanelElement) => {
        if (layout.type === "panel") {
          layout.tabs.forEach((tab) => {
            if (!tab.source) return;
            if (tab.source === oldPath) {
              tab.source = newPath;
              tab.title = newName;
            } else if (isDirectory && tab.source.startsWith(oldPath + path.sep)) {
              const relativePath = tab.source.slice(oldPath.length);
              tab.source = newPath + relativePath;
            }
            // For folder rename: update all files under the folder
            else if (isDirectory && tab.source.startsWith(oldPath + path.sep)) {
              const relativePath = tab.source.slice(oldPath.length);
              tab.source = newPath + relativePath;
            }
            // For folder rename: update all files under the folder
            else if (isDirectory && tab.source.startsWith(oldPath + path.sep)) {
              const relativePath = tab.source.slice(oldPath.length);
              tab.source = newPath + relativePath;
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
      return { success: true, data: result.data };
    },
  );

  ipcMain.handle(
    "sidebar:registerSidebarTab",
    async (
      _,
      sidebarId: "left" | "right",
      tab: {
        extensionId: string;
        id: string;
        title: string;
      },
    ) => {
      const appState = getAppState();
      const newTab: SidebarTab = {
        id: crypto.randomUUID(),
        type: "custom",
        meta: {
          extensionId: tab.extensionId,
          customTabKey: tab.id,
        },
      };
      if (
        appState.sidebars[sidebarId].tabs.some(
          (t) => t.meta?.customTabKey === tab.id,
        )
      ) {
        return { sidebarId, tabId: newTab.id, alreadyExists: true };
      }
      if (!appState.sidebars[sidebarId].activeTabId) {
        appState.sidebars[sidebarId].activeTabId = newTab.id;
      }

      appState.sidebars[sidebarId].tabs.push(newTab);
      await saveState(appState);
      return { sidebarId, tabId: newTab.id };
    },
  );

  // Toggle history-related sidebar tabs (left: globalHistory, right: history) based on setting
  ipcMain.handle("sidebar:setHistoryEnabled", async (_event, enabled: boolean) => {
    // Guard against the startup race: this handler is invoked by the renderer's
    // useHistoryTabSync effect on mount, which can fire before initializeState()
    // registers the window state.  Return early instead of throwing so the UI
    // doesn't surface an unhandled-rejection error; the renderer re-applies the
    // setting whenever userSettings.onChange fires.
    let appState: ReturnType<typeof getAppState>;
    try {
      appState = getAppState();
    } catch {
      return { success: false };
    }

    if (enabled) {
      const hasGlobal = appState.sidebars.left.tabs.some((t: any) => t.type === "globalHistory");
      if (!hasGlobal) {
        appState.sidebars.left.tabs.push({ id: crypto.randomUUID(), type: "globalHistory" });
      }
      const hasHistory = appState.sidebars.right.tabs.some((t: any) => t.type === "history");
      if (!hasHistory) {
        appState.sidebars.right.tabs.push({ id: crypto.randomUUID(), type: "history" });
      }
    } else {
      appState.sidebars.left.tabs = appState.sidebars.left.tabs.filter((t: any) => t.type !== "globalHistory");
      appState.sidebars.right.tabs = appState.sidebars.right.tabs.filter((t: any) => t.type !== "history");
      if (!appState.sidebars.left.tabs.some((t: any) => t.id === appState.sidebars.left.activeTabId)) {
        appState.sidebars.left.activeTabId = appState.sidebars.left.tabs[0]?.id ?? null;
      }
      if (!appState.sidebars.right.tabs.some((t: any) => t.id === appState.sidebars.right.activeTabId)) {
        appState.sidebars.right.activeTabId = appState.sidebars.right.tabs[0]?.id ?? null;
      }
    }

    await saveState(appState);
    return { success: true };
  });

  ipcMain.handle(
    "tab:activate",
    async (event, panelId: string, tabId: string) => {
      return await activateTab(event, panelId, tabId);
    },
  );

  ipcMain.handle("state:getProjects", async (_event: IpcMainInvokeEvent) => {
    const appState = getAppState(_event);
    const voidenProjects = await findVoidenProjects();

    for (const projectPath of voidenProjects) {
      if (!appState.directories[projectPath]) {
        appState.directories[projectPath] = { layout: getDefaultLayout() };
      }
    }

    const normalizeProjectPath = (projectPath: string) => {
      let normalized = path.resolve(projectPath);
      normalized = normalized.replace(/[\\/]+$/, "");
      if (process.platform === "win32") {
        normalized = normalized.toLowerCase();
      }
      return normalized;
    };

    // Aggregate directories from all open windows so that projects opened
    // in other windows also appear in the Recent Projects list.
    const mergedEntries: Array<{ norm: string; projectPath: string; state: any }> = [];
    const upsertEntry = (projectPath: string, state: any, prefer: boolean) => {
      const norm = normalizeProjectPath(projectPath);
      const existingIndex = mergedEntries.findIndex((entry) => entry.norm === norm);
      if (existingIndex === -1) {
        mergedEntries.push({ norm, projectPath, state });
      } else if (prefer) {
        mergedEntries[existingIndex] = { norm, projectPath, state };
      }
    };

    for (const winState of windowManager.getAllWindows()) {
      if (winState) {
        for (const [projectPath, layoutState] of Object.entries(winState.directories)) {
          upsertEntry(projectPath, layoutState, false);
        }
      }
    }
    // Current window's state takes precedence (e.g. hidden flag set in this window)
    for (const [projectPath, layoutState] of Object.entries(appState.directories)) {
      upsertEntry(projectPath, layoutState, true);
    }

    const projects: string[] = [];
    let stateChanged = false;
    for (const entry of mergedEntries) {
      if (entry.state?.hidden) continue;
      try {
        const stat = await fs.stat(entry.projectPath);
        if (!stat.isDirectory()) {
          throw new Error("not a directory");
        }
        projects.push(entry.projectPath);
      } catch {
        if (appState.directories[entry.projectPath]) {
          delete appState.directories[entry.projectPath];
          stateChanged = true;
        }
        if (appState.activeDirectory === entry.projectPath) {
          appState.activeDirectory = "";
          stateChanged = true;
        }
      }
    }

    if (stateChanged) {
      await saveState(appState);
    }

    const activeProject = appState.activeDirectory;
    return {
      projects,
      activeProject,
    };
  });

  ipcMain.handle("settings:get", () => {
    return appSettings;
  });

  // New IPC endpoints using the extension manager:
  ipcMain.handle("extensions:getAll", async () => {
    // Guard against the startup race: extensionManager is set inside
    // initializeState() which is async. Return an empty array if called
    // before initialization completes; the renderer will retry.
    if (!extensionManager) return [];
    const localExtensions = await extensionManager.getAllExtensions();
    const remoteExtensions = await getRemoteExtensions();
    const mergedExtensions = localExtensions.map((ext) => {
      const remoteExt = remoteExtensions.find((r) => r.id === ext.id);
      if (remoteExt && remoteExt.version !== ext.version) {
        // Attach latestVersion if remote version differs from local version
        return { ...ext, latestVersion: remoteExt.version };
      }
      return ext;
    });
    return mergedExtensions;
  });

  ipcMain.handle("extensions:install", async (_, extension: ExtensionData) => {
    if (extension.type !== "community") {
      throw new Error("only community extensions can be installed");
    }
    await extensionManager.installCommunityExtension(extension);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { success: true };
  });

  ipcMain.handle("extensions:installFromZip", async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWindow!, {
      title: "Install Extension from Zip",
      filters: [{ name: "Zip Archives", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const ext = await extensionManager.installFromZip(result.filePaths[0]);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { success: true, extension: ext };
  });

  ipcMain.handle("extensions:uninstall", async (_, extensionId: string) => {
    const appState = getAppState();

    removeExtensionTabsFromLayout(appState.unsaved.layout, extensionId);

    for (const dir of Object.values(appState.directories)) {
      if (dir.layout) {
        removeExtensionTabsFromLayout(dir.layout, extensionId);
      }
    }

    removeExtensionTabsFromSidebars(appState.sidebars, extensionId);
    await extensionManager.uninstallCommunityExtension(extensionId);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { success: true };
  });

  ipcMain.handle(
    "extensions:setEnabled",
    async (_, extensionId: string, enabled: boolean) => {
      const appState = getAppState();
      const ext = appState.extensions.find((e) => e.id === extensionId);
      if (ext) {
        ext.enabled = enabled;
      }

      if (!enabled) {
        removeExtensionTabsFromLayout(appState.unsaved.layout, extensionId);

        for (const dir of Object.values(appState.directories)) {
          if (dir.layout) {
            removeExtensionTabsFromLayout(dir.layout, extensionId);
          }
        }

        removeExtensionTabsFromSidebars(appState.sidebars, extensionId);
      } else {
        const leftSidebar = appState.sidebars.left;
        const exists = leftSidebar.tabs.some(
          (tab) => tab.meta?.extensionId === extensionId,
        );
        if (!exists) {
          const newTab: SidebarTab = {
            id: crypto.randomUUID(),
            type: "custom",
            meta: { extensionId, customTabKey: extensionId },
          };
          if (!leftSidebar.activeTabId) {
            leftSidebar.activeTabId = newTab.id;
          }
          leftSidebar.tabs.push(newTab);
        }
      }

    await extensionManager.setExtensionEnabled(extensionId, enabled);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { extensionId, enabled };
  });

  ipcMain.handle(
    "state:setActiveProject",
    async (event, projectPath: string) => {
      if (!projectPath) {
        throw new Error("Project path is required");
      }

      if (windowManager.focusWindowByProject(projectPath)) {
        return;
      }
      await setActiveProject(projectPath);

      // Notify the renderer that the active project changed so it invalidates
      // its query cache (files:tree, git:status, app:state, etc.) immediately.
      // Without this the renderer keeps using the old activeDirectory until its
      // 30-second refetchInterval fires, causing stale git/file-tree checks.
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.webContents.send("folder:opened", { path: projectPath });
    },
  );

  ipcMain.handle("state:emptyActiveProject", async (_) => {
    await emptyActiveProject();
  });

  ipcMain.handle(
    "state:removeProjectFromList",
    async (_, projectPath: string) => {
      await removeProjectFromList(projectPath);
    },
  );

  ipcMain.handle(
    "state:addPanelTab",
    async (event, panelId: string, tab: Tab) => {
      return await addPanelTab(event, panelId, tab);
    },
  );

  ipcMain.handle("state:getOnboarding", async () => {
    return loadOnboardingState();
  });

  ipcMain.handle("state:updateOnboarding", async (event, onboarding) => {
    try {
      await saveOnboardingState(onboarding);
      const state = getAppState(event);
      state.onboarding = onboarding;
      return state;
    } catch (error) {
      throw error;
    }
  });

  ipcMain.handle(
    "state:activatePanelTab",
    async (_, panelId: string, tabId: string) => {
      const appState = getAppState();
      const layout = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;

      if (!layout) {
        throw new Error("No layout found to activate tab.");
      }

      const updated = activateTabInLayout(layout, panelId, tabId);
      if (!updated) {
        throw new Error(
          `Panel with id ${panelId} or tab with id ${tabId} not found.`,
        );
      }
      await saveState(appState);
      return { panelId, tabId };
    },
  );

  ipcMain.handle(
    "extensions:openDetails",
    async (_, extension: ExtensionData) => {
      const appState = getAppState();
      const layout = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;
      if (!layout) throw new Error("No layout found to open tab.");

      const tab: Tab = {
        id: `extensionDetails-${extension.id}`,
        type: "extensionDetails",
        title: extension.name,
        source: extension.id,
        directory: null,
        meta: { extensionId: extension.id },
      };

      const existingTab = findTabInPanel(layout, "main", tab);
      if (existingTab) {
        activateTabInLayout(layout, "main", existingTab.id);
        await saveState(appState);
        return { tabId: existingTab.id, alreadyExists: true };
      }

      const added = addTabToPanel(layout, "main", tab);
      if (!added) throw new Error("Main panel not found.");
      activateTabInLayout(layout, "main", tab.id);
      await saveState(appState);
      return { tabId: tab.id, alreadyExists: false };
    },
  );

  ipcMain.handle("extensions:update", async (_, extensionId: string) => {
    const appState = getAppState();
    const ext = appState.extensions.find((e) => e.id === extensionId);
    if (!ext) {
      throw new Error(`Extension ${extensionId} not found`);
    }
    if (ext.type !== "community") {
      throw new Error("Only community extensions can be updated");
    }
    const remoteExtensions = await getRemoteExtensions();
    const remoteExt = remoteExtensions.find((r) => r.id === extensionId);
    if (!remoteExt) {
      throw new Error(`Remote extension for ${extensionId} not found`);
    }
    if (remoteExt.version === ext.version) {
      return { success: true, updatedExtension: ext };
    }
    const updatedExtension =
      await extensionManager.installCommunityExtension(remoteExt);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { success: true, updatedExtension };
  });

  ipcMain.handle("terminal:new", async (event, panelId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) as any;
    const windowId = win?.windowInfo?.id as string | undefined;
    const appState = getAppState(event);
    const layout = appState.activeDirectory
      ? appState.directories[appState.activeDirectory]?.layout
      : appState.unsaved.layout;

    if (!layout) {
      throw new Error("No layout found to add terminal tab.");
    }

    const defaultCwd = appState.activeDirectory || os.homedir();

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: "terminal",
      title: "Terminal",
      source: null,
      directory: defaultCwd,
    };

    addTabToPanel(layout, panelId, newTab);
    activateTabInLayout(layout, panelId, newTab.id);
    await saveState(appState, windowId);
    return { panelId, tabId: newTab.id, cwd: defaultCwd };
  });

  ipcMain.handle(
    "state:closePanelTab",
    async (
      _,
      panelId: string,
      tabId: string,
      unsavedContent?: string, // passed from the renderer if the document is "dirty"
    ) => {
      const appState = getAppState();
      const layout =
        appState.activeDirectory &&
        appState.directories[appState.activeDirectory]
          ? appState.directories[appState.activeDirectory].layout
          : appState.unsaved.layout;
      if (!layout) {
        throw new Error("No layout found to close tab.");
      }

      const closingTab = findTabById(layout, panelId, tabId);
      if (!closingTab) {
        throw new Error(`Tab with id ${tabId} not found in panel ${panelId}.`);
      }

      if (closingTab.type === "document" && unsavedContent) {
        const locked = await isClosingTabInLockedProject(appState, closingTab);
        if (locked) {
          const cancelId = 1;
          const result = await dialog.showMessageBox({
            type: "warning",
            buttons: ["Discard", "Cancel"],
            defaultId: 0,
            cancelId,
            title: "Project Locked",
            message: `Discard unsaved changes to ${closingTab.title}?`,
            detail:
              "The project is locked, so these changes can't be saved. Closing the tab will discard them.",
          });
          if (result.response === cancelId) {
            return { canceled: true };
          }
        } else {
          const cancelId = 2;
          const defaultId = 0;
          const result = await dialog.showMessageBox({
            type: "warning",
            buttons: ["Save", "Don't Save", "Cancel"],
            defaultId,
            cancelId,
            title: "Unsaved Changes",
            message: `Do you want to save changes made to ${closingTab.title}?`,
            detail: "Your changes will be lost if you don't save them.",
          });

          if (result.response === cancelId) {
            return { canceled: true };
          }

          if (result.response === defaultId) {
            const success = await saveDocument(closingTab, unsavedContent);
            if (!success) {
              return { canceled: true };
            }
          }
        }
      }

      if (closingTab.type === "terminal" && closingTab.source) {
        killTerminal(closingTab.source);
      }

      if (closingTab.type === "document" && !closingTab.source) {
        await deleteAutosaveFile(tabId);
      }

      const removed = removeTabFromPanel(layout, panelId, tabId);
      if (!removed) {
        throw new Error(
          `Failed to remove tab with id ${tabId} from panel ${panelId}.`,
        );
      }
      await saveState(appState);
      return { panelId, tabId };
    },
  );
  ipcMain.handle(
    "state:closePanelTabs",
    async (
      _,
      panelId: string,
      tabs: Array<{ tabId: string; unsavedContent?: string }>,
    ) => {
      const appState = getAppState();
      const layout =
        appState.activeDirectory &&
        appState.directories[appState.activeDirectory]
          ? appState.directories[appState.activeDirectory].layout
          : appState.unsaved.layout;
      if (!layout) {
        throw new Error("No layout found to close tabs.");
      }

      const closedTabs: Array<{ panelId: string; tabId: string }> = [];
      const canceledTabs: Array<{ panelId: string; tabId: string }> = [];

      for (const tabInfo of tabs) {
        const { tabId, unsavedContent } = tabInfo;

        const closingTab = findTabById(layout, panelId, tabId);
        if (!closingTab) {
          console.warn(`Tab with id ${tabId} not found in panel ${panelId}.`);
          continue;
        }

        let shouldClose = true;

        if (closingTab.type === "document" && unsavedContent) {
          const locked = await isClosingTabInLockedProject(appState, closingTab);
          if (locked) {
            const result = await dialog.showMessageBox({
              type: "warning",
              buttons: ["Discard", "Cancel"],
              defaultId: 0,
              cancelId: 1,
              title: "Project Locked",
              message: `Discard unsaved changes to ${closingTab.title}?`,
              detail:
                "The project is locked, so these changes can't be saved. Closing the tab will discard them.",
            });
            if (result.response === 1) {
              canceledTabs.push({ panelId, tabId });
              shouldClose = false;
              continue;
            }
          } else {
            const result = await dialog.showMessageBox({
              type: "warning",
              buttons: ["Save", "Don't Save", "Cancel"],
              defaultId: 0,
              cancelId: 2,
              title: "Unsaved Changes",
              message: `Do you want to save changes made to ${closingTab.title}?`,
              detail: "Your changes will be lost if you don't save them.",
            });

            if (result.response === 2) {
              canceledTabs.push({ panelId, tabId });
              shouldClose = false;
              continue;
            }

            if (result.response === 0) {
              const success = await saveDocument(closingTab, unsavedContent);
              if (!success) {
                canceledTabs.push({ panelId, tabId });
                shouldClose = false;
                continue;
              }
            }
          }
        }

        if (shouldClose) {
          if (closingTab.type === "terminal" && closingTab.source) {
            killTerminal(closingTab.source);
          }

          if (closingTab.type === "document" && !closingTab.source) {
            await deleteAutosaveFile(tabId);
          }

          const removed = removeTabFromPanel(layout, panelId, tabId);
          if (!removed) {
            console.warn(`Failed to remove tab with id ${tabId} from panel ${panelId}.`);
            canceledTabs.push({ panelId, tabId });
          } else {
            closedTabs.push({ panelId, tabId });
          }
        }
      }

      if (closedTabs.length > 0) {
        await saveState(appState);
      }

      return {
        panelId,
        closedTabs,
        canceledTabs,
        allClosed: canceledTabs.length === 0,
      };
    },
  );

  ipcMain.handle(
    "state:duplicatePanelTab",
    async (_event, panelId: string, tabId: string) => {
      const appState = getAppState();
      const layout = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;
      if (!layout) throw new Error("No layout found to duplicate tab");
      const original = findTabById(layout, panelId, tabId);
      if (!original)
        throw new Error(`Tab ${tabId} not found in panel ${panelId}`);
      // Generate unique newTitle and newSource with -copy, -copy-2, etc.
      const origTitle = original.title;
      const dotIndex = origTitle.lastIndexOf(".");
      const baseName = dotIndex >= 0 ? origTitle.slice(0, dotIndex) : origTitle;
      const ext = dotIndex >= 0 ? origTitle.slice(dotIndex) : "";
      let newTitle: string;
      let newSource: string | null = null;
      let count = 1;
      while (true) {
        const suffix = count === 1 ? "-copy" : `-copy-${count}`;
        newTitle = `${baseName}${suffix}${ext}`;
        newSource = original.source
          ? path.join(path.dirname(original.source), newTitle)
          : null;
        if (!newSource) break;
        try {
          await fs.access(newSource);
          count++;
        } catch {
          break;
        }
      }
      // Copy the original file on disk to the new path so the duplicate is available
      if (original.source && newSource) {
        await fs.copyFile(original.source, newSource);
      }
      const newTab: Tab = {
        ...original,
        id: crypto.randomUUID(),
        title: newTitle,
        source: newSource,
      };
      const added = addTabToPanel(layout, panelId, newTab);
      if (!added)
        throw new Error(`Failed to duplicate tab in panel ${panelId}`);
      await saveState(appState);
      if (newSource) {
        _event.sender.send("file:duplicate", {
          path: newSource,
          name: newTitle,
        });
      }
      return { panelId, tabId: newTab.id };
    },
  );

  ipcMain.handle(
    "state:reloadPanelTab",
    async (_event, panelId: string, tabId: string) => {
      return { panelId, tabId };
    },
  );

  ipcMain.handle(
    "state:reorder-tabs",
    async (_event, panelId: string, tabs: any[]) => {
      const appState = getAppState();
      const layout = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;
      if (!layout) {
        return;
      }
      reorderTabs(layout, panelId, tabs);
      await saveState(appState);
    },
  );

  ipcMain.handle(
    "fileLink:open",
    async (_event, filePath: string, filename: string) => {
      const appState = getAppState();

      const layout: PanelElement = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;

      if (!layout) {
        throw new Error("No layout available to open file.");
      }

      const findDocumentTab = (layout: PanelElement): Tab | null => {
        if (layout.type === "panel") {
          return (
            layout.tabs.find(
              (tab) => tab.type === "document" && tab.source === filePath,
            ) || null
          );
        } else if (layout.type === "group") {
          for (const child of layout.children) {
            const found = findDocumentTab(child);
            if (found) return found;
          }
        }
        return null;
      };

      const existingTab = findDocumentTab(layout);
      if (existingTab) {
        activateTabInLayout(layout, "main", existingTab.id);
        await saveState(appState);
        return { tabId: existingTab.id, opened: false };
      } else {
        const newTab: Tab = {
          id: crypto.randomUUID(),
          type: "document",
          title: filename || "Untitled",
          source: filePath,
          directory: null,
        };
        if (!addTabToPanel(layout, "main", newTab)) {
          throw new Error("Failed to add new tab to panel 'main'");
        }
        activateTabInLayout(layout, "main", newTab.id);
        await saveState(appState);
        return { tabId: newTab.id, opened: true };
      }
    },
  );

  ipcMain.handle("fileLink:exists", async (_event, absolutePath: string) => {
    try {
      await fs.access(absolutePath);
      return true;
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle(
    "file:duplicate",
    async (_, filePath: string, newName: string) => {
      const result = await renameFileOrDirectory(filePath, newName);
      if (!result.success) {
        return result;
      }
      const newPath = result.data.path;
      windowManager.browserWindow?.webContents.send("file:duplicate", {
        path: newPath,
        name: result.data.name,
      });
      return { success: true, data: result.data };
    },
  );

  // Auto-save handlers for unsaved files
  ipcMain.handle("autosave:save", async (_, tabId: string, content: string) => {
    await saveAutosaveFile(tabId, content);
    return { success: true };
  });

  ipcMain.handle("autosave:load", async (_, tabId: string) => {
    const content = await loadAutosaveFile(tabId);
    return { content };
  });

  ipcMain.handle("autosave:delete", async (_, tabId: string) => {
    await deleteAutosaveFile(tabId);
    return { success: true };
  });
};
