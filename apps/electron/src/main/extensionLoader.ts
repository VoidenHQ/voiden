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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { app } from "electron";
import { replaceVariablesSecure } from "./env";
import { getActiveProject } from "./state";
import type { ExtensionData } from "../shared/types";
import { logger } from "./logger";
import { coreCacheDir } from "./extension/paths";

export interface MainProcessExtensionResult {
  id: string;
  success: boolean;
  path?: string;
  error?: string;
  duration: number;
}

const mainProcessResults: MainProcessExtensionResult[] = [];

export function getMainProcessExtensionResults(): MainProcessExtensionResult[] {
  return [...mainProcessResults];
}

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
 * Resolve the on-disk path of a main-process bundle for an extension.
 * Returns null if no file exists (including when the registry/manifest claims
 * mainProcess:true but the bundle was never downloaded or built).
 */
function resolveMainProcessFilePath(ext: ExtensionData): string | null {
  if (ext.type === "core") {
    const cacheDir = coreCacheDir();

    // 1. OTA cache — authoritative: only a real downloaded file counts
    const topManifestPath = path.join(cacheDir, "manifest.json");
    if (existsSync(topManifestPath)) {
      try {
        const topManifest = JSON.parse(readFileSync(topManifestPath, "utf8"));
        const mainFile = topManifest.plugins?.[ext.id]?.mainFile;
        if (mainFile) {
          const p = path.join(cacheDir, ext.id, mainFile);
          if (existsSync(p)) return p;
        }
      } catch { /* malformed manifest */ }
    }

    // 2. Bundled (packaged app) or dev equivalent
    const mainPluginsDir = app.isPackaged
      ? path.join(process.resourcesPath, "bundled-main-plugins")
      : path.join(app.getAppPath(), "bundled-main-plugins");
    const cjsPath = path.join(mainPluginsDir, `${ext.id}-main.cjs`);
    const jsPath  = path.join(mainPluginsDir, `${ext.id}-main.js`);
    if (existsSync(cjsPath)) return cjsPath;
    if (existsSync(jsPath))  return jsPath;

    return null;
  }

  if (ext.installedPath) {
    const mainPath = path.join(ext.installedPath, "main-process.js");
    return existsSync(mainPath) ? mainPath : null;
  }

  return null;
}

/**
 * Load all main-process extensions.
 * Called at startup after state initialization.
 */
export async function loadMainProcessExtensions(extensions: ExtensionData[]) {
  logger.info("plugin", `[ExtensionLoader] loadMainProcessExtensions called with ${extensions.length} extension(s), packaged=${app.isPackaged}`);

  for (const ext of extensions) {
    if (!ext.enabled) continue;

    const bundlePath = resolveMainProcessFilePath(ext);
    if (!bundlePath) {
      // Only log if the registry/manifest claims mainProcess:true — means bundle not yet downloaded
      if ((ext as any).mainProcess) {
        logger.info("plugin", `[ExtensionLoader] ${ext.id}: mainProcess=true in manifest but no bundle file found — not yet downloaded or not in this build`);
      }
      continue;
    }

    const t0 = Date.now();
    let factory: ElectronPluginFactory | null = null;

    logger.info("plugin", `[ExtensionLoader] ${ext.id}: loading from ${bundlePath}`);

    try {
      delete (require.cache as any)[require.resolve(bundlePath)];
      const mod = require(bundlePath);
      factory = mod.default ?? mod;
    } catch (err) {
      const loadResult: MainProcessExtensionResult = { id: ext.id, success: false, path: bundlePath, error: String(err), duration: Date.now() - t0 };
      mainProcessResults.push(loadResult);
      logger.error("plugin", `[ExtensionLoader] ${ext.id}: require() failed`, { error: String(err), path: bundlePath });
      _notifyRenderer(loadResult);
      continue;
    }

    if (!factory || typeof factory !== "function") {
      const loadResult: MainProcessExtensionResult = { id: ext.id, success: false, path: bundlePath, error: "module has no callable default export", duration: Date.now() - t0 };
      mainProcessResults.push(loadResult);
      logger.warn("plugin", `[ExtensionLoader] ${ext.id}: module loaded but no callable factory export`, { path: bundlePath });
      _notifyRenderer(loadResult);
      continue;
    }

    try {
      const { context, registeredChannels } = createContextForExtension(ext.id);

      let plugin: ElectronPlugin;
      const result = factory(context);
      if (result && typeof (result as any)._setContext === "function") {
        (result as any)._setContext(context);
        plugin = { onload: () => (result as any).onLoad(), onunload: () => (result as any).onUnload?.() };
      } else {
        plugin = result;
      }

      await plugin.onload();
      loadedPlugins.push({ extensionId: ext.id, plugin, registeredChannels });

      const loadResult: MainProcessExtensionResult = { id: ext.id, success: true, path: bundlePath, duration: Date.now() - t0 };
      mainProcessResults.push(loadResult);
      logger.info("plugin", `[ExtensionLoader] ✓ Loaded main-process extension: ${ext.id}`, { path: bundlePath, duration: loadResult.duration });
      _notifyRenderer(loadResult);
    } catch (err) {
      const loadResult: MainProcessExtensionResult = { id: ext.id, success: false, path: bundlePath, error: String(err), duration: Date.now() - t0 };
      mainProcessResults.push(loadResult);
      logger.error("plugin", `[ExtensionLoader] Failed to initialize extension ${ext.id}`, { error: String(err) });
      _notifyRenderer(loadResult);
    }
  }
}

function _notifyRenderer(result: MainProcessExtensionResult): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("coreExtensions:mainProcessLoaded", result);
    }
  }
}

/**
 * Unload then reload the main-process plugin for a single extension.
 * Called after a community extension is installed or updated at runtime.
 */
export async function reloadMainProcessExtension(ext: ExtensionData): Promise<void> {
  const idx = loadedPlugins.findIndex((p) => p.extensionId === ext.id);
  if (idx >= 0) {
    const existing = loadedPlugins[idx];
    try { await existing.plugin.onunload?.(); } catch {}
    for (const ch of existing.registeredChannels) {
      try { ipcMain.removeHandler(ch); } catch {}
    }
    loadedPlugins.splice(idx, 1);
  }
  // Use loadMainProcessExtensions directly — it already contains all hasMainProcess fallback logic
  // (registry flag, cached plugin manifest, top-level mainFile entry).
  if (ext.enabled) {
    await loadMainProcessExtensions([ext]);
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
