import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

export const pluginsRoot      = () => path.join(app.getPath('userData'), 'plugins');
export const coreCacheDir     = () => path.join(pluginsRoot(), 'core');
export const communityDir     = () => path.join(pluginsRoot(), 'community');
export const coreDisabledPath    = () => path.join(pluginsRoot(), 'core-disabled.json');
export const coreUninstalledPath = () => path.join(pluginsRoot(), 'core-uninstalled.json');
export const githubCachePath     = () => path.join(pluginsRoot(), 'github-cache.json');

/**
 * One-time migration: moves all plugin-related files from their old scattered
 * locations under userData/ into the unified plugins/ directory.
 * Safe to call every startup — no-ops if already migrated.
 */
export async function migratePluginPaths(): Promise<void> {
  const userData = app.getPath('userData');
  await fs.mkdir(pluginsRoot(), { recursive: true });

  const moves: [string, string][] = [
    [path.join(userData, 'core-extensions-cache'), coreCacheDir()],
    [path.join(userData, 'extensions'),            communityDir()],
    [path.join(userData, 'disabled-core-plugins.json'), coreDisabledPath()],
    [path.join(userData, 'github-api-cache.json'),      githubCachePath()],
  ];

  for (const [oldPath, newPath] of moves) {
    if (existsSync(oldPath) && !existsSync(newPath)) {
      await fs.rename(oldPath, newPath).catch(() => {
        // rename fails across devices — shouldn't happen within userData but handle gracefully
      });
    }
  }
}
