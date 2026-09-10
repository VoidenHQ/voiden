#!/usr/bin/env node

/**
 * Voiden Winget Manifest Publisher
 *
 * Opens a PR against microsoft/winget-pkgs bumping the Voiden manifest to the
 * current app version. Runs for both channels, each under its own package
 * identifier since winget resolves `winget install <id>` to the highest
 * version under that id — a beta build (e.g. 2.3.0-beta.1) would otherwise
 * outrank stable and become the default install:
 *   - stable → Voiden.Voiden
 *   - beta   → Voiden.Voiden-Beta
 *
 * Usage:
 *   node publish-winget.js [beta|stable]
 *
 * Required env vars:
 *   WINGET_GITHUB_TOKEN — classic PAT with the "public_repo" scope, belonging to
 *                         whichever GitHub account should own the winget-pkgs fork
 *                         and open the PR. The fork is created automatically on
 *                         first run if it doesn't exist yet.
 *
 * What it does:
 *   1. Downloads the channel's current Windows installer and hashes it (sha256).
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

const PACKAGE_NAME_PART = channel === 'beta' ? 'Voiden-Beta' : 'Voiden';
const PACKAGE_IDENTIFIER = `Voiden.${PACKAGE_NAME_PART}`;
const MANIFEST_PATH = `manifests/v/Voiden/${PACKAGE_NAME_PART}/${version}`;
const UPSTREAM_OWNER = 'microsoft';
const UPSTREAM_REPO = 'winget-pkgs';
const MANIFEST_SCHEMA_VERSION = '1.12.0';
// Must be a version-pinned URL, not the "latest" pointer — winget-pkgs keeps
// every version's manifest forever with InstallerSha256 baked in at publish
// time, so a URL a future release overwrites breaks that manifest's hash
// check as soon as the next version ships (this is what was happening:
// setup-latest.exe is a mutable "latest" pointer, so every previously
// published manifest's hash went stale the moment a newer version replaced
// it). The NSIS installer itself is already published under a real,
// immutable, version-pinned filename by the "Publish to S3 — Windows" step
// (electron-forge's publisher-s3, from forge.config.ts) — reference that
// directly instead of a separate "latest" copy.
const INSTALLER_FILENAME = `${packageJson.productName || 'Voiden'} Setup ${version}.exe`;
const INSTALLER_URL = `https://voiden.md/api/download/${channel}/win32/x64/${encodeURIComponent(INSTALLER_FILENAME)}`;
const GITHUB_API = 'https://api.github.com';

console.log(`\n📦 Winget Publisher — Voiden v${version} [${channel}]\n`);

if (channel !== 'beta' && channel !== 'stable') {
  console.log(`ℹ️  Nothing to publish for channel "${channel}". Skipping.\n`);
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
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A freshly-created fork of a huge repo (microsoft/winget-pkgs has 100k+
// manifest files) is created asynchronously on GitHub's backend — the POST
// /forks response returns immediately, but git data operations against the
// fork can lag behind that for a while. Cheap to check even when the fork
// already existed from a previous run (the common case) — this just confirms
// the fork's own default branch is queryable before doing anything else.
async function waitForForkReady(forkOwner, repo, { attempts = 15, delayMs = 4000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const ref = await gh('GET', `/repos/${forkOwner}/${repo}/git/ref/heads/master`);
    if (ref.ok) return;
    console.log(`   ...fork not ready yet (attempt ${i}/${attempts}, HTTP ${ref.status}), waiting ${delayMs / 1000}s`);
    await sleep(delayMs);
  }
  throw new Error(`Fork ${forkOwner}/${repo} never became ready (git ref queries kept failing) after ${attempts} attempts.`);
}

// Separate from waitForForkReady: even on a long-established, fully-ready
// fork, a *specific newly-created* commit object (via POST .../git/commits)
// can take a short-to-noticeable while longer to become visible to the
// git/refs validation path than to a plain GET of the object itself —
// confirmed in production against this exact fork (voiden-beta-2.3.0-beta.3:
// blob/tree/commit creation all succeeded immediately, but git/refs POST
// still 404'd on every retry across a 15s window; the same commit shape
// created moments later via a fresh manual attempt succeeded on the very
// first try). Polls the commit object itself before attempting to point a
// ref at it, since that's the specific propagation gap observed, not fork
// readiness in general.
async function waitForCommitVisible(forkOwner, repo, commitSha, { attempts = 10, delayMs = 6000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const commit = await gh('GET', `/repos/${forkOwner}/${repo}/git/commits/${commitSha}`);
    if (commit.ok) return;
    console.log(`   ...commit ${commitSha.slice(0, 8)} not visible yet (attempt ${i}/${attempts}, HTTP ${commit.status}), waiting ${delayMs / 1000}s`);
    await sleep(delayMs);
  }
  throw new Error(`Commit ${commitSha} on ${forkOwner}/${repo} never became visible after ${attempts} attempts.`);
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
      `PackageName: Voiden${channel === 'beta' ? ' Beta' : ''}`,
      'PackageUrl: https://voiden.md',
      'License: Apache-2.0',
      `ShortDescription: Build, Test, Document & Collaborate. Streamline your API development process with Voiden${channel === 'beta' ? ' (Beta channel)' : ''}`,
      'ManifestType: defaultLocale',
      `ManifestVersion: ${MANIFEST_SCHEMA_VERSION}`,
      '',
    ].join('\n'),
  };
}

async function main() {
  // Already published? (re-runs / retries should be harmless no-ops)
  const existing = await gh('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/contents/${MANIFEST_PATH}`);
  if (existing.ok) {
    console.log(`ℹ️  ${MANIFEST_PATH} already exists upstream. Nothing to do.\n`);
    return;
  }

  const me = await gh('GET', '/user');
  if (!me.ok) throw new Error(`Failed to resolve token identity: ${JSON.stringify(me.json)}`);
  const forkOwner = me.json.login;
  console.log(`   token identity : ${forkOwner}`);
  // Temporary diagnostic for the recurring "git/refs 404 on this token but
  // not on a manually-tested broader one" investigation — the X-OAuth-Scopes
  // response header echoes back exactly what scopes GitHub itself sees on
  // this token, removing any doubt about what actually got saved to the
  // WINGET_GITHUB_TOKEN secret vs. what was intended in the GitHub UI.
  console.log(`   token scopes   : ${me.headers.get('x-oauth-scopes') || '(none reported)'}`);

  console.log(`\n🍴 Ensuring fork of ${UPSTREAM_OWNER}/${UPSTREAM_REPO}...`);
  const fork = await gh('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`);
  if (!fork.ok) throw new Error(`Fork request failed: ${JSON.stringify(fork.json)}`);

  // fork.json.created_at/updated_at won't tell us whether THIS run just
  // created it vs. it already existed from a previous run — always poll
  // rather than trying to distinguish those cases, it's a no-op cost when
  // the fork was already fully ready.
  console.log('   waiting for the fork to actually be ready for git data operations...');
  await waitForForkReady(forkOwner, UPSTREAM_REPO);

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
      path: `${MANIFEST_PATH}/${name}`,
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

  // See waitForCommitVisible's own comment — this specific commit object can
  // lag behind being queryable, independent of the fork itself being ready.
  console.log('   waiting for the new commit to actually be visible...');
  await waitForCommitVisible(forkOwner, UPSTREAM_REPO, commit.json.sha);

  const branch = `${PACKAGE_NAME_PART.toLowerCase()}-${version}`;
  console.log(`\n🌿 Pushing branch ${forkOwner}:${branch}...`);
  let ref;
  const maxRefAttempts = 8;
  for (let attempt = 1; attempt <= maxRefAttempts; attempt++) {
    ref = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.json.sha,
    });
    if (ref.status === 422) {
      // Branch already exists (retry of a previous run) — force-update it instead.
      ref = await gh('PATCH', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs/heads/${branch}`, {
        sha: commit.json.sha,
        force: true,
      });
      break;
    }
    // A 404 here (as opposed to on the branch-not-found PATCH path above)
    // means the commit still isn't consistent from the ref-creation path's
    // point of view, even after waitForCommitVisible's own check passed —
    // belt-and-suspenders for exactly the propagation gap that's already
    // been observed in production (waitForCommitVisible confirmed readable,
    // git/refs still 404'd for a while after). Anything else (network
    // error, actual auth/perm failure) isn't transient — fail immediately
    // instead of retrying blind.
    if (ref.ok || ref.status !== 404 || attempt === maxRefAttempts) break;
    const delaySec = Math.min(10 * attempt, 30);
    console.log(`   ...ref push got 404 (attempt ${attempt}/${maxRefAttempts}), still settling — retrying in ${delaySec}s`);
    await sleep(delaySec * 1000);
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
