#!/usr/bin/env node
/**
 * registry:update  /  registry:update:push
 *
 * Reads each plugins/plugin-{id}/manifest.json, updates the matching entry in
 * plugins/plugin-registry/extensions.json, then syncs the snapshot to
 * apps/electron/src/extensions.json.
 *
 * With --push: also commits and pushes the updated extensions.json to
 * VoidenHQ/plugin-registry (requires the clone to be authenticated).
 *
 * Usage:
 *   node scripts/update-registry.mjs           # update locally
 *   node scripts/update-registry.mjs --push    # update + push to remote
 *   yarn registry:update
 *   yarn registry:update:push
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = resolve(ROOT, 'plugins');
const REGISTRY_CLONE = resolve(PLUGINS_DIR, 'plugin-registry', 'extensions.json');
const SNAPSHOT = resolve(ROOT, 'apps', 'electron', 'src', 'extensions.json');

const shouldPush = process.argv.includes('--push');

if (!existsSync(REGISTRY_CLONE)) {
  console.error(`[registry:update] ERROR: ${REGISTRY_CLONE} not found.`);
  console.error('[registry:update] Run "bash scripts/setup-plugins.sh" first.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(REGISTRY_CLONE, 'utf8'));
// Support both flat array (new format) and legacy { plugins: {} } object
const registry: any[] = Array.isArray(raw) ? raw : Object.values(raw?.plugins ?? {});

let updated = 0;
let failed = 0;

const pluginDirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('plugin-'))
  .map((d) => d.name);

for (const dir of pluginDirs) {
  const manifestPath = join(PLUGINS_DIR, dir, 'manifest.json');
  if (!existsSync(manifestPath)) continue;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.warn(`[registry:update] ✗ Could not parse ${manifestPath}: ${e.message}`);
    failed++;
    continue;
  }

  const { id, version, name } = manifest;
  if (!id || !version || !name) {
    console.warn(`[registry:update] ✗ ${dir}/manifest.json missing required fields (id, version, name) — skipping`);
    failed++;
    continue;
  }

  const idx = registry.findIndex((p) => p.id === id);
  const existing = idx >= 0 ? registry[idx] : { type: 'core' };
  const updated_entry = {
    ...existing,
    id,
    name,
    version,
    ...(manifest.description !== undefined && { description: manifest.description }),
    ...(manifest.author !== undefined && { author: manifest.author }),
    ...(manifest.repo !== undefined && { repo: manifest.repo }),
    ...(manifest.voidenVersion !== undefined && { voidenVersion: manifest.voidenVersion }),
    ...(manifest.bundled !== undefined && { bundled: manifest.bundled }),
    ...(manifest.mainProcess !== undefined && { mainProcess: manifest.mainProcess }),
    ...(manifest.priority !== undefined && { priority: manifest.priority }),
    ...(manifest.capabilities !== undefined && { capabilities: manifest.capabilities }),
    ...(manifest.features !== undefined && { features: manifest.features }),
  };

  if (idx >= 0) {
    registry[idx] = updated_entry;
  } else {
    registry.push(updated_entry);
  }

  console.log(`[registry:update] ✓ ${id} → v${version}`);
  updated++;
}

if (failed > 0) {
  console.error(`[registry:update] ${failed} plugin(s) had errors — aborting without writing.`);
  process.exit(1);
}

// Write back to registry clone
writeFileSync(REGISTRY_CLONE, JSON.stringify(registry, null, 2) + '\n');
console.log(`[registry:update] Updated ${updated} plugin(s) in registry clone.`);

// Sync snapshot (only core entries)
const coreEntries = registry.filter((p) => p.type === 'core');
writeFileSync(SNAPSHOT, JSON.stringify(coreEntries, null, 2) + '\n');
console.log(`[registry:update] ✓ Synced snapshot → apps/electron/src/extensions.json`);

if (shouldPush) {
  const registryDir = resolve(PLUGINS_DIR, 'plugin-registry');
  try {
    execSync('git add extensions.json', { cwd: registryDir, stdio: 'inherit' });
    execSync('git commit -m "chore: update registry from local plugin manifests"', { cwd: registryDir, stdio: 'inherit' });
    execSync('git push', { cwd: registryDir, stdio: 'inherit' });
    console.log('[registry:update] ✓ Pushed updated registry to VoidenHQ/plugin-registry');
  } catch (e) {
    console.error('[registry:update] ✗ Push failed:', e.message);
    process.exit(1);
  }
} else {
  console.log('[registry:update] Run "yarn registry:update:push" to also push to VoidenHQ/plugin-registry.');
}
