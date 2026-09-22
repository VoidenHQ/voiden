import { BrowserWindow, Menu, dialog, MenuItemConstructorOptions, app, shell, ipcMain } from "electron";
import path from "node:path";
import EventBus from "./eventBus";
import { getRecentPaths } from "./fileSystem";
import { setActiveProject, addTabToPanel, activateTabInLayout, getAppState, createNewDocumentTab, activateTab, addPanelTab } from "./state";
import { Tab } from "../shared/types";
import { saveState } from "./persistState";
import { createFileTreeContextMenu, getFileTreeFocus } from "./menus";
import { setActiveDirectory } from "./ipc/directory";
import { handleDeeplink } from "./deeplink";
import { windowManager } from "./windowManager";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let splash: BrowserWindow | null = null;

export function setSplash(window: BrowserWindow) {
  splash = window;
}

const isMac = process.platform === "darwin";

const menubarTemplate: Array<MenuItemConstructorOptions> = [
  // App menu (macOS only)
  ...(isMac
    ? [
      {
        label: app.name,
        submenu: [
          {
            label: `About ${app.name}`,
            click: () => {
              windowManager.browserWindow?.webContents.send("menu:show-about", {});
            },
          },
          { type: "separator" as const },
          {
            label: "Check for Updates...",
            click: async () => {
              windowManager.browserWindow?.webContents.send("menu:check-updates", {});
            },
          },
          { type: "separator" as const },
          {
            label: "Settings...",
            accelerator: "Cmd+,",
            registerAccelerator: false,
            click: () => {
              windowManager.browserWindow?.webContents.send("menu:open-settings", {});
            },
          },
          { type: "separator" as const },
          {
            label: "Services",
            role: "services" as const,
          },
          { type: "separator" as const },
          {
            label: `Hide ${app.name}`,
            accelerator: "Cmd+H",
            role: "hide" as const,
          },
          {
            label: "Hide Others",
            accelerator: "Option+Cmd+H",
            role: "hideOthers" as const,
          },
          {
            label: "Show All",
            role: "unhide" as const,
          },
          { type: "separator" as const },
          {
            label: `Quit ${app.name}`,
            accelerator: "Cmd+Q",
            // Use a manual click handler instead of role:"quit" so that
            // registerAccelerator:false takes effect — native role items
            // ignore that flag and intercept at the physical key level,
            // which breaks macOS keyboard remapping tools (e.g. Karabiner).
            registerAccelerator: false,
            click: () => app.quit(),
          },
        ],
      },
    ]
    : []),
  // File menu
  {
    label: "File",
    submenu: [
      {
        label: "New Window",
        accelerator: "CmdOrCtrl+Shift+N",
        registerAccelerator: false,
        click: async () => {
          await windowManager.createWindow();
        },
      },
      {
        label: "New File",
        accelerator: "CmdOrCtrl+N",
        registerAccelerator: false,
        click: async () => {
          await createNewDocumentTab();
        },
      },
      { type: "separator" },
      {
        label: "Open File",
        click: async (_menuItem, browserWindow) => {
          if (!browserWindow) return;
          const result = await dialog.showOpenDialog(browserWindow, {
            properties: ["openFile"],
          });
          if (!result.canceled) {
            const file = result.filePaths[0];

            const newTab = {
              id: crypto.randomUUID(),
              type: "document" as const,
              title: path.basename(file),
              source: file,
              directory: null,
            };
            const tab = await addPanelTab(undefined, 'main', newTab);
            await activateTab(undefined, 'main', tab.tabId);
            if (windowManager.browserWindow) windowManager.browserWindow.webContents.send('file:newTab');
          }
        },
      },
      {
        label: "Open Folder...",
        accelerator: "CmdOrCtrl+O",
        registerAccelerator: false,
        click: async (_menuItem, browserWindow) => {
          if (!browserWindow) return;
          const result = await dialog.showOpenDialog(browserWindow, {
            properties: ["openDirectory", "createDirectory"],
          });
          if (!result.canceled) {
            await setActiveProject(result.filePaths[0]);
            windowManager.browserWindow?.webContents.send('folder:opened', { path: result.filePaths[0] })
          }
        },
      },
      {
        label: "Open Recent",
        submenu: [
          {
            label: "No recent projects",
            enabled: false,
          },
        ],
      },
      { type: "separator" },
      {
        label: "Save",
        accelerator: "CmdOrCtrl+S",
        registerAccelerator: false,
        click: () => {
          windowManager.browserWindow?.webContents.send("file-menu-command", { command: "save-file" });
        },
      },
      { type: "separator" },
      {
        label: "Close Project",
        click: () => {
          windowManager.browserWindow?.webContents.send("directory:close-project", {});
        },
      },
      {
        label: "Close Window",
        click: () => {
          // Delete state before closing since this is explicit menu close
          windowManager.closeWindowAndDeleteState();
        },
      },
      // Windows-specific menu items
      ...(!isMac
        ? [
          { type: "separator" as const },
          {
            label: "Settings...",
            accelerator: "Ctrl+,",
            registerAccelerator: false,
            click: () => {
              windowManager.browserWindow?.webContents.send("menu:open-settings", {});
            },
          },
          { type: "separator" as const },
          {
            label: "Exit",
            accelerator: "Alt+F4",
            role: "quit" as const,
          },
        ]
        : []),
    ],
  },
  // Edit menu
  {
    label: "Edit",
    submenu: [
      {
        label: "Undo",
        accelerator: "CmdOrCtrl+Z",
        role: "undo",
      },
      {
        label: "Redo",
        accelerator: isMac ? "Shift+Cmd+Z" : "Ctrl+Y",
        role: "redo",
      },
      { type: "separator" },
      {
        label: "Cut",
        accelerator: "CmdOrCtrl+X",
        role: "cut",
      },
      {
        label: "Copy",
        accelerator: "CmdOrCtrl+C",
        role: "copy",
      },
      {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        role: "paste",
      },
      ...(isMac
        ? [
          {
            label: "Paste and Match Style",
            accelerator: "Option+Shift+Cmd+V",
            role: "pasteAndMatchStyle" as const,
          },
        ]
        : []),
      { type: "separator" },
      {
        label: "Select All",
        accelerator: "CmdOrCtrl+A",
        // Use a manual click handler instead of role:"selectAll", same fix
        // as Quit above: role-based menu items are native NSMenuItem
        // actions on macOS and intercept the accelerator at the physical
        // key level regardless of registerAccelerator:false — the keydown
        // never reaches the web page's own handling at all, so no
        // TipTap/DOM keyboard shortcut for Cmd/Ctrl+A ever fires (this is
        // what broke every node-scoped Cmd+A override — REST's UrlNode,
        // MCP's McpUrlNode, etc.). Dropping the role and keeping only a
        // manual click handler (for when the menu item is clicked directly,
        // not via the keystroke) lets the keystroke fall through to the
        // renderer, where those extensions can properly scope it.
        registerAccelerator: false,
        click: () => {
          windowManager.browserWindow?.webContents.selectAll();
        },
      },
      { type: "separator" },
      {
        label: "Find",
        accelerator: "CmdOrCtrl+F",
        registerAccelerator: false,
        click: () => {
          windowManager.browserWindow?.webContents.send("menu:find", {});
        },
      },
    ],
  },
  // View menu
  {
    label: "View",
    submenu: [
      {
        label: "Toggle File Explorer",
        accelerator: isMac ? "Cmd+Shift+E" : "Ctrl+Shift+E",
        registerAccelerator: false,
        click: () => {
          windowManager.browserWindow?.webContents.send("menu:toggle-explorer", {});
        },
      },
      {
        label: "Toggle Terminal",
        accelerator: isMac ? "Cmd+J" : "Ctrl+J",
        registerAccelerator: false,
        click: () => {
          windowManager.browserWindow?.webContents.send("menu:toggle-terminal", {});
        },
      },
      { type: "separator" },
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        role: "reload",
      },
      {
        label: "Force Reload",
        accelerator: isMac ? "Option+Cmd+R" : "Ctrl+Shift+R",
        // Dropped the native role (and kept a manual click handler instead),
        // same fix as Select All above: this combo is also the file tree's
        // "Reveal in Finder" shortcut, and role-based items intercept their
        // accelerator as a native NSMenuItem action on macOS regardless of
        // registerAccelerator:false, so the keydown never reaches the
        // before-input-event handler below that decides between the two.
        registerAccelerator: false,
        click: (_menuItem, browserWindow) => {
          browserWindow?.webContents.reloadIgnoringCache();
        },
      },
      { type: "separator" },
      {
        label: "Actual Size",
        accelerator: "CmdOrCtrl+0",
        role: "resetZoom",
      },
      {
        label: "Zoom In",
        accelerator: "CmdOrCtrl+Plus",
        registerAccelerator: false,
        click: (_, browserWindow) => {
          if (browserWindow) {
            const currentZoom = browserWindow.webContents.getZoomLevel();
            if (currentZoom < 3) {
              browserWindow.webContents.setZoomLevel(Math.min(currentZoom + 0.5,1));
            }
          }
        },
      },
      {
        label: "Zoom Out",
        accelerator: "CmdOrCtrl+-",
        registerAccelerator: false,
        click: (_, browserWindow) => {
          if (browserWindow) {
            const currentZoom = browserWindow.webContents.getZoomLevel();
            if (currentZoom > -1) {
              browserWindow.webContents.setZoomLevel(Math.max(currentZoom - 0.5, -1));
            }
          }
        },
      },
      { type: "separator" },
      {
        label: "Toggle Full Screen",
        accelerator: isMac ? "Control+Cmd+F" : "F11",
        role: "togglefullscreen",
      },
      { type: "separator" },
      {
        label: "Toggle Developer Tools",
        accelerator: isMac ? "Option+Cmd+I" : "F12",
        registerAccelerator: false,
        click: (_menuItem, browserWindow) => {
          if (browserWindow) {
            windowManager.browserWindow?.webContents.toggleDevTools();
          }
        },
      },
    ],
  },
  // Window menu (macOS)
  ...(isMac
    ? [
      {
        label: "Window",
        submenu: [
          {
            label: "Minimize",
            accelerator: "Cmd+M",
            role: "minimize" as const,
          },
          {
            label: "Zoom",
            role: "zoom" as const,
          },
          { type: "separator" as const },
          {
            label: "Bring All to Front",
            role: "front" as const,
          },
        ],
      },
    ]
    : []),
  // Help menu
  {
    label: "Help",
    submenu: [
      {
        label: "Welcome",
        click: () => {
          windowManager.browserWindow?.webContents.send("menu:open-welcome", {});
        },
      },
      {
        label: "Changelog",
        click: () => {
          windowManager.browserWindow?.webContents.send("menu:open-changelog", {});
        },
      },
      { type: "separator" },
      {
        label: "Documentation",
        click: () => {
          shell.openExternal("https://docs.voiden.md");
        },
      },
      {
        label: "Report an Issue",
        click: () => {
          shell.openExternal("https://github.com/voidenhq/voiden/issues");
        },
      },
      { type: "separator" },
      {
        label: "Install CLI Command...",
        click: async () => {
          const { showCliInstructions } = await import("./cliInstaller");
          await showCliInstructions();
        },
      },
      { type: "separator" },
      {
        label: "Visit Voiden Website",
        click: () => {
          shell.openExternal("https://voiden.md");
        },
      },
      ...(!isMac
        ? [
          { type: "separator" as const },
          {
            label: "Check for Updates...",
            click: async () => {
              windowManager.browserWindow?.webContents.send("menu:check-updates", {});
            },
          },
          { type: "separator" as const },
          {
            label: `About ${app.name}`,
            click: () => {
              windowManager.browserWindow?.webContents.send("menu:check-updates", {});
            },
          },
        ]
        : []),
    ],
  },
];

export async function createMenuWithRecent(mainWindow: BrowserWindow) {
  const recent = await getRecentPaths();

  const fileMenu = menubarTemplate.find((item) => item.label === "File");
  if (fileMenu && Array.isArray(fileMenu.submenu)) {
    const openRecentMenu = fileMenu.submenu.find(
      (item) => typeof item === "object" && "label" in item && item.label === "Open Recent",
    );

    if (openRecentMenu && typeof openRecentMenu === "object" && "submenu" in openRecentMenu) {
      if (recent.length === 0) {
        openRecentMenu.submenu = [
          {
            label: "No recent projects",
            enabled: false,
          },
        ];
      } else {
        openRecentMenu.submenu = [
          ...recent.map((projectPath: string) => ({
            label: path.basename(projectPath),
            sublabel: projectPath,
            click: async () => {
              await setActiveDirectory(projectPath, mainWindow);
            },
          })),
          { type: "separator" as const },
          {
            label: "Clear Recently Opened",
            click: async () => {
              // Clear recent paths logic - you may need to implement this
              windowManager.browserWindow?.webContents.send("menu:clear-recent", {});
              await createMenuWithRecent(mainWindow);
            },
          },
        ];
      }
    }
  }

  // Build and set menu for all platforms
  // macOS: Shows in system menu bar
  // Windows/Linux: Hidden but still handles keyboard shortcuts
  const menu = Menu.buildFromTemplate(menubarTemplate);
  Menu.setApplicationMenu(menu);
}

// Get icon path for Linux
const getLinuxIcon = () => {
  if (process.platform !== "linux") return undefined;
  // In production, icon is in resources; in dev, it's in src/images
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "../../src/images/icon.png");
  return iconPath;
};

export interface InitialWindowBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
}

export async function createWindow(initialBounds?: InitialWindowBounds): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: initialBounds?.width ?? 1200,
    height: initialBounds?.height ?? 800,
    ...(initialBounds?.x != null && initialBounds?.y != null
      ? { x: initialBounds.x, y: initialBounds.y }
      : {}),
    minHeight: 384,
    minWidth: 384,
    webPreferences: {
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false,
    icon: getLinuxIcon(),
    ...(isMac ? {
      titleBarOverlay: {
        color: "#1f2430",
        symbolColor: "#ffffff",
      },
      titleBarStyle: "hidden",
    } : { frame: false })
  });
  mainWindow.on("ready-to-show", () => {
    // Reapply size before show() — on macOS the OS can silently adjust window
    // dimensions between construction and ready-to-show, so we set them again
    // here to guarantee the saved size takes effect without a visible resize.
    if (initialBounds?.width && initialBounds?.height) {
      mainWindow.setBounds({
        width: initialBounds.width,
        height: initialBounds.height,
        ...(initialBounds.x != null ? { x: initialBounds.x } : {}),
        ...(initialBounds.y != null ? { y: initialBounds.y } : {}),
      }, false);
    }

    // Restore zoom state before show() so the window is already at its saved
    // size when it first appears — no visible flash from normal→zoomed.
    // On macOS, maximize() on a hidden window sets the frame to the work area
    // directly (no animation), so the user sees it correctly from the start.
    if (initialBounds?.isMaximized) {
      mainWindow.maximize();
    }

    splash?.destroy();
    mainWindow.show();

    // Full-screen must come after show() because entering a macOS Space
    // requires the window to already be visible.
    if (initialBounds?.isFullScreen) {
      mainWindow.setFullScreen(true);
    }
  });
  EventBus.registerWindow(mainWindow);
  // Clear Electron's cache in development to ensure fresh UI loads
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.webContents.session.clearCache();
  }
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const newHeaders = {
      ...details.requestHeaders,
      Origin: MAIN_WINDOW_VITE_DEV_SERVER_URL || "voiden://",
    };

    callback({ cancel: false, requestHeaders: newHeaders });
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // On Windows/Linux, auto-hide the menu bar (keyboard shortcuts still work)
  // User can press Alt to show it temporarily, or use the hamburger menu
  if (!isMac) {
    mainWindow.setAutoHideMenuBar(true);
  }

  handleDeeplink(mainWindow);

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  // Match shortcuts against the OS-remapped logical key (input.key) rather
  // than the physical key code so that macOS key remapping tools (Karabiner,
  // custom layouts, System Preferences shortcuts) are respected.
  // The accelerators above use registerAccelerator:false so they never fire
  // on the raw scancode; this handler owns the actual dispatch.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const primary = isMac ? input.meta : input.control;
    const { shift, alt, meta, control } = input;
    const key = input.key.toLowerCase();

    // Quit — macOS Cmd+Q
    if (isMac && meta && !control && !shift && !alt && key === 'q') {
      app.quit();
      event.preventDefault();
      return;
    }

    // Settings — Cmd+, (macOS) or Ctrl+, (others)
    if (primary && !shift && !alt && input.key === ',') {
      mainWindow.webContents.send('menu:open-settings', {});
      event.preventDefault();
      return;
    }

    // New Window — CmdOrCtrl+Shift+N (check before New File)
    if (primary && shift && !alt && key === 'n') {
      void windowManager.createWindow();
      event.preventDefault();
      return;
    }

    // New File — CmdOrCtrl+N
    if (primary && !shift && !alt && key === 'n') {
      void createNewDocumentTab();
      event.preventDefault();
      return;
    }

    // Open Folder — CmdOrCtrl+O
    if (primary && !shift && !alt && key === 'o') {
      void (async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory', 'createDirectory'],
        });
        if (!result.canceled) {
          await setActiveProject(result.filePaths[0]);
          mainWindow.webContents.send('folder:opened', { path: result.filePaths[0] });
        }
      })();
      event.preventDefault();
      return;
    }

    // Save — CmdOrCtrl+S
    if (primary && !shift && !alt && key === 's') {
      mainWindow.webContents.send('file-menu-command', { command: 'save-file' });
      event.preventDefault();
      return;
    }

    // Find — CmdOrCtrl+F
    if (primary && !shift && !alt && key === 'f') {
      mainWindow.webContents.send('menu:find', {});
      event.preventDefault();
      return;
    }

    // Toggle Explorer — CmdOrCtrl+Shift+E
    if (primary && shift && !alt && key === 'e') {
      mainWindow.webContents.send('menu:toggle-explorer', {});
      event.preventDefault();
      return;
    }

    // Toggle Terminal — CmdOrCtrl+J
    if (primary && !shift && !alt && key === 'j') {
      mainWindow.webContents.send('menu:toggle-terminal', {});
      event.preventDefault();
      return;
    }

    // Zoom In — CmdOrCtrl+= or CmdOrCtrl++
    if (primary && !shift && !alt && (key === '=' || key === '+')) {
      const level = mainWindow.webContents.getZoomLevel();
      if (level < 3) mainWindow.webContents.setZoomLevel(Math.min(level + 0.5, 1));
      event.preventDefault();
      return;
    }

    // Zoom Out — CmdOrCtrl+-
    if (primary && !shift && !alt && key === '-') {
      const level = mainWindow.webContents.getZoomLevel();
      if (level > -1) mainWindow.webContents.setZoomLevel(Math.max(level - 0.5, -1));
      event.preventDefault();
      return;
    }

    // Reveal in Finder / Force Reload — Option+Cmd+R (macOS) or Ctrl+Shift+R
    // (others). Both names are bound to the same combo on purpose: this
    // reveals the file tree's focused/selected item when the tree has
    // keyboard focus, and falls through to the previous Force Reload
    // behavior otherwise (see the dropped role on that menu item above).
    //
    // On macOS, holding Option while pressing R doesn't always resolve to a
    // plain "r" in input.key — on at least the en-GB layout it reports "Dead"
    // (an unresolved dead-key compose state), so the primary check falls back
    // to the physical key code when input.key isn't a usable letter. Karabiner
    // -style remaps still take priority: they change input.key to something
    // real, which the first branch catches before the fallback ever runs.
    const isRKey = key === 'r' || (key === 'dead' && input.code === 'KeyR');
    const isRevealOrForceReloadCombo = isMac
      ? (meta && alt && !control && !shift && isRKey)
      : (control && shift && !alt && isRKey);
    if (isRevealOrForceReloadCombo) {
      const focused = getFileTreeFocus(mainWindow.webContents.id);
      if (focused) {
        shell.showItemInFolder(focused.path);
      } else {
        mainWindow.webContents.reloadIgnoringCache();
      }
      event.preventDefault();
      return;
    }

    // Dev Tools — Option+Cmd+I (macOS) or F12 (others)
    if (isMac && meta && alt && !shift && !control && key === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (!isMac && !primary && !shift && !alt && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
  });

  createMenuWithRecent(mainWindow);
  createFileTreeContextMenu(mainWindow);

  return mainWindow;
}

// Removed auto-opening of welcome/changelog tabs
// Users can now access these from Help menu
export async function initializeWelcomeTabs() {
  // No longer auto-opens welcome/changelog tabs
  return;
}
