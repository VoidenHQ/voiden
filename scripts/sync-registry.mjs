#!/usr/bin/env node
/**
 * registry:sync
 *
 * Copies plugins/core-plugins-registry/registry.json →
 *         apps/electron/src/core-plugins-registry.json
 *
 * No network call — reads from the locally cloned registry repo.
 * Run setup-plugins.sh first if the clone doesn't exist yet.
 *
 * Usage: node scripts/sync-registry.mjs
 *        yarn registry:sync
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC = resolve(ROOT, 'plugins', 'core-plugins-registry', 'registry.json');
const DEST = resolve(ROOT, 'apps', 'electron', 'src', 'core-plugins-registry.json');

if (!existsSync(SRC)) {
  console.error(`[registry:sync] ERROR: ${SRC} not found.`);
  console.error('[registry:sync] Run "bash scripts/setup-plugins.sh" first to clone the registry repo.');
  process.exit(1);
}

const registry = JSON.parse(readFileSync(SRC, 'utf8'));
writeFileSync(DEST, JSON.stringify(registry, null, 2) + '\n');

const count = Object.keys(registry.plugins ?? {}).length;
console.log(`[registry:sync] ✓ Synced ${count} plugin(s) → apps/electron/src/core-plugins-registry.json`);
