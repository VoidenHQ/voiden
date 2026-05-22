# Void Blueprints Community Plugin — Design Spec

**Date:** 2026-05-21  
**Branch:** voidBlok  
**Status:** Approved for implementation

---

## Overview

Void Blueprints is a template system for Voiden that lets users create named slash commands that insert pre-configured sets of editor blocks (endpoints, headers, auth, body, etc.) in one action. Optionally, each Blueprint can carry prefilled block content — so running `/ardoise-studio` inserts an endpoint already populated with `{{BASE_STUDIO}}` and an auth block pre-configured with `{{CORE_JWT}}`.

The feature is substantially built in `core-extensions/src/voiden-voidbloks/` under the old working name "VoidBloks". The goal of this spec is to rename it to **Void Blueprints**, move it out of core, and ship it as a standalone community plugin ZIP, while keeping only generic editor capabilities in core Voiden.

---

## Current State

### What exists (under old name VoidBloks)

| Location | Contents | Status |
|---|---|---|
| `core-extensions/src/voiden-voidbloks/` | `types.ts`, `store.ts`, `slashGroup.ts`, `Manager.tsx`, `manifest.json` | Complete, but wired into core |
| `apps/ui/src/core/voidblok/` | `slashGroup.ts` (broken), `components/` (empty) | Abandoned duplicate — delete |
| `apps/ui/src/core/editors/voiden/extensions/voidBlokGroup.ts` | TipTap extension for `voidBlokId`/`voidBlokLabel` attributes | Needs to move into the plugin (renamed) |
| `apps/ui/src/core/editors/voiden/SlashCommand.tsx` | Reads `voidenSlashGroups` from enhancement store | Keep — generic plugin integration point |
| `apps/ui/src/plugins.tsx` | Exposes `ctx.addVoidenSlashGroup`, `ctx.files.*`, enhancement store | Keep — generic plugin context |
| `core-extensions/src/registry.ts` etc. | Registers `voiden-voidbloks` as core extension | Remove VoidBloks entries |

### The core problem

`core-extensions/src/voiden-voidbloks/` is a core extension (compiled into Voiden), not a community plugin. It also has a direct `import(/* @vite-ignore */ "@/plugins")` in `Manager.tsx` to read the editor enhancement store — which only works inside Voiden's own build and must be replaced.

---

## Template Storage

Two scopes, both project-relative:

| Scope | Path | Git behavior | Use case |
|---|---|---|---|
| `shared` | `.templates/blueprints/<slug>.json` | **Committed** — shared with team | Team-standard Blueprints |
| `local` | `.voiden/blueprints/<slug>.json` | **Ignored** — stays on your machine | Personal or environment-specific setups |

**Conflict rule:** a local Blueprint with the same `slash` as a shared Blueprint overrides the shared one at runtime.

### Template schema (v1)

```ts
type VoidBlueprint = {
  version: 1;
  id: string;           // UUID, stable identifier
  label: string;        // Display name
  slash: string;        // e.g. "/ardoise-studio"
  description: string;
  enabled: boolean;
  scope: "local" | "shared";
  commands: string[];   // slash strings of structure commands to compose
  content?: any[];      // prefilled editor block JSON (optional)
};
```

`commands` and `content` can coexist but `content` takes priority: if `content` is non-empty, `runBlueprint()` inserts the saved block JSON directly (with variables like `{{BASE_STUDIO}}` unresolved). If only `commands` is set, it composes existing slash commands in sequence. A Blueprint must have at least one of the two.

---

## Per-Install Settings

Plugin-level settings (not project-level) stored in the plugin's localStorage namespace:

- Default scope for new Blueprints (`local` or `shared`)
- Whether the status bar item shows a label or icon-only

These are per-installation and not shareable. The plugin stores them under a namespaced key like `voiden:blueprints:settings`.

---

## Plugin Architecture

### Package structure

The plugin lives as its own package — either a separate repo (for publishing to the community) or temporarily under `plugins/voiden-blueprints/` in the monorepo during development.

```
plugins/voiden-blueprints/
├── src/
│   ├── manifest.json
│   ├── index.tsx             # entry point
│   ├── types.ts
│   ├── store.ts              # file-backed template storage
│   ├── slashGroup.ts         # runBlueprint() + createBlueprintSlashGroup()
│   ├── blueprintGroup.ts     # TipTap extension (moved + renamed from core)
│   └── Manager.tsx           # React UI component
├── dist/
│   ├── manifest.json
│   └── main.js
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

### Plugin entry point responsibilities

```
onload(ctx):
  1. Register TipTap extension:   ctx.registerVoidenExtension(BlueprintGroupExtension)
  2. Load templates from disk:    await store.loadBlueprints(ctx)
  3. Register slash group:        ctx.addVoidenSlashGroup(createBlueprintSlashGroup(...))
  4. Register status bar item:    ctx.registerStatusBarItem({ id: "void-blueprints", icon: "Blocks", label: "Blueprints", position: "left", ... })
  5. Register manager panel:      ctx.registerPanel("main", { id: "blueprints-manager", title: "Void Blueprints", ... })

onunload():
  - clean up template subscriptions
```

### Fixing the @/plugins import leak

`Manager.tsx` currently calls `import(/* @vite-ignore */ "@/plugins")` to read available slash groups (so users can pick which commands to compose).

**Fix:** The plugin entry point passes its own slash group registry into the Manager via a closure. The plugin maintains an in-memory `getSlashGroups: () => SlashCommandGroup[]` in module scope. Manager.tsx calls this instead of importing `@/plugins`.

### File API

The plugin uses `context.files.*` for all template I/O:

```ts
context.files.read(path)           // Promise<string>
context.files.write(path, content) // Promise<void>
context.files.listDir(path)        // Promise<string[]>
context.files.ensureDir(path)      // Promise<string>
context.files.removeFile(path)     // Promise<boolean>
context.files.joinPath(...parts)   // Promise<string>
```

This API is already implemented in the Electron IPC layer and exposed on `PluginContext` via `sdk-extensions.d.ts`. The type declarations ship with the plugin for compilation.

---

## Core Voiden Changes

### Keep (generic editor capabilities)

- `useEditorEnhancementStore` in `plugins.tsx` — `voidenSlashGroups`, `voidenExtensions` slots
- `context.addVoidenSlashGroup` / `context.registerVoidenExtension` on PluginContext
- `context.files.*` IPC + preload API
- Drag menu group operations in `VoidenDragMenu.tsx` — treat `blueprintId` as a generic block-group attribute that any plugin can set. No Blueprint-specific logic in core.

### Remove

- `core-extensions/src/voiden-voidbloks/` — entire directory
- Registration in `registry.ts`, `main-plugins.ts`, `plugins.ts`
- `apps/ui/src/core/voidblok/` — entire directory (broken duplicate)
- `apps/ui/src/core/editors/voiden/extensions/voidBlokGroup.ts` — moves into plugin as `blueprintGroup.ts`

### Drag menu framing

The drag menu currently knows about "VoidBlok groups" via the `voidBlokId` attribute. After this change, the attribute is renamed to `blueprintId` (set by the plugin's TipTap extension), and the drag menu treats it generically: any block with a `blueprintId` belongs to a group and group operations apply. No Blueprint-specific logic stays in core.

---

## Manager UI

The Manager panel has two sections:

**Left column — create/edit form:**
- Name, Command (slash), Description fields
- Scope toggle: `.voiden` (local) ↔ `.templates` (shared)
- Structure commands picker — lists all available non-Blueprint slash commands with search; checkboxes to compose them
- Prefill content section (collapsible): "Capture active document blocks" button + raw JSON textarea
- Enabled toggle
- Create/Save/Cancel actions

**Right column — Blueprint list:**
- Each card shows: label, scope badge, enabled/disabled badge
- Actions: Make shared/local, On/Off toggle, Edit, Open file, Delete

---

## Prefill Behavior

When a Blueprint has `content`, `runBlueprint()` inserts those serialized editor blocks directly into the document at the cursor position. Variables like `{{BASE_STUDIO}}`, `{{CORE_JWT}}`, `{{AUTH_TOKEN}}` in URLs, headers, and body fields are left as-is — Voiden's existing variable substitution resolves them when the request runs.

The Manager's "Capture active document blocks" button serializes the currently open `.void` file's block content into `blueprint.content` — so you configure your request in Voiden first, then save it as a Void Blueprint.

---

## Singleton + Group Behavior

- Blocks inserted by `runBlueprint()` all receive the same `blueprintId` (a new UUID per insertion) and `blueprintLabel` (the Blueprint name).
- Singleton enforcement: before inserting, `runBlueprint()` checks the current document section (bounded by `request-separator` nodes) for blocks whose `compareKeys` match the incoming block type. If a singleton block already exists in the section, insertion is skipped.
- Drag menu group operations (copy/cut/delete/duplicate) operate on all blocks sharing the same `blueprintId`.

---

## Template Loading Order

On plugin load:
1. Load all `.json` files from `.templates/blueprints/` (shared)
2. Load all `.json` files from `.voiden/blueprints/` (local)
3. Merge: local Blueprint with same `slash` overrides shared
4. Filter to `enabled: true` Blueprints
5. Build slash command group and register via `ctx.addVoidenSlashGroup()`

On save/delete in Manager: reload Blueprints, re-register slash group.

---

## What Is NOT Changing

- The `.void` file format
- Existing block types (endpoint, headers, auth, body, query, separator, etc.)
- Variable substitution (`{{...}}`) — handled entirely by core Voiden at request time
- The `voidenSlashGroups` store shape in `plugins.tsx`
- All other core extensions

---

## Out of Scope

- Multi-workspace Blueprint sync
- Blueprint versioning/migration beyond v1
- Blueprint sharing/publishing to a marketplace
- Per-block prefill overrides at insert time (variables left as unresolved placeholders)
