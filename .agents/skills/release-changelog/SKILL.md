---
name: release-changelog
description: Use whenever asked to write/create a new changelog entry for a new Voiden app version (e.g. "create a changelog for 2.1.2", "add a new patch release changelog"). Two files must be updated together — the full technical changelog AND the in-app "What's New" highlights — never just one.
---

# Voiden release changelog workflow

When asked to create a changelog entry for a new app version, **two files** need
updating, not one. They serve different audiences and have different formats —
do not skip the second file or copy the same content into both verbatim.

## 1. `apps/ui/src/data/changelog.json` — full technical changelog

The exhaustive, engineering-facing record. One object per release, prepended
to the top of the array (newest first).

```json
{
  "version": "vX.Y.Z",
  "date": "DD/MM/YYYY",
  "title": "Short Punchy Title",
  "description": "1-2 sentence summary of the release for the changelog page header.",
  "icon": "Wrench",
  "iconColor": "text-orange-400",
  "bgColor": "bg-gradient-to-br from-slate-900 to-orange-950",
  "changes": {
    "Added": ["..."],
    "Improved": ["..."],
    "Fixed": ["..."]
  }
}
```

- Only include `"Added"`/`"Improved"`/`"Fixed"` keys that actually have entries for this release.
- Each bullet should be specific enough to explain *what broke* and *what changed*, not just "fixed a bug".
- Derive content from `git log <previous-changelog-commit>..HEAD`, scoped to user-facing changes — skip pure CI/release-pipeline commits (npm publish config, GitHub workflow tweaks, signing, packaging scripts) unless they're user-visible (e.g. "Windows installer now signed correctly").
- Pick an icon from the existing set already used in the file (`Wrench`, `Sparkles`, `Bug`, `Plug`, etc.) — reuse for consistency, vary the color so consecutive releases don't look identical.
- Validate with `node -e "JSON.parse(require('fs').readFileSync('apps/ui/src/data/changelog.json','utf8')))"` after editing.

## 2. `apps/ui/src/core/whats-new/whats-new.json` — in-app "What's New" highlights

A **curated, marketing-toned** subset shown in the in-app spotlight/modal
(`apps/ui/src/core/whats-new/WhatsNewModal.tsx`). Prepend a new release object
to `releases` (newest first):

```json
{
  "version": "X.Y.Z",
  "date": "Month YYYY",
  "whatsnew": [
    {
      "icon": "🌱",
      "title": "Short Title",
      "description": "User-facing sentence or two, written for someone who didn't read the technical changelog — explain the *benefit*, not the implementation."
    }
  ]
}
```

- Version string has **no leading `v`** here (unlike `changelog.json`), and `date` is `"Month YYYY"`, not `DD/MM/YYYY`.
- Pick 2-4 of the most user-visible items, not every bullet from the technical changelog. Bundle a batch of minor/internal fixes into one "🐛 ... Fixes" entry rather than listing each separately — see existing `2.0.1`/`2.1.0` entries in the file for tone and granularity.
- A release that's pure CI/infra/internal cleanup with nothing user-visible can be skipped here (it's fine for `whats-new.json` to jump versions) — but if you added a changelog entry because there *was* user-facing change, add a whats-new entry too.
- Use real emoji for `icon` (not Lucide icon names — that's `changelog.json`'s convention, this file is different).
- Validate the same way after editing.

## Order of operations

1. Check `git log` since the last changelog entry's commit to know what actually shipped.
2. Write the `changelog.json` entry first (full detail).
3. Distill 2-4 highlights from it into a `whats-new.json` entry.
4. Validate both JSON files parse.
