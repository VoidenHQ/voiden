import fs from "fs/promises";
import {
  AppSettings,
  AppState,
  ExtensionData,
  PanelElement,
  SidebarTab,
} from "src/shared/types";
import { Tab } from "src/shared/types";
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
} from "./persistState";
import { renameFileOrDirectory, findVoidenProjects } from "./fileSystem";
import { killTerminal } from "./terminal";
import eventBus from "./eventBus";
import os from "os";
import path from "path";
import { updateFileWatcher } from "./fileWatcher";
import { windowManager } from "./windowManager";
import { getSettings } from "./settings";
import { recomposeAndInstall } from "./skillsInstaller";

function maybeRecomposeSkills(state: AppState): void {
  const skills = getSettings().skills;
  if (skills?.claude || skills?.codex) {
    recomposeAndInstall(state, { claude: skills.claude ?? false, codex: skills.codex ?? false }).catch(() => {});
  }
}

// Declare global state variables.
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
// Initialize state and settings on startup.
export const initializeState = async (
  skipDefault?: boolean,
): Promise<AppState> => {
  appState = await loadState(skipDefault);

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

  // Initialize extension manager after the state is loaded.
  extensionManager = new ExtensionManager(appState);
  await extensionManager.loadInstalledCommunityExtensions();

  // Save state after syncing extensions to persist any new core extensions
  await saveState(appState);

  // Initialize file watcher if an active project exists in state.
  if (appState.activeDirectory) {
    // console.debug("Initializing file watcher for active project:", appState.activeDirectory);
    await updateFileWatcher(
      appState.activeDirectory,
      windowManager.activeWindowId as string,
    );
  }

  // Collect all tab IDs from the state for cleanup
  const activeTabIds = new Set<string>();

  // Helper to collect tab IDs from a layout
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

  // Collect from all directory layouts
  Object.values(appState.directories).forEach((dir) => {
    if (dir.layout) collectTabIds(dir.layout);
  });

  // Collect from unsaved layout
  if (appState.unsaved?.layout) {
    collectTabIds(appState.unsaved.layout);
  }

  // Clean up autosaved files that are no longer referenced
  await cleanupAutosaveFiles(activeTabIds);

  return appState;
};

// Update getAppState to return the loaded state.
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
  // it's a group so loop its children
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
      // Optionally, check if the tab exists in this panel before activating.
      const tabExists = layout.tabs.some((tab) => tab.id === tabId);
      if (!tabExists) {
        // console.error(`Tab with id ${tabId} not found in panel ${panelId}`);
        return false;
      }
      layout.activeTabId = tabId;
      return true;
    }
    return false;
  }
  // For a group, iterate over its children.
  for (const child of layout.children) {
    if (activateTabInLayout(child, panelId, tabId)) {
      return true;
    }
  }
  return false;
}

// Add these helper functions at the top level
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

// Add this helper function at the top level
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
    // Filter out any tabs that were created by the extension.
    const remainingTabs = layout.tabs.filter(
      (tab) => !(tab.meta?.extensionId === extensionId),
    );
    // Update the panel's tabs.
    layout.tabs = remainingTabs;
    // If the current activeTabId no longer exists in the filtered list,
    // update it to the first available tab (or null if none exist).
    if (!remainingTabs.some((tab) => tab.id === layout.activeTabId)) {
      layout.activeTabId =
        remainingTabs.length > 0 ? remainingTabs[0].id : null;
    }
  } else if (layout.type === "group") {
    // Recursively update all children.
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
    // Update activeTabId if the current active tab was removed.
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

async function saveDocument(
  closingTab: any,
  unsavedContent: string,
): Promise<boolean> {
  if (closingTab.source) {
    // If we already have a file path, save directly.
    try {
      await fs.writeFile(closingTab.source, unsavedContent, "utf8");
      return true;
    } catch (error) {
      // console.error("Error saving file:", error);
      return false;
    }
  } else {
    // No file path available, so ask the user where to save via a "Save As" dialog.
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save Document",
      defaultPath: closingTab.title, // use the current title as a default file name
    });
    if (!canceled && filePath) {
      try {
        await fs.writeFile(filePath, unsavedContent, "utf8");
        // Optionally update the tab metadata with the new file path and title.
        closingTab.source = filePath;
        closingTab.title = filePath.split(/[\\/]/).pop() || closingTab.title;
        return true;
      } catch (error) {
        // console.error("Error saving file:", error);
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

  // Update the file watcher:
  // If projectPath is an empty string or null, the watcher will be closed.

  await updateFileWatcher(projectPath || null);

  return { activeProject: projectPath };
}

export async function emptyActiveProject() {
  const appState = getAppState();
  appState.activeDirectory = "";
  await saveState(appState);
  // Update the file watcher:
  // If projectPath is an empty string or null, the watcher will be closed.
  await updateFileWatcher("");
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
  // 1. Get the active directory (if applicable).
  const activeDirectory = await getActiveProject();

  // 2. Retrieve the current app state and determine the layout.
  const appState = getAppState();
  const layout = appState.activeDirectory
    ? appState.directories[appState.activeDirectory]?.layout
    : appState.unsaved.layout;

  if (!layout) {
    // console.error("No layout found.");
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
      title: fileName, // Default title until saved.
      source: null, // No file path yet since we're not writing to disk.
      directory: activeDirectory,
    };
    return newTab;
  };
  // 3. Create a new Tab object for the document without creating a file on disk.
  const newTab: Tab = createNewTabWithIncrement();

  // 4. Add the new tab to the main panel and activate it.
  addTabToPanel(layout, "main", newTab);
  activateTabInLayout(layout, "main", newTab.id);

  // 5. Save the updated application state.
  await saveState(appState);

  // 6. Emit an event indicating a new document tab has been created.
  windowManager.browserWindow?.webContents.send("file:newTab", { tab: newTab });
  // eventBus.emitEvent("file:newTab", { tab: newTab });
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

  // Check if tab already exists
  const existingTab = findTabInPanel(layout, panelId, tab);
  if (existingTab) {
    return { tabId: existingTab.id, alreadyExists: true };
  }

  // Add new tab
  const added = addTabToPanel(layout, panelId, tab);
  if (!added) {
    throw new Error(`Panel with id ${panelId} not found.`);
  }

  // Save the updated state to file.
  await saveState(state);
  return { tabId: tab.id, alreadyExists: false, panelId };
}

export async function activateTab(
  event: IpcMainInvokeEvent | undefined,
  panelId: string,
  tabId: string,
): Promise<any> {
  const appState = getAppState(event);

  // Determine which layout to update (active directory or unsaved)
  const layout = appState.activeDirectory
    ? appState.directories[appState.activeDirectory]?.layout
    : appState.unsaved.layout;

  if (!layout) {
    throw new Error("No layout found to update the active tab.");
  }

  // Attempt to activate the tab in the layout.
  const updated = activateTabInLayout(layout, panelId, tabId);
  if (!updated) {
    throw new Error(
      `Panel with id ${panelId} or tab with id ${tabId} not found.`,
    );
  }

  // Optionally, you can log or return the updated layout.
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
    // Get the window that sent the IPC call.
    const browserWindow = BrowserWindow.fromWebContents(event.sender);

    // Open a native dialog using the default path provided.
    const result = await dialog.showOpenDialog(browserWindow, {
      defaultPath, // e.g. "~/" passed from the renderer
      properties: ["openDirectory", "createDirectory"],
    });

    // If the user did not cancel and selected a folder...
    if (!result.canceled && result.filePaths.length > 0) {
      const projectPath = result.filePaths[0];

      if (windowManager.focusWindowByProject(projectPath)) {
        return;
      }
      // Set the active project (your existing logic)
      await setActiveProject(projectPath);

      // Emit an event to notify renderers that the folder has been opened.
      windowManager.browserWindow?.webContents.send("folder:opened", {
        path: projectPath,
      });
      // eventBus.emitEvent("folder:opened", { path: projectPath });

      // Return the selected path back to the renderer.
      return projectPath;
    } else {
      // Optionally, you can either return a value indicating cancellation or throw an error.
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
      case "document": {
        if (!source) {
          // Try to load autosaved content for unsaved files
          const autosavedContent = await loadAutosaveFile(tabId);
          // Autosaved content is already in JSON format (editor's getJSON output)
          // We need to return it as-is, not as a string
          return {
            type: "document",
            tabId,
            title,
            content: autosavedContent || "",
            isAutosaved: !!autosavedContent,
          };
        }

        try {
          let now = new Date();
          let timeString = now.toLocaleTimeString("en-US", { hour12: false });
          // console.debug("--------------------");
          // console.debug(title);
          // console.debug("--------------------");
          // console.debug(timeString); // Example output: "14:30:15"
          const content = await fs.readFile(source, "utf8");
          now = new Date();
          timeString = now.toLocaleTimeString("en-US", { hour12: false });
          // console.debug(timeString); // Example output: "14:30:15"
          return { type: "document", tabId, title, content, source };
        } catch (error) {
          // console.error(`Failed to read file: ${source}`, error);
          return { type: "document", tabId, title, content: null, source };
        }
      }
      case "terminal":
        return { type: "terminal", tabId, title, source };
      // case "settings":
      //   // return settings content; this could be read from a config file or similar
      //   return JSON.stringify(getAppSettings());
      // add additional tab types here
      case "settings":
        return { type: "settings", tabId, title, content: "settings" };

      // Handle extension-related tabs
      case "extensionDetails": {
        if (!tab.meta?.extensionId) {
          throw new Error(
            "Missing extensionId in tab meta for extensionDetails tab",
          );
        }
        const appState = getAppState();
        // First try to find the extension in our local app state.
        let extension = appState.extensions.find(
          (ext) => ext.id === tab.meta!.extensionId,
        );
        if (!extension) {
          // If not found locally, fetch remote extensions.
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

        // Use the readme field from the manifest (shipped with the release)
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
        // This branch could be used if you have an interactive extension view.
        // For now, we return a placeholder; you can extend this as your architecture evolves.
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
        // Git branch diff viewer
        return {
          type: "diff",
          tabId,
          title,
          source,
          meta: tab.meta,
        };
      }

      case "conflict": {
        // Git merge conflict resolver
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
      // Update the active tab in the sidebars state
      appState.sidebars[sidebarId].activeTabId = tabId;
      await saveState(appState);
      return { sidebarId, tabId };
    },
  );

  ipcMain.handle(
    "state:renameFile",
    async (event, oldPath: string, newName: string) => {
      // Call the filesystem rename function.
      const result = await renameFileOrDirectory(oldPath, newName);
      if (!result.success) {
        // Return error details if the rename failed.
        return result;
      }

      // Get the new path from the filesystem operation.
      const newPath = result.data.path;

      // Get the current application state.
      const appState = getAppState(event);

      // Define a helper to recursively update tabs in a layout.
      const updateTabsInLayout = (layout: PanelElement) => {
        if (layout.type === "panel") {
          layout.tabs.forEach((tab) => {
            // If the tab's source matches the old path,
            // update it to the new path and update its title.
            if (tab.source === oldPath) {
              tab.source = newPath;
              tab.title = newName;
            }
          });
        } else if (layout.type === "group") {
          // For group layouts, recurse on children.
          layout.children.forEach((child) => updateTabsInLayout(child));
        }
      };

      // Update tabs in the active project layout (if any)
      if (appState.activeDirectory) {
        const dirState = appState.directories[appState.activeDirectory];
        if (dirState && dirState.layout) {
          updateTabsInLayout(dirState.layout);
        }
      }

      // Also update tabs in the unsaved layout if you have one.
      if (appState.unsaved && appState.unsaved.layout) {
        updateTabsInLayout(appState.unsaved.layout);
      }

      // Save the updated app state.
      await saveState(appState);

      // Return the successful result along with the new file data.
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
      // check first if sidebar doesn't already contain tab of this id
      if (
        appState.sidebars[sidebarId].tabs.some(
          (t) => t.meta?.customTabKey === tab.id,
        )
      ) {
        return { sidebarId, tabId: newTab.id, alreadyExists: true };
      }
      // if there is not active tab for this sidebar, set the new tab as active
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
    const appState = getAppState();

    if (enabled) {
      // Add globalHistory to left if missing
      const hasGlobal = appState.sidebars.left.tabs.some((t: any) => t.type === "globalHistory");
      if (!hasGlobal) {
        appState.sidebars.left.tabs.push({ id: crypto.randomUUID(), type: "globalHistory" });
      }
      // Add history to right if missing
      const hasHistory = appState.sidebars.right.tabs.some((t: any) => t.type === "history");
      if (!hasHistory) {
        appState.sidebars.right.tabs.push({ id: crypto.randomUUID(), type: "history" });
      }
    } else {
      // Remove both tabs
      appState.sidebars.left.tabs = appState.sidebars.left.tabs.filter((t: any) => t.type !== "globalHistory");
      appState.sidebars.right.tabs = appState.sidebars.right.tabs.filter((t: any) => t.type !== "history");
      // If active tab was removed, reset activeTabId
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

  // Add a new IPC handler to activate a tab.
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

    // Aggregate directories from all open windows so that projects opened
    // in other windows also appear in the Recent Projects list.
    const allDirectories: Record<string, any> = {};
    for (const winState of windowManager.getAllWindows()) {
      if (winState) {
        for (const [projectPath, layoutState] of Object.entries(winState.directories)) {
          if (!allDirectories[projectPath]) {
            allDirectories[projectPath] = layoutState;
          }
        }
      }
    }
    // Current window's state takes precedence (e.g. hidden flag set in this window)
    const mergedDirectories = { ...allDirectories, ...appState.directories };

    const filterDirectories = Object.fromEntries(Object.entries(mergedDirectories).filter(([key, el]) => !el.hidden));

    const projects = Object.keys(filterDirectories);
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

    // Remove extension tabs from the unsaved layout.
    removeExtensionTabsFromLayout(appState.unsaved.layout, extensionId);

    // Remove extension tabs from all saved directory layouts.
    for (const dir of Object.values(appState.directories)) {
      if (dir.layout) {
        removeExtensionTabsFromLayout(dir.layout, extensionId);
      }
    }

    // Also remove extension tabs from the sidebars.
    removeExtensionTabsFromSidebars(appState.sidebars, extensionId);

    // Now uninstall the extension via the extension manager.
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
      } else {
        // console.error(`extension ${extensionId} not found in state`);
      }

      // If disabling the extension, remove any related tabs.
      if (!enabled) {
        // Remove extension tabs from the unsaved layout.
        removeExtensionTabsFromLayout(appState.unsaved.layout, extensionId);

        // Remove extension tabs from all saved directory layouts.
        for (const dir of Object.values(appState.directories)) {
          if (dir.layout) {
            removeExtensionTabsFromLayout(dir.layout, extensionId);
          }
        }

        // Also remove any extension tabs from the sidebars.
        removeExtensionTabsFromSidebars(appState.sidebars, extensionId);
      } else {
        // When enabling the extension, add back its sidebar tab if not already present.
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
      // Get the current state.
      return await addPanelTab(event, panelId, tab);
    },
  );

  ipcMain.handle("state:updateOnboarding", async (event, onboarding) => {
    try {
      const state = await getAppState();
      state.onboarding = onboarding;
      await saveState(state);
      return state;
    } catch (error) {
      // console.error("Error updating onboarding:", error);
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

      // Create a new extensionDetails tab object.
      const tab: Tab = {
        id: `extensionDetails-${extension.id}`,
        type: "extensionDetails",
        title: extension.name,
        source: extension.id, // use extension id as a unique key
        directory: null,
        meta: { extensionId: extension.id },
      };

      const existingTab = findTabInPanel(layout, "main", tab);
      if (existingTab) {
        // Activate the already open tab.
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
    // If the extension is already up-to-date, return the current extension.
    if (remoteExt.version === ext.version) {
      return { success: true, updatedExtension: ext };
    }
    // Otherwise, download and replace (update) the extension using the extension manager.
    const updatedExtension =
      await extensionManager.installCommunityExtension(remoteExt);
    await saveState(appState);
    maybeRecomposeSkills(appState);
    return { success: true, updatedExtension };
  });

  ipcMain.handle("terminal:new", async (_, panelId: string) => {
    const appState = getAppState();
    const layout = appState.activeDirectory
      ? appState.directories[appState.activeDirectory]?.layout
      : appState.unsaved.layout;

    if (!layout) {
      throw new Error("No layout found to add terminal tab.");
    }

    // Determine the default cwd:
    // If there's an active project, use that path; otherwise, default to the user's home directory.
    const defaultCwd = appState.activeDirectory || os.homedir();

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: "terminal",
      title: "Terminal",
      source: null,
      // Set the directory property so later terminal processes know where to start
      directory: defaultCwd,
    };

    addTabToPanel(layout, panelId, newTab);
    activateTabInLayout(layout, panelId, newTab.id);
    await saveState(appState);

    // Return the cwd along with the new tab id so the renderer can pass it to "terminal:attachOrCreate"
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
      // Choose the layout: use the active directory's layout if available; otherwise use the unsaved layout.
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
      // console.debug("closingTab", closingTab);
      // For document tabs with unsaved changes, show a native OS dialog.
      if (closingTab.type === "document" && unsavedContent) {
        const result = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Save", "Don't Save", "Cancel"],
          defaultId: 0, // "Save" is the primary action
          cancelId: 2, // "Cancel" is the cancel action
          title: "Unsaved Changes",
          message: `Do you want to save changes made to ${closingTab.title}?`,
          detail: "Your changes will be lost if you don't save them.",
        });

        if (result.response === 2) {
          // User clicked "Cancel"—abort closing.
          return { canceled: true };
        }

        if (result.response === 0) {
          // User chose "Save". Use the saveDocument function.
          const success = await saveDocument(closingTab, unsavedContent);
          if (!success) {
            // If saving fails, cancel closing.
            return { canceled: true };
          }
        }
        // If the user chose "Don't Save" (button index 1), proceed without saving.
      }
      // If this is a terminal tab, kill the associated process.
      if (closingTab.type === "terminal" && closingTab.source) {
        killTerminal(closingTab.source);
      }

      // Clean up autosaved file if this was an unsaved document
      if (closingTab.type === "document" && !closingTab.source) {
        await deleteAutosaveFile(tabId);
      }

      // Remove the tab from the layout.
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
      // Choose the layout: use the active directory's layout if available; otherwise use the unsaved layout.
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

      // Loop through each tab and process them one by one
      for (const tabInfo of tabs) {
        const { tabId, unsavedContent } = tabInfo;

        const closingTab = findTabById(layout, panelId, tabId);
        if (!closingTab) {
          console.warn(`Tab with id ${tabId} not found in panel ${panelId}.`);
          continue; // Skip to next tab instead of throwing error
        }

        let shouldClose = true;

        // For document tabs with unsaved changes, show a native OS dialog.
        if (closingTab.type === "document" && unsavedContent) {
          const result = await dialog.showMessageBox({
            type: "warning",
            buttons: ["Save", "Don't Save", "Cancel"],
            defaultId: 0, // "Save" is the primary action
            cancelId: 2, // "Cancel" is the cancel action
            title: "Unsaved Changes",
            message: `Do you want to save changes made to ${closingTab.title}?`,
            detail: "Your changes will be lost if you don't save them.",
          });

          if (result.response === 2) {
            // User clicked "Cancel"—abort closing for this tab.
            canceledTabs.push({ panelId, tabId });
            shouldClose = false;
            continue; // Move to next tab
          }

          if (result.response === 0) {
            // User chose "Save". Use the saveDocument function.
            const success = await saveDocument(closingTab, unsavedContent);
            if (!success) {
              // If saving fails, cancel closing for this tab.
              canceledTabs.push({ panelId, tabId });
              shouldClose = false;
              continue; // Move to next tab
            }
          }
          // If the user chose "Don't Save" (button index 1), proceed without saving.
        }

        if (shouldClose) {
          // If this is a terminal tab, kill the associated process.
          if (closingTab.type === "terminal" && closingTab.source) {
            killTerminal(closingTab.source);
          }

          // Clean up autosaved file if this was an unsaved document
          if (closingTab.type === "document" && !closingTab.source) {
            await deleteAutosaveFile(tabId);
          }

          // Remove the tab from the layout.
          const removed = removeTabFromPanel(layout, panelId, tabId);
          if (!removed) {
            console.warn(
              `Failed to remove tab with id ${tabId} from panel ${panelId}.`,
            );
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
        allClosed: canceledTabs.length === 0, // true if all tabs were successfully closed
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

  // This IPC handler opens a file from a file link.
  // It checks if there's already a document tab open for the file;
  // if so, it activates that tab; otherwise, it creates a new document tab.
  ipcMain.handle(
    "fileLink:open",
    async (_event, filePath: string, filename: string) => {
      const appState = getAppState();

      // Choose the layout from the active project or unsaved state.
      const layout: PanelElement = appState.activeDirectory
        ? appState.directories[appState.activeDirectory]?.layout
        : appState.unsaved.layout;

      if (!layout) {
        throw new Error("No layout available to open file.");
      }

      // A helper function to recursively search for a document tab that has this file path.
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
        // If found, activate it.
        // (Assuming your document tabs live in a panel with id "main")
        activateTabInLayout(layout, "main", existingTab.id);
        await saveState(appState);
        return { tabId: existingTab.id, opened: false };
      } else {
        // Otherwise, create a new document tab.
        const newTab: Tab = {
          id: crypto.randomUUID(),
          type: "document",
          title: filename || "Untitled", // Use the filename as the tab title
          source: filePath, // Store the file path so you can load the content later
          directory: null,
        };
        // Add the new tab to the "main" panel.
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
      // eventBus.emitEvent("file:duplicate", { path: newPath, name: result.data.name });
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
