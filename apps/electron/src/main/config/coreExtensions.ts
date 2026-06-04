import type { ExtensionData } from '../../shared/types';
import { app } from 'electron';
import * as https from 'node:https';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const CORE_REGISTRY_URL = 'https://raw.githubusercontent.com/VoidenHQ/plugin-registry/main/extensions.json';

function mapPlugins(reg: any): ExtensionData[] {
  const entries: any[] = Array.isArray(reg)
    ? reg.filter((p: any) => p.type === 'core')
    : Object.values(reg?.plugins ?? {});
  return entries
    .map((p: any) => ({
      id: p.id,
      type: 'core' as const,
      name: p.name,
      description: p.description,
      author: p.author,
      version: p.version,
      // enabled is not stored in the registry — it is always derived at runtime
      // by syncCoreExtensions() from bundled status + user history.
      enabled: false,
      priority: p.priority,
      readme: p.readme ?? '',
      capabilities: p.capabilities,
      features: p.features,
      repo: p.repo,
      icon: p.icon,
      bundled: p.bundled ?? false,
      mainProcess: p.mainProcess ?? false,
      voidenVersion: p.voidenVersion,
    }));
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Voiden-App', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Remote version map populated by fetchAndUpdateCoreRegistry.
 * Keys are plugin IDs, values are the latest version strings from GitHub.
 * Used by checkForUpdates to compare against the locally installed version.
 * coreExtensions itself always reflects the local snapshot and is never mutated.
 */
export const remoteVersions: Map<string, string> = new Map();

/**
 * voidenVersion constraints fetched from the live remote registry.
 * Takes precedence over the local snapshot when checking update compatibility.
 */
export const remoteVoidenVersions: Map<string, string> = new Map();

/**
 * Plugins that exist in the remote registry but NOT in the local snapshot.
 * Populated by fetchAndUpdateCoreRegistry so they can be shown in the Extension
 * Browser even when the user hasn't updated the app yet.
 */
export const remoteNewPlugins: ExtensionData[] = [];

/**
 * Fetches the remote registry from GitHub, populates remoteVersions (for update
 * detection) and remoteNewPlugins (for brand-new plugins not in the local snapshot).
 */
export async function fetchAndUpdateCoreRegistry(): Promise<void> {
  try {
    const raw = await httpsGet(CORE_REGISTRY_URL);
    const parsed = JSON.parse(raw);
    const entries: any[] = Array.isArray(parsed)
      ? parsed.filter((p: any) => p.type === 'core')
      : Object.values(parsed?.plugins ?? {});

    if (entries.length > 0) {
      const localIds = new Set(coreExtensionsSnapshot.map((e: ExtensionData) => e.id));

      remoteVersions.clear();
      remoteVoidenVersions.clear();
      remoteNewPlugins.length = 0;

      for (const p of entries) {
        const id: string = p.id;
        if (p.version) remoteVersions.set(id, p.version);
        if (p.voidenVersion) remoteVoidenVersions.set(id, p.voidenVersion);

        // New plugin — not in local snapshot at all
        if (!localIds.has(id)) {
          remoteNewPlugins.push({
            id: p.id,
            type: 'core' as const,
            name: p.name,
            description: p.description ?? '',
            author: p.author ?? 'Voiden Team',
            version: p.version,
            enabled: false,
            priority: p.priority,
            readme: p.readme ?? '',
            capabilities: p.capabilities,
            features: p.features,
            repo: p.repo,
            icon: p.icon,
            bundled: p.bundled ?? false,
            mainProcess: p.mainProcess ?? false,
            voidenVersion: p.voidenVersion,
          });
        }
      }

      console.log('[CoreRegistry] Fetched remote registry:', remoteVersions.size, 'plugins,', remoteNewPlugins.length, 'new');
    }
  } catch (err) {
    console.warn('[CoreRegistry] Failed to fetch remote registry:', err instanceof Error ? err.message : err);
  }
}

// Seed from the build-time snapshot so core plugins are available immediately.
let _snapshot: any = [];
try {
  const possiblePaths = [
    // Dev: local registry clone populated by cleanup.sh (always freshest in dev)
    join(app.getAppPath(), '..', '..', 'plugins', 'plugin-registry', 'extensions.json'),
    // Dev: snapshot synced via yarn registry:sync
    join(app.getAppPath(), 'src', 'extensions.json'),
    // Packaged: baked into ASAR by forge generateAssets
    join(app.getAppPath(), 'extensions.json'),
    // Packaged: resources directory outside ASAR
    join(process.resourcesPath, 'extensions.json'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      _snapshot = JSON.parse(readFileSync(p, 'utf8'));
      console.log(`[CoreRegistry] Loaded snapshot from: ${p}`);
      break;
    }
  }
} catch (err) {
  try {
    _snapshot = require('../../extensions.json');
  } catch { /* ignored */ }
}

export const coreExtensions: ExtensionData[] = mapPlugins(_snapshot);
// Alias for use inside fetchAndUpdateCoreRegistry (avoids a forward-reference problem)
const coreExtensionsSnapshot = coreExtensions;
