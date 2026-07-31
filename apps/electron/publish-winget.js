#!/usr/bin/env node

/**
 * Voiden Winget Manifest Publisher
 *
 * Opens a PR against microsoft/winget-pkgs bumping the Voiden.Voiden manifest
 * to the current app version. Stable channel only — winget has no beta channel
 * concept, so this is a no-op for beta/development builds.
 *
 * Usage:
 *   node publish-winget.js [stable]
 *
 * Required env vars:
 *   WINGET_GITHUB_TOKEN — classic PAT with the "public_repo" scope, belonging to
 *                         whichever GitHub account should own the winget-pkgs fork
 *                         and open the PR. The fork is created automatically on
 *                         first run if it doesn't exist yet.
 *
 * What it does:
 *   1. Downloads the current stable Windows installer and hashes it (sha256).
 *   2. Forks microsoft/winget-pkgs under the token's account (idempotent).
 *   3. Copies the existing manifest forward to a new version folder, via the
 *      GitHub Git Data API — no local clone (winget-pkgs is huge).
 *   4. Opens a PR: microsoft/winget-pkgs expects one manifest bump per PR, and
 *      its own validation bot (wingetbot) takes it from there — hash check,
 *      sandboxed silent-install test, then auto-merge if it passes. There is
 *      no further action to take after the PR is opened.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;
const isBetaBuild = version.includes('beta') || version.includes('alpha') || version.includes('rc');
const channel = process.argv[2] || (isBetaBuild ? 'beta' : 'stable');

const PACKAGE_IDENTIFIER = 'Voiden.Voiden';
const UPSTREAM_OWNER = 'microsoft';
const UPSTREAM_REPO = 'winget-pkgs';
const MANIFEST_SCHEMA_VERSION = '1.12.0';
const INSTALLER_URL = 'https://voiden.md/api/download/stable/win32/x64/setup-latest.exe';
const GITHUB_API = 'https://api.github.com';

console.log(`\n📦 Winget Publisher — Voiden v${version} [${channel}]\n`);

if (channel !== 'stable') {
  console.log('ℹ️  Winget has no beta channel — nothing to publish for a non-stable build. Skipping.\n');
  process.exit(0);
}

const token = process.env.WINGET_GITHUB_TOKEN;
if (!token) {
  console.error('❌ WINGET_GITHUB_TOKEN is not set. Create a classic PAT with the "public_repo"');
  console.error('   scope on the account that should own the winget-pkgs fork, and store it as');
  console.error('   the WINGET_GITHUB_TOKEN secret.');
  process.exit(1);
}

// ─── GitHub API helper ─────────────────────────────────────────────────────────

async function gh(method, apiPath, body) {
  const res = await fetch(`${GITHUB_API}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { status: res.status, ok: res.ok, json };
}

function manifestFiles(v, sha256) {
  return {
    [`${PACKAGE_IDENTIFIER}.yaml`]: [
      `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${MANIFEST_SCHEMA_VERSION}.schema.json`,
      '',
      `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
      `PackageVersion: ${v}`,
      'DefaultLocale: en-US',
      'ManifestType: version',
      `ManifestVersion: ${MANIFEST_SCHEMA_VERSION}`,
      '',
    ].join('\n'),

    [`${PACKAGE_IDENTIFIER}.installer.yaml`]: [
      `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${MANIFEST_SCHEMA_VERSION}.schema.json`,
      '',
      `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
      `PackageVersion: ${v}`,
      'Installers:',
      '- Architecture: x64',
      '  InstallerType: nullsoft',
      '  Scope: machine',
      `  InstallerUrl: ${INSTALLER_URL}`,
      `  InstallerSha256: ${sha256}`,
      'ManifestType: installer',
      `ManifestVersion: ${MANIFEST_SCHEMA_VERSION}`,
      '',
    ].join('\n'),

    [`${PACKAGE_IDENTIFIER}.locale.en-US.yaml`]: [
      `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${MANIFEST_SCHEMA_VERSION}.schema.json`,
      '',
      `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
      `PackageVersion: ${v}`,
      'PackageLocale: en-US',
      'Publisher: Voiden',
      'PublisherUrl: https://voiden.md',
      'PackageName: Voiden',
      'PackageUrl: https://voiden.md',
      'License: Apache-2.0',
      'ShortDescription: Build, Test, Document & Collaborate. Streamline your API development process with Voiden',
      'ManifestType: defaultLocale',
      `ManifestVersion: ${MANIFEST_SCHEMA_VERSION}`,
      '',
    ].join('\n'),
  };
}

async function main() {
  // Already published? (re-runs / retries should be harmless no-ops)
  const existing = await gh('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/contents/manifests/v/Voiden/Voiden/${version}`);
  if (existing.ok) {
    console.log(`ℹ️  manifests/v/Voiden/Voiden/${version} already exists upstream. Nothing to do.\n`);
    return;
  }

  const me = await gh('GET', '/user');
  if (!me.ok) throw new Error(`Failed to resolve token identity: ${JSON.stringify(me.json)}`);
  const forkOwner = me.json.login;
  console.log(`   token identity : ${forkOwner}`);

  console.log(`\n🍴 Ensuring fork of ${UPSTREAM_OWNER}/${UPSTREAM_REPO}...`);
  const fork = await gh('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`);
  if (!fork.ok) throw new Error(`Fork request failed: ${JSON.stringify(fork.json)}`);

  console.log(`\n⬇️  Downloading installer for hashing:\n   ${INSTALLER_URL}`);
  const installerRes = await fetch(INSTALLER_URL);
  if (!installerRes.ok) throw new Error(`Installer download failed: HTTP ${installerRes.status}`);
  const installerBuf = Buffer.from(await installerRes.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(installerBuf).digest('hex').toUpperCase();
  console.log(`   sha256 : ${sha256}`);

  const upstreamRef = await gh('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/git/ref/heads/master`);
  if (!upstreamRef.ok) throw new Error(`Failed to read upstream master ref: ${JSON.stringify(upstreamRef.json)}`);
  const baseSha = upstreamRef.json.object.sha;

  console.log('\n📝 Building manifest blobs...');
  const files = manifestFiles(version, sha256);
  const treeEntries = [];
  for (const [name, content] of Object.entries(files)) {
    const blob = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/blobs`, {
      content,
      encoding: 'utf-8',
    });
    if (!blob.ok) throw new Error(`Failed to create blob for ${name}: ${JSON.stringify(blob.json)}`);
    treeEntries.push({
      path: `manifests/v/Voiden/Voiden/${version}/${name}`,
      mode: '100644',
      type: 'blob',
      sha: blob.json.sha,
    });
  }

  const tree = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/trees`, {
    base_tree: baseSha,
    tree: treeEntries,
  });
  if (!tree.ok) throw new Error(`Failed to create tree: ${JSON.stringify(tree.json)}`);

  const commit = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/commits`, {
    message: `New version: ${PACKAGE_IDENTIFIER} version ${version}`,
    tree: tree.json.sha,
    parents: [baseSha],
  });
  if (!commit.ok) throw new Error(`Failed to create commit: ${JSON.stringify(commit.json)}`);

  const branch = `voiden-${version}`;
  console.log(`\n🌿 Pushing branch ${forkOwner}:${branch}...`);
  let ref = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.json.sha,
  });
  if (ref.status === 422) {
    // Branch already exists (retry of a previous run) — force-update it instead.
    ref = await gh('PATCH', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs/heads/${branch}`, {
      sha: commit.json.sha,
      force: true,
    });
  }
  if (!ref.ok) throw new Error(`Failed to push branch: ${JSON.stringify(ref.json)}`);

  console.log('\n🚀 Opening PR against microsoft/winget-pkgs...');
  const pr = await gh('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
    title: `New version: ${PACKAGE_IDENTIFIER} version ${version}`,
    body: `Updates ${PACKAGE_IDENTIFIER} to version ${version}.`,
    head: `${forkOwner}:${branch}`,
    base: 'master',
  });
  if (!pr.ok) {
    const alreadyExists = pr.status === 422 && JSON.stringify(pr.json).includes('already exists');
    if (!alreadyExists) throw new Error(`Failed to open PR: ${JSON.stringify(pr.json)}`);
    console.log('ℹ️  A PR for this branch already exists upstream.');
  } else {
    console.log(`\n✅ PR opened: ${pr.json.html_url}\n`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
