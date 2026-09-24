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

## The submission PR must be opened by a human — not automated

Flathub's own PR template
(`.github/pull_request_template.md` in `flathub/flathub`) requires checking:

> I have not used AI tools or agents to generate or automate this
> submission pull request or its review interactions.

`publish-flatpak.js` originally automated the fork + PR the same way
`publish-winget.js` does against `microsoft/winget-pkgs`. Three real PRs got
opened this way (`flathub/flathub#10360`, `#10361`, `#10362`) while
iterating on unrelated bot rejections (wrong base branch, then a nested file
path) — which is what surfaced this template requirement in the first
place. Continuing to automate the PR would mean either checking that box
dishonestly or submitting one that fails Flathub's own stated criteria
either way. All three PRs were auto-closed by Flathub's `submission-checker`
bot; no PR is currently open.

**So `publish-flatpak.js` now only stamps the manifest file — it does not
touch GitHub at all.** The actual submission needs a human:

1. Fork `flathub/flathub` under your own account (or the account that
   should be Voiden's Flathub maintainer).
2. Add `apps/electron/flatpak/md.voiden.Voiden.yml` from this repo — **at
   the root** of your branch, named `md.voiden.Voiden.yml` (not nested in a
   subfolder — a nested path gets auto-rejected: "Files not in toplevel").
3. Push that branch and open a PR against `flathub/flathub`, with the base
   branch set to **`new-pr`** (not `master` — targeting `master` gets
   auto-rejected: "application submission pull requests must be made
   against the new-pr branch"). `new-pr` is a permanently empty orphan
   branch, so the PR's diff should just be that one new file.
4. Fill out the actual PR template honestly — it asks for an app
   description in your own words, a demo video of Voiden running via the
   Flatpak build, and an authorship/upstream-contact statement, none of
   which this script can produce.

This constraint is specific to the *initial submission* PR under Flathub's
human review process. Once Voiden is accepted, routine version bumps push
directly to the dedicated `flathub/md.voiden.Voiden` repo with no PR review
gate — same shape as `publish-winget.js`/`publish-brew.js` already automate
for their own ecosystems, and reasonable to automate here too once that repo
exists (see "After Acceptance" below).

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

## Domain + app id

The app id `md.voiden.Voiden` is the reverse-DNS of `voiden.md`. Flathub
requires proving ownership of that domain as part of first submission —
typically a file under `https://voiden.md/.well-known/`. Check
https://docs.flathub.org/docs/for-app-authors/requirements for the exact
current requirement before submitting; this hasn't been done yet.

## Every Release, Before Submission (Linux, after `electron-forge make`)

```bash
node apps/electron/publish-flatpak.js stable
```

Finds the built `.deb`, computes its sha256, and stamps the real
version-pinned url/sha256 into the manifest — nothing else. Commit the
updated manifest yourself as part of whatever PR/update you're making by
hand (see above for the initial submission; see "After Acceptance" for what
routine updates should look like later).

## After Acceptance (not yet implemented)

Once a human has gotten Voiden accepted and `flathub/md.voiden.Voiden`
exists, routine version bumps could push directly to that repo — no PR
review gate applies to an already-accepted app's own repo, so this doesn't
run into the same human-submission requirement as the initial PR. Not
implemented yet since that repo doesn't exist yet; add a real push path
(mirroring `publish-brew.js`'s direct push to
`phurpa-tsering/homebrew-voiden`) once it does.

## Files in This Repo

| File | Purpose |
|---|---|
| `apps/electron/flatpak/md.voiden.Voiden.yml` | Flatpak manifest |
| `apps/electron/publish-flatpak.js` | Stamps the manifest's url/sha256 only — does not touch GitHub |
