#!/usr/bin/env node

/**
 * Voiden Flatpak Manifest Updater
 *
 * Stamps the real, version-pinned .deb url/sha256 into
 * flatpak/md.voiden.Voiden.yml. Does NOT open or touch any PR against
 * flathub/flathub — see "Why this doesn't submit anything" below.
 *
 * Usage:
 *   node publish-flatpak.js [beta|stable]
 *
 * Notes:
 *   - Flatpak has no first-class beta channel the way winget/chocolatey do —
 *     this only updates the manifest for the "stable" channel.
 *
 * Why this doesn't submit anything (read before "fixing" that):
 *   flathub/flathub's own PR template
 *   (https://github.com/flathub/.github/blob/main/pull_request_template.md,
 *   mirrored at flathub/flathub/.github/pull_request_template.md) requires
 *   checking:
 *     "I have not used AI tools or agents to generate or automate this
 *      submission pull request or its review interactions."
 *   An earlier version of this script did automate the fork + PR (same
 *   technique as ../publish-winget.js against microsoft/winget-pkgs) and got
 *   as far as opening real PRs (flathub/flathub#10360, #10361, #10362) before
 *   this was caught — all three were auto-closed by Flathub's
 *   submission-checker bot for other reasons first (wrong base branch,
 *   nested file path, missing checklist), which is what surfaced the
 *   template's actual requirements. Continuing to automate the PR itself
 *   would mean either checking that box dishonestly or submitting a PR that
 *   fails Flathub's own stated criteria either way. The initial submission —
 *   including the required checklist (app description in the submitter's
 *   own words, a demo video, an authorship/upstream-contact statement) —
 *   needs to be done by a human. See FLATPAK.md for the exact next steps.
 *
 *   This constraint is specific to the *initial submission* PR under
 *   Flathub's review process. Once Voiden is accepted, routine version
 *   bumps push directly to the dedicated flathub/<app-id> repo with no PR
 *   review gate (the same shape publish-winget.js/publish-brew.js already
 *   automate for their own ecosystems) — that path can reasonably be
 *   automated once it exists; it isn't implemented yet since that repo
 *   doesn't exist yet either.
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

console.log(`\n📦 Flatpak Manifest Updater — Voiden v${version} [${channel}]\n`);

if (channel !== 'stable') {
  console.log('ℹ️  Flatpak has no beta channel for this manifest — nothing to update. Skipping.\n');
  process.exit(0);
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

console.log('─── Manual next step required ──────────────────────────────────\n');
console.log('This script only updates the manifest — see FLATPAK.md for why the');
console.log('actual submission PR needs to be opened by a human, not this script.\n');
