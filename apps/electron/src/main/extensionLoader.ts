/**
 * Main-Process Extension Loader
 *
 * Loads extensions that have main-process entry points.
 * Builds an ElectronExtensionContext per extension with IPC auto-namespacing.
 * Supports both core (bundled) and community (dynamic require) extensions.
 */

import { ipcMain, shell, BrowserWindow, IpcMainInvokeEvent } from "electron";
import path from "node:path";
import type {
  ElectronExtensionContext,
  ElectronPlugin,
  ElectronPluginFactory,
} from "@voiden/sdk/electron";
import { coreMainProcessPlugins } from "@voiden/core-extensions/main";
import { replaceVariablesSecure } from "./env";
import { getActiveProject } from "./state";
import type { ExtensionData } from "../shared/types";

interface LoadedPlugin {
  extensionId: string;
  plugin: ElectronPlugin;
  registeredChannels: string[];
}

const loadedPlugins: LoadedPlugin[] = [];

/**
 * Build an ElectronExtensionContext for a given extension.
 * IPC channels are auto-namespaced: `ext:{extensionId}:{channel}`.
 */
function createContextForExtension(extensionId: string): {
  context: ElectronExtensionContext;
  registeredChannels: string[];
} {
  const registeredChannels: string[] = [];
  const prefix = `ext:${extensionId}:`;

  const context: ElectronExtensionContext = {
    // ── IPC API (auto-namespaced) ─────────────────────────────────
    ipc: {
      handle(channel: string, handler: (...args: any[]) => any) {
        const fullChannel = `${prefix}${channel}`;
        ipcMain.handle(fullChannel, handler);
        registeredChannels.push(fullChannel);
      },
      removeHandler(channel: string) {
        const fullChannel = `${prefix}${channel}`;
        ipcMain.removeHandler(fullChannel);
        const idx = registeredChannels.indexOf(fullChannel);
        if (idx >= 0) registeredChannels.splice(idx, 1);
      },
      send(channel: string, ...args: any[]) {
        const fullChannel = `${prefix}${channel}`;
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(fullChannel, ...args);
          }
        }
      },
    },

    // ── Shell API ─────────────────────────────────────────────────
    shell: {
      openExternal(url: string) {
        return shell.openExternal(url);
      },
    },

    // ── Env API ───────────────────────────────────────────────────
    env: {
      async replaceVariables(text: string, eventOrProjectPath: any): Promise<string> {
        let projectPath: string;
        if (typeof eventOrProjectPath === "string") {
          projectPath = eventOrProjectPath;
        } else {
          // It's an IPC event — resolve project path from it
          projectPath = await getActiveProject(eventOrProjectPath);
        }
        if (!projectPath) return text;
        return replaceVariablesSecure(text, projectPath);
      },
    },

    // ── Project API ───────────────────────────────────────────────
    project: {
      async getActive(event?: IpcMainInvokeEvent): Promise<string | undefined> {
        return getActiveProject(event);
      },
    },

    // ── Stubs (not needed by OAuth2 yet) ──────────────────────────
    menu: {
      registerMenuItem() {},
      updateMenuItem() {},
      removeMenuItem() {},
    },
    protocol: {
      registerProtocol() {},
      unregisterProtocol() {},
    },
    fs: {
      watch() { return () => {}; },
      async readFile() { return ""; },
      async writeFile() {},
      async exists() { return false; },
    },
    process: {
      async spawn() { return { stdout: "", stderr: "", exitCode: 1 }; },
      async exec() { return ""; },
    },
    storage: {
      async get() { return undefined; },
      async set() {},
      async delete() {},
      async clear() {},
      async keys() { return []; },
    },
    metadata: {
      name: extensionId,
      version: "0.0.0",
    },
  };

  return { context, registeredChannels };
}

/**
 * Load all main-process extensions.
 * Called at startup after state initialization.
 */
export async function loadMainProcessExtensions(extensions: ExtensionData[]) {
  for (const ext of extensions) {
    if (!ext.enabled) continue;
    // Check for mainProcess flag in the extension data or manifest capabilities
    if (!(ext as any).mainProcess) continue;

    let factory: ElectronPluginFactory | null = null;

    if (ext.type === "core") {
      factory = coreMainProcessPlugins[ext.id] ?? null;
    } else if (ext.installedPath) {
      try {
        // Community extensions: dynamically require main-process.js
        const mod = require(path.join(ext.installedPath, "main-process.js"));
        factory = mod.default ?? mod;
      } catch {
        // No main-process file for this extension
      }
    }

    if (!factory) continue;

    try {
      const { context, registeredChannels } = createContextForExtension(ext.id);

      // Support both factory functions and class-based extensions
      let plugin: ElectronPlugin;
      const result = factory(context);
      if (result && typeof (result as any)._setContext === "function") {
        // Class-based extension
        (result as any)._setContext(context);
        plugin = { onload: () => (result as any).onLoad(), onunload: () => (result as any).onUnload?.() };
      } else {
        plugin = result;
      }

      await plugin.onload();
      loadedPlugins.push({ extensionId: ext.id, plugin, registeredChannels });
      console.log(`[ExtensionLoader] Loaded main-process extension: ${ext.id}`);
    } catch (err) {
      console.error(`[ExtensionLoader] Failed to load extension ${ext.id}:`, err);
    }
  }
}

/**
 * Unload all main-process extensions.
 * Called on before-quit. Removes all registered IPC handlers.
 */
export async function unloadMainProcessExtensions() {
  for (const loaded of loadedPlugins) {
    try {
      await loaded.plugin.onunload?.();
    } catch (err) {
      console.error(`[ExtensionLoader] Error unloading ${loaded.extensionId}:`, err);
    }
    // Clean up all registered IPC handlers
    for (const channel of loaded.registeredChannels) {
      try {
        ipcMain.removeHandler(channel);
      } catch { /* already removed */ }
    }
  }
  loadedPlugins.length = 0;
}
