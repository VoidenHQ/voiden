#!/usr/bin/env node

/**
 * Voiden Chocolatey Publisher
 *
 * Packs and pushes the Chocolatey package (apps/electron/chocolatey/) for the
 * already-built Windows installer. Must run on Windows (Chocolatey CLI is
 * Windows-only) — GitHub-hosted windows-* runners ship `choco` preinstalled.
 *
 * Usage:
 *   node publish-choco.js [beta|stable]
 *
 * Required env vars:
 *   CHOCOLATEY_API_KEY — from https://community.chocolatey.org/account (after
 *                        claiming/publishing the "voiden" package id there once)
 *
 * Notes:
 *   - Beta builds publish as a Chocolatey prerelease (NuGet prerelease semver,
 *     e.g. 2.3.0-beta.1) — installable via `choco install voiden --pre`.
 *   - The install script points at the versioned GitHub Release asset
 *     (.../releases/download/vX.Y.Z/Voiden.Setup.X.Y.Z.exe), not a "latest" alias —
 *     that URL must stay immutable forever once a version is published, since
 *     Chocolatey (and users' pinned installs) will re-verify against the recorded
 *     checksum indefinitely.
 *   - New Chocolatey package ids go through moderator review on first publish;
 *     subsequent version pushes are typically automatic once trusted.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;
const isBetaBuild = version.includes('beta') || version.includes('alpha') || version.includes('rc');
const channel = process.argv[2] || (isBetaBuild ? 'beta' : 'stable');

console.log(`\n📦 Chocolatey Publisher — Voiden v${version} [${channel}]\n`);

if (channel !== 'beta' && channel !== 'stable') {
  console.log(`ℹ️  Nothing to publish for channel "${channel}". Skipping.\n`);
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.error('❌ Chocolatey packaging must run on Windows (choco.exe is Windows-only).');
  process.exit(1);
}

const apiKey = process.env.CHOCOLATEY_API_KEY;
if (!apiKey) {
  console.error('❌ CHOCOLATEY_API_KEY is not set. Get one from https://community.chocolatey.org/account');
  console.error('   after claiming the "voiden" package id, and store it as the CHOCOLATEY_API_KEY secret.');
  process.exit(1);
}

function checkCommand(cmd) {
  const result = spawnSync('where', [cmd]);
  if (result.status !== 0) {
    console.error(`❌ '${cmd}' not found on PATH.`);
    process.exit(1);
  }
}
checkCommand('choco');

// ─── Find the built .exe ────────────────────────────────────────────────────────

function findExe(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findExe(full);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith('.exe')) {
      return full;
    }
  }
  return null;
}

const makeDir = path.join(__dirname, 'out', 'make');
const exePath = findExe(makeDir);
if (!exePath) {
  console.error(`❌ No .exe found under ${makeDir}. Run \`electron-forge make\` first.`);
  process.exit(1);
}
console.log(`   installer : ${path.basename(exePath)}`);

const checksum = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex').toUpperCase();
console.log(`   sha256    : ${checksum}\n`);

// ─── Stamp version + checksum into a scratch copy of the package ────────────────

const srcDir = path.join(__dirname, 'chocolatey');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiden-choco-'));
fs.cpSync(srcDir, workDir, { recursive: true });

const installScriptPath = path.join(workDir, 'tools', 'chocolateyinstall.ps1');
let installScript = fs.readFileSync(installScriptPath, 'utf-8');
installScript = installScript
  .replace('__VERSION__', version)
  .replace('__CHECKSUM__', checksum);
fs.writeFileSync(installScriptPath, installScript);

// ─── Pack ───────────────────────────────────────────────────────────────────────

console.log('🔨 Packing .nupkg...\n');
const packResult = spawnSync('choco', [
  'pack', path.join(workDir, 'voiden.nuspec'),
  '--version', version,
  '--outputdirectory', workDir,
], { stdio: 'inherit' });

if (packResult.status !== 0) {
  console.error('\n❌ choco pack failed.');
  process.exit(1);
}

const nupkgName = `voiden.${version}.nupkg`;
const nupkgPath = path.join(workDir, nupkgName);
if (!fs.existsSync(nupkgPath)) {
  console.error(`❌ Expected ${nupkgPath} after pack but it wasn't produced.`);
  process.exit(1);
}

// Exposes the built package to a later CI step (e.g. actions/upload-artifact)
// so it can be downloaded and pushed manually if `choco push` below fails —
// the nupkg itself is already fully built at this point regardless of push.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `nupkg_path=${nupkgPath}\n`);
}

// ─── Push ───────────────────────────────────────────────────────────────────────
//
// choco.exe has no built-in retry for transient server errors (a long-standing
// gap: https://github.com/chocolatey/choco/issues/385), and push.chocolatey.org
// gateway timeouts (504) do happen. Retry a few times with backoff before
// giving up, rather than failing outright on the first transient hiccup.

const PUSH_RETRIES = 4;
const PUSH_BACKOFF_MS = [15_000, 30_000, 60_000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pushWithRetry() {
  for (let attempt = 1; attempt <= PUSH_RETRIES; attempt++) {
    console.log(`\n📤 Pushing ${nupkgName} to Chocolatey Community Repository... (attempt ${attempt}/${PUSH_RETRIES})\n`);
    const pushResult = spawnSync('choco', [
      'push', nupkgPath,
      '--source', 'https://push.chocolatey.org/',
      '--api-key', apiKey,
    ], { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf-8' });

    const pushStdout = pushResult.stdout || '';
    const pushStderr = pushResult.stderr || '';
    if (pushStdout) process.stdout.write(pushStdout);
    if (pushStderr) process.stderr.write(pushStderr);

    if (pushResult.status === 0) return;

    if (/already exists and cannot be modified/i.test(pushStdout + pushStderr)) {
      console.log(`\nℹ️  voiden ${version} was already pushed. Nothing to do.\n`);
      process.exit(0);
    }

    const isTransientGatewayError = /50[234] /.test(pushStdout + pushStderr);
    const attemptsLeft = attempt < PUSH_RETRIES;
    if (isTransientGatewayError && attemptsLeft) {
      const delayMs = PUSH_BACKOFF_MS[attempt - 1] ?? PUSH_BACKOFF_MS[PUSH_BACKOFF_MS.length - 1];
      console.log(`\n⚠️  Transient gateway error — retrying in ${delayMs / 1000}s...\n`);
      await sleep(delayMs);
      continue;
    }

    console.error('\n❌ choco push failed. Output above shows the actual reason.');
    process.exit(1);
  }
}

(async () => {
  await pushWithRetry();

  console.log(`\n✅ Pushed voiden ${version} to Chocolatey.\n`);
  console.log('─── User install command ────────────────────────────────────\n');
  console.log('choco install voiden\n');
})();
