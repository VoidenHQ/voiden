# Voiden — Homebrew (Linux) Release Guide

Addresses [#37](https://github.com/VoidenHQ/voiden/issues/37).

## Distribution method

Voiden's formula installs the already-released **AppImage** directly
(`chmod +x` + symlink into the Cellar's `bin/`) rather than unpacking the
`.deb` the way `snapcraft.yaml` does. The AppImage is a single, already
self-contained executable Voiden already ships and has already worked
through sandboxing caveats for (see the `caveats` block in the formula) —
no separate `stage-packages`-style dependency list to keep in sync here.

Homebrew has no first-class prerelease/beta channel for a single formula —
`publish-brew.js` only publishes for the **stable** channel.

## One-time Setup

The tap already exists: https://github.com/phurpa-tsering/homebrew-voiden

Hosted under a personal account rather than `VoidenHQ` — a fine-grained PAT
scoped to an org repo typically needs an org *owner* to approve it before it
works, which isn't available here; a repo owned outright by the token's own
account has no such approval step.

1. Create a **classic** GitHub PAT with the `repo` scope (fine-grained tokens
   work too for a repo you own, but classic avoids org-approval gotchas
   entirely) and store it as the `HOMEBREW_TAP_GITHUB_TOKEN` secret.

That's the only setup — unlike Winget/Chocolatey/Snap, there's no external
account to register or package id to claim, since the tap owner pushes to
their own repo outright.

## Every Release (Linux, after `electron-forge make`)

```bash
node apps/electron/publish-brew.js stable
```

The script:
- Finds the built `.AppImage` in `out/make/`
- Computes its sha256
- Templates `Formula/voiden.rb` with the real version/url/sha256
- Clones `phurpa-tsering/homebrew-voiden`, commits, and pushes directly to
  `main` (no fork/PR — same-repo push, unlike `publish-winget.js`'s
  fork-and-PR flow against the much larger, externally-owned
  `microsoft/winget-pkgs`)
- No-ops cleanly if the formula is already up to date for this version
  (safe to re-run)

## User Install Commands

```bash
brew tap phurpa-tsering/voiden
brew install voiden

# Update
brew update && brew upgrade voiden
```

## Files in This Repo

| File | Purpose |
|---|---|
| `apps/electron/publish-brew.js` | Templates and pushes `Formula/voiden.rb` to the tap |

The formula itself lives in the separate `phurpa-tsering/homebrew-voiden`
repo, not here — do not hand-edit it there, it's overwritten on every
publish.

## Verifying a real install (not done as part of this change)

`publish-brew.js` and the formula's syntax have been checked
(`node --check`, `ruby -c`), but an actual `brew install voiden` from the
tap has not been run end-to-end — that needs a real released AppImage at
the pinned URL first. Do that once a real version has gone through
`publish-brew.js` for the first time.
