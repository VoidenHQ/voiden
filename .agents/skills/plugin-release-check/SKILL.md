---
name: plugin-release-check
description: Use whenever a plugin under plugins/<name> is updated/pushed, or whenever asked to write a changelog/release for the app or a plugin. Cross-checks each plugin's local package.json version against its latest GitHub release and the plugin-registry entry, so a bumped-but-unreleased plugin doesn't get silently left behind.
---

# Plugin release / registry consistency check

Each directory under `plugins/<name>/` is its own independent git repo (its
own GitHub remote, its own versioning, its own release cycle) — separate from
the main Voiden app. The central source of truth for what's actually
installable is `plugins/plugin-registry/extensions.json`, one object per
plugin, keyed by `id`, with at least `repo` (`owner/name`), `version`, and
`voidenVersion`.

These three numbers can drift out of sync:
1. `plugins/<name>/package.json` → `version` (local working tree)
2. The plugin repo's latest GitHub release tag
3. `plugins/plugin-registry/extensions.json` → that plugin's `"version"` field

## How to check

For each plugin directory with a `package.json` and a git remote (skip
`plugin-registry` itself):

```bash
# 1. Local version
node -p "require('./plugins/<name>/package.json').version"

# 2. Repo remote -> owner/name
git -C plugins/<name> remote get-url origin   # https://github.com/<owner>/<repo>.git

# 3. Latest GitHub release tag for that repo
gh release view --repo <owner>/<repo> --json tagName -q .tagName

# 4. Registry's recorded version for that plugin id
# (read plugins/plugin-registry/extensions.json, find the matching "id")
```

Strip the leading `v` from the release tag before comparing against semver
in `package.json`.

## Decision tree per plugin

- **local version > latest release tag** → the working tree has unreleased
  changes. **Ask the user** to cut a new GitHub release (with the built
  runner/asset, matching how existing releases for that repo are structured)
  for that plugin — do not create the release yourself, this is a
  user-confirmed action. Mention that `extensions.json` will also need its
  `version` (and `voidenVersion`, if the plugin's minimum Voiden version
  requirement changed) updated to match once the release exists.

- **local version == latest release tag, but registry version differs** →
  the release exists but the registry hasn't caught up. Update
  `plugins/plugin-registry/extensions.json` for that plugin's entry:
  `version` (and `voidenVersion` if it changed in this release) — bring it in
  sync with the actual release tag. This repo is also independent, so
  committing/pushing there needs the same confirmation as any other push.

- **local version < latest release tag** → the local checkout is just stale
  (someone released ahead of what's checked out here). Not actionable —
  no release or registry change needed, just note it if relevant.

- **all three match** → nothing to do.

## Notes

- Never create a GitHub release on the user's behalf — always ask first,
  same as any other push/release action.
- `extensions.json` edits are a normal file edit (fine to make directly), but
  committing/pushing them in the `plugin-registry` repo is a separate
  confirm-first step.
- This check pairs naturally with [[release-changelog]] — when asked to
  write a changelog entry (app or plugin), also run this check so a plugin
  version bump that shipped code but never got tagged isn't missed.
