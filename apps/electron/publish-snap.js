#!/usr/bin/env node

/**
 * Voiden Snap Publisher
 *
 * Builds a .snap from the already-built .deb and publishes to the Snap Store.
 * Must be run on Linux with snapcraft installed.
 *
 * Usage:
 *   node publish-snap.js [beta|stable]
 *
 * Prerequisites:
 *   sudo snap install snapcraft --classic
 *   snapcraft login  (one-time — logs into your Snap Store account)
 *
 * Users install with:
 *   sudo snap install voiden
 *   sudo snap install voiden --channel=beta   # beta channel
 */

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version     = packageJson.version;
const isBetaBuild = version.includes('beta') || version.includes('alpha') || version.includes('rc');
const channel     = process.argv[2] || (isBetaBuild ? 'beta' : 'stable');

if (!['beta', 'stable'].includes(channel)) {
  console.error('Usage: node publish-snap.js [beta|stable]');
  process.exit(1);
}

// Snap Store channel: stable → stable, beta → beta/edge
const snapChannel = channel === 'beta' ? 'beta' : 'stable';

console.log(`\n📦 Snap Publisher — Voiden v${version} [${channel}]`);
console.log(`   snap channel : ${snapChannel}\n`);

// ─── Check prerequisites ──────────────────────────────────────────────────────

function checkCommand(cmd) {
  const result = spawnSync('which', [cmd]);
  if (result.status !== 0) {
    console.error(`❌ '${cmd}' not found. Install with: sudo snap install ${cmd} --classic`);
    process.exit(1);
  }
}

if (process.platform !== 'linux') {
  console.error('❌ Snap builds must run on Linux.');
  process.exit(1);
}

checkCommand('snapcraft');

// ─── Find .deb artifact ───────────────────────────────────────────────────────

const makeDir = path.join(__dirname, 'out', 'make', 'deb');
let debPath = null;

for (const arch of ['x64', 'arm64']) {
  const dir   = path.join(makeDir, arch);
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.deb'));
  if (files.length > 0) { debPath = path.join(dir, files[0]); break; }
}

if (!debPath) {
  console.error('❌ No .deb found in out/make/deb/. Run `electron-forge make` first.');
  process.exit(1);
}

console.log(`   .deb : ${path.basename(debPath)}\n`);

// ─── Stamp version into snapcraft.yaml ───────────────────────────────────────

const snapcraftYamlPath = path.join(__dirname, 'snapcraft.yaml');
let snapcraftYaml = fs.readFileSync(snapcraftYamlPath, 'utf-8');
snapcraftYaml = snapcraftYaml.replace(/^version:.*$/m, `version: "${version}"`);
snapcraftYaml = snapcraftYaml.replace(/^grade:.*$/m, `grade: stable`);
fs.writeFileSync(snapcraftYamlPath, snapcraftYaml);
console.log(`   ✓ Stamped version ${version} into snapcraft.yaml`);

// ─── Build snap ───────────────────────────────────────────────────────────────

console.log('\n🔨 Building snap (this may take a few minutes)...\n');

const buildResult = spawnSync('snapcraft', ['--destructive-mode'], {
  cwd:   __dirname,
  stdio: 'inherit',
});

if (buildResult.status !== 0) {
  console.error('\n❌ snapcraft build failed.');
  process.exit(1);
}

// Find the produced .snap file
const snapFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.snap'));
if (snapFiles.length === 0) {
  console.error('❌ No .snap file produced after build.');
  process.exit(1);
}
const snapFile = snapFiles[0];
console.log(`\n   ✓ Built: ${snapFile}`);

// ─── Upload to Snap Store ─────────────────────────────────────────────────────

console.log(`\n📤 Uploading to Snap Store (channel: ${snapChannel})...\n`);

const uploadResult = spawnSync('snapcraft', [
  'upload',
  path.join(__dirname, snapFile),
  '--release', snapChannel,
], {
  cwd:    __dirname,
  stdio:  ['inherit', 'pipe', 'pipe'],
  encoding: 'utf-8',
});

const uploadStdout = uploadResult.stdout || '';
const uploadStderr = uploadResult.stderr || '';

// Print output regardless so user sees what snapcraft said
if (uploadStdout) process.stdout.write(uploadStdout);
if (uploadStderr) process.stderr.write(uploadStderr);

if (uploadResult.status !== 0) {
  console.error('\n❌ Snap Store upload failed. Snapcraft output above shows the actual reason.');
  process.exit(1);
}

console.log(`\n✅ Snap published to Snap Store!\n`);
console.log('─── User install command ────────────────────────────────────\n');
if (channel === 'beta') {
  console.log('sudo snap install voiden --channel=beta');
} else {
  console.log('sudo snap install voiden');
}
console.log('');
