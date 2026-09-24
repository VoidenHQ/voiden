# Voiden — Flatpak Release Guide

Addresses the Flatpak half of
[#43](https://github.com/VoidenHQ/voiden/issues/43) (AppImage and Snap are
already shipped — see `SNAP.md`).

## Why Flatpak, on top of AppImage/Snap

Voiden's AppImage currently needs `--no-sandbox` or a
`kernel.apparmor_restrict_unprivileged_userns=0` workaround on newer kernels
(see the discussion on #43). The Flatpak build is based on
`org.electronjs.Electron2.BaseApp`, which bundles `zypak` — letting
Chromium's real sandbox run *inside* Flatpak's own sandbox. This is the one
Linux channel where that workaround shouldn't be needed at all, once the
manifest is verified.

## Build approach

`apps/electron/flatpak/md.voiden.Voiden.yml` extracts the already-built
`.deb` (`dpkg-deb -x`) the same way `snapcraft.yaml` does, rather than
compiling Voiden from source a second time inside `flatpak-builder` — the
real build already happens once, via electron-forge.

**This manifest has not been run through a real `flatpak-builder` build in
this environment.** Before submitting anywhere, on a Linux machine:

```bash
flatpak install flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08 org.electronjs.Electron2.BaseApp//23.08
flatpak-builder --force-clean build-dir apps/electron/flatpak/md.voiden.Voiden.yml
flatpak-builder --run build-dir apps/electron/flatpak/md.voiden.Voiden.yml voiden
```

Things likely worth checking/adjusting once you can actually run this:
- Icon path/sizes actually produced by `MakerDeb` (`forge.config.ts`) —
  the manifest guesses the standard `hicolor` icon theme layout.
- Whether a `.metainfo.xml` AppStream file exists yet (Flathub requires one
  for the store listing) — the manifest's copy step is a no-op (`|| true`)
  if it doesn't exist yet, but Flathub submission needs a real one.
- `finish-args` — narrowed from a first pass matching `snapcraft.yaml`'s
  plug list; Flathub reviewers push back on overly broad permissions
  (e.g. `--filesystem=home` vs. a scoped project directory) as part of
  review.

## One-time Setup — domain + app id

The app id `md.voiden.Voiden` is the reverse-DNS of `voiden.md`. Flathub
requires proving ownership of that domain as part of first submission —
typically a file under `https://voiden.md/.well-known/`. Check
https://docs.flathub.org/docs/for-app-authors/requirements for the exact
current requirement before submitting; this hasn't been done yet.

Store a GitHub PAT (classic, `public_repo` scope) for the account that
should own the `flathub/flathub` fork and open the submission PR, as the
`FLATHUB_GITHUB_TOKEN` secret.

## First Submission

```bash
node apps/electron/publish-flatpak.js stable
```

Stamps the real `.deb` url/sha256 into the manifest, then opens a new-app
request PR against `flathub/flathub` (fork + PR, same technique
`publish-winget.js` uses against `microsoft/winget-pkgs`) — idempotent, safe
to re-run.

**Confirmed against two real submission attempts, both auto-closed by
Flathub's `submission-checker` bot:**
1. The PR must target Flathub's `new-pr` branch, not `master` — `new-pr` is
   a permanently empty orphan branch (a single 2017 "Initial commit" with no
   files), so the PR's diff ends up being just this app's own folder added
   on top of nothing. Targeting `master` got an instant close:
   "application submission pull requests must be made against the new-pr
   branch."
2. The manifest file must sit at the **PR diff's root** — `<app-id>.yml`,
   not `<app-id>/<app-id>.yml` in a subfolder. A nested path got: "Files not
   in toplevel."

`publish-flatpak.js` now does both correctly. It also **reopens the same PR
on a corrected retry** instead of opening a new one each time — the bot
explicitly asks for that ("please post a comment below instead of opening
or reopening (new) PRs"), and two real PRs (flathub/flathub#10360, #10361)
already got opened-then-closed working through these two issues.

**Flathub's submission process is external and can change** — re-check
https://docs.flathub.org/docs/for-app-authors/submission against what the
script actually does before relying on it for future submissions. Once
accepted, Flathub creates a dedicated `flathub/<app-id>` repo for future
updates to push to directly instead of opening a new PR each time.

## After Acceptance (not yet implemented)

Once `flathub/md.voiden.Voiden` exists, `publish-flatpak.js` needs a
direct-push path to that repo instead of a fresh `flathub/flathub` PR each
time (mirroring how `publish-brew.js` pushes straight to
`phurpa-tsering/homebrew-voiden` once that's created/accepted, rather than
opening a PR each time). The script currently exits with guidance if
`FLATHUB_APP_REPO_EXISTS=1` is set, rather than guessing at a flow that
hasn't been validated against the real repo yet — implement that path once
the app is actually accepted.

## Files in This Repo

| File | Purpose |
|---|---|
| `apps/electron/flatpak/md.voiden.Voiden.yml` | Flatpak manifest |
| `apps/electron/publish-flatpak.js` | Stamps the manifest + opens/tracks the Flathub submission |
