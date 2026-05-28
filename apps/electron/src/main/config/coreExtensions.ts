import type { ExtensionData } from '../../shared/types';
import { app } from 'electron';
import * as https from 'node:https';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const CORE_REGISTRY_URL = 'https://raw.githubusercontent.com/VoidenHQ/core-plugins-registry/main/registry.json';

function mapPlugins(reg: any): ExtensionData[] {
  if (!reg || !reg.plugins) return [];
  return Object.values(reg.plugins)
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
      mainProcess: p.mainProcess ?? false,
      voidenVersion: p.voidenVersion,
    }));
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Voiden-App' } }, (res) => {
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
    const remote = JSON.parse(raw);
    if (remote?.plugins) {
      const localIds = new Set(coreExtensionsSnapshot.map((e: ExtensionData) => e.id));

      remoteVersions.clear();
      remoteNewPlugins.length = 0;

      for (const [id, p] of Object.entries(remote.plugins as Record<string, any>)) {
        if (p.version) remoteVersions.set(id, p.version);

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
let _snapshot: any = { plugins: {} };
try {
  const possiblePaths = [
    // Dev: local registry clone populated by setup-plugins.sh (always freshest in dev)
    join(app.getAppPath(), '..', '..', 'plugins', 'core-plugins-registry', 'registry.json'),
    // Dev: snapshot synced via yarn registry:sync
    join(app.getAppPath(), 'src', 'core-plugins-registry.json'),
    // Packaged: baked into ASAR by forge generateAssets
    join(app.getAppPath(), 'core-plugins-registry.json'),
    // Packaged: resources directory outside ASAR
    join(process.resourcesPath, 'core-plugins-registry.json'),
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
    _snapshot = require('../../core-plugins-registry.json');
  } catch { /* ignored */ }
}

export const coreExtensions: ExtensionData[] = mapPlugins(_snapshot);
// Alias for use inside fetchAndUpdateCoreRegistry (avoids a forward-reference problem)
const coreExtensionsSnapshot = coreExtensions;
