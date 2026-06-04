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
import { getRemoteExtensions, fetchReadme, fetchChangelog, fetchManifest } from "./extension/extensionFetcher";
import { migratePluginPaths, coreCacheDir, communityDir } from "./extension/paths";
import { fetchAndUpdateCoreRegistry, coreExtensions, remoteNewPlugins } from "./config/coreExtensions";
import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from "electron";
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
import { reloadMainProcessExtension } from "./extensionLoader";
import { logger } from "./logger";

function maybeRecomposeSkills(state: AppState): void {
  const skills = getSettings().skills;
  if (skills?.claude || skills?.codex) {
    recomposeAndInstall(state, { claude: skills.claude ?? false, codex: skills.codex ?? false }).catch(() => {});
  }
}

let appState: AppState;
let appSettings: AppSettings;
export let extensionManager: ExtensionManager;

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

  await migratePluginPaths();

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
        // Final fallback: core registry in-memory array (populated by fetchRegistry).
        // Covers the case where syncCoreExtensions ran after the tab was opened.
        if (!extension) {
          extension = coreExtensions.find(
            (ext) => ext.id === tab.meta!.extensionId,
          );
        }
        // Also check remoteNewPlugins — plugins visible in the browser that aren't
        // in the local snapshot yet (e.g. when the registry JSON failed to load).
        if (!extension) {
          extension = remoteNewPlugins.find(
            (ext) => ext.id === tab.meta!.extensionId,
          ) as typeof extension;
        }
        // Last resort: read installed.json directly — handles the startup race where
        // loadInstalledCommunityExtensions hasn't populated appState.extensions yet.
        if (!extension) {
          try {
            const raw = await fs.readFile(path.join(communityDir(), "installed.json"), "utf8");
            const installed: any[] = JSON.parse(raw);
            const found = installed.find((e) => e.id === tab.meta!.extensionId);
            if (found) {
              // Enrich with on-disk manifest so readme/capabilities are current
              try {
                const manifestRaw = await fs.readFile(
                  path.join(communityDir(), found.id, "manifest.json"), "utf8"
                );
                const manifest = JSON.parse(manifestRaw);
                extension = {
                  ...found,
                  readme: manifest.readme || found.readme || "",
                  capabilities: manifest.capabilities || found.capabilities,
                  features: manifest.features || found.features,
                  icon: manifest.icon || found.icon,
                };
              } catch {
                extension = found;
              }
            }
          } catch { /* installed.json not readable — fall through */ }
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
    return await extensionManager.getAllExtensions();
  });

  ipcMain.handle("extensions:updateCoreMeta", (_event, pluginId: string, meta: Record<string, any>) => {
    if (!extensionManager) return;
    extensionManager.updateCoreExtensionMeta(pluginId, meta);
  });

  ipcMain.handle("extensions:install", async (_, extension: ExtensionData) => {
    if (extension.type !== "community") {
      throw new Error("only community extensions can be installed");
    }
    const installed = await extensionManager.installCommunityExtension(extension);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    reloadMainProcessExtension(installed).catch(() => {});
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
    reloadMainProcessExtension(ext).catch(() => {});
    return { success: true, extension: ext };
  });

  // Dev plugin: install directly from a known path (used by plugin dev toolbar — no folder picker).
  ipcMain.handle("extensions:devInstallFromPath", async (event, sourcePath: string) => {
    try {
      const state = getAppState(event);
      const ext = await extensionManager.installDevExtension(sourcePath);
      await saveState(state);
      reloadMainProcessExtension(ext).catch(() => {});
      return { success: true, extension: ext };
    } catch (e: any) {
      return { success: false, error: e.message ?? "Unknown error", details: e.stack ?? "" };
    }
  });

  // Dev plugin: open a folder picker and install directly from the chosen directory.
  ipcMain.handle("extensions:devInstall", async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWindow!, {
      title: "Select Plugin Project Directory",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    try {
      const ext = await extensionManager.installDevExtension(result.filePaths[0]);
      await saveState(appState);
      reloadMainProcessExtension(ext).catch(() => {});
      return { success: true, extension: ext };
    } catch (e: any) {
      return { success: false, error: e.message ?? "Unknown error", details: e.stack ?? "" };
    }
  });

  // Dev plugin: scaffold a new plugin project directly (no external CLI, no prompts, instant).
  ipcMain.handle(
    "extensions:devScaffold",
    async (_, { name, parentDir }: { name: string; parentDir: string }) => {
      try {
        const pluginId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-plugin";
        const projectDir = path.join(parentDir, pluginId);
        const srcDir = path.join(projectDir, "src");
        await fs.mkdir(srcDir, { recursive: true });

        // manifest.json at root (also read by build script)
        await fs.writeFile(
          path.join(projectDir, "manifest.json"),
          JSON.stringify({
            id: pluginId,
            name,
            description: "",
            version: "1.0.0",
            voidenVersion: ">=2.0.0",
            author: "",
            icon: "Plug",
            type: "community",
            priority: 30,
            permissions: [],
            capabilities: {},
            features: [],
          }, null, 2)
        );

        // src/plugin.ts — entry point
        const fnSuffix = name.replace(/[^a-zA-Z0-9]/g, "") || "Plugin";
        await fs.writeFile(
          path.join(srcDir, "plugin.ts"),
`import type { CorePluginContext } from '@voiden/sdk/ui';
import manifest from '../manifest.json';

export default function create${fnSuffix}(context: CorePluginContext) {
  return {
    onload: async () => {
      // Register your plugin functionality here
    },

    onunload: async () => {
      // Clean up subscriptions and listeners here
    },

    metadata: manifest,
  };
}
`
        );

        // src/voiden.d.ts — compile-time stubs for all packages shimmed by Voiden at runtime.
        // react, react-dom, and @voiden/sdk are ALL provided via window.__voiden_shims__
        // when the plugin is loaded, so none of them need to be installed from npm.
        await fs.writeFile(
          path.join(srcDir, "voiden.d.ts"),
`// ── Voiden runtime shims ──────────────────────────────────────────────────────
// These packages are injected by Voiden at runtime via window.__voiden_shims__.
// They are externalized from the build and must NOT be installed from npm.

declare module 'react' {
  export = React;
  export as namespace React;
  namespace React {
    type ReactNode = any;
    type FC<P = {}> = (props: P) => ReactNode;
    type CSSProperties = { [key: string]: any };
    function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
    function useEffect(fn: () => void | (() => void), deps?: any[]): void;
    function useRef<T>(init?: T): { current: T };
    function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
    function useMemo<T>(fn: () => T, deps: any[]): T;
    function useContext<T>(ctx: React.Context<T>): T;
    function createContext<T>(def: T): Context<T>;
    function createElement(type: any, props?: any, ...children: any[]): ReactNode;
    function forwardRef<T, P>(fn: (props: P, ref: any) => ReactNode): FC<P & { ref?: any }>;
    function memo<T extends FC<any>>(fn: T): T;
    interface Context<T> { Provider: FC<{ value: T; children?: ReactNode }> }
    [key: string]: any;
  }
}

declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react/jsx-dev-runtime' { export const jsxDEV: any; export const Fragment: any; }

declare module 'react-dom' {
  export function render(element: any, container: Element): void;
  export function unmountComponentAtNode(container: Element): boolean;
  export function createPortal(children: any, container: Element): any;
  export const version: string;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element): { render(el: any): void; unmount(): void };
}

declare module '@voiden/sdk/ui' {
  export interface CorePluginContext {
    registerVoidenExtension: (ext: any) => void;
    addVoidenSlashGroup: (group: any) => void;
    registerSidebarTab: (opts: any) => void;
    registerCommand: (opts: any) => void;
    registerContextMenu: (opts: any) => void;
    events: { on: (event: string, handler: (...args: any[]) => void) => () => void };
    fs: { read: (p: string) => Promise<string>; write: (p: string, content: string) => Promise<void>; [k: string]: any };
    settings: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void>; [k: string]: any };
    ui: { registerSettings: (opts: any) => void; [k: string]: any };
    [key: string]: any;
  }
}

declare module '@voiden/sdk' { export * from '@voiden/sdk/ui'; }
`
        );

        // package.json — only vite + typescript needed; @voiden/sdk is shimmed by Voiden at runtime
        await fs.writeFile(
          path.join(projectDir, "package.json"),
          JSON.stringify({
            name: pluginId,
            version: "1.0.0",
            type: "module",
            scripts: {
              build: "node build.mjs",
              zip: "node zip.mjs",
            },
            devDependencies: {
              vite: "^6.0.0",
              typescript: "^5.0.0",
            },
          }, null, 2)
        );

        // tsconfig.json
        await fs.writeFile(
          path.join(projectDir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              target: "ES2020",
              module: "ESNext",
              moduleResolution: "bundler",
              jsx: "react-jsx",
              strict: true,
              declaration: true,
              resolveJsonModule: true,
            },
            include: ["src/**/*", "manifest.json"],
          }, null, 2)
        );

        // build.mjs — Vite build, copies manifest.json to dist/
        await fs.writeFile(
          path.join(projectDir, "build.mjs"),
`import { build } from 'vite';
import { readFileSync, copyFileSync, mkdirSync } from 'fs';

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'));
const pluginId = manifest.id;

// All packages listed here are provided by Voiden's shim system at runtime.
// They must be externalized — do NOT bundle them.
const VOIDEN_SHIMS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@voiden/sdk',
  '@voiden/sdk/ui',
];

await build({
  build: {
    lib: {
      entry: './src/plugin.ts',
      formats: ['es'],
      fileName: () => \`\${pluginId}.js\`,
    },
    outDir: './dist',
    rollupOptions: {
      external: VOIDEN_SHIMS,
    },
  },
});

mkdirSync('./dist', { recursive: true });
copyFileSync('./manifest.json', './dist/manifest.json');
console.log(\`Built \${pluginId} → dist/\${pluginId}.js\`);
`
        );

        // changelog.json
        await fs.writeFile(
          path.join(projectDir, "changelog.json"),
          JSON.stringify([{
            version: "1.0.0",
            date: new Date().toISOString().split("T")[0],
            changes: ["Initial release"],
          }], null, 2)
        );

        return { success: true, projectPath: projectDir, pluginId };
      } catch (e: any) {
        return { success: false, error: e.message ?? "Scaffold failed", details: e.stack ?? "" };
      }
    }
  );

  // Dev plugin: check whether a directory looks like a valid plugin project.
  ipcMain.handle("pluginDev:checkProject", (_, dirPath: string) => {
    try {
      const manifestPath = path.join(dirPath, "manifest.json");
      const pkgPath = path.join(dirPath, "package.json");
      if (!fsSync.existsSync(manifestPath) || !fsSync.existsSync(pkgPath)) return { isPlugin: false };
      const manifest = JSON.parse(fsSync.readFileSync(manifestPath, "utf8"));
      const pkg = JSON.parse(fsSync.readFileSync(pkgPath, "utf8"));
      if (!manifest.id || !manifest.name || !manifest.version) return { isPlugin: false };
      if (!pkg.scripts?.build) return { isPlugin: false };
      return { isPlugin: true, pluginId: manifest.id as string, pluginName: manifest.name as string };
    } catch {
      return { isPlugin: false };
    }
  });

  // Dev plugin: open a new Voiden window to preview the loaded dev extension.
  ipcMain.handle("extensions:devOpenPreviewWindow", async () => {
    await windowManager.createWindow();
    return { success: true };
  });

  // Dev plugin: run npm run build in the plugin source directory, streaming output line-by-line.
  ipcMain.handle("pluginDev:build", async (event, sourcePath: string) => {
    const { spawn } = await import("child_process");
    const sender = event.sender;

    const runStep = (args: string[]): Promise<{ success: boolean; error?: string; output: string }> =>
      new Promise((resolve) => {
        const proc = spawn("npm", args, {
          cwd: sourcePath,
          shell: true,
          env: { ...process.env, FORCE_COLOR: "0" },
        });
        let output = "";
        const collect = (d: Buffer) => {
          const text = d.toString();
          output += text;
          text.split("\n").forEach((l) => { if (l.trim() && !sender.isDestroyed()) sender.send("pluginDev:buildOutput", l); });
        };
        proc.stdout?.on("data", collect);
        proc.stderr?.on("data", collect);
        proc.on("close", (code) => resolve(code === 0 ? { success: true, output } : { success: false, error: `exited with code ${code}`, output }));
        proc.on("error", (err: Error) => resolve({ success: false, error: err.message, output }));
      });

    // Step 1: npm install — --legacy-peer-deps avoids eresolve conflicts from npm 7+
    const installResult = await runStep(["install", "--legacy-peer-deps"]);
    if (!installResult.success) {
      return { success: false, error: `npm install failed: ${installResult.error}` };
    }

    // Step 2: npm run build
    const buildResult = await runStep(["run", "build"]);
    return buildResult.success
      ? { success: true }
      : { success: false, error: `npm run build failed: ${buildResult.error}` };
  });

  // Dev plugin: re-read files from the original source directory and reinstall.
  ipcMain.handle("extensions:devReload", async (_, extensionId: string) => {
    const state = getAppState();
    const ext = state.extensions.find((e) => e.id === extensionId && e.isDev);
    if (!ext?.devSourcePath) {
      return { success: false, error: "Extension not found or not a dev extension." };
    }
    try {
      const reloaded = await extensionManager.installDevExtension(ext.devSourcePath);
      await saveState(state);
      reloadMainProcessExtension(reloaded).catch(() => {});
      return { success: true, extension: reloaded };
    } catch (e: any) {
      return { success: false, error: e.message ?? "Unknown error", details: e.stack ?? "" };
    }
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

  ipcMain.handle("extensions:uninstallCore", async (_, pluginId: string) => {
    const appState = getAppState();
    removeExtensionTabsFromLayout(appState.unsaved.layout, pluginId);
    for (const dir of Object.values(appState.directories)) {
      if (dir.layout) removeExtensionTabsFromLayout(dir.layout, pluginId);
    }
    removeExtensionTabsFromSidebars(appState.sidebars, pluginId);
    await extensionManager.uninstallCoreExtension(pluginId);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { success: true };
  });

  ipcMain.handle("extensions:reinstallCore", async (_, pluginId: string) => {
    const appState = getAppState();
    await extensionManager.reinstallCoreExtension(pluginId);
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
    // Re-sync core extensions so isLocallyAvailable is refreshed (e.g. after OTA install).
    const targetExt = appState.extensions.find((e) => e.id === extensionId);
    if (targetExt?.type === "core") {
      extensionManager.syncCoreExtensions();
    }
    // Reload (or unload) the main-process bundle immediately — no restart needed.
    const freshExt = appState.extensions.find((e) => e.id === extensionId);
    if (freshExt) {
      reloadMainProcessExtension(freshExt).catch((err) =>
        logger.warn("plugin", `[state] Failed to reload main-process for ${extensionId}`, { error: String(err) })
      );
    }
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
    reloadMainProcessExtension(updatedExtension).catch(() => {});
    return { success: true, updatedExtension };
  });

  ipcMain.handle("extensions:fetchReadme", async (_, repo: string): Promise<string> => {
    return fetchReadme(repo);
  });

  ipcMain.handle("extensions:fetchChangelog", async (_, pluginId: string, repo: string): Promise<any[] | null> => {
    // Check local disk first — core cache then community install dir
    for (const localPath of [
      path.join(coreCacheDir(), pluginId, "changelog.json"),
      path.join(communityDir(), pluginId, "changelog.json"),
    ]) {
      if (fsSync.existsSync(localPath)) {
        try {
          const raw = await fs.readFile(localPath, "utf8");
          return JSON.parse(raw);
        } catch {}
      }
    }
    return fetchChangelog(repo);
  });

  ipcMain.handle("extensions:fetchManifest", async (_, pluginId: string, repo: string): Promise<Record<string, any> | null> => {
    // For installed community plugins, read from disk (already has the manifest)
    const localPath = path.join(communityDir(), pluginId, "manifest.json");
    if (fsSync.existsSync(localPath)) {
      try {
        const raw = await fs.readFile(localPath, "utf8");
        return JSON.parse(raw);
      } catch {}
    }
    // For uninstalled: fetch from the plugin's latest GitHub release
    return fetchManifest(repo);
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
