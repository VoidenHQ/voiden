#!/usr/bin/env node

/**
 * Voiden Homebrew (Linux) Publisher
 *
 * Publishes the already-built Linux AppImage to the VoidenHQ/homebrew-voiden
 * tap by templating Formula/voiden.rb with the real version/url/sha256 and
 * pushing directly to that repo's main branch — no fork/PR needed, Voiden
 * owns this tap outright (unlike publish-winget.js's fork-and-PR dance
 * against the huge, third-party-owned microsoft/winget-pkgs).
 *
 * Usage:
 *   node publish-brew.js [beta|stable]
 *
 * Required env vars:
 *   HOMEBREW_TAP_GITHUB_TOKEN — classic PAT with "repo" scope (or a fine-grained
 *                               token scoped to VoidenHQ/homebrew-voiden) for
 *                               the account that pushes to the tap.
 *
 * Notes:
 *   - Homebrew has no first-class concept of a prerelease/beta channel for a
 *     single formula the way winget/chocolatey do — this only publishes for
 *     the "stable" channel. A "beta" run is a documented no-op.
 *   - The formula installs the AppImage directly (chmod +x, symlink into
 *     Cellar's bin/) rather than unpacking the .deb the way snapcraft.yaml
 *     does — the AppImage is already a proven, self-contained single
 *     executable with no separate stage-packages dependency list to keep in
 *     sync here.
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

const TAP_OWNER = 'VoidenHQ';
const TAP_REPO = 'homebrew-voiden';

console.log(`\n📦 Homebrew (Linux) Publisher — Voiden v${version} [${channel}]\n`);

if (channel !== 'stable') {
  console.log('ℹ️  Homebrew has no beta channel for this formula — nothing to publish. Skipping.\n');
  process.exit(0);
}

if (process.platform !== 'linux') {
  console.error('❌ This publishes the Linux AppImage and expects to run in the same job that built it (linux).');
  process.exit(1);
}

const token = process.env.HOMEBREW_TAP_GITHUB_TOKEN;
if (!token) {
  console.error('❌ HOMEBREW_TAP_GITHUB_TOKEN is not set. Create a token with push access to');
  console.error(`   ${TAP_OWNER}/${TAP_REPO} and store it as the HOMEBREW_TAP_GITHUB_TOKEN secret.`);
  process.exit(1);
}

// ─── Find the built AppImage ───────────────────────────────────────────────────

const makeDir = path.join(__dirname, 'out', 'make');
const appImageName = fs.existsSync(makeDir)
  ? fs.readdirSync(makeDir).find((f) => f.endsWith('.AppImage') && f.includes(version))
  : undefined;

if (!appImageName) {
  console.error(`❌ No .AppImage matching version ${version} found in out/make/. Run \`electron-forge make\` first.`);
  process.exit(1);
}

const appImagePath = path.join(makeDir, appImageName);
console.log(`   AppImage : ${appImageName}`);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(appImagePath)).digest('hex');
console.log(`   sha256   : ${sha256}`);

// Same immutable, version-pinned download path used everywhere else
// (republish.js, publish-winget.js) — never a "latest" pointer, since the
// formula's sha256 is pinned at publish time and must stay valid forever.
const downloadUrl = `https://voiden.md/api/download/${channel}/linux/x64/${appImageName}`;
console.log(`   url      : ${downloadUrl}\n`);

// ─── Template Formula/voiden.rb ────────────────────────────────────────────────

function formulaContents() {
  return `class Voiden < Formula
  desc "Build, Test, Document & Collaborate — file-based API client (REST, GraphQL, WebSocket, gRPC)"
  homepage "https://voiden.md"
  license "Apache-2.0"

  on_linux do
    url "${downloadUrl}"
    sha256 "${sha256}"
    version "${version}"

    def install
      appimage = Dir["*.AppImage"].first
      odie "No .AppImage found in the downloaded artifact" unless appimage
      chmod 0755, appimage
      bin.install appimage => "voiden"
    end

    caveats do
      <<~EOS
        Voiden ships as an AppImage. On some modern kernels (Ubuntu 24.04+,
        Fedora with strict AppArmor userns restrictions), the sandboxed
        Chromium helper needs one of:

          sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

        ...or run Voiden with --no-sandbox:

          voiden --no-sandbox

        This is a known AppImage/Electron sandboxing limitation, not specific
        to this formula — see https://github.com/VoidenHQ/voiden/issues/43.
      EOS
    end

    test do
      system "#{bin}/voiden", "--version"
    end
  end
end
`;
}

// ─── Clone, update, push ───────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebrew-voiden-'));
const authedUrl = `https://x-access-token:${token}@github.com/${TAP_OWNER}/${TAP_REPO}.git`;

console.log(`🌀 Cloning ${TAP_OWNER}/${TAP_REPO}...`);
run('git', ['clone', '--depth=1', authedUrl, tmpDir]);

const formulaPath = path.join(tmpDir, 'Formula', 'voiden.rb');
fs.mkdirSync(path.dirname(formulaPath), { recursive: true });
fs.writeFileSync(formulaPath, formulaContents());

// `git diff --quiet` exits 0 when there's no difference, 1 when there is —
// checked directly rather than via try/catch, since "there is a diff" is the
// expected, ordinary outcome on every real version bump, not an error case.
const diff = spawnSync('git', ['-C', tmpDir, 'diff', '--quiet', '--', 'Formula/voiden.rb']);

if (diff.status === 0) {
  console.log('ℹ️  Formula already up to date for this version. Nothing to push.\n');
} else {
  console.log('📝 Committing updated Formula/voiden.rb...');
  run('git', ['-C', tmpDir, 'config', 'user.name', 'voiden-release-bot']);
  run('git', ['-C', tmpDir, 'config', 'user.email', 'releases@voiden.md']);
  run('git', ['-C', tmpDir, 'add', 'Formula/voiden.rb']);
  run('git', ['-C', tmpDir, 'commit', '-m', `Update voiden to ${version}`]);
  console.log(`🚀 Pushing to ${TAP_OWNER}/${TAP_REPO}...`);
  run('git', ['-C', tmpDir, 'push', 'origin', 'HEAD:main']);
  console.log(`\n✅ Pushed to https://github.com/${TAP_OWNER}/${TAP_REPO}\n`);
}

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('─── User install command ────────────────────────────────────\n');
console.log('brew tap voidenhq/voiden');
console.log('brew install voiden');
console.log('');
