import { BrowserWindow, dialog, shell, MenuItemConstructorOptions } from "electron";

import { ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
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

/**
 * webContents.id → the file tree's currently focused/selected item in that
 * window, or null when the tree doesn't have keyboard focus. Kept here (main
 * process) so the global Option+Cmd+R / Ctrl+Shift+R handler in window.ts can
 * decide between "Reveal in Finder" and "Force Reload" synchronously, without
 * a round trip to the renderer on every keypress.
 */
const fileTreeFocusByWindow = new Map<number, { path: string; type: "file" | "folder"; name: string } | null>();

/** Read the last-reported file tree focus for a window's webContents. */
export function getFileTreeFocus(webContentsId: number) {
  return fileTreeFocusByWindow.get(webContentsId) ?? null;
}

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

    const pluginItems: Array<{ id: string; label: string }> = data.pluginItems ?? [];
    const fileTarget = { path: data.path, type: data.type, name: data.name };

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
        { type: "separator" as const },
        {
          label: fs.existsSync(path.join(data.path, ".voiden-inherited.void"))
            ? "Edit Config Inheritance"
            : "Add Config Inheritance",
          click: async () => {
            safeSend(senderWindow, "file:create-inherited-config", { path: data.path });
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
            safeSend(senderWindow, "file:delete-complete");

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

      if (pluginItems.length > 0) {
        menuTemplate.push({ type: "separator" as const });
        for (const item of pluginItems) {
          menuTemplate.push({
            label: item.label,
            click: () => safeSend(senderWindow, "plugin:file-context-action", { id: item.id, target: fileTarget }),
          });
        }
      }
      menu = Menu.buildFromTemplate(menuTemplate);
    } else {
      const fileMenuTemplate: MenuItemConstructorOptions[] = [
        {
          label: process.platform==='darwin'?"Reveal in Finder":(process.platform==='win32'?"Reveal in Explorer":"Reveal Containing Folder"),
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
            safeSend(senderWindow, "file:delete-complete");

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
      ];
      if (pluginItems.length > 0) {
        fileMenuTemplate.push({ type: "separator" as const });
        for (const item of pluginItems) {
          fileMenuTemplate.push({
            label: item.label,
            click: () => safeSend(senderWindow, "plugin:file-context-action", { id: item.id, target: fileTarget }),
          });
        }
      }
      menu = Menu.buildFromTemplate(fileMenuTemplate);
    }

    menu.popup({ window: senderWindow || undefined });
  });

  ipcMain.on("show-bulk-delete-menu", async (event, data: FileTreeItem[]) => {
    const bulkSenderWindow = BrowserWindow.fromWebContents(event.sender);
    const template = [
      {
        label: `Delete ${data.length} items`,
        click: async () => {
          await deleteItemsWithConfirm(event, bulkSenderWindow, data);
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: bulkSenderWindow || undefined });
  });

  // Direct, non-popup delete path — used by the file tree's keyboard shortcut
  // (Cmd+Backspace / Delete on the focused/selected item). The context-menu
  // "Delete" item above only works while that popup is actually open, since
  // Electron doesn't globally register accelerators declared on a context
  // menu — so keyboard-triggered delete needs its own invokable entry point
  // running the exact same confirm/trash/tab-cleanup logic.
  ipcMain.handle("files:deleteItems", async (event, items: FileTreeItem[]) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    await deleteItemsWithConfirm(event, senderWindow, items);
  });

  // Same reasoning as files:deleteItems above — the context menu's "Reveal in
  // Finder" item only fires while that popup is open, so the keyboard
  // shortcut needs a direct, invokable path to the same shell call.
  ipcMain.handle("files:revealInFinder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // Renderer reports whenever the file tree's focus/selection changes (or
  // clears, on blur) so getFileTreeFocus() above can answer synchronously.
  ipcMain.on("filetree:focus-state", (event, item: { path: string; type: "file" | "folder"; name: string } | null) => {
    fileTreeFocusByWindow.set(event.sender.id, item);
  });
};

/**
 * Confirm, trash, and clean up open tabs for one or more files/folders.
 * Shared by the file tree's bulk-delete context menu and its keyboard
 * shortcut so both paths behave identically.
 */
async function deleteItemsWithConfirm(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  senderWindow: BrowserWindow | null,
  data: FileTreeItem[],
) {
  if (data.length === 0) return;

  const { response } = await dialog.showMessageBox({
    type: "none",
    buttons: ["Cancel", "Delete"],
    defaultId: 0,
    title: "Confirm Delete",
    message: data.length === 1
      ? `Are you sure you want to delete "${data[0].name}"?`
      : "Are you sure you want to delete these items?",
    detail: data.length === 1
      ? `It will be moved to trash.`
      : `${data.length} items will be moved to trash.`,
  });

  if (response !== 1) return;

  logger.info('filesystem', `Bulk delete: ${data.length} items`, { paths: data.map(i => i.path) });
  safeSend(senderWindow, "file:delete-start");

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

      safeSend(senderWindow, "directory:delete", item);
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

      safeSend(senderWindow, "file:delete", item);
    }
  }

  logger.info('filesystem', `Bulk delete complete: ${data.length} items`);
  safeSend(senderWindow, "file:bulk-delete-complete", { count: data.length });
}
