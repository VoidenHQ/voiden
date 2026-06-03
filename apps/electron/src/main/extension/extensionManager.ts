// extensionManager.ts
import { getRemoteExtensions } from "./extensionFetcher";
import * as installer from "./extensionInstaller";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { app } from "electron";
import { AppState, ExtensionData } from "src/shared/types";
import { coreExtensions, remoteVersions, remoteNewPlugins } from "../config/coreExtensions";
import { satisfiesVersionRange } from "../ipc/coreExtensions";
import AdmZip from "adm-zip";

import { coreCacheDir, communityDir, coreDisabledPath, coreUninstalledPath } from './paths';

function readDisabledCorePluginsSync(): Set<string> {
  try {
    const raw = require("fs").readFileSync(coreDisabledPath(), "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveDisabledCorePlugins(ids: Set<string>): Promise<void> {
  await fs.writeFile(coreDisabledPath(), JSON.stringify([...ids], null, 2));
}

function readUninstalledCorePluginsSync(): Set<string> {
  try {
    const raw = require("fs").readFileSync(coreUninstalledPath(), "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveUninstalledCorePlugins(ids: Set<string>): Promise<void> {
  await fs.writeFile(coreUninstalledPath(), JSON.stringify([...ids], null, 2));
}

export class ExtensionManager {
  constructor(private store: AppState) {}

  async loadInstalledCommunityExtensions(): Promise<void> {
    // Sync core extensions from config - this ensures new core extensions are automatically added
    this.syncCoreExtensions();

    try {
      const data = await fs.readFile(path.join(communityDir(), "installed.json"), "utf8");
      const installed: ExtensionData[] = JSON.parse(data);

      // Enrich each installed extension with data from its on-disk manifest
      const enriched = await Promise.all(
        installed.map(async (ext) => {
          if (!ext.installedPath) return ext;
          try {
            const manifestRaw = await fs.readFile(path.join(ext.installedPath, "manifest.json"), "utf8");
            const manifest = JSON.parse(manifestRaw);
            return {
              ...ext,
              icon: manifest.icon || ext.icon,
              readme: manifest.readme || ext.readme || "",
              capabilities: manifest.capabilities || ext.capabilities,
              features: manifest.features || ext.features,
              dependencies: manifest.dependencies || ext.dependencies,
              mainProcess: manifest.mainProcess ?? ext.mainProcess,
              permissions: manifest.permissions ?? ext.permissions ?? [],
            };
          } catch {
            return ext;
          }
        }),
      );

      // Migrate any extensions that were installed before shim support was added
      await Promise.all(
        enriched.map(async (ext: ExtensionData) => {
          if (!ext.installedPath) return;
          try {
            const mainPath = path.join(ext.installedPath, "main.js");
            const mainSource = await fs.readFile(mainPath, "utf8");
            // Already processed — skip
            if (mainSource.includes("__voiden_shim_")) return;
            const prepared = installer.prepareExtensionMain(mainSource);
            await fs.writeFile(mainPath, prepared.main, "utf8");
            await Promise.all(
              Object.entries(prepared.extraFiles).map(([filename, source]) =>
                fs.writeFile(path.join(ext.installedPath!, filename), source, "utf8"),
              ),
            );
          } catch {
            // Silently skip — will surface as a load error later
          }
        }),
      );

      // merge with core extensions in centralized appState
      this.store.extensions = [...this.store.extensions.filter((ext) => ext.type === "core"), ...enriched];
    } catch (e) {
      // no installed community ext found, so only keep core extensions in appState
      this.store.extensions = this.store.extensions.filter((ext) => ext.type === "core");
    }
  }

  /**
   * Syncs core extensions from the config file with the current state.
   * This ensures:
   * - New core extensions are automatically added
   * - Existing core extensions are updated with latest metadata
   * - User's enabled/disabled preferences are preserved (via plugins/core-disabled.json, shared across all windows)
   */
  syncCoreExtensions(): void {
    // Enabled state is global (shared across windows), not per-window.
    // A plugin is enabled by default if it is installed; explicit disable is tracked in plugins/core-disabled.json.
    // User-initiated uninstalls are tracked separately in plugins/core-uninstalled.json so that bundled
    // plugins (which always have a local file) still show an Install button after the user removes them.
    const disabled = readDisabledCorePluginsSync();
    const uninstalled = readUninstalledCorePluginsSync();

    const isBundledLocally = (pluginId: string): boolean => {
      if (app.isPackaged) {
        return existsSync(path.join(process.resourcesPath, "bundled-plugins", `${pluginId}.js`));
      }
      return existsSync(path.join(app.getAppPath(), "bundled-plugins", `${pluginId}.js`));
    };

    const isOtaCached = (pluginId: string): boolean => {
      const cacheDir = coreCacheDir();
      try {
        const manifest = JSON.parse(readFileSync(path.join(cacheDir, "manifest.json"), "utf8"));
        const entry = manifest?.plugins?.[pluginId];
        if (!entry) return false;
        return existsSync(path.join(cacheDir, pluginId, `${entry.version}.js`));
      } catch {
        return false;
      }
    };

    const getOtaCachedVersion = (pluginId: string): string | null => {
      const cacheDir = coreCacheDir();
      try {
        const manifest = JSON.parse(readFileSync(path.join(cacheDir, "manifest.json"), "utf8"));
        return manifest?.plugins?.[pluginId]?.version ?? null;
      } catch {
        return null;
      }
    };

    const syncedCoreExtensions: ExtensionData[] = coreExtensions.map((coreExt) => {
      // A plugin is "locally available" only when it has a file to load AND the user hasn't
      // explicitly uninstalled it. Uninstalled bundled plugins still have their bundled file
      // on disk, but we treat them as unavailable so the UI shows an Install button.
      const hasFile = isBundledLocally(coreExt.id) || isOtaCached(coreExt.id);
      const isLocallyAvailable = hasFile && !uninstalled.has(coreExt.id);
      // Priority: OTA-installed version > remote registry version (for "available to install" display) > local snapshot fallback
      const effectiveVersion = getOtaCachedVersion(coreExt.id) ?? remoteVersions.get(coreExt.id) ?? coreExt.version;
      return {
        ...coreExt,
        version: effectiveVersion,
        // Enabled = locally available AND not explicitly disabled by user.
        // This is window-independent: reads from plugins/core-disabled.json, not from window state.
        enabled: isLocallyAvailable && !disabled.has(coreExt.id),
        isLocallyAvailable,
      };
    });

    // Append plugins that exist in the remote registry but not in the local snapshot.
    // These are OTA-only new plugins the user can install but haven't been bundled yet.
    const existingIds = new Set(syncedCoreExtensions.map((e) => e.id));
    const newRemoteExtensions: ExtensionData[] = remoteNewPlugins
      .filter((p) => !existingIds.has(p.id))
      .map((p) => {
        const hasFile = isBundledLocally(p.id) || isOtaCached(p.id);
        const locallyAvailable = hasFile && !uninstalled.has(p.id);
        return {
          ...p,
          version: remoteVersions.get(p.id) ?? p.version,
          enabled: locallyAvailable && !disabled.has(p.id),
          isLocallyAvailable: locallyAvailable,
        };
      });

    this.store.extensions = [
      ...syncedCoreExtensions,
      ...newRemoteExtensions,
      ...this.store.extensions.filter((ext) => ext.type !== "core"),
    ];
  }

  /** Mark a core plugin as uninstalled and wipe all local state for it. */
  async uninstallCoreExtension(pluginId: string): Promise<void> {
    // Clear disabled state — the plugin is gone, not just toggled off.
    const disabled = readDisabledCorePluginsSync();
    disabled.delete(pluginId);
    await saveDisabledCorePlugins(disabled);

    // Track as explicitly uninstalled so bundled plugins show Install button (not Enable).
    const uninstalled = readUninstalledCorePluginsSync();
    uninstalled.add(pluginId);
    await saveUninstalledCorePlugins(uninstalled);
    this.syncCoreExtensions();

    // Delete OTA cache files and remove the version entry from the local manifest.
    const cacheDir = coreCacheDir();
    const pluginCacheDir = path.join(cacheDir, pluginId);
    if (existsSync(pluginCacheDir)) {
      await fs.rm(pluginCacheDir, { recursive: true, force: true });
    }
    const manifestPath = path.join(cacheDir, "manifest.json");
    try {
      const cached = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (cached.plugins?.[pluginId]) {
        delete cached.plugins[pluginId];
        await fs.writeFile(manifestPath, JSON.stringify(cached, null, 2));
      }
    } catch { /* manifest may not exist yet — ignore */ }
  }

  /** Re-enable a previously uninstalled core plugin. Clears both disabled and uninstalled state. */
  async reinstallCoreExtension(pluginId: string): Promise<void> {
    const disabled = readDisabledCorePluginsSync();
    disabled.delete(pluginId);
    await saveDisabledCorePlugins(disabled);
    const uninstalled = readUninstalledCorePluginsSync();
    uninstalled.delete(pluginId);
    await saveUninstalledCorePlugins(uninstalled);
    this.syncCoreExtensions();
  }

  async saveInstalledCommunityExtensions(): Promise<void> {
    const communityExtensions = this.store.extensions.filter((ext) => ext.type === "community");
    await fs.mkdir(communityDir(), { recursive: true });
    await fs.writeFile(path.join(communityDir(), "installed.json"), JSON.stringify(communityExtensions), "utf8");
  }

  /**
   * Update metadata for a single core extension in the in-memory store.
   * Called after an OTA bundle loads and exposes __voiden_manifest__.
   * Only patches safe fields — id, type, and enabled are never overwritten.
   */
  updateCoreExtensionMeta(pluginId: string, meta: Record<string, any>): void {
    const ext = this.store.extensions.find((e) => e.id === pluginId && e.type === "core");
    if (!ext) return;
    const { id, type, enabled, ...rest } = meta; // strip protected fields
    Object.assign(ext, rest);
  }

  async getAllExtensions(): Promise<ExtensionData[]> {
    // this list comes solely from centralized appState
    const remoteExtensions = await getRemoteExtensions();
    // make sure there are no duplicates
    const allExtensions = [...this.store.extensions, ...remoteExtensions].filter(
      (ext, index, self) => self.findIndex((t) => t.id === ext.id) === index,
    );
    // Attach latestVersion / incompatibleLatestVersion based on version and voidenVersion checks
    const appVersion = app.getVersion();
    return allExtensions.map((ext) => {
      // Community: compare installed version against live registry version
      const remoteExt = remoteExtensions.find((r) => r.id === ext.id);
      if (remoteExt && remoteExt.version !== ext.version) {
        const voidenVersion = remoteExt.voidenVersion;
        const compatible = voidenVersion ? satisfiesVersionRange(appVersion, voidenVersion) : true;
        if (compatible) return { ...ext, latestVersion: remoteExt.version };
        return { ...ext, incompatibleLatestVersion: remoteExt.version, requiredVoidenVersion: voidenVersion };
      }
      // Core: check whether the registry voidenVersion is satisfied by the running app.
      // This surfaces an incompatible badge at page-load without requiring the user to click Install.
      if (ext.type === "core" && ext.voidenVersion && !satisfiesVersionRange(appVersion, ext.voidenVersion)) {
        return { ...ext, incompatibleLatestVersion: ext.version, requiredVoidenVersion: ext.voidenVersion };
      }
      return ext;
    });
  }

  async installCommunityExtension(extension: ExtensionData): Promise<ExtensionData> {
    if (!extension.repo) {
      throw new Error("repo not defined");
    }
    const { manifest, main, skill, mainProcess, changelog } = await installer.getExtensionFiles(extension.repo, extension.version);
    const prepared = installer.prepareExtensionMain(main);
    const installPath = path.join(communityDir(), extension.id);
    await fs.mkdir(installPath, { recursive: true });
    await fs.writeFile(path.join(installPath, "manifest.json"), manifest, "utf8");
    await fs.writeFile(path.join(installPath, "main.js"), prepared.main, "utf8");
    await Promise.all(
      Object.entries(prepared.extraFiles).map(([filename, source]) =>
        fs.writeFile(path.join(installPath, filename), source, "utf8"),
      ),
    );
    if (skill) {
      await fs.writeFile(path.join(installPath, "skill.md"), skill, "utf8");
    }
    if (mainProcess) {
      await fs.writeFile(path.join(installPath, "main-process.js"), mainProcess, "utf8");
    }
    if (changelog) {
      await fs.writeFile(path.join(installPath, "changelog.json"), changelog, "utf8");
    }

    // Parse the downloaded manifest to extract rich metadata
    let manifestData: any = {};
    try {
      manifestData = JSON.parse(manifest);
    } catch {
      // If manifest parsing fails, continue with the sparse registry data
    }

    // Build complete extension data from the manifest
    const installed: ExtensionData = {
      ...extension,
      installedPath: installPath,
      enabled: true,
      icon: manifestData.icon || extension.icon,
      readme: manifestData.readme || extension.readme || "",
      capabilities: manifestData.capabilities || extension.capabilities,
      features: manifestData.features || extension.features,
      dependencies: manifestData.dependencies || extension.dependencies,
      mainProcess: manifestData.mainProcess ?? !!mainProcess,
      permissions: manifestData.permissions ?? [],
    };

    const index = this.store.extensions.findIndex((ext) => ext.id === installed.id);
    if (index > -1) {
      this.store.extensions[index] = installed;
    } else {
      this.store.extensions.push(installed);
    }
    await this.saveInstalledCommunityExtensions();
    return installed;
  }

  async uninstallCommunityExtension(extensionId: string): Promise<void> {
    const idx = this.store.extensions.findIndex((ext) => ext.id === extensionId);
    if (idx < 0) return;
    const ext = this.store.extensions[idx];
    if (ext.installedPath) {
      await fs.rm(ext.installedPath, { recursive: true, force: true });
    }
    if (ext.repo) {
      // Registry plugin: keep as "not installed" so the user can reinstall from the browser.
      this.store.extensions[idx] = { ...ext, installedPath: undefined, enabled: false };
    } else {
      // Zip-installed plugin: no registry entry to fall back to, remove completely.
      this.store.extensions.splice(idx, 1);
    }
    await this.saveInstalledCommunityExtensions();
  }

  async setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    const ext = this.store.extensions.find((ext) => ext.id === extensionId);
    if (!ext) throw new Error("extension not found");
    ext.enabled = enabled;
    if (ext.type === "core") {
      // Persist enabled state globally (shared across windows) in plugins/core-disabled.json.
      const disabled = readDisabledCorePluginsSync();
      if (!enabled) {
        disabled.add(extensionId);
      } else {
        disabled.delete(extensionId);
        // Enabling always clears the uninstalled marker so the plugin becomes locally available again.
        const uninstalled = readUninstalledCorePluginsSync();
        if (uninstalled.has(extensionId)) {
          uninstalled.delete(extensionId);
          await saveUninstalledCorePlugins(uninstalled);
        }
      }
      await saveDisabledCorePlugins(disabled);
    } else if (ext.type === "community") {
      await this.saveInstalledCommunityExtensions();
    }
  }

  async installFromZip(zipPath: string): Promise<ExtensionData> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipPath);
    } catch {
      throw new Error("Failed to open zip file. The file may be corrupted.");
    }

    const entries = zip.getEntries();

    // Resolve prefix: entries can live at root or inside a single top-level folder
    let prefix = "";
    const hasRootManifest = entries.some((e) => e.entryName === "manifest.json");

    if (!hasRootManifest) {
      const topLevelDirs = new Set<string>();
      for (const entry of entries) {
        const parts = entry.entryName.split("/");
        if (parts.length > 1 && parts[0]) {
          topLevelDirs.add(parts[0]);
        }
      }
      if (topLevelDirs.size === 1) {
        prefix = [...topLevelDirs][0] + "/";
        const hasNestedManifest = entries.some((e) => e.entryName === prefix + "manifest.json");
        if (!hasNestedManifest) {
          throw new Error("Zip must contain manifest.json at root level or inside a single folder");
        }
      } else {
        throw new Error("Zip must contain manifest.json at root level or inside a single folder");
      }
    }

    // Parse and validate manifest
    const manifestEntry = zip.getEntry(prefix + "manifest.json");
    if (!manifestEntry) throw new Error("manifest.json not found in zip");

    let manifest: any;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
    } catch {
      throw new Error("manifest.json is not valid JSON");
    }

    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error("manifest.json must contain id, name, and version fields");
    }

    // Check for core extension conflict
    const isCoreExt = coreExtensions.some((ext) => ext.id === manifest.id);
    if (isCoreExt) {
      throw new Error(`Cannot install: "${manifest.id}" conflicts with a core extension`);
    }

    // Extract manifest.json and main.js to the community extensions directory
    const installPath = path.join(communityDir(), manifest.id);
    await fs.mkdir(installPath, { recursive: true });

    await fs.writeFile(path.join(installPath, "manifest.json"), manifestEntry.getData());

    // Prefer {id}.js (canonical build output name); fall back to main.js for older zips
    const mainEntry = zip.getEntry(prefix + `${manifest.id}.js`) ?? zip.getEntry(prefix + "main.js");
    if (!mainEntry) throw new Error(`${manifest.id}.js (or main.js) not found in zip`);
    const preparedZip = installer.prepareExtensionMain(mainEntry.getData().toString("utf8"));
    await fs.writeFile(path.join(installPath, "main.js"), preparedZip.main, "utf8");
    await Promise.all(
      Object.entries(preparedZip.extraFiles).map(([filename, source]) =>
        fs.writeFile(path.join(installPath, filename), source, "utf8"),
      ),
    );

    // Extract skill.md if present — optional, best-effort
    const skillEntry = zip.getEntry(prefix + "skill.md");
    if (skillEntry) {
      await fs.writeFile(path.join(installPath, "skill.md"), skillEntry.getData().toString("utf8"), "utf8");
    }

    // Extract main-process bundle — accepts three naming conventions:
    //   {id}-main.cjs  (canonical, current build output)
    //   {id}-main.js   (legacy renamed format)
    //   main-process.js (older zip.mjs format)
    const mainProcessEntry = entries.find((e) => {
      const name = e.entryName.startsWith(prefix) ? e.entryName.slice(prefix.length) : e.entryName;
      return (name.endsWith("-main.cjs") || name.endsWith("-main.js") || name === "main-process.js") && name !== "main.js";
    });
    if (mainProcessEntry) {
      await fs.writeFile(
        path.join(installPath, "main-process.js"),
        mainProcessEntry.getData().toString("utf8"),
        "utf8",
      );
    }

    // Build ExtensionData
    const extension: ExtensionData = {
      id: manifest.id,
      type: "community",
      name: manifest.name,
      description: manifest.description || "",
      author: manifest.author || "Unknown",
      version: manifest.version,
      enabled: true,
      icon: manifest.icon,
      readme: manifest.readme || "",
      installedPath: installPath,
      capabilities: manifest.capabilities,
      features: manifest.features,
      dependencies: manifest.dependencies,
      mainProcess: manifest.mainProcess ?? !!mainProcessEntry,
      permissions: manifest.permissions ?? [],
    };

    // Add or update in store
    const index = this.store.extensions.findIndex((ext) => ext.id === extension.id);
    if (index > -1) {
      this.store.extensions[index] = extension;
    } else {
      this.store.extensions.push(extension);
    }
    await this.saveInstalledCommunityExtensions();

    return extension;
  }

  // getRemoteExtensions remains unchanged: it returns ALL available extensions for browsing.
  // note: enabled/disabled does not apply to remote list.
}
