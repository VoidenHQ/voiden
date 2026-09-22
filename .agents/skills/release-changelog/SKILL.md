---
name: release-changelog
description: Use whenever asked to write/create a new changelog entry for a new Voiden app version (e.g. "create a changelog for 2.1.2", "add a new patch release changelog"), or to sync/backfill the changelog on the marketing website. Three files across two repos need updating together — the app's full technical changelog, its in-app "What's New" highlights, and the website's changelog mirror — never just one.
---

# Voiden release changelog workflow

## Sibling repositories

This repo (`voiden`) is one of three under `~/Desktop/Voiden/` — know all three before starting release work, since a release routinely touches more than one:

- **`voiden`** (this repo) — the app monorepo. Owns `apps/ui/src/data/changelog.json` (full technical changelog) and `apps/ui/src/core/whats-new/whats-new.json` (in-app highlights).
- **`../Voiden Website/website`** — the public marketing site. Mirrors the technical changelog at `src/features/changelog/data.ts`, rendered by `src/components/ChangelogEntry.tsx`. Same content as `changelog.json`, different schema (see part 3 below) — keep both in sync every release, don't let the website fall behind (it had silently missed three whole releases before this note existed).
- **`../docs`** — the docs site (docs.voiden.md, Docusaurus). No changelog here, but a release that adds or changes a user-facing feature (a new block, a new CLI flag, a new panel) usually means a doc page needs updating too. This skill doesn't write those doc edits itself — but check whether one's needed, and say so, rather than closing out release work as if the changelog were the only thing that could be stale.

When asked to create a changelog entry for a new app version, **three files across two repos** need updating, not one. They serve different audiences and have different formats — do not skip any of them or copy the same content in verbatim where the format actually differs.

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
- **Each bullet is ONE line** — a single short sentence or clause, like Bruno's and Yaak's changelogs (`fix: stop AWS V4 auth headers from leaking on cross-origin redirects`). Name what changed, not the mechanism — no "because", no multi-clause backstory, no explaining *why* it broke or *how* it was fixed internally. If it takes more than one line to read, cut it down to the user-visible outcome only. An issue/PR number in parens (`(#523)`) is fine and matches the file's existing convention.
- **Title/description stay neutral about the past.** Don't phrase a fix as "X Actually Works Now" or "X Finally Fixed" — that reads as an admission the feature never worked, which isn't the tone a release note should take even when it's technically true. State what changed ("X Connection Fix", "X Reliability Fix"), not a verdict on the prior state.
- Derive content from `git log <previous-changelog-commit>..HEAD`, scoped to user-facing changes — skip pure CI/release-pipeline commits (npm publish config, GitHub workflow tweaks, signing, packaging scripts) unless they're user-visible (e.g. "Windows installer now signed correctly").
- **Contributor credit, with a real link.** For every change whose commit/PR author isn't the core team, append ` — contributed by [@username](https://github.com/username)` to that bullet. Don't guess the username from the commit's git author name or email — look it up for certain:
  - `git log <range> --format="%an <%ae>"` to see who committed in this release's range.
  - For each non-core author, find their PR number (commit message usually has `(#123)`) and confirm the real GitHub login with `gh pr view <number> --repo VoidenHQ/voiden --json author -q .author.login` — a `noreply.github.com` commit email often encodes the username directly, but don't rely on that alone (a personal/work email tells you nothing); the PR lookup is the source of truth.
  - This renders as a real clickable link in the app (`ChangeLogScreen.tsx` parses the `[text](url)` shape specifically for this) — always use that exact markdown-link form, not a bare URL or plain username.
  - Check every contributor's change actually made it into a changelog bullet — it's easy for a real fix to ship without ever getting written up. Cross-check `git log <range> --format="%an"` against what you're about to write, and add a bullet for anything missing rather than only covering what an existing draft already mentions.
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

## 3. `../Voiden Website/website/src/features/changelog/data.ts` — website mirror

Same content as `changelog.json`'s entry (part 1) — same bullets, same
one-line rule, same contributor links — but a different schema, in a
**different repo** (`Voiden Website/website`, a sibling of this one, not a
subdirectory of it). Prepend to the top of the `changelogs` array:

```ts
{
  version: "X.Y.Z",      // no leading "v", unlike changelog.json
  date: "YYYY-MM-DD",    // ISO, unlike changelog.json's DD/MM/YYYY
  title: "Short Punchy Title",
  description: "Same 1-2 sentence summary as changelog.json.",
  icon: "Wrench",
  iconColor: "text-orange-400",
  bgColor: "bg-gradient-to-br from-slate-900 to-orange-950",
  changes: [
    { type: "added", items: ["..."] },
    { type: "improved", items: ["..."] },
    { type: "fixed", items: ["..."] },
  ],
}
```

- `changes` is an **array of `{type, items}` objects** here (lowercase `type`: `added`/`improved`/`fixed`/`changed`/`notes`), not a keyed object like `changelog.json`'s `Added`/`Improved`/`Fixed`. Don't paste one shape into the other's file.
- Contributor links use the identical `[@username](https://github.com/username)` markdown-link text — `ChangelogEntry.tsx` parses that exact shape the same way `ChangeLogScreen.tsx` does on the app side. Keep both parsers' regex (`CHANGE_LINK_RE`) in sync if either ever changes.
- Validate with `npx tsc --noEmit -p tsconfig.json` (run from the website repo root) after editing — it's a `.ts` file, not JSON, so `JSON.parse` won't catch a syntax error here.
- This file has drifted behind `changelog.json` before (three releases went unmirrored) — when in doubt, diff the top few entries of both files before assuming the website is current.

## Order of operations

1. Check `git log` since the last changelog entry's commit to know what actually shipped.
2. Write the `changelog.json` entry first (full detail).
3. Distill 2-4 highlights from it into a `whats-new.json` entry.
4. Mirror the same entry into the website's `data.ts` (part 3) — same content, different schema, different repo.
5. Validate all three files (two JSON parses + one `tsc --noEmit`).
6. If this release shipped a new or changed user-facing feature, check `../docs` for a page that now needs updating — flag it even if you're not the one writing that doc pass right now.
