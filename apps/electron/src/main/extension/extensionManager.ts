// extensionManager.ts
import { getRemoteExtensions } from "./extensionFetcher";
import * as installer from "./extensionInstaller";
import fs from "fs/promises";
import path from "path";
import { app } from "electron";
import { AppState, ExtensionData } from "src/shared/types";
import { coreExtensions } from "../config/coreExtensions";
import AdmZip from "adm-zip";

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
   * - User's enabled/disabled preferences are preserved
   */
  private syncCoreExtensions(): void {
    const existingCoreExtensions = this.store.extensions.filter((ext) => ext.type === "core");
    const syncedCoreExtensions: ExtensionData[] = [];

    for (const coreExt of coreExtensions) {
      // Check if this core extension already exists in state
      const existing = existingCoreExtensions.find((ext) => ext.id === coreExt.id);

      if (existing) {
        // Preserve user's enabled/disabled preference, but update other metadata
        syncedCoreExtensions.push({
          ...coreExt,
          enabled: existing.enabled, // Preserve user preference
        });
      } else {
        // New core extension - add it with default enabled state from config
        syncedCoreExtensions.push(coreExt);
      }
    }

    // Replace core extensions in state with synced versions
    this.store.extensions = [
      ...syncedCoreExtensions,
      ...this.store.extensions.filter((ext) => ext.type !== "core"),
    ];
  }

  async saveInstalledCommunityExtensions(): Promise<void> {
    const communityExtensions = this.store.extensions.filter((ext) => ext.type === "community");
    await fs.mkdir(communityDir, { recursive: true });
    await fs.writeFile(path.join(communityDir, "installed.json"), JSON.stringify(communityExtensions), "utf8");
  }

  async getAllExtensions(): Promise<ExtensionData[]> {
    // this list comes solely from centralized appState
    const remoteExtensions = await getRemoteExtensions();
    // make sure there are no duplicates
    const allExtensions = [...this.store.extensions, ...remoteExtensions].filter(
      (ext, index, self) => self.findIndex((t) => t.id === ext.id) === index,
    );
    return allExtensions;
  }

  async installCommunityExtension(extension: ExtensionData): Promise<ExtensionData> {
    if (!extension.repo) {
      throw new Error("repo not defined");
    }
    const { manifest, main, skill } = await installer.getExtensionFiles(extension.repo, extension.version);
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
    const ext = this.store.extensions.find((ext) => ext.id === extensionId);
    if (ext && ext.installedPath) {
      await fs.rm(ext.installedPath, { recursive: true, force: true });
      // remove extension from centralized appState
      this.store.extensions = this.store.extensions.filter((ext) => ext.id !== extensionId);
      await this.saveInstalledCommunityExtensions();
    }
  }

  async setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    const ext = this.store.extensions.find((ext) => ext.id === extensionId);
    if (!ext) throw new Error("extension not found");
    ext.enabled = enabled;
    if (ext.type === "community") {
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
