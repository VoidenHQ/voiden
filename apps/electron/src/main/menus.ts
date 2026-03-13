import { BrowserWindow, dialog, shell, MenuItemConstructorOptions } from "electron";

import { ipcMain } from "electron";
import path from "node:path";
import { Menu } from "electron";
import { createFile, deleteDirectory, deleteFile, duplicateFile } from "./fileSystem";
import { findTabInPanel, removeTabFromPanel } from "./state";
import { getAppState } from "./state";
import { Tab } from "src/shared/types";
import { saveState } from "./persistState";
import eventBus from "./eventBus";
import { FileTreeItem } from "src/types";
import fs from "node:fs";

let contextMenuHandlersRegistered = false;

export const createFileTreeContextMenu = (mainWindow: BrowserWindow) => {
  // Prevent registering handlers multiple times (called for each window)
  if (contextMenuHandlersRegistered) return;
  contextMenuHandlersRegistered = true;

  ipcMain.on("show-file-context-menu", (event, data) => {
    let menu;
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    // Explicit root hint from renderer. Falls back to previous inference for compatibility.
    const appState = getAppState(event);
    const isRootFolder =
      data.isProjectRoot === true ||
      (data.isProjectRoot === undefined &&
        (appState.activeDirectory === data.path ||
          Object.values(appState.directories || {}).some((dir) => dir.rootPath === data.path)));

    if (data.type === "folder") {
      const menuTemplate: MenuItemConstructorOptions[] = [
        {
          label: "New Voiden file...",
          click: async () => {
            senderWindow?.webContents.send("file:create-void", {
              path: data.path,
            });
          },
        },
        {
          label: "New file...",
          click: async () => {
            // console.debug("new -regular file");
            senderWindow?.webContents.send("file:create", {
              path: data.path,
            });
          },
        },
        {
          label: "New folder...",
          click: async () => {
            senderWindow?.webContents.send("directory:create", {
              path: data.path,
            });
          },
        },
        {
          label: "Reveal in Finder",
          accelerator: "Option+Cmd+R",
          click: () => {
            shell.showItemInFolder(data.path);
          },
        },
      ];

      if (isRootFolder) {
        menuTemplate.push(
          { type: "separator" as const },
          {
            label: "Close Project",
            click: async () => {
              senderWindow?.webContents.send("directory:close-project", {});
            },
          },
          { type: "separator" as const },
        );
      } else {
        menuTemplate.push({ type: "separator" as const });
      }

      // Only add rename and delete options if not the root folder
      if (!isRootFolder) {
        menuTemplate.push({
          label: "Rename",
          click: () => {
            senderWindow?.webContents.send("file:rename", {
              path: data.path,
            });
          },
        });
        menuTemplate.push({
          label: "Delete",
          accelerator: process.platform === "darwin" ? "Cmd+Backspace" : "Delete",
          click: async () => {
            const res = await deleteDirectory(data.path);

            // Close any open tabs whose source lives inside the deleted directory.
            const delAppState = getAppState(event);
            const delLayout = delAppState.activeDirectory
              ? delAppState.directories[delAppState.activeDirectory]?.layout
              : delAppState.unsaved.layout;
            if (delLayout) {
              const dirPrefix = data.path.endsWith(path.sep) ? data.path : data.path + path.sep;
              const tabsToRemove: Array<{ panelId: string; tabId: string }> = [];
              const collectTabs = (el: any) => {
                if (el.type === "panel") {
                  for (const tab of el.tabs) {
                    if (tab.source && (tab.source === data.path || tab.source.startsWith(dirPrefix))) {
                      tabsToRemove.push({ panelId: el.id, tabId: tab.id });
                    }
                  }
                } else if (el.children) {
                  for (const child of el.children) collectTabs(child);
                }
              };
              collectTabs(delLayout);
              let stateChanged = false;
              for (const { panelId, tabId } of tabsToRemove) {
                if (removeTabFromPanel(delLayout, panelId, tabId)) stateChanged = true;
              }
              if (stateChanged) await saveState(delAppState);
            }

            senderWindow?.webContents.send("directory:delete", data);
          },
        });
      }

      menu = Menu.buildFromTemplate(menuTemplate);
    } else {
      menu = Menu.buildFromTemplate([
        {
          label: "Reveal in Finder",
          accelerator: "Option+Cmd+R",
          click: () => {
            shell.showItemInFolder(data.path);
          },
        },
        { type: "separator" as const },
        {
          label: "Rename",
          click: () => {
            senderWindow?.webContents.send("file:rename", {
              path: data.path,
            });
          },
        },
        {
          label: "Delete",
          accelerator: process.platform === "darwin" ? "Cmd+Backspace" : "Delete",
          click: async () => {
            // Delete the file from disk
            const deleted = await deleteFile(data.path);
            if (!deleted) return;

            const appState = getAppState(event);
            const layout = appState.activeDirectory ? appState.directories[appState.activeDirectory]?.layout : appState.unsaved.layout;
            if (!layout) {
              throw new Error("No layout found to close tab.");
            }

            // Build a dummy tab that represents the file tab.
            // We assume that file tabs are of type "document" and that their 'source' field is the file path.
            const dummyTab: Tab = {
              id: "", // not used in the search
              type: "document",
              title: data.name,
              source: data.path,
              directory: null,
            };

            // Use the helper to search for the tab in the "main" panel.
            const tabToRemove = findTabInPanel(layout, "main", dummyTab);
            if (!tabToRemove) {
              // console.warn("No matching tab found for file:", data.path);
            } else {
              // Remove the tab using its real id.
              const removed = removeTabFromPanel(layout, "main", tabToRemove.id);
              if (removed) {
                await saveState(appState);
              }
            }

            // Notify that the file was deleted.
            senderWindow?.webContents.send("file:delete", data);
          },
        },
        {
          label: "Duplicate",
          click: async () => {
            const originalPath = data.path;
            const fileName = path.basename(originalPath);
            const ext = path.extname(fileName);
            const baseName = path.basename(fileName, ext);
            const newName = `${baseName} copy${ext}`;

            try {
              const result = await duplicateFile(originalPath, newName);
              senderWindow?.webContents.send("file:duplicate", {
                path: result.path,
                name: result.name,
              });
            } catch (err: any) {
              dialog.showErrorBox("Error", `Failed to duplicate file:\n${err.message}`);
            }
          },
        },
      ]);
    }

    menu.popup({ window: senderWindow || undefined });
  });

  ipcMain.on("show-bulk-delete-menu", async (event, data: FileTreeItem[]) => {
    const bulkSenderWindow = BrowserWindow.fromWebContents(event.sender);
    const template = [
      {
        label: `Delete ${data.length} items`,
        click: async () => {
          const { response } = await dialog.showMessageBox({
            type: "none",
            buttons: ["Cancel", "Delete"],
            defaultId: 0,
            title: "Confirm Delete",
            message: "Are you sure you want to delete these items?",
            detail: `${data.length} items will be moved to trash.`,
          });

          if (response === 1) {
            const appState = getAppState(event);
            const layout = appState.activeDirectory ? appState.directories[appState.activeDirectory]?.layout : appState.unsaved.layout;

            // Delete all items
            for (const item of data) {
              if (item.type === "folder") {
                await fs.promises.rm(item.path, { recursive: true, force: true });

                // Close any open tabs whose source lives inside the deleted directory.
                if (layout) {
                  const dirPrefix = item.path.endsWith(path.sep) ? item.path : item.path + path.sep;
                  let stateChanged = false;
                  // Collect tabs to remove first (mutating while iterating is unsafe).
                  const tabsToRemove: Array<{ panelId: string; tabId: string }> = [];
                  const collectTabs = (el: any, panelId?: string) => {
                    if (el.type === "panel") {
                      for (const tab of el.tabs) {
                        if (tab.source && (tab.source === item.path || tab.source.startsWith(dirPrefix))) {
                          tabsToRemove.push({ panelId: el.id, tabId: tab.id });
                        }
                      }
                    } else if (el.children) {
                      for (const child of el.children) collectTabs(child);
                    }
                  };
                  collectTabs(layout);
                  for (const { panelId, tabId } of tabsToRemove) {
                    if (removeTabFromPanel(layout, panelId, tabId)) stateChanged = true;
                  }
                  if (stateChanged) await saveState(appState);
                }

                bulkSenderWindow?.webContents.send("directory:delete", item);
              } else {
                await shell.trashItem(item.path);

                // Remove the open tab BEFORE notifying the UI so the refetch sees updated state.
                if (layout) {
                  const dummyTab: Tab = {
                    id: "",
                    type: "document",
                    title: item.name,
                    source: item.path,
                    directory: null,
                  };
                  const tabToRemove = findTabInPanel(layout, "main", dummyTab);
                  if (tabToRemove) {
                    const removed = removeTabFromPanel(layout, "main", tabToRemove.id);
                    if (removed) await saveState(appState);
                  }
                }

                bulkSenderWindow?.webContents.send("file:delete", item);
              }
            }
          }
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: bulkSenderWindow || undefined });
  });
};
