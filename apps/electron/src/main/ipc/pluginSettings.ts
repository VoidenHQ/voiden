import { ipcMain, app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const pluginSettingsDir = () =>
  path.join(app.getPath('userData'), 'plugin-settings');

function settingsFile(pluginId: string): string {
  return path.join(pluginSettingsDir(), `${pluginId}.json`);
}

function readSettings(pluginId: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(pluginId), 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(pluginId: string, data: Record<string, unknown>): void {
  const dir = pluginSettingsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsFile(pluginId), JSON.stringify(data, null, 2), 'utf-8');
}

function notifyChange(pluginId: string, key: string, value: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('pluginSettings:changed', pluginId, key, value);
    }
  });
}

export function registerPluginSettingsIpcHandlers() {
  ipcMain.handle('pluginSettings:get', (_event, pluginId: string, key: string) => {
    return readSettings(pluginId)[key];
  });

  ipcMain.handle('pluginSettings:getAll', (_event, pluginId: string) => {
    return readSettings(pluginId);
  });

  ipcMain.handle('pluginSettings:set', (_event, pluginId: string, key: string, value: unknown) => {
    const data = readSettings(pluginId);
    data[key] = value;
    writeSettings(pluginId, data);
    notifyChange(pluginId, key, value);
  });

  ipcMain.handle('pluginSettings:delete', (_event, pluginId: string, key: string) => {
    const data = readSettings(pluginId);
    delete data[key];
    writeSettings(pluginId, data);
    notifyChange(pluginId, key, undefined);
  });
}
