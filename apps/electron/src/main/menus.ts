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
import { logger } from "./logger";
import { setDeleting } from "./fileWatcher";

let contextMenuHandlersRegistered = false;

/** Send to renderer only if the window and its webContents are still alive. */
function safeSend(win: BrowserWindow | null | undefined, channel: string, data?: any) {
  try {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, data ?? {});
    }
  } catch {
    // Renderer frame disposed — nothing to do
  }
}

/** Yield to the Node.js event loop so the UI can process queued messages. */
function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

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
            safeSend(senderWindow, "file:create-void", { path: data.path });
          },
        },
        {
          label: "New file...",
          click: async () => {
            safeSend(senderWindow, "file:create", { path: data.path });
          },
        },
        {
          label: "New folder...",
          click: async () => {
            safeSend(senderWindow, "directory:create", { path: data.path });
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
              safeSend(senderWindow, "directory:close-project");
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
            safeSend(senderWindow, "file:rename", { path: data.path });
          },
        });
        menuTemplate.push({
          label: "Delete",
          accelerator: process.platform === "darwin" ? "Cmd+Backspace" : "Delete",
          click: async () => {
            const { response } = await dialog.showMessageBox({
              type: "none",
              buttons: ["Cancel", "Delete"],
              defaultId: 0,
              title: "Confirm Delete",
              message: "Are you sure you want to delete this folder?",
              detail: `The folder "${path.basename(data.path)}" and its contents will be moved to trash.`,
            });

            if (response !== 1) return;

            logger.info('filesystem', `Delete folder: ${data.name}`, { path: data.path });
            safeSend(senderWindow, "file:delete-start");
            setDeleting(data.path, true);
            try {
              await shell.trashItem(data.path);
            } finally {
              setDeleting(data.path, false);
            }
            logger.info('filesystem', `Folder trashed: ${data.name}`, { path: data.path });

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

            safeSend(senderWindow, "directory:delete", data);
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
            safeSend(senderWindow, "file:rename", { path: data.path });
          },
        },
        {
          label: "Delete",
          accelerator: process.platform === "darwin" ? "Cmd+Backspace" : "Delete",
          click: async () => {
            const { response: fileDeleteResponse } = await dialog.showMessageBox({
              type: "none",
              buttons: ["Cancel", "Delete"],
              defaultId: 1,
              title: "Confirm Delete",
              message: "Are you sure you want to delete this file?",
              detail: `The file "${path.basename(data.path)}" will be moved to trash.`,
            });
            if (fileDeleteResponse !== 1) return;

            logger.info('filesystem', `Delete file: ${data.name}`, { path: data.path });
            safeSend(senderWindow, "file:delete-start");
            setDeleting(data.path, true);
            try {
              await shell.trashItem(data.path);
            } finally {
              setDeleting(data.path, false);
            }
            logger.info('filesystem', `File trashed: ${data.name}`, { path: data.path });

            const appState = getAppState(event);
            const layout = appState.activeDirectory ? appState.directories[appState.activeDirectory]?.layout : appState.unsaved.layout;
            if (layout) {
              const dummyTab: Tab = {
                id: "",
                type: "document",
                title: data.name,
                source: data.path,
                directory: null,
              };
              const tabToRemove = findTabInPanel(layout, "main", dummyTab);
              if (tabToRemove) {
                const removed = removeTabFromPanel(layout, "main", tabToRemove.id);
                if (removed) await saveState(appState);
              }
            }

            safeSend(senderWindow, "file:delete", data);
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
              safeSend(senderWindow, "file:duplicate", { path: result.path, name: result.name });
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

          if (response !== 1) return;

          logger.info('filesystem', `Bulk delete: ${data.length} items`, { paths: data.map(i => i.path) });
          safeSend(bulkSenderWindow, "file:delete-start");

          const appState = getAppState(event);
          const layout = appState.activeDirectory
            ? appState.directories[appState.activeDirectory]?.layout
            : appState.unsaved.layout;

          // Delete items one at a time, yielding between each so the UI stays responsive.
          for (const item of data) {
            await yieldToEventLoop();

            if (item.type === "folder") {
              setDeleting(item.path, true);
              try {
                await shell.trashItem(item.path);
              } finally {
                // Keep the guard alive briefly so chokidar's async unlink event
                // (which fires after trashItem resolves) is still suppressed.
                setTimeout(() => setDeleting(item.path, false), 500);
              }
              logger.info('filesystem', `Bulk: folder trashed: ${item.name}`, { path: item.path });

              // Close any open tabs whose source lives inside the deleted directory.
              if (layout) {
                const dirPrefix = item.path.endsWith(path.sep) ? item.path : item.path + path.sep;
                const tabsToRemove: Array<{ panelId: string; tabId: string }> = [];
                const collectTabs = (el: any) => {
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
                let stateChanged = false;
                for (const { panelId, tabId } of tabsToRemove) {
                  if (removeTabFromPanel(layout, panelId, tabId)) stateChanged = true;
                }
                if (stateChanged) await saveState(appState);
              }

              safeSend(bulkSenderWindow, "directory:delete", item);
            } else {
              setDeleting(item.path, true);
              try {
                await shell.trashItem(item.path);
              } finally {
                // Keep the guard alive briefly so chokidar's async unlink event
                // (which fires after trashItem resolves) is still suppressed.
                setTimeout(() => setDeleting(item.path, false), 500);
              }
              logger.info('filesystem', `Bulk: file trashed: ${item.name}`, { path: item.path });

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

              safeSend(bulkSenderWindow, "file:delete", item);
            }
          }

          logger.info('filesystem', `Bulk delete complete: ${data.length} items`);
          safeSend(bulkSenderWindow, "file:bulk-delete-complete", { count: data.length });
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: bulkSenderWindow || undefined });
  });
};
