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

## A bare `brew install voiden` is not possible from a custom tap

This is a real, working Homebrew tap (**verified against live infra** — see
below), but `brew install voiden` with no prior `brew tap` will never find
it. Homebrew only searches `homebrew-core` (and, on macOS, the official
`homebrew-cask`, which is why `brew install voiden` already works on macOS —
Voiden has a real, accepted entry in `Homebrew/homebrew-cask`, set up
separately from anything in this doc) by default. A custom tap is invisible
to a bare install until Homebrew is told to look there:

```bash
brew tap voidenhq/voiden
brew install voiden

# or, equivalently, one line:
brew install voidenhq/voiden/voiden
```

The only way to get a truly bare `brew install voiden` on Linux is
acceptance into `homebrew-core` itself — a separate, human-reviewed
submission process with its own strict criteria (and GUI-only apps are
usually pointed at Cask instead of core formulae, which doesn't have a
Linux equivalent the way macOS does). Not attempted here.

## One-time Setup

The tap: https://github.com/VoidenHQ/homebrew-voiden

1. Create a **classic** GitHub PAT with the `repo` scope and store it as the
   `HOMEBREW_TAP_GITHUB_TOKEN` secret, from an account with push access to
   that repo (e.g. whoever created it — repo creators get admin on that
   specific repo even without being an org owner overall).

**Use classic, not fine-grained.** This tap briefly lived under a personal
account after a fine-grained PAT scoped to `VoidenHQ` got a real, confirmed
403 — fine-grained PATs scoped to an org repo typically need an org *owner*
to approve them before they work, which wasn't available. A classic PAT has
no such approval step and works fine here once it belongs to an account
that can push to this specific repo.

## Every Release (Linux, after `electron-forge make`)

```bash
node apps/electron/publish-brew.js stable
```

The script:
- Finds the built `.AppImage` in `out/make/`
- Computes its sha256
- Templates `Formula/voiden.rb` with the real version/url/sha256
- Clones `VoidenHQ/homebrew-voiden`, commits, and pushes directly to `main`
  (no fork/PR — same-repo push, unlike `publish-winget.js`'s fork-and-PR
  flow against the much larger, externally-owned `microsoft/winget-pkgs`)
- No-ops cleanly if the formula is already up to date for this version
  (safe to re-run)

## User Install Commands

```bash
brew tap voidenhq/voiden
brew install voiden

# Update
brew update && brew upgrade voiden
```

## Files in This Repo

| File | Purpose |
|---|---|
| `apps/electron/publish-brew.js` | Templates and pushes `Formula/voiden.rb` to the tap |

The formula itself lives in the separate `VoidenHQ/homebrew-voiden` repo,
not here — do not hand-edit it there, it's overwritten on every publish.

## Verified against real infra

A real dispatch of `publish-brew.js` (against the actual v2.3.0 stable
build artifact) successfully pushed a real formula update, confirmed by
reading the pushed file back from the tap repo:

```ruby
url "https://voiden.md/api/download/stable/linux/x64/Voiden-2.3.0.AppImage"
sha256 "d25ecf80790eee15f13c5e9a136171d359554c2535beddd9106491fbbdea6cd0"
version "2.3.0"
```

Not yet done: an actual `brew install voiden` run end-to-end on a real
Linux machine (the push is confirmed; the resulting install experience
itself hasn't been).
