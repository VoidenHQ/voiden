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

// Tracks plugins the user has explicitly disabled (persisted globally, not per-window).
const disabledCorePath = () => path.join(app.getPath("userData"), "disabled-core-plugins.json");

function readDisabledCorePluginsSync(): Set<string> {
  try {
    const raw = require("fs").readFileSync(disabledCorePath(), "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveDisabledCorePlugins(ids: Set<string>): Promise<void> {
  await fs.writeFile(disabledCorePath(), JSON.stringify([...ids], null, 2));
}

const communityDir = path.join(app.getPath("userData"), "extensions");

export class ExtensionManager {
  constructor(private store: AppState) {}

  async loadInstalledCommunityExtensions(): Promise<void> {
    // Sync core extensions from config - this ensures new core extensions are automatically added
    this.syncCoreExtensions();

    try {
      const data = await fs.readFile(path.join(communityDir, "installed.json"), "utf8");
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
              readme: manifest.readme || ext.readme || "",
              capabilities: manifest.capabilities || ext.capabilities,
              features: manifest.features || ext.features,
              dependencies: manifest.dependencies || ext.dependencies,
              mainProcess: manifest.mainProcess ?? ext.mainProcess,
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
   * - User's enabled/disabled preferences are preserved (via disabled-core-plugins.json, shared across all windows)
   */
  syncCoreExtensions(): void {
    // Enabled state is global (shared across windows), not per-window.
    // A plugin is enabled by default if it is installed; explicit disable is tracked in disabled-core-plugins.json.
    const disabled = readDisabledCorePluginsSync();

    const isBundledLocally = (pluginId: string): boolean => {
      if (app.isPackaged) {
        return existsSync(path.join(process.resourcesPath, "bundled-plugins", `${pluginId}.js`));
      }
      return existsSync(path.join(app.getAppPath(), "bundled-plugins", `${pluginId}.js`));
    };

    const isOtaCached = (pluginId: string): boolean => {
      const cacheDir = path.join(app.getPath("userData"), "core-extensions-cache");
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
      const cacheDir = path.join(app.getPath("userData"), "core-extensions-cache");
      try {
        const manifest = JSON.parse(readFileSync(path.join(cacheDir, "manifest.json"), "utf8"));
        return manifest?.plugins?.[pluginId]?.version ?? null;
      } catch {
        return null;
      }
    };

    const syncedCoreExtensions: ExtensionData[] = coreExtensions.map((coreExt) => {
      const installed = isBundledLocally(coreExt.id) || isOtaCached(coreExt.id);
      // Priority: OTA-installed version > remote registry version (for "available to install" display) > local snapshot fallback
      const effectiveVersion = getOtaCachedVersion(coreExt.id) ?? remoteVersions.get(coreExt.id) ?? coreExt.version;
      return {
        ...coreExt,
        version: effectiveVersion,
        // Enabled = installed AND not explicitly disabled by user.
        // This is window-independent: reads from disabled-core-plugins.json, not from window state.
        enabled: installed && !disabled.has(coreExt.id),
        isLocallyAvailable: installed,
      };
    });

    // Append plugins that exist in the remote registry but not in the local snapshot.
    // These are OTA-only new plugins the user can install but haven't been bundled yet.
    const existingIds = new Set(syncedCoreExtensions.map((e) => e.id));
    const newRemoteExtensions: ExtensionData[] = remoteNewPlugins
      .filter((p) => !existingIds.has(p.id))
      .map((p) => {
        const locallyAvailable = isBundledLocally(p.id) || isOtaCached(p.id);
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

  /** Disable a core plugin and delete its OTA cache (user-initiated uninstall from Extension Browser). */
  async uninstallCoreExtension(pluginId: string): Promise<void> {
    const disabled = readDisabledCorePluginsSync();
    disabled.add(pluginId);
    await saveDisabledCorePlugins(disabled);
    this.syncCoreExtensions();

    const cacheDir = path.join(app.getPath("userData"), "core-extensions-cache");
    const pluginCacheDir = path.join(cacheDir, pluginId);
    if (existsSync(pluginCacheDir)) {
      await fs.rm(pluginCacheDir, { recursive: true, force: true });
      const manifestPath = path.join(cacheDir, "manifest.json");
      try {
        const cached = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        delete cached.plugins[pluginId];
        await fs.writeFile(manifestPath, JSON.stringify(cached, null, 2));
      } catch { /* ignore */ }
    }
  }

  /** Re-enable a previously uninstalled core plugin. */
  async reinstallCoreExtension(pluginId: string): Promise<void> {
    const disabled = readDisabledCorePluginsSync();
    disabled.delete(pluginId);
    await saveDisabledCorePlugins(disabled);
    this.syncCoreExtensions();
  }

  async saveInstalledCommunityExtensions(): Promise<void> {
    const communityExtensions = this.store.extensions.filter((ext) => ext.type === "community");
    await fs.mkdir(communityDir, { recursive: true });
    await fs.writeFile(path.join(communityDir, "installed.json"), JSON.stringify(communityExtensions), "utf8");
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
    // Attach latestVersion if remote version differs and is compatible with the running app
    const appVersion = app.getVersion();
    return allExtensions.map((ext) => {
      const remoteExt = remoteExtensions.find((r) => r.id === ext.id);
      if (remoteExt && remoteExt.version !== ext.version) {
        const voidenVersion = (remoteExt as any).voidenVersion as string | undefined;
        const compatible = voidenVersion ? satisfiesVersionRange(appVersion, voidenVersion) : true;
        if (compatible) return { ...ext, latestVersion: remoteExt.version };
      }
      return ext;
    });
  }

  async installCommunityExtension(extension: ExtensionData): Promise<ExtensionData> {
    if (!extension.repo) {
      throw new Error("repo not defined");
    }
    const { manifest, main, skill, mainProcess } = await installer.getExtensionFiles(extension.repo, extension.version);
    const prepared = installer.prepareExtensionMain(main);
    const installPath = path.join(communityDir, extension.id);
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
      readme: manifestData.readme || extension.readme || "",
      capabilities: manifestData.capabilities || extension.capabilities,
      features: manifestData.features || extension.features,
      dependencies: manifestData.dependencies || extension.dependencies,
      mainProcess: manifestData.mainProcess ?? !!mainProcess,
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
    // Keep extension in store as "not installed" so it stays visible in Extension Browser.
    // UI shows "Install" button when installedPath is falsy.
    this.store.extensions[idx] = { ...ext, installedPath: undefined, enabled: false };
    await this.saveInstalledCommunityExtensions();
  }

  async setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    const ext = this.store.extensions.find((ext) => ext.id === extensionId);
    if (!ext) throw new Error("extension not found");
    ext.enabled = enabled;
    if (ext.type === "core") {
      // Persist enabled state globally (shared across windows) in disabled-core-plugins.json.
      const disabled = readDisabledCorePluginsSync();
      if (!enabled) {
        disabled.add(extensionId);
      } else {
        disabled.delete(extensionId);
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

    // Look for manifest.json and main.js — either at root or inside a single top-level folder
    let prefix = "";
    const hasRootManifest = entries.some((e) => e.entryName === "manifest.json");
    const hasRootMain = entries.some((e) => e.entryName === "main.js");

    if (!hasRootManifest || !hasRootMain) {
      // Check for a single top-level directory
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
        const hasNestedMain = entries.some((e) => e.entryName === prefix + "main.js");
        if (!hasNestedManifest || !hasNestedMain) {
          throw new Error("Zip must contain manifest.json and main.js");
        }
      } else {
        throw new Error("Zip must contain manifest.json and main.js at root level or inside a single folder");
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
    const installPath = path.join(communityDir, manifest.id);
    await fs.mkdir(installPath, { recursive: true });

    await fs.writeFile(path.join(installPath, "manifest.json"), manifestEntry.getData());

    const mainEntry = zip.getEntry(prefix + "main.js");
    if (!mainEntry) throw new Error("main.js not found in zip");
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

    // Extract main-process bundle if present — named {pluginId}-main.js by convention
    const mainProcessEntry = entries.find((e) => {
      const name = e.entryName.startsWith(prefix) ? e.entryName.slice(prefix.length) : e.entryName;
      return name.endsWith("-main.js") && name !== "main.js";
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
      readme: manifest.readme || "",
      installedPath: installPath,
      capabilities: manifest.capabilities,
      features: manifest.features,
      dependencies: manifest.dependencies,
      mainProcess: manifest.mainProcess ?? !!mainProcessEntry,
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
