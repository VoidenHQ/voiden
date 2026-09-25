# Voiden — Homebrew (Linux) Release Guide

Addresses [#37](https://github.com/VoidenHQ/voiden/issues/37).

## Distribution method

Voiden's formula installs the already-released **AppImage** directly
(`chmod +x` + symlink into the Cellar's `bin/`) rather than unpacking the
`.deb` the way `snapcraft.yaml` does. The AppImage is a single, already
self-contained executable Voiden already ships and has already worked
through sandboxing caveats for (see the `caveats` block in the formula) —
no separate `stage-packages`-style dependency list to keep in sync here.

The formula is a plain, unconditional `url`/`sha256`/`version` gated by
`depends_on :linux` (a real Homebrew `LinuxRequirement`) — **not** nested
inside `on_linux do...end`. That nesting was tried first and broke tapping
*entirely*: Homebrew's `on_linux`/`on_macos` DSL validates the formula
against every OS variant it knows about, and since nothing was defined
outside the block, validation failed for every macOS bottle codename
(`golden_gate`, `tahoe`, `sequoia`, ...) simultaneously, which took the
whole tap down with "Cannot tap voidenhq/voiden: invalid syntax in tap!" —
confirmed on a real user's Linux machine. `depends_on :linux` fails cleanly
on macOS instead ("Linux is required for this software.") without touching
tap-wide validation at all.

Homebrew has no first-class prerelease/beta channel for a single formula —
`publish-brew.js` only publishes for the **stable** channel.

## Install command — two things this needs that aren't obvious, confirmed on real Linux

```bash
brew tap voidenhq/voiden
brew trust voidenhq/voiden
brew install voidenhq/voiden/voiden
```

**Both `brew trust` and the fully-qualified name are required, not
optional conveniences** — both confirmed by actually running this on a
real `ubuntu-latest` GitHub Actions runner (see `test-homebrew-tap.yml`),
not assumed from reading docs:

1. **`brew trust voidenhq/voiden`** — newer Homebrew refuses to load a
   formula from a third-party tap until it's explicitly trusted:
   `Refusing to load formula voidenhq/voiden/voiden from untrusted tap
   voidenhq/voiden.` This is a real Homebrew security gate for *any*
   third-party tap, not specific to this one.
2. **The fully-qualified name (`voidenhq/voiden/voiden`), not bare
   `voiden`** — Voiden already has a real, separately-accepted entry in
   the official `Homebrew/homebrew-cask` (macOS only). Because that name
   already exists elsewhere, a bare `brew install voiden` resolves to
   *that* Cask instead of this tap's formula — confirmed on Linux CI:
   `Treating voiden as a cask... This cask requires macOS.` Homebrew's own
   warning names the fix: use the fully-qualified name, or pass
   `--formula`.

A bare `brew install voiden` with **zero** ambiguity (no tap, no
qualification, and not shadowed by the Cask) is only possible via
acceptance into `homebrew-core` itself — a separate, human-reviewed
submission process with its own strict criteria. Not attempted here.

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

## Verifying a tap/formula change before pushing it live

`ruby -c` only checks Ruby *syntax* — it does not catch Homebrew DSL
mistakes (wrong `caveats` shape, `on_linux` structural issues, etc.), both
of which reached a real user before being caught here. Use
`.github/workflows/test-homebrew-tap.yml` (`workflow_dispatch`, runs on a
real `ubuntu-latest` box) to actually tap and install from the live repo
end-to-end before trusting a formula change.

## Files in This Repo

| File | Purpose |
|---|---|
| `apps/electron/publish-brew.js` | Templates and pushes `Formula/voiden.rb` to the tap |
| `.github/workflows/test-homebrew-tap.yml` | Manual real-Linux tap+install verification |

The formula itself lives in the separate `VoidenHQ/homebrew-voiden` repo,
not here — do not hand-edit it there, it's overwritten on every publish.

## Verified against real infra

A full `brew tap` → `brew trust` → `brew install voidenhq/voiden/voiden`
run succeeded end-to-end on a real `ubuntu-latest` GitHub Actions runner,
including confirming the installed binary:

```
/home/linuxbrew/.linuxbrew/bin/voiden -> ../Cellar/voiden/2.3.0/bin/voiden
```

`voiden --version` itself doesn't run headlessly in that environment
(`AppImages require FUSE to run` — the CI container has no FUSE), which is
an unrelated, expected AppImage/CI limitation, not a formula problem; real
desktop Linux systems have FUSE available by default.
