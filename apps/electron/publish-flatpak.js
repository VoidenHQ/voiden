#!/usr/bin/env node

/**
 * Voiden Flatpak Publisher
 *
 * Stamps the real, version-pinned .deb url/sha256 into
 * flatpak/md.voiden.Voiden.yml, then either:
 *   - Voiden isn't on Flathub yet: opens a new-app submission PR against
 *     flathub/flathub with the manifest (same fork/git-data-API technique
 *     as ../publish-winget.js against microsoft/winget-pkgs).
 *   - Voiden has already been accepted: Flathub gives accepted apps their
 *     own dedicated repo (flathub/<app-id>) to push directly to instead —
 *     that path isn't implemented here yet since FLATHUB_APP_REPO_EXISTS
 *     flips this on only once that repo actually exists (see FLATPAK.md).
 *
 * Flathub's submission process is an external, evolving process this
 * script can't fully verify from here — re-check
 * https://docs.flathub.org/docs/for-app-authors/submission against what
 * this script actually does before relying on it for a real submission.
 *
 * Usage:
 *   node publish-flatpak.js [beta|stable]
 *
 * Required env vars:
 *   FLATHUB_GITHUB_TOKEN — classic PAT with "public_repo" scope, belonging to
 *                          the account that should own the flathub/flathub
 *                          fork and open the submission PR (or push directly,
 *                          once FLATHUB_APP_REPO_EXISTS=1).
 *
 * Optional env vars:
 *   FLATHUB_APP_REPO_EXISTS — set to "1" once Flathub has created
 *                             flathub/md.voiden.Voiden for an already-accepted
 *                             app. Not yet implemented — the script exits
 *                             with guidance instead of guessing at a push
 *                             flow that hasn't been validated against the
 *                             real repo yet.
 *
 * Notes:
 *   - Flatpak has no first-class beta channel the way winget/chocolatey do —
 *     this only publishes for the "stable" channel.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;
const isBetaBuild = version.includes('beta') || version.includes('alpha') || version.includes('rc');
const channel = process.argv[2] || (isBetaBuild ? 'beta' : 'stable');

const APP_ID = 'md.voiden.Voiden';
const MANIFEST_RELATIVE_PATH = `flatpak/${APP_ID}.yml`;
const MANIFEST_LOCAL_PATH = path.join(__dirname, MANIFEST_RELATIVE_PATH);
const UPSTREAM_OWNER = 'flathub';
const UPSTREAM_REPO = 'flathub';
// New-app submission PRs must target this branch, not the default (master) —
// see the comment above where it's read, in main().
const SUBMISSION_BASE_BRANCH = 'new-pr';
const GITHUB_API = 'https://api.github.com';

console.log(`\n📦 Flatpak Publisher — Voiden v${version} [${channel}]\n`);

if (channel !== 'stable') {
  console.log('ℹ️  Flatpak has no beta channel for this manifest — nothing to publish. Skipping.\n');
  process.exit(0);
}

if (process.env.FLATHUB_APP_REPO_EXISTS === '1') {
  console.error(`❌ FLATHUB_APP_REPO_EXISTS=1, but the direct-push path to flathub/${APP_ID} isn't`);
  console.error('   implemented yet — that repo/flow hasn\'t been exercised or validated. Push the');
  console.error(`   updated ${MANIFEST_RELATIVE_PATH} to flathub/${APP_ID} manually for now, and`);
  console.error('   extend this script once that\'s confirmed working.');
  process.exit(1);
}

const token = process.env.FLATHUB_GITHUB_TOKEN;
if (!token) {
  console.error('❌ FLATHUB_GITHUB_TOKEN is not set. See FLATPAK.md for what this token needs.');
  process.exit(1);
}

// ─── Find the built .deb ────────────────────────────────────────────────────────

const debDir = path.join(__dirname, 'out', 'make', 'deb', 'x64');
const debName = fs.existsSync(debDir)
  ? fs.readdirSync(debDir).find((f) => f.endsWith('.deb'))
  : undefined;

if (!debName) {
  console.error('❌ No .deb found in out/make/deb/x64/. Run `electron-forge make` first.');
  process.exit(1);
}

const debPath = path.join(debDir, debName);
console.log(`   .deb : ${debName}`);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(debPath)).digest('hex');
const downloadUrl = `https://voiden.md/api/download/${channel}/linux/x64/${debName}`;
console.log(`   sha256 : ${sha256}`);
console.log(`   url    : ${downloadUrl}\n`);

// ─── Stamp the manifest ─────────────────────────────────────────────────────────

let manifest = fs.readFileSync(MANIFEST_LOCAL_PATH, 'utf-8');
manifest = manifest.replace(/^(\s*url:\s*).*$/m, `$1${downloadUrl}`);
manifest = manifest.replace(/^(\s*sha256:\s*).*$/m, `$1"${sha256}"`);
fs.writeFileSync(MANIFEST_LOCAL_PATH, manifest);
console.log(`   ✓ Stamped url/sha256 into ${MANIFEST_RELATIVE_PATH}\n`);

// ─── GitHub API helper (same shape as publish-winget.js) ───────────────────────

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForForkReady(forkOwner, repo, branchName, { attempts = 15, delayMs = 4000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const ref = await gh('GET', `/repos/${forkOwner}/${repo}/git/ref/heads/${branchName}`);
    if (ref.ok) return;
    console.log(`   ...fork not ready yet (attempt ${i}/${attempts}, HTTP ${ref.status}), waiting ${delayMs / 1000}s`);
    await sleep(delayMs);
  }
  throw new Error(`Fork ${forkOwner}/${repo} never became ready after ${attempts} attempts.`);
}

// Separate from waitForForkReady: even on a fully-ready fork, a specific
// newly-created commit object (via POST .../git/commits) can take a short-to
// -noticeable while longer to become visible to the git/refs validation path
// than to a plain GET of the object itself. Confirmed against this exact
// flathub/flathub fork on this run: the fork itself was ready, but pushing
// the branch still 404'd ("Failed to push branch: Not Found") because the
// commit wasn't visible to git/refs yet. See the identical comment on
// publish-winget.js's own waitForCommitVisible, which this mirrors.
async function waitForCommitVisible(forkOwner, repo, commitSha, { attempts = 10, delayMs = 6000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const commit = await gh('GET', `/repos/${forkOwner}/${repo}/git/commits/${commitSha}`);
    if (commit.ok) return;
    console.log(`   ...commit ${commitSha.slice(0, 8)} not visible yet (attempt ${i}/${attempts}, HTTP ${commit.status}), waiting ${delayMs / 1000}s`);
    await sleep(delayMs);
  }
  throw new Error(`Commit ${commitSha} on ${forkOwner}/${repo} never became visible after ${attempts} attempts.`);
}

async function main() {
  const branch = `${APP_ID.toLowerCase()}-${version}`;

  const me = await gh('GET', '/user');
  if (!me.ok) throw new Error(`Failed to resolve token identity: ${JSON.stringify(me.json)}`);
  const forkOwner = me.json.login;
  console.log(`   token identity : ${forkOwner}`);

  // Already submitted? An OPEN PR means nothing further to do. A CLOSED one
  // (Flathub's submission-checker bot auto-closes on anything it flags, e.g.
  // wrong base branch or a nested file path — both hit for real on the first
  // two attempts here) ideally wouldn't turn into yet another new PR on
  // retry, since the bot explicitly asks for that instead ("please post a
  // comment instead of opening or reopening (new) PRs") — reopening was
  // tried, but GitHub hard-blocks reopening a PR whose head branch was
  // force-pushed ("state cannot be changed"), which a content fix on the
  // same branch name always triggers. So: a closed PR just gets referenced
  // in the new PR's body for reviewer context instead.
  const allPrs = await gh('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls?head=${forkOwner}:${branch}&state=all`);
  const existingOpenPr = allPrs.ok ? allPrs.json.find((p) => p.state === 'open') : undefined;
  const existingClosedPr = allPrs.ok ? allPrs.json.find((p) => p.state === 'closed') : undefined;
  if (existingOpenPr) {
    console.log(`ℹ️  A submission PR already exists: ${existingOpenPr.html_url}\n`);
    return;
  }

  console.log(`\n🍴 Ensuring fork of ${UPSTREAM_OWNER}/${UPSTREAM_REPO}...`);
  const fork = await gh('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`);
  if (!fork.ok) throw new Error(`Fork request failed: ${JSON.stringify(fork.json)}`);
  await waitForForkReady(forkOwner, UPSTREAM_REPO, SUBMISSION_BASE_BRANCH);

  // Flathub's new-app submission PRs target `new-pr`, a permanently empty
  // orphan branch (a single 2017 "Initial commit" with the well-known empty
  // git tree) — NOT `master`, which holds the whole repo's history/CI config.
  // Confirmed the hard way: a first real submission attempt targeting
  // `master` was auto-closed instantly by flathub's own bot with "must be
  // made against the new-pr branch". Branching off `new-pr` means the PR's
  // diff is just this app's own folder, added on top of nothing.
  const upstreamRef = await gh('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/git/ref/heads/${SUBMISSION_BASE_BRANCH}`);
  if (!upstreamRef.ok) throw new Error(`Failed to read upstream ${SUBMISSION_BASE_BRANCH} ref: ${JSON.stringify(upstreamRef.json)}`);
  const baseSha = upstreamRef.json.object.sha;

  console.log('\n📝 Building manifest blob...');
  const manifestContent = fs.readFileSync(MANIFEST_LOCAL_PATH, 'utf-8');
  const blob = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/blobs`, {
    content: manifestContent,
    encoding: 'utf-8',
  });
  if (!blob.ok) throw new Error(`Failed to create blob: ${JSON.stringify(blob.json)}`);

  const tree = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/trees`, {
    base_tree: baseSha,
    // Flathub's submission-checker bot rejects a nested path — confirmed via
    // a real submission (flathub/flathub#10361, auto-closed: "Files not in
    // toplevel") — the manifest must sit at the PR diff's root, not in a
    // subfolder named after the app id.
    tree: [{ path: `${APP_ID}.yml`, mode: '100644', type: 'blob', sha: blob.json.sha }],
  });
  if (!tree.ok) throw new Error(`Failed to create tree: ${JSON.stringify(tree.json)}`);

  const commit = await gh('POST', `/repos/${forkOwner}/${UPSTREAM_REPO}/git/commits`, {
    message: `Add ${APP_ID}`,
    tree: tree.json.sha,
    parents: [baseSha],
  });
  if (!commit.ok) throw new Error(`Failed to create commit: ${JSON.stringify(commit.json)}`);

  console.log('   waiting for the new commit to actually be visible...');
  await waitForCommitVisible(forkOwner, UPSTREAM_REPO, commit.json.sha);

  console.log(`\n🌿 Pushing branch ${forkOwner}:${branch}...`);
  let ref;
  const maxRefAttempts = 12;
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
    if (ref.ok || ref.status !== 404 || attempt === maxRefAttempts) break;
    const delaySec = Math.min(10 * attempt, 45);
    console.log(`   ...ref push got 404 (attempt ${attempt}/${maxRefAttempts}), still settling — retrying in ${delaySec}s`);
    await sleep(delaySec * 1000);
  }
  if (!ref.ok) throw new Error(`Failed to push branch: ${JSON.stringify(ref.json)}`);

  console.log('\n🚀 Opening new-app submission PR against flathub/flathub...');
  const pr = await gh('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
    title: `Add ${APP_ID}`,
    body: [
      `Requesting the app id \`${APP_ID}\` for [Voiden](https://voiden.md).`,
      '',
      'Voiden is a file-based API client for building, testing, documenting and',
      'collaborating on APIs (REST, GraphQL, WebSocket, gRPC). Source: https://github.com/VoidenHQ/voiden',
      '',
      ...(existingClosedPr
        ? [`Supersedes #${existingClosedPr.number}, auto-closed by the submission checker — that feedback is now addressed.`, '']
        : []),
      '_Opened by publish-flatpak.js — please flag if the current Flathub submission',
      'process expects something different from what this PR does._',
    ].join('\n'),
    head: `${forkOwner}:${branch}`,
    base: SUBMISSION_BASE_BRANCH,
  });
  if (!pr.ok) {
    const alreadyExists = pr.status === 422 && JSON.stringify(pr.json).includes('already exists');
    if (!alreadyExists) throw new Error(`Failed to open PR: ${JSON.stringify(pr.json)}`);
    console.log('ℹ️  A PR for this branch already exists upstream.');
  } else {
    console.log(`\n✅ Submission PR opened: ${pr.json.html_url}\n`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
