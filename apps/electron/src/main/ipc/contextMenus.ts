import { ipcMain, Menu, BrowserWindow, MenuItemConstructorOptions, clipboard } from "electron";

export function registerContextMenuIpcHandlers() {
  ipcMain.on("show-editor-context-menu", (event, info: { x: number; y: number; selectedText?: string }) => {
    const template: MenuItemConstructorOptions[] = [
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" },
    ];
    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    menu.popup({ window: win, x: info.x, y: info.y });
  });

  ipcMain.on("show-editor-copy-context-menu", (event, info: { x: number; y: number; selectedText?: string }) => {
    const senderRef = event.sender;
    const template: MenuItemConstructorOptions[] = [
      {
        label: "Copy",
        click: () => {
          if (info.selectedText) {
            clipboard.writeText(info.selectedText);
          } else {
            // Guard against the renderer crashing between menu open and click
            if (!senderRef.isDestroyed()) {
              senderRef.copy();
            }
          }
        },
        enabled: !!info.selectedText,
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(senderRef);
    if (!win || win.isDestroyed()) return;
    menu.popup({ window: win, x: info.x, y: info.y });
  });
}
