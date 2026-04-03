#!/usr/bin/env node

/**
 * Voiden APT Repository Publisher
 *
 * Generates APT repo metadata from the built .deb and publishes to S3.
 * Run this after `electron-forge make` on a Linux machine.
 *
 * Usage:
 *   node publish-apt.js [beta|stable]
 *
 * Required env vars (loaded from ../../.env):
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_BUCKET_NAME_BETA or S3_BUCKET_NAME_STABLE
 *   S3_REGION (default: eu-west-1)
 *
 * Optional env vars:
 *   VOIDEN_GPG_KEY_ID  — GPG key ID for signing InRelease / Release.gpg
 *                        If not set, repo is published unsigned (users need trusted=yes)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;
const isBetaBuild = version.includes('beta') || version.includes('alpha') || version.includes('rc');

const channel = process.argv[2] || (isBetaBuild ? 'beta' : 'stable');

if (!['beta', 'stable'].includes(channel)) {
  console.error('Usage: node publish-apt.js [beta|stable]');
  process.exit(1);
}

const suite = channel;
const bucket = channel === 'beta'
  ? process.env.S3_BUCKET_NAME_BETA || 'voiden-beta-releases'
  : process.env.S3_BUCKET_NAME_STABLE || 'voiden-releases';
const region = process.env.S3_REGION || 'eu-west-1';
const gpgKeyId = process.env.VOIDEN_GPG_KEY_ID;

// ─── Find .deb ───────────────────────────────────────────────────────────────

const makeDir = path.join(__dirname, 'out', 'make', 'deb');
let debPath = null;
let debArch = 'amd64';

for (const [forgeArch, debArchName] of [['x64', 'amd64'], ['arm64', 'arm64']]) {
  const dir = path.join(makeDir, forgeArch);
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.deb'));
  if (files.length > 0) {
    debPath = path.join(dir, files[0]);
    debArch = debArchName;
    break;
  }
}

if (!debPath) {
  console.error('\n❌ No .deb found in out/make/deb/. Run `electron-forge make` first.\n');
  process.exit(1);
}

const debFileName = path.basename(debPath);
const poolPath = `pool/main/${debFileName}`;
const binaryDir = `main/binary-${debArch}`;

console.log(`\n📦 APT Publisher — Voiden v${version} [${channel}]`);
console.log(`   .deb    : ${debFileName}`);
console.log(`   bucket  : ${bucket}`);
console.log(`   suite   : ${suite}`);
console.log(`   arch    : ${debArch}`);
console.log(`   signing : ${gpgKeyId ? gpgKeyId : 'disabled (no VOIDEN_GPG_KEY_ID)'}\n`);

// ─── Hash helpers ─────────────────────────────────────────────────────────────

function hashFile(filePath, algo) {
  return crypto.createHash(algo).update(fs.readFileSync(filePath)).digest('hex');
}

function hashBuf(buf, algo) {
  return crypto.createHash(algo).update(buf).digest('hex');
}

// ─── Packages file ───────────────────────────────────────────────────────────

const debSize = fs.statSync(debPath).size;
const debSha256 = hashFile(debPath, 'sha256');
const debSha1   = hashFile(debPath, 'sha1');
const debMd5    = hashFile(debPath, 'md5');

// Debian versions use ~ for pre-release separators, but Forge uses -
// Keep as-is — apt handles it fine for install purposes
const packagesContent = [
  `Package: voiden`,
  `Version: ${version}`,
  `Architecture: ${debArch}`,
  `Maintainer: Voiden By ApyHub <info@voiden.md>`,
  `Filename: ${poolPath}`,
  `Size: ${debSize}`,
  `SHA256: ${debSha256}`,
  `SHA1: ${debSha1}`,
  `MD5sum: ${debMd5}`,
  `Homepage: https://voiden.md`,
  `Description: ${packageJson.description}`,
  ``,
].join('\n');

const packagesBuf   = Buffer.from(packagesContent, 'utf-8');
const packagesGzBuf = zlib.gzipSync(packagesBuf);

// ─── Release file ────────────────────────────────────────────────────────────

const releaseDate = new Date().toUTCString();

const releaseContent = [
  `Origin: Voiden`,
  `Label: Voiden`,
  `Suite: ${suite}`,
  `Codename: ${suite}`,
  `Architectures: ${debArch}`,
  `Components: main`,
  `Description: Voiden APT Repository — ${channel} channel`,
  `Date: ${releaseDate}`,
  `MD5Sum:`,
  ` ${hashBuf(packagesBuf, 'md5')} ${packagesBuf.length} ${binaryDir}/Packages`,
  ` ${hashBuf(packagesGzBuf, 'md5')} ${packagesGzBuf.length} ${binaryDir}/Packages.gz`,
  `SHA1:`,
  ` ${hashBuf(packagesBuf, 'sha1')} ${packagesBuf.length} ${binaryDir}/Packages`,
  ` ${hashBuf(packagesGzBuf, 'sha1')} ${packagesGzBuf.length} ${binaryDir}/Packages.gz`,
  `SHA256:`,
  ` ${hashBuf(packagesBuf, 'sha256')} ${packagesBuf.length} ${binaryDir}/Packages`,
  ` ${hashBuf(packagesGzBuf, 'sha256')} ${packagesGzBuf.length} ${binaryDir}/Packages.gz`,
  ``,
].join('\n');

// ─── GPG signing ─────────────────────────────────────────────────────────────

let inReleaseContent  = null;
let releaseGpgContent = null;
let gpgPublicKey      = null;

if (gpgKeyId) {
  console.log('🔑 Signing Release...');
  const tmpRelease = path.join('/tmp', `voiden-apt-Release-${Date.now()}`);
  fs.writeFileSync(tmpRelease, releaseContent);

  const inReleaseResult = spawnSync('gpg', [
    '--default-key', gpgKeyId,
    '--clearsign', '--armor', '-o', '-', tmpRelease,
  ], { encoding: 'utf-8' });

  const releaseGpgResult = spawnSync('gpg', [
    '--default-key', gpgKeyId,
    '--armor', '--detach-sign', '-o', '-', tmpRelease,
  ], { encoding: 'utf-8' });

  fs.unlinkSync(tmpRelease);

  if (inReleaseResult.status === 0) {
    inReleaseContent = inReleaseResult.stdout;
    console.log('   ✓ InRelease signed');
  } else {
    console.warn('   ⚠  InRelease signing failed:', inReleaseResult.stderr.trim());
  }

  if (releaseGpgResult.status === 0) {
    releaseGpgContent = releaseGpgResult.stdout;
    console.log('   ✓ Release.gpg signed');
  } else {
    console.warn('   ⚠  Release.gpg signing failed:', releaseGpgResult.stderr.trim());
  }

  // Export the public key so we can upload it to S3
  const pubKeyResult = spawnSync('gpg', [
    '--armor', '--export', gpgKeyId,
  ], { encoding: 'utf-8' });

  if (pubKeyResult.status === 0 && pubKeyResult.stdout) {
    gpgPublicKey = pubKeyResult.stdout;
    console.log('   ✓ Public key exported');
  } else {
    console.warn('   ⚠  Public key export failed:', pubKeyResult.stderr.trim());
  }

  console.log('');
} else {
  console.log('ℹ️  Skipping GPG signing (set VOIDEN_GPG_KEY_ID to enable)\n');
}

// ─── Upload to S3 ────────────────────────────────────────────────────────────

if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
  console.error('❌ Missing S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY in .env');
  process.exit(1);
}

// suppress the aws-sdk v2 migration warning
process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region,
});

// Small files — single putObject, just tick when done
async function upload(key, body, contentType) {
  const fullKey = `apt/${key}`;
  await s3.putObject({
    Bucket: bucket,
    Key: fullKey,
    Body: body,
    ContentType: contentType,
    ACL: 'public-read',
  }).promise();
  console.log(`   ✓ ${fullKey}`);
}

// Large files — upload from local file with progress bar
async function uploadDebWithProgress(key, filePath, contentType) {
  const fullKey    = `apt/${key}`;
  const totalBytes = fs.statSync(filePath).size;
  const totalMB    = (totalBytes / 1024 / 1024).toFixed(1);

  const managed = s3.upload({
    Bucket:      bucket,
    Key:         fullKey,
    Body:        fs.createReadStream(filePath),
    ContentType: contentType,
    ACL:         'public-read',
  });

  managed.on('httpUploadProgress', ({ loaded }) => {
    const loadedMB = (loaded / 1024 / 1024).toFixed(1);
    const pct    = Math.min(100, Math.round((loaded / totalBytes) * 100));
    const filled = Math.floor(pct / 5);
    const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
    process.stdout.write(`\r   [${bar}] ${pct}%  ${loadedMB} / ${totalMB} MB  `);
  });

  await managed.promise();
  process.stdout.write(`\r   ✓ ${fullKey} (${totalMB} MB)${' '.repeat(20)}\n`);
}

async function main() {
  console.log('📤 Uploading to S3...\n');

  // 1. .deb binary in pool — copy from forge's existing upload, or upload fresh
  await uploadDebWithProgress(poolPath, debPath, 'application/vnd.debian.binary-package');

  // 2. Packages index
  await upload(`dists/${suite}/${binaryDir}/Packages`,    packagesBuf,   'text/plain');
  await upload(`dists/${suite}/${binaryDir}/Packages.gz`, packagesGzBuf, 'application/gzip');

  // 3. Release
  await upload(`dists/${suite}/Release`, releaseContent, 'text/plain');

  // 4. Signed files + public key (if GPG was available)
  if (inReleaseContent)  await upload(`dists/${suite}/InRelease`,   inReleaseContent,  'text/plain');
  if (releaseGpgContent) await upload(`dists/${suite}/Release.gpg`, releaseGpgContent, 'text/plain');
  if (gpgPublicKey)      await upload(`voiden.gpg`,                 gpgPublicKey,      'application/pgp-keys');

  // ─── Summary ───────────────────────────────────────────────────────────────

  const baseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;

  console.log(`\n✅ APT repository published to s3://${bucket}/apt/\n`);
  console.log('─── Install instructions ───────────────────────────────────\n');

  if (inReleaseContent || releaseGpgContent) {
    console.log('# Signed repo — users run this once to add Voiden to apt:\n');
    console.log(`curl -fsSL ${baseUrl}/apt/voiden.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/voiden.gpg`);
    console.log(`echo "deb [arch=${debArch} signed-by=/etc/apt/keyrings/voiden.gpg] ${baseUrl}/apt ${suite} main" \\`);
    console.log(`  | sudo tee /etc/apt/sources.list.d/voiden.list`);
  } else {
    console.log('# Unsigned repo — users must add [trusted=yes]:\n');
    console.log(`echo "deb [arch=${debArch} trusted=yes] ${baseUrl}/apt ${suite} main" \\`);
    console.log(`  | sudo tee /etc/apt/sources.list.d/voiden.list`);
  }

  console.log(`sudo apt update && sudo apt install voiden\n`);
}

main().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
