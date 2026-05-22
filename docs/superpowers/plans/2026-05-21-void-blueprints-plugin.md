# Void Blueprints Community Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the VoidBloks feature out of core Voiden, rename it to Void Blueprints, and ship it as a standalone community plugin ZIP.

**Architecture:** The existing logic in `core-extensions/src/voiden-voidbloks/` becomes a standalone esbuild-bundled plugin package under `plugins/voiden-blueprints/`. Core Voiden retains only generic editor infrastructure (attribute extension, drag-menu group ops, plugin context APIs). The plugin registers its slash group, status bar item, and manager panel via the public SDK.

**Tech Stack:** TypeScript, React, TipTap extensions, esbuild, @voiden/sdk

---

## File Map

### Create (plugin package)
- `plugins/voiden-blueprints/package.json`
- `plugins/voiden-blueprints/tsconfig.json`
- `plugins/voiden-blueprints/esbuild.config.mjs`
- `plugins/voiden-blueprints/src/manifest.json`
- `plugins/voiden-blueprints/src/types.ts`
- `plugins/voiden-blueprints/src/store.ts`
- `plugins/voiden-blueprints/src/slashGroup.ts`
- `plugins/voiden-blueprints/src/Manager.tsx`
- `plugins/voiden-blueprints/src/index.tsx`
- `plugins/voiden-blueprints/src/sdk-extensions.d.ts`

### Modify (core Voiden)
- `apps/ui/src/types/sdk-extensions.d.ts` — add `getVoidenSlashGroups`
- `core-extensions/src/types/sdk-extensions.d.ts` — same
- `apps/ui/src/plugins.tsx` — add `getVoidenSlashGroups` implementation
- `apps/ui/src/core/editors/voiden/VoidenEditor.tsx` — swap `voidBlokGroup` → `blueprintGroup`
- `apps/ui/src/core/editors/voiden/components/VoidenDragMenu.tsx` — rename `voidBlokId`/`voidBlokLabel` → `blueprintId`/`blueprintLabel`
- `core-extensions/src/registry.ts` — remove `voiden-voidbloks` entry
- `core-extensions/src/plugins.ts` — remove `voiden-voidbloks` import and entry

### Rename (core Voiden)
- `apps/ui/src/core/editors/voiden/extensions/voidBlokGroup.ts` → `blueprintGroup.ts`

### Delete
- `core-extensions/src/voiden-voidbloks/` (entire directory)
- `apps/ui/src/core/voidblok/` (entire directory)

---

## Task 1: Add `getVoidenSlashGroups` to plugin context

The Manager needs to list all available slash commands so users can compose blueprints from them. The plugin loads at priority 95 (last), so at `onload` time all other plugins' groups are already in the enhancement store. We expose a `ctx.getVoidenSlashGroups()` method that reads them.

**Files:**
- Modify: `apps/ui/src/types/sdk-extensions.d.ts`
- Modify: `core-extensions/src/types/sdk-extensions.d.ts`
- Modify: `apps/ui/src/plugins.tsx`

- [ ] **Step 1: Add the type to both sdk-extensions.d.ts files**

In `apps/ui/src/types/sdk-extensions.d.ts`, add `getVoidenSlashGroups` inside the `PluginContext` interface:

```typescript
import type { ResponseChildNodeType } from "@/core/extensions/hooks/useParentResponseDoc";
import type { SlashCommandGroup } from "@voiden/sdk/ui";

declare module "@voiden/sdk/ui" {
  interface PluginContext {
    files: {
      read: (path: string) => Promise<string>;
      write: (path: string, content: string) => Promise<void>;
      listDir: (path: string) => Promise<string[]>;
      ensureDir: (path: string) => Promise<void>;
      removeFile: (path: string) => Promise<void>;
      joinPath: (...parts: string[]) => Promise<string | undefined>;
    };
    getVoidenSlashGroups: () => SlashCommandGroup[];
  }

  interface RequestHooks {
    useParentResponseDoc: (
      editor: any,
      getPos: () => number
    ) => {
      openNodes: ResponseChildNodeType[];
      parentPos: number | null;
    };
    useResponseBodyHeight: () => {
      height: number | null;
      setHeight: (h: number) => void;
    };
  }
}
```

Apply the same addition (just the `getVoidenSlashGroups` line) to `core-extensions/src/types/sdk-extensions.d.ts`.

- [ ] **Step 2: Add the implementation in plugins.tsx**

Find the block around line 312 in `apps/ui/src/plugins.tsx` where `addVoidenSlashGroup` is implemented. Add `getVoidenSlashGroups` right after it:

```typescript
addVoidenSlashGroup: (group: SlashCommandGroup) => {
  useEditorEnhancementStore.getState().addVoidenSlashGroup(group);
},
getVoidenSlashGroups: (): SlashCommandGroup[] => {
  return useEditorEnhancementStore.getState().voidenSlashGroups;
},
```

- [ ] **Step 3: Verify TypeScript compiles in apps/ui**

```bash
cd apps/ui && npx tsc --noEmit
```
Expected: no errors on the new lines (may have pre-existing errors elsewhere — ignore those).

- [ ] **Step 4: Commit**

```bash
git add apps/ui/src/types/sdk-extensions.d.ts core-extensions/src/types/sdk-extensions.d.ts apps/ui/src/plugins.tsx
git commit -m "feat: expose getVoidenSlashGroups on plugin context"
```

---

## Task 2: Rename voidBlokGroup extension to blueprintGroup

The TipTap extension that stamps `voidBlokId`/`voidBlokLabel` on editor blocks is configured inside VoidenEditor. We rename the file and the attribute keys.

**Files:**
- Rename + modify: `apps/ui/src/core/editors/voiden/extensions/voidBlokGroup.ts` → `blueprintGroup.ts`
- Modify: `apps/ui/src/core/editors/voiden/VoidenEditor.tsx`

- [ ] **Step 1: Create blueprintGroup.ts**

Create `apps/ui/src/core/editors/voiden/extensions/blueprintGroup.ts` with this exact content:

```typescript
import { Extension } from "@tiptap/core";

interface BlueprintGroupOptions {
  types: string[];
}

export const BlueprintGroup = Extension.create<BlueprintGroupOptions>({
  name: "blueprintGroup",

  addOptions() {
    return { types: [] };
  },

  addGlobalAttributes() {
    return (this.options.types || []).map((type) => ({
      types: [type],
      attributes: {
        blueprintId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-blueprint-id"),
          renderHTML: (attributes) => {
            const value = attributes.blueprintId as string | null;
            return value ? { "data-blueprint-id": value } : {};
          },
        },
        blueprintLabel: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-blueprint-label"),
          renderHTML: (attributes) => {
            const value = attributes.blueprintLabel as string | null;
            return value ? { "data-blueprint-label": value } : {};
          },
        },
      },
    }));
  },
});
```

- [ ] **Step 2: Update VoidenEditor.tsx**

Replace the import and usages in `apps/ui/src/core/editors/voiden/VoidenEditor.tsx`:

Old import (line 25):
```typescript
import { VoidBlokGroup } from "./extensions/voidBlokGroup";
```
New:
```typescript
import { BlueprintGroup } from "./extensions/blueprintGroup";
```

Old useMemo (lines 132-138):
```typescript
  const voidBlokGroupExtension = useMemo(
    () =>
      VoidBlokGroup.configure({
        types: customNodeTypes,
      }),
    [customNodeTypes],
  );
```
New:
```typescript
  const blueprintGroupExtension = useMemo(
    () =>
      BlueprintGroup.configure({
        types: customNodeTypes,
      }),
    [customNodeTypes],
  );
```

Old finalExtensions (line 144):
```typescript
      voidBlokGroupExtension,
```
New:
```typescript
      blueprintGroupExtension,
```

Old useMemo dependency (line 154):
```typescript
  }, [memoizedExtensions, voidBlokGroupExtension, uniqueIdExtension, envData, voidVariableData]);
```
New:
```typescript
  }, [memoizedExtensions, blueprintGroupExtension, uniqueIdExtension, envData, voidVariableData]);
```

- [ ] **Step 3: Delete the old extension file**

```bash
rm apps/ui/src/core/editors/voiden/extensions/voidBlokGroup.ts
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/ui && npx tsc --noEmit 2>&1 | grep -i "blueprintGroup\|voidBlokGroup"
```
Expected: no errors referencing these files.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/core/editors/voiden/extensions/blueprintGroup.ts apps/ui/src/core/editors/voiden/VoidenEditor.tsx
git rm apps/ui/src/core/editors/voiden/extensions/voidBlokGroup.ts
git commit -m "feat: rename voidBlokGroup TipTap extension to blueprintGroup"
```

---

## Task 3: Update VoidenDragMenu to use blueprintId/blueprintLabel

**Files:**
- Modify: `apps/ui/src/core/editors/voiden/components/VoidenDragMenu.tsx`

This task is a rename sweep across the file. Make each change in order.

- [ ] **Step 1: Rename internal helpers (lines 14-28)**

Replace:
```typescript
const createVoidBlokGroupId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `voidblok-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const remapVoidBlokNodes = (nodes: any[]) => {
  const voidBlokId = createVoidBlokGroupId();
  return nodes.map((node) => ({
    ...node,
    attrs: {
      ...(node.attrs ?? {}),
      voidBlokId,
    },
  }));
};
```
With:
```typescript
const createBlueprintGroupId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blueprint-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const remapBlueprintNodes = (nodes: any[]) => {
  const blueprintId = createBlueprintGroupId();
  return nodes.map((node) => ({
    ...node,
    attrs: {
      ...(node.attrs ?? {}),
      blueprintId,
    },
  }));
};
```

- [ ] **Step 2: Rename getVoidBlokRange function (lines 276-312)**

Replace:
```typescript
  const getVoidBlokRange = useCallback(() => {
    const groupId = currentNode?.attrs?.voidBlokId;
    if (!groupId) return null;

    const doc = editor.state.doc;
    const blocks: { node: Node; from: number; to: number }[] = [];
    let offset = 0;

    doc.forEach((node) => {
      const from = offset;
      const to = from + node.nodeSize;
      if (node.attrs?.voidBlokId === groupId) {
        blocks.push({ node, from, to });
      }
      offset = to;
    });

    const currentIndex = blocks.findIndex((block) => block.from === currentNodePos);
    if (currentIndex === -1) return null;

    let startIndex = currentIndex;
    let endIndex = currentIndex;

    while (startIndex > 0 && blocks[startIndex - 1].to === blocks[startIndex].from) {
      startIndex--;
    }
    while (endIndex < blocks.length - 1 && blocks[endIndex].to === blocks[endIndex + 1].from) {
      endIndex++;
    }

    return {
      from: blocks[startIndex].from,
      to: blocks[endIndex].to,
      nodes: blocks.slice(startIndex, endIndex + 1).map((block) => block.node.toJSON()),
      label: currentNode.attrs?.voidBlokLabel || "VoidBlok",
    };
  }, [editor, currentNode, currentNodePos]);
```
With:
```typescript
  const getBlueprintRange = useCallback(() => {
    const groupId = currentNode?.attrs?.blueprintId;
    if (!groupId) return null;

    const doc = editor.state.doc;
    const blocks: { node: Node; from: number; to: number }[] = [];
    let offset = 0;

    doc.forEach((node) => {
      const from = offset;
      const to = from + node.nodeSize;
      if (node.attrs?.blueprintId === groupId) {
        blocks.push({ node, from, to });
      }
      offset = to;
    });

    const currentIndex = blocks.findIndex((block) => block.from === currentNodePos);
    if (currentIndex === -1) return null;

    let startIndex = currentIndex;
    let endIndex = currentIndex;

    while (startIndex > 0 && blocks[startIndex - 1].to === blocks[startIndex].from) {
      startIndex--;
    }
    while (endIndex < blocks.length - 1 && blocks[endIndex].to === blocks[endIndex + 1].from) {
      endIndex++;
    }

    return {
      from: blocks[startIndex].from,
      to: blocks[endIndex].to,
      nodes: blocks.slice(startIndex, endIndex + 1).map((block) => block.node.toJSON()),
      label: currentNode.attrs?.blueprintLabel || "Blueprint",
    };
  }, [editor, currentNode, currentNodePos]);
```

- [ ] **Step 3: Rename copyVoidBlok, duplicateVoidBlok, cutVoidBlok, deleteVoidBlok**

Replace:
```typescript
  const copyVoidBlok = useCallback(() => {
    const range = getVoidBlokRange();
    if (!range) return;
    navigator.clipboard.writeText(`voidblok://${JSON.stringify(range.nodes)}`);
  }, [getVoidBlokRange]);

  const duplicateVoidBlok = useCallback(() => {
    const range = getVoidBlokRange();
    if (!range) return;

    editor.chain().insertContentAt(range.to, remapVoidBlokNodes(range.nodes)).run();
    setTimeout(() => {
      safeFocusEditor(range.to + 1);
    }, 0);
  }, [editor, getVoidBlokRange, safeFocusEditor]);

  const cutVoidBlok = useCallback(() => {
    const range = getVoidBlokRange();
    if (!range) return;

    navigator.clipboard.writeText(`voidblok://${JSON.stringify(range.nodes)}`);
    editor.chain()
      .command(({ dispatch, tr }) => {
        if (dispatch) {
          tr.delete(range.from, range.to);
          return dispatch(tr);
        }
        return true;
      })
      .run();

    setTimeout(() => {
      safeFocusEditor(Math.min(range.from, editor.state.doc.content.size));
    }, 0);
  }, [editor, getVoidBlokRange, safeFocusEditor]);

  const deleteVoidBlok = useCallback(() => {
    const range = getVoidBlokRange();
    if (!range) return;

    editor.chain()
      .command(({ dispatch, tr }) => {
        if (dispatch) {
          tr.delete(range.from, range.to);
          return dispatch(tr);
        }
        return true;
      })
      .run();

    setTimeout(() => {
      safeFocusEditor(Math.min(range.from, editor.state.doc.content.size));
    }, 0);
  }, [editor, getVoidBlokRange, safeFocusEditor]);
```
With:
```typescript
  const copyBlueprint = useCallback(() => {
    const range = getBlueprintRange();
    if (!range) return;
    navigator.clipboard.writeText(`blueprint://${JSON.stringify(range.nodes)}`);
  }, [getBlueprintRange]);

  const duplicateBlueprint = useCallback(() => {
    const range = getBlueprintRange();
    if (!range) return;

    editor.chain().insertContentAt(range.to, remapBlueprintNodes(range.nodes)).run();
    setTimeout(() => {
      safeFocusEditor(range.to + 1);
    }, 0);
  }, [editor, getBlueprintRange, safeFocusEditor]);

  const cutBlueprint = useCallback(() => {
    const range = getBlueprintRange();
    if (!range) return;

    navigator.clipboard.writeText(`blueprint://${JSON.stringify(range.nodes)}`);
    editor.chain()
      .command(({ dispatch, tr }) => {
        if (dispatch) {
          tr.delete(range.from, range.to);
          return dispatch(tr);
        }
        return true;
      })
      .run();

    setTimeout(() => {
      safeFocusEditor(Math.min(range.from, editor.state.doc.content.size));
    }, 0);
  }, [editor, getBlueprintRange, safeFocusEditor]);

  const deleteBlueprint = useCallback(() => {
    const range = getBlueprintRange();
    if (!range) return;

    editor.chain()
      .command(({ dispatch, tr }) => {
        if (dispatch) {
          tr.delete(range.from, range.to);
          return dispatch(tr);
        }
        return true;
      })
      .run();

    setTimeout(() => {
      safeFocusEditor(Math.min(range.from, editor.state.doc.content.size));
    }, 0);
  }, [editor, getBlueprintRange, safeFocusEditor]);
```

- [ ] **Step 4: Update the return object of useActions**

Replace the old return value entries:
```typescript
    copyVoidBlok,
    duplicateVoidBlok,
    cutVoidBlok,
    deleteVoidBlok,
```
With:
```typescript
    copyBlueprint,
    duplicateBlueprint,
    cutBlueprint,
    deleteBlueprint,
```

- [ ] **Step 5: Update DragPopoverContentProps interface**

Replace:
```typescript
  copyVoidBlok?: () => void;
  duplicateVoidBlok?: () => void;
  cutVoidBlok?: () => void;
  deleteVoidBlok?: () => void;
  ...
  voidBlokLabel?: string | null;
```
With:
```typescript
  copyBlueprint?: () => void;
  duplicateBlueprint?: () => void;
  cutBlueprint?: () => void;
  deleteBlueprint?: () => void;
  ...
  blueprintLabel?: string | null;
```

- [ ] **Step 6: Update DragPopoverContent render function**

In the destructured parameters of `DragPopoverContent`, replace:
```typescript
  { ..., copyVoidBlok, duplicateVoidBlok, cutVoidBlok, deleteVoidBlok, ..., voidBlokLabel, ... }
```
With:
```typescript
  { ..., copyBlueprint, duplicateBlueprint, cutBlueprint, deleteBlueprint, ..., blueprintLabel, ... }
```

Replace the Blueprint operations section in JSX:
```typescript
              {voidBlokLabel && copyVoidBlok && duplicateVoidBlok && cutVoidBlok && deleteVoidBlok && (
                <>
                  <div className="h-px bg-border my-1" />
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-comment">
                    VoidBlok Operations
                  </div>
                  <DragMenuItem onClick={copyVoidBlok} label={`Copy ${voidBlokLabel}`} hint="VoidBlok" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘C" size="sm"></Kbd></span>} />
                  <DragMenuItem onClick={duplicateVoidBlok} label={`Duplicate ${voidBlokLabel}`} hint="VoidBlok" shortcut={<span className="inline-block mr-1"><Kbd keys={duplicateShortcut} size="sm"></Kbd></span>} />
                  <DragMenuItem onClick={cutVoidBlok} label={`Cut ${voidBlokLabel}`} hint="VoidBlok" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘X" size="sm"></Kbd></span>} />
                  <DragMenuItem onClick={deleteVoidBlok} label={`Delete ${voidBlokLabel}`} hint="VoidBlok" shortcut={<span className="inline-block mr-1"><Kbd keys="⌫" size="sm"></Kbd></span>} />
                </>
              )}
```
With:
```typescript
              {blueprintLabel && copyBlueprint && duplicateBlueprint && cutBlueprint && deleteBlueprint && (
                <>
                  <div className="h-px bg-border my-1" />
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-comment">
                    Blueprint Operations
                  </div>
                  <DragMenuItem onClick={copyBlueprint} label={`Copy ${blueprintLabel}`} hint="Blueprint" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘C" size="sm"></Kbd></span>} />
                  <DragMenuItem onClick={duplicateBlueprint} label={`Duplicate ${blueprintLabel}`} hint="Blueprint" shortcut={<span className="inline-block mr-1"><Kbd keys={duplicateShortcut} size="sm"></Kbd></span>} />
                  <DragMenuItem onClick={cutBlueprint} label={`Cut ${blueprintLabel}`} hint="Blueprint" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘X" size="sm"></Kbd></span>} />
                  <DragMenuItem onClick={deleteBlueprint} label={`Delete ${blueprintLabel}`} hint="Blueprint" shortcut={<span className="inline-block mr-1"><Kbd keys="⌫" size="sm"></Kbd></span>} />
                </>
              )}
```

- [ ] **Step 7: Update main VoidenDragMenu component**

In the destructured `useActions` return (lines 643-663), replace:
```typescript
    copyVoidBlok,
    duplicateVoidBlok,
    cutVoidBlok,
    deleteVoidBlok,
```
With:
```typescript
    copyBlueprint,
    duplicateBlueprint,
    cutBlueprint,
    deleteBlueprint,
```

Replace the derived label variable (line 978-979):
```typescript
  const voidBlokLabel = currentNode?.attrs?.voidBlokId
    ? currentNode.attrs.voidBlokLabel || "VoidBlok"
    : null;
```
With:
```typescript
  const blueprintLabel = currentNode?.attrs?.blueprintId
    ? currentNode.attrs.blueprintLabel || "Blueprint"
    : null;
```

Replace the PopoverTrigger tooltip (line 1017):
```typescript
              title={voidBlokLabel ? `${voidBlokLabel} block` : undefined}
```
With:
```typescript
              title={blueprintLabel ? `${blueprintLabel} block` : undefined}
```

Replace the accent indicator condition (line 1019):
```typescript
              {voidBlokLabel && (
```
With:
```typescript
              {blueprintLabel && (
```

Update the DragPopoverContent props passed (lines 1036-1044):
```typescript
            copyVoidBlok={copyVoidBlok}
            duplicateVoidBlok={duplicateVoidBlok}
            cutVoidBlok={cutVoidBlok}
            deleteVoidBlok={deleteVoidBlok}
            ...
            voidBlokLabel={voidBlokLabel}
```
With:
```typescript
            copyBlueprint={copyBlueprint}
            duplicateBlueprint={duplicateBlueprint}
            cutBlueprint={cutBlueprint}
            deleteBlueprint={deleteBlueprint}
            ...
            blueprintLabel={blueprintLabel}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd apps/ui && npx tsc --noEmit 2>&1 | grep -i "dragmenu\|voidBlok"
```
Expected: no errors referencing `voidBlokId`, `voidBlokLabel`, or `VoidenDragMenu`.

- [ ] **Step 9: Commit**

```bash
git add apps/ui/src/core/editors/voiden/components/VoidenDragMenu.tsx
git commit -m "feat: rename voidBlok group ops to blueprint in drag menu"
```

---

## Task 4: Remove voiden-voidbloks from core-extensions registry

**Files:**
- Modify: `core-extensions/src/registry.ts`
- Modify: `core-extensions/src/plugins.ts`

- [ ] **Step 1: Remove from registry.ts**

In `core-extensions/src/registry.ts`, delete the entire object from `id: "voiden-voidbloks"` through the closing `}` and trailing comma (the last entry in the `coreExtensions` array, roughly lines 692-725).

The array should end with the `postman-import` entry.

- [ ] **Step 2: Remove from plugins.ts**

In `core-extensions/src/plugins.ts`, remove the import line:
```typescript
import voiden_voidbloksPlugin from './voiden-voidbloks';
```
And remove the entry from the map:
```typescript
  'voiden-voidbloks': voiden_voidbloksPlugin
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd core-extensions && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```
Expected: errors only about the now-missing `./voiden-voidbloks` directory (will be cleaned up in Task 12).

- [ ] **Step 4: Commit**

```bash
git add core-extensions/src/registry.ts core-extensions/src/plugins.ts
git commit -m "feat: remove voiden-voidbloks from core extension registry"
```

---

## Task 5: Set up plugin package scaffolding

**Files:**
- Create: `plugins/voiden-blueprints/package.json`
- Create: `plugins/voiden-blueprints/tsconfig.json`
- Create: `plugins/voiden-blueprints/esbuild.config.mjs`

- [ ] **Step 1: Create the plugins directory and package.json**

```bash
mkdir -p plugins/voiden-blueprints/src plugins/voiden-blueprints/dist
```

Create `plugins/voiden-blueprints/package.json`:

```json
{
  "name": "voiden-blueprints",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev": "node esbuild.config.mjs --watch",
    "package": "node esbuild.config.mjs && cd dist && zip -r ../voiden-blueprints.zip manifest.json main.js && cd .."
  },
  "dependencies": {
    "@voiden/sdk": "^1.0.6"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.27",
    "esbuild": "^0.24.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `plugins/voiden-blueprints/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create esbuild.config.mjs**

Create `plugins/voiden-blueprints/esbuild.config.mjs`:

```js
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/index.tsx"],
  outfile: "dist/main.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@voiden/sdk",
    "@voiden/sdk/ui",
  ],
  logLevel: "info",
};

mkdirSync("dist", { recursive: true });
copyFileSync("src/manifest.json", "dist/manifest.json");

if (isWatch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await build(buildOptions);
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd plugins/voiden-blueprints && npm install
```
Expected: `node_modules` created, no errors.

- [ ] **Step 5: Commit scaffolding**

```bash
git add plugins/voiden-blueprints/
git commit -m "feat: scaffold voiden-blueprints plugin package"
```

---

## Task 6: Write types.ts

**Files:**
- Create: `plugins/voiden-blueprints/src/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
export type BlueprintScope = "local" | "shared";

export type VoidBlueprint = {
  version: 1;
  id: string;
  label: string;
  slash: string;
  description: string;
  enabled: boolean;
  scope: BlueprintScope;
  commands: string[];
  content?: any[];
};

export type BlueprintCommand = {
  name: string;
  label: string;
  description: string;
  slash: string;
  aliases?: string[];
  singleton?: boolean;
  compareKeys?: string[];
  action: (editor: any) => void;
};

export type BlueprintCommandGroup = {
  name: string;
  title: string;
  commands: BlueprintCommand[];
};
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voiden-blueprints/src/types.ts
git commit -m "feat: add VoidBlueprint type definitions"
```

---

## Task 7: Write store.ts

**Files:**
- Create: `plugins/voiden-blueprints/src/store.ts`

- [ ] **Step 1: Create store.ts**

```typescript
import type { PluginContext } from "@voiden/sdk/ui";
import type { BlueprintScope, VoidBlueprint } from "./types";

const LOCAL_DIR = ".voiden/blueprints";
const SHARED_DIR = ".templates/blueprints";
const LEGACY_STORAGE_KEY = "voiden:voidbloks";

let blueprints: VoidBlueprint[] = [];
let projectPath: string | null = null;
const listeners = new Set<() => void>();

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blueprint-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeSlash = (slash: string) => {
  const trimmed = slash.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.toLowerCase();
};

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "blueprint";

export const sanitizeBlueprint = (input: Partial<VoidBlueprint>): VoidBlueprint => ({
  version: 1,
  id: input.id || createId(),
  label: (input.label || "Untitled Blueprint").trim(),
  slash: normalizeSlash(input.slash || input.label || "blueprint"),
  description: (input.description || "").trim(),
  enabled: input.enabled ?? true,
  scope: input.scope === "shared" ? "shared" : "local",
  commands: (input.commands || []).map(normalizeSlash),
  content: Array.isArray(input.content) ? input.content : undefined,
});

const notify = () => listeners.forEach((listener) => listener());

export const subscribeBlueprints = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getBlueprints = () => blueprints;

const blueprintDir = async (context: PluginContext, scope: BlueprintScope) => {
  if (!projectPath) return null;
  return context.files.joinPath(projectPath, scope === "shared" ? SHARED_DIR : LOCAL_DIR);
};

const blueprintPath = async (
  context: PluginContext,
  blueprint: VoidBlueprint,
  scope = blueprint.scope,
) => {
  const dir = await blueprintDir(context, scope);
  if (!dir) return null;
  return context.files.joinPath(dir, `${slugify(blueprint.slash.replace(/^\//, ""))}.json`);
};

const readBlueprintsFromDir = async (
  context: PluginContext,
  scope: BlueprintScope,
): Promise<VoidBlueprint[]> => {
  const dir = await blueprintDir(context, scope);
  if (!dir) return [];

  let files: string[];
  try {
    files = (await context.files.listDir(dir)).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }

  const loaded: VoidBlueprint[] = [];
  for (const file of files) {
    const path = await context.files.joinPath(dir, file);
    if (!path) continue;
    try {
      const raw = await context.files.read(path);
      if (!raw) continue;
      loaded.push(sanitizeBlueprint({ ...JSON.parse(raw), scope }));
    } catch {
      // Ignore malformed files so one bad file does not break the plugin.
    }
  }
  return loaded;
};

const readLegacyInstallBlueprints = (): VoidBlueprint[] => {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const legacy = parsed?.state?.voidBloks;
    if (!Array.isArray(legacy)) return [];
    return legacy.map((item: any) =>
      sanitizeBlueprint({ ...item, scope: "local", version: 1 }),
    );
  } catch {
    return [];
  }
};

const mergeBlueprints = (
  shared: VoidBlueprint[],
  local: VoidBlueprint[],
  install: VoidBlueprint[],
) => {
  const merged = new Map<string, VoidBlueprint>();
  const put = (blueprint: VoidBlueprint) => {
    merged.set(blueprint.id, blueprint);
    merged.set(blueprint.slash, blueprint);
  };
  shared.forEach(put);
  install.forEach(put);
  local.forEach(put);
  return Array.from(new Set(merged.values())).sort((a, b) => a.label.localeCompare(b.label));
};

export const loadBlueprints = async (context: PluginContext) => {
  projectPath = (await context.project.getActiveProject()) || null;

  const [shared, local] = await Promise.all([
    readBlueprintsFromDir(context, "shared"),
    readBlueprintsFromDir(context, "local"),
  ]);

  blueprints = mergeBlueprints(shared, local, readLegacyInstallBlueprints());
  notify();
  return blueprints;
};

export const saveBlueprint = async (context: PluginContext, input: Partial<VoidBlueprint>) => {
  const previous = blueprints.find((b) => b.id === input.id);
  const next = sanitizeBlueprint(input);
  const dir = await blueprintDir(context, next.scope);
  const path = await blueprintPath(context, next);
  if (!dir || !path) throw new Error("No active project.");

  await context.files.ensureDir(dir);
  await context.files.write(path, JSON.stringify(next, null, 2));

  if (previous && previous.scope !== next.scope) {
    const oldPath = await blueprintPath(context, previous, previous.scope);
    if (oldPath) await context.files.removeFile(oldPath);
  }

  await loadBlueprints(context);
  return next;
};

export const deleteBlueprint = async (context: PluginContext, blueprint: VoidBlueprint) => {
  const path = await blueprintPath(context, blueprint);
  if (path) await context.files.removeFile(path);
  await loadBlueprints(context);
};

export const openBlueprintFile = async (context: PluginContext, blueprint: VoidBlueprint) => {
  const relative =
    blueprint.scope === "shared"
      ? `${SHARED_DIR}/${slugify(blueprint.slash.replace(/^\//, ""))}.json`
      : `${LOCAL_DIR}/${slugify(blueprint.slash.replace(/^\//, ""))}.json`;
  await context.project.openFile(relative);
};
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voiden-blueprints/src/store.ts
git commit -m "feat: add Void Blueprints file-backed store"
```

---

## Task 8: Write slashGroup.ts

**Files:**
- Create: `plugins/voiden-blueprints/src/slashGroup.ts`

- [ ] **Step 1: Create slashGroup.ts**

```typescript
import { TextSelection } from "@tiptap/pm/state";
import type { BlueprintCommand, BlueprintCommandGroup, VoidBlueprint } from "./types";

const BLUEPRINT_GROUP_NAME = "blueprint";

const createGroupId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blueprint-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeSlash = (value: string) => value.trim().toLowerCase();

const findCommand = (
  groups: BlueprintCommandGroup[],
  slash: string,
): BlueprintCommand | undefined => {
  const target = normalizeSlash(slash);
  for (const group of groups) {
    if (group.name === BLUEPRINT_GROUP_NAME) continue;
    const command = group.commands.find(
      (candidate) => normalizeSlash(candidate.slash) === target,
    );
    if (command) return command;
  }
  return undefined;
};

const getBlueprintCompareKeys = (
  groups: BlueprintCommandGroup[],
  blueprint: VoidBlueprint,
) => {
  const compareKeys = new Set<string>();
  for (const slash of blueprint.commands) {
    const command = findCommand(groups, slash);
    if (!command?.singleton) continue;
    command.compareKeys?.forEach((key) => compareKeys.add(key));
  }
  return Array.from(compareKeys);
};

const getCurrentSectionNodeTypes = (editor: any) => {
  const cursorPos = editor.state.selection.$from.pos;
  let currentSectionIndex = 0;
  const sections: string[][] = [[]];
  editor.state.doc.forEach((child: any, offset: number) => {
    const nodeStart = offset + 1;
    const nodeEnd = nodeStart + child.nodeSize;
    if (child.type.name === "request-separator") {
      if (cursorPos >= nodeEnd) currentSectionIndex++;
      sections.push([]);
      return;
    }
    sections[sections.length - 1].push(child.type.name);
  });
  return sections[currentSectionIndex] ?? [];
};

const currentSectionHasSingleton = (editor: any, command: BlueprintCommand) => {
  if (!command.singleton || !command.compareKeys?.length) return false;
  const nodeTypes = getCurrentSectionNodeTypes(editor);
  return nodeTypes.some((type) => command.compareKeys?.includes(type));
};

const sectionHasSingletonAfterPendingInsert = (
  editor: any,
  command: BlueprintCommand,
  pendingNodeTypes: Set<string>,
) => {
  if (!command.singleton || !command.compareKeys?.length) return false;
  if (command.compareKeys.some((type) => pendingNodeTypes.has(type))) return true;
  return currentSectionHasSingleton(editor, command);
};

const waitForCommandSideEffects = () => new Promise((resolve) => window.setTimeout(resolve, 80));

const tableNode = () => ({
  type: "table",
  content: [
    {
      type: "tableRow",
      content: [
        { type: "tableCell", content: [{ type: "paragraph" }] },
        { type: "tableCell", content: [{ type: "paragraph" }] },
      ],
    },
  ],
});

const textCell = (text: string, readonly = false) => ({
  type: "tableCell",
  attrs: readonly ? { readonly: true } : undefined,
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

const authRowsBySlash: Record<string, string[][]> = {
  "/auth": [],
  "/auth-bearer": [["token", ""]],
  "/auth-basic": [["username", ""], ["password", ""]],
  "/auth-api-key": [["key", ""], ["value", ""], ["add_to", "header"]],
  "/auth-oauth2": [
    ["auth_url", ""],
    ["token_url", ""],
    ["client_id", ""],
    ["client_secret", ""],
    ["scope", ""],
    ["callback_url", "http://localhost:9090/callback"],
    ["state", ""],
  ],
  "/auth-oauth1": [
    ["consumer_key", ""],
    ["consumer_secret", ""],
    ["access_token", ""],
    ["token_secret", ""],
    ["signature_method", "HMAC-SHA1"],
  ],
  "/auth-digest": [["username", ""], ["password", ""], ["realm", ""], ["algorithm", "MD5"]],
  "/auth-aws": [
    ["access_key", ""],
    ["secret_key", ""],
    ["region", "us-east-1"],
    ["service", "execute-api"],
  ],
};

const authTypeBySlash: Record<string, string> = {
  "/auth": "inherit",
  "/auth-bearer": "bearer",
  "/auth-basic": "basic",
  "/auth-api-key": "apiKey",
  "/auth-oauth2": "oauth2",
  "/auth-oauth1": "oauth1",
  "/auth-digest": "digest",
  "/auth-aws": "awsSignature",
};

const authTableNode = (rows: string[][]) => ({
  type: "table",
  content: rows.map(([key, value]) => ({
    type: "tableRow",
    content: [textCell(key, true), textCell(value)],
  })),
});

const withBlueprintAttrs = (nodeJson: any, attrs: Record<string, string>) => ({
  ...nodeJson,
  attrs: { ...(nodeJson.attrs ?? {}), ...attrs },
});

const directNodeForSlash = (slash: string, attrs: Record<string, string>) => {
  const applyAttrs = (nodeJson: any) => withBlueprintAttrs(nodeJson, attrs);
  switch (slash) {
    case "/endpoint":
      return applyAttrs({
        type: "request",
        content: [
          { type: "method", content: [{ type: "text", text: "GET" }] },
          { type: "url", content: [{ type: "text", text: "https://" }] },
        ],
      });
    case "/headers":
      return applyAttrs({ type: "headers-table", content: [tableNode()] });
    case "/query":
      return applyAttrs({ type: "query-table", content: [tableNode()] });
    case "/multipart":
      return applyAttrs({ type: "multipart-table", content: [tableNode()] });
    case "/url":
      return applyAttrs({ type: "url-table", content: [tableNode()] });
    case "/cookies":
      return applyAttrs({ type: "cookies-table", content: [tableNode()] });
    case "/options":
      return applyAttrs({ type: "options-table", content: [tableNode()] });
    case "/path-params":
      return applyAttrs({ type: "path-table", content: [tableNode()] });
    case "/json":
      return applyAttrs({ type: "json_body" });
    case "/xml":
      return applyAttrs({ type: "xml_body" });
    case "/yml":
      return applyAttrs({ type: "yml_body" });
    default: {
      const authType = authTypeBySlash[slash];
      if (!authType) return null;
      const rows = authRowsBySlash[slash] ?? [];
      return applyAttrs({
        type: "auth",
        attrs: {
          authType,
          ...(authType === "oauth2" ? { oauth2Config: "{}" } : {}),
        },
        content: rows.length > 0 ? [authTableNode(rows)] : [],
      });
    }
  }
};

const flushNodesAtSelection = (editor: any, nodeJsons: any[]): number | null => {
  if (nodeJsons.length === 0) return null;
  try {
    const { state, view } = editor;
    const blocks = nodeJsons.map((nodeJson) => state.schema.nodeFromJSON(nodeJson));
    const paragraph = state.schema.nodes.paragraph.create();
    const { $from } = state.selection;
    const topLevelStart = $from.depth > 0 ? $from.before(1) : 0;
    const topLevelNode = state.doc.nodeAt(topLevelStart);
    const replaceFrom =
      topLevelNode?.type.name === "paragraph"
        ? topLevelStart
        : Math.min(topLevelStart + (topLevelNode?.nodeSize ?? 0), state.doc.content.size);
    const replaceTo =
      topLevelNode?.type.name === "paragraph"
        ? topLevelStart + topLevelNode.nodeSize
        : replaceFrom;
    const tr = state.tr.replaceWith(replaceFrom, replaceTo, [...blocks, paragraph]);
    const cursorPosition =
      replaceFrom + blocks.reduce((pos, node) => pos + node.nodeSize, 0) + 1;
    tr.setSelection(TextSelection.create(tr.doc, cursorPosition)).scrollIntoView();
    view.dispatch(tr);
    return cursorPosition;
  } catch {
    return null;
  }
};

const placeCursorInParagraphAfterCurrentTopLevelBlock = (editor: any): number | null => {
  const { state, view } = editor;
  const { $from } = state.selection;
  if ($from.depth === 0) return null;
  const topLevelStart = $from.before(1);
  const topLevelNode = state.doc.nodeAt(topLevelStart);
  if (!topLevelNode) return null;
  const insertAt = Math.min(
    topLevelStart + topLevelNode.nodeSize,
    state.doc.content.size,
  );
  const paragraph = state.schema.nodes.paragraph.create();
  const tr = state.tr.insert(insertAt, paragraph);
  const cursorPosition = Math.min(insertAt + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.create(tr.doc, cursorPosition)).scrollIntoView();
  view.dispatch(tr);
  return cursorPosition;
};

const focusAtInsertionPoint = (editor: any, fallbackPosition: number | null) => {
  const position = fallbackPosition ?? editor.state.selection.$from.pos;
  editor.commands.focus(Math.min(position, editor.state.doc.content.size));
};

const withAttrsForContent = (nodes: any[], attrs: Record<string, string>) =>
  nodes.map((node) => withBlueprintAttrs(node, attrs));

const runBlueprint = async (
  editor: any,
  groups: BlueprintCommandGroup[],
  blueprint: VoidBlueprint,
) => {
  editor.commands.focus();
  const groupAttrs = {
    blueprintId: createGroupId(),
    blueprintLabel: blueprint.label,
  };

  if (blueprint.content?.length) {
    flushNodesAtSelection(editor, withAttrsForContent(blueprint.content, groupAttrs));
    return;
  }

  let insertionPoint: number | null = null;
  const pendingDirectNodes: any[] = [];
  const pendingNodeTypes = new Set<string>();

  const flushPendingDirectNodes = () => {
    if (pendingDirectNodes.length === 0) return insertionPoint;
    const nextInsertionPoint = flushNodesAtSelection(editor, pendingDirectNodes);
    pendingDirectNodes.length = 0;
    pendingNodeTypes.clear();
    insertionPoint = nextInsertionPoint ?? insertionPoint;
    return insertionPoint;
  };

  for (const slash of blueprint.commands) {
    focusAtInsertionPoint(editor, insertionPoint);
    const command = findCommand(groups, slash);
    if (!command || sectionHasSingletonAfterPendingInsert(editor, command, pendingNodeTypes))
      continue;
    const directNode = directNodeForSlash(slash, groupAttrs);
    if (directNode) {
      pendingDirectNodes.push(directNode);
      pendingNodeTypes.add(directNode.type);
      continue;
    }
    flushPendingDirectNodes();
    focusAtInsertionPoint(editor, insertionPoint);
    command.action(editor);
    await waitForCommandSideEffects();
    insertionPoint =
      placeCursorInParagraphAfterCurrentTopLevelBlock(editor) ?? insertionPoint;
  }

  flushPendingDirectNodes();
};

export const createBlueprintSlashGroup = (
  groups: BlueprintCommandGroup[],
  blueprints: VoidBlueprint[],
) => ({
  name: BLUEPRINT_GROUP_NAME,
  title: "Blueprints",
  commands: blueprints
    .filter(
      (blueprint) =>
        blueprint.enabled &&
        ((blueprint.content?.length ?? 0) > 0 || blueprint.commands.length > 0),
    )
    .map((blueprint) => {
      const compareKeys = blueprint.content?.length
        ? Array.from(
            new Set(
              blueprint.content.map((node) => node.type).filter(Boolean),
            ),
          )
        : getBlueprintCompareKeys(groups, blueprint);
      return {
        name: `blueprint-${blueprint.id}`,
        label: blueprint.label,
        description:
          blueprint.description ||
          blueprint.commands.join(", ") ||
          "Prefilled blueprint",
        slash: blueprint.slash,
        aliases: [blueprint.label, ...blueprint.commands],
        singleton: compareKeys.length > 0,
        compareKeys,
        action: (editor: any) => {
          void runBlueprint(editor, groups, blueprint);
        },
      };
    }),
});
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voiden-blueprints/src/slashGroup.ts
git commit -m "feat: add Void Blueprints slash group and runBlueprint logic"
```

---

## Task 9: Write Manager.tsx

**Files:**
- Create: `plugins/voiden-blueprints/src/Manager.tsx`

- [ ] **Step 1: Create Manager.tsx**

```typescript
import React, { useEffect, useMemo, useState } from "react";
import type { PluginContext, SlashCommandGroup } from "@voiden/sdk/ui";
import type { BlueprintCommand, VoidBlueprint } from "./types";
import {
  deleteBlueprint,
  getBlueprints,
  openBlueprintFile,
  sanitizeBlueprint,
  saveBlueprint,
  subscribeBlueprints,
} from "./store";

type ManagerProps = {
  context: PluginContext;
  refreshSlashGroup: () => Promise<void>;
  getSlashGroups: () => SlashCommandGroup[];
};

type FormState = VoidBlueprint & {
  prefillText: string;
};

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blueprint-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const emptyForm = (): FormState => ({
  version: 1,
  id: createId(),
  label: "",
  slash: "",
  description: "",
  enabled: true,
  scope: "local",
  commands: [],
  content: undefined,
  prefillText: "[]",
});

const toForm = (blueprint: VoidBlueprint): FormState => ({
  ...blueprint,
  prefillText: JSON.stringify(blueprint.content ?? [], null, 2),
});

const normalizeSlash = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const uniqueCommands = (groups: SlashCommandGroup[]) => {
  const seen = new Set<string>();
  return groups
    .filter((group) => group.name !== "blueprint")
    .flatMap((group) => group.commands as BlueprintCommand[])
    .filter((command) => {
      const key = command.slash.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export function createBlueprintManager(
  context: PluginContext,
  refreshSlashGroup: () => Promise<void>,
  getSlashGroups: () => SlashCommandGroup[],
) {
  return function BlueprintManager() {
    return (
      <BlueprintManagerInner
        context={context}
        refreshSlashGroup={refreshSlashGroup}
        getSlashGroups={getSlashGroups}
      />
    );
  };
}

function BlueprintManagerInner({ context, refreshSlashGroup, getSlashGroups }: ManagerProps) {
  const [blueprints, setBlueprints] = useState(getBlueprints());
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeBlueprints(() => setBlueprints([...getBlueprints()])), []);

  const commandOptions = useMemo(() => uniqueCommands(getSlashGroups()), []);
  const filteredCommands = useMemo(() => {
    const needle = commandQuery.trim().toLowerCase();
    if (!needle) return commandOptions;
    return commandOptions.filter((command) =>
      [command.label, command.description, command.name, command.slash, ...(command.aliases ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [commandOptions, commandQuery]);

  const visibleBlueprints = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return blueprints;
    return blueprints.filter((blueprint) =>
      [blueprint.label, blueprint.slash, blueprint.description, blueprint.scope]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, blueprints]);

  const reset = () => {
    setForm(emptyForm());
    setEditingId(null);
    setPrefillOpen(false);
    setError(null);
  };

  const toggleCommand = (slash: string) => {
    setForm((current) => ({
      ...current,
      commands: current.commands.includes(slash)
        ? current.commands.filter((command) => command !== slash)
        : [...current.commands, slash],
    }));
  };

  const captureActiveDocument = () => {
    const editor = context.project.getActiveEditor("voiden");
    const content = (editor as any)?.getJSON?.()?.content ?? [];
    setForm((current) => ({
      ...current,
      content,
      prefillText: JSON.stringify(content, null, 2),
    }));
    setPrefillOpen(true);
  };

  const save = async () => {
    try {
      const content = form.prefillText.trim() ? JSON.parse(form.prefillText) : [];
      if (!Array.isArray(content)) {
        setError("Prefill content must be a JSON array of editor blocks.");
        return;
      }

      const next = sanitizeBlueprint({
        ...form,
        slash: normalizeSlash(
          form.slash || form.label.toLowerCase().replace(/\s+/g, "-"),
        ),
        content: content.length > 0 ? content : undefined,
      });

      if (!next.label) {
        setError("Name is required.");
        return;
      }
      if (!/^\/[a-z0-9][a-z0-9-_]*$/.test(next.slash)) {
        setError("Command must look like /my-command.");
        return;
      }
      if (next.commands.length === 0 && !next.content?.length) {
        setError("Choose structure commands or add prefill content.");
        return;
      }
      const duplicate = blueprints.find(
        (blueprint) => blueprint.id !== next.id && blueprint.slash === next.slash,
      );
      if (duplicate) {
        setError("Another Blueprint already uses that command.");
        return;
      }

      await saveBlueprint(context, next);
      await refreshSlashGroup();
      reset();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save Blueprint.",
      );
    }
  };

  const remove = async (blueprint: VoidBlueprint) => {
    await deleteBlueprint(context, blueprint);
    await refreshSlashGroup();
  };

  const toggleShared = async (blueprint: VoidBlueprint) => {
    await saveBlueprint(context, {
      ...blueprint,
      scope: blueprint.scope === "shared" ? "local" : "shared",
    });
    await refreshSlashGroup();
  };

  return (
    <div className="h-full overflow-auto bg-bg text-text">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Void Blueprints</div>
          <div className="text-xs text-comment">
            Project templates from .templates/blueprints and .voiden/blueprints.
          </div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-56 px-2.5 py-1 rounded-md bg-editor text-text text-xs border border-border-subtle focus:outline-none"
          placeholder="Search"
        />
      </div>

      <div className="grid grid-cols-[minmax(320px,420px)_1fr] gap-4 p-4">
        <div className="rounded-md overflow-hidden bg-surface border border-border-subtle">
          <div className="px-4 py-3 border-b border-border-subtle">
            <div className="text-sm">{editingId ? "Edit Blueprint" : "Create Blueprint"}</div>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-comment mb-1">Name</span>
                <input
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                  className="w-full px-3 py-1.5 rounded-md bg-editor text-text text-sm border border-border-subtle focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-comment mb-1">Command</span>
                <input
                  value={form.slash}
                  onChange={(event) => setForm({ ...form, slash: event.target.value })}
                  className="w-full px-3 py-1.5 rounded-md bg-editor text-text text-sm border border-border-subtle focus:outline-none font-mono"
                  placeholder="/ardoise-studio"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-xs text-comment mb-1">Description</span>
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="w-full px-3 py-1.5 rounded-md bg-editor text-text text-sm border border-border-subtle focus:outline-none"
              />
            </label>

            <div className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-2">
              <span className="text-xs text-comment">Shared template</span>
              <button
                type="button"
                onClick={() =>
                  setForm({ ...form, scope: form.scope === "shared" ? "local" : "shared" })
                }
                className={`px-2 py-1 rounded text-xs border border-border-subtle ${
                  form.scope === "shared" ? "bg-panel/70 text-text" : "text-comment"
                }`}
              >
                {form.scope === "shared" ? ".templates" : ".voiden"}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-xs text-comment">Structure commands</div>
                <input
                  value={commandQuery}
                  onChange={(event) => setCommandQuery(event.target.value)}
                  className="w-44 px-2.5 py-1 rounded-md bg-editor text-text text-xs border border-border-subtle focus:outline-none"
                  placeholder="Search commands"
                />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border-subtle">
                {filteredCommands.map((command) => {
                  const selected = form.commands.includes(command.slash);
                  return (
                    <button
                      key={command.slash}
                      type="button"
                      onClick={() => toggleCommand(command.slash)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm border-b border-border-subtle last:border-b-0 ${
                        selected
                          ? "bg-panel/70 text-text"
                          : "hover:bg-panel/40 text-comment"
                      }`}
                    >
                      <span className="truncate">{command.label}</span>
                      <span className="font-mono text-xs">{command.slash}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border border-border-subtle">
              <button
                type="button"
                onClick={() => setPrefillOpen(!prefillOpen)}
                className="w-full px-3 py-2 text-left text-xs text-comment hover:bg-panel/40"
              >
                {prefillOpen ? "Hide prefill content" : "Edit prefill content"}
              </button>
              {prefillOpen && (
                <div className="border-t border-border-subtle p-3 space-y-2">
                  <button
                    type="button"
                    onClick={captureActiveDocument}
                    className="px-2 py-1 rounded text-xs border border-border-subtle text-comment hover:text-text"
                  >
                    Capture active document blocks
                  </button>
                  <textarea
                    value={form.prefillText}
                    onChange={(event) =>
                      setForm({ ...form, prefillText: event.target.value })
                    }
                    className="w-full h-44 px-2 py-2 rounded bg-editor text-text text-xs border border-border-subtle focus:outline-none font-mono"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="text-xs" style={{ color: "var(--icon-error)" }}>
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 rounded-md text-sm border border-border-subtle text-comment hover:text-text"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={save}
                className="px-3 py-1.5 rounded-md text-sm"
                style={{ backgroundColor: "var(--icon-primary)", color: "var(--ui-bg)" }}
              >
                {editingId ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {visibleBlueprints.length === 0 ? (
            <div className="rounded-md border border-border-subtle bg-surface px-4 py-8 text-center text-xs text-comment">
              No Blueprints yet.
            </div>
          ) : (
            visibleBlueprints.map((blueprint) => (
              <div
                key={`${blueprint.scope}-${blueprint.id}-${blueprint.slash}`}
                className="rounded-md border border-border-subtle bg-surface px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate">{blueprint.label}</span>
                    <span className="text-[10px] uppercase rounded border border-border-subtle px-1.5 py-0.5 text-comment">
                      {blueprint.scope === "shared" ? "Shared" : "Local"}
                    </span>
                    {!blueprint.enabled && (
                      <span className="text-[10px] uppercase rounded border border-border-subtle px-1.5 py-0.5 text-comment">
                        Off
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-comment font-mono mt-0.5 truncate">
                    {blueprint.slash} ={" "}
                    {blueprint.content?.length
                      ? "prefill content"
                      : blueprint.commands.join(" ")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleShared(blueprint)}
                    className="px-2 py-1 rounded text-xs border border-border-subtle text-comment hover:text-text"
                  >
                    {blueprint.scope === "shared" ? "Make local" : "Make shared"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await saveBlueprint(context, {
                        ...blueprint,
                        enabled: !blueprint.enabled,
                      });
                      await refreshSlashGroup();
                    }}
                    className="px-2 py-1 rounded text-xs border border-border-subtle text-comment hover:text-text"
                  >
                    {blueprint.enabled ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForm(toForm(blueprint));
                      setEditingId(blueprint.id);
                      setError(null);
                    }}
                    className="px-2 py-1 rounded text-xs border border-border-subtle text-comment hover:text-text"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => openBlueprintFile(context, blueprint)}
                    className="px-2 py-1 rounded text-xs border border-border-subtle text-comment hover:text-text"
                  >
                    Open file
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(blueprint)}
                    className="px-2 py-1 rounded text-xs border border-border-subtle"
                    style={{ color: "var(--icon-error)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/voiden-blueprints/src/Manager.tsx
git commit -m "feat: add Void Blueprints manager UI component"
```

---

## Task 10: Write sdk-extensions.d.ts, manifest.json, and index.tsx

**Files:**
- Create: `plugins/voiden-blueprints/src/sdk-extensions.d.ts`
- Create: `plugins/voiden-blueprints/src/manifest.json`
- Create: `plugins/voiden-blueprints/src/index.tsx`

- [ ] **Step 1: Create sdk-extensions.d.ts**

This extends the community plugin's view of `PluginContext` to include `files` and `getVoidenSlashGroups`:

```typescript
import type { SlashCommandGroup } from "@voiden/sdk/ui";

declare module "@voiden/sdk/ui" {
  interface PluginContext {
    files: {
      read: (path: string) => Promise<string>;
      write: (path: string, content: string) => Promise<void>;
      listDir: (path: string) => Promise<string[]>;
      ensureDir: (path: string) => Promise<void>;
      removeFile: (path: string) => Promise<void>;
      joinPath: (...parts: string[]) => Promise<string | undefined>;
    };
    getVoidenSlashGroups: () => SlashCommandGroup[];
  }
}
```

- [ ] **Step 2: Create manifest.json**

```json
{
  "id": "voiden-blueprints",
  "type": "community",
  "name": "Void Blueprints",
  "description": "File-backed request templates with local and shared project scopes. Run /your-command to insert a fully configured request in one action.",
  "version": "1.0.0",
  "author": "Voiden Team",
  "enabled": true,
  "priority": 95,
  "readme": "Void Blueprints lets you bundle existing slash commands or prefilled editor blocks into reusable project templates. Shared templates live in .templates/blueprints (committed to git). Local templates live in .voiden/blueprints (gitignored).",
  "capabilities": {
    "slashCommands": {
      "groups": [
        {
          "name": "blueprint",
          "commands": ["Project-defined blueprint templates"]
        }
      ]
    },
    "ui": {
      "statusBar": true,
      "panels": ["Void Blueprints manager"]
    }
  },
  "features": [
    "Status bar manager (click Blueprints in the status bar)",
    "Local templates in .voiden/blueprints (gitignored)",
    "Shared templates in .templates/blueprints (committed to git)",
    "Structure-only templates that compose existing slash commands",
    "Prefilled templates that insert saved block content with variable placeholders"
  ]
}
```

- [ ] **Step 3: Create index.tsx**

```typescript
import type { Plugin, PluginContext, SlashCommandGroup } from "@voiden/sdk/ui";
import { loadBlueprints, getBlueprints } from "./store";
import { createBlueprintSlashGroup } from "./slashGroup";
import { createBlueprintManager } from "./Manager";
import type { BlueprintCommandGroup } from "./types";

export default function voidBlueprintsPlugin(_context: PluginContext): Plugin {
  return {
    async onload(ctx: PluginContext) {
      await loadBlueprints(ctx);

      // Priority 95 means all other plugins have loaded — capture their slash groups now.
      const cachedGroups: SlashCommandGroup[] = ctx.getVoidenSlashGroups();
      const getSlashGroups = () => cachedGroups;

      const registerSlashGroup = async () => {
        const blueprints = getBlueprints();
        ctx.addVoidenSlashGroup(
          createBlueprintSlashGroup(
            cachedGroups as unknown as BlueprintCommandGroup[],
            blueprints,
          ),
        );
      };

      await registerSlashGroup();

      ctx.registerStatusBarItem({
        id: "void-blueprints",
        icon: "Blocks",
        label: "Blueprints",
        tooltip: "Open Void Blueprints manager",
        position: "left",
        onClick: () => {
          ctx.addTab("main", {
            id: "blueprints-manager",
            icon: "Blocks",
            title: "Void Blueprints",
            props: {},
            component: createBlueprintManager(ctx, registerSlashGroup, getSlashGroups),
          });
        },
      });
    },

    onunload() {},
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/voiden-blueprints/src/sdk-extensions.d.ts plugins/voiden-blueprints/src/manifest.json plugins/voiden-blueprints/src/index.tsx
git commit -m "feat: add Void Blueprints plugin entry point and manifest"
```

---

## Task 11: Build and install the plugin

- [ ] **Step 1: Build the plugin**

```bash
cd plugins/voiden-blueprints && npm run package
```
Expected output:
```
dist/main.js  XX kb

⚡ Done in Xms
```
And a `voiden-blueprints.zip` created in `plugins/voiden-blueprints/`.

If build fails with TypeScript errors:
- Check that `@voiden/sdk` types are resolved (run `npm install` first)
- Check `tsconfig.json` `moduleResolution` is set to `"bundler"`

- [ ] **Step 2: Install in Voiden**

1. Launch the Voiden app (from the monorepo root: `yarn dev` or however the project is run)
2. Open **Settings → Extensions** (or the puzzle-piece sidebar icon)
3. Click **"Install from file"**
4. Select `plugins/voiden-blueprints/voiden-blueprints.zip`
5. Voiden will validate and install automatically

- [ ] **Step 3: Verify status bar item appears**

After install, the "Blueprints" item should appear in the bottom status bar.

- [ ] **Step 4: Verify slash group is empty but registered**

Open a `.void` file, type `/`, and verify there is no "Blueprints" group showing in the menu (expected — no templates yet). If it shows a group error, check the console for load errors.

- [ ] **Step 5: Create a local blueprint**

1. Click the "Blueprints" status bar item
2. In the manager, enter: Name = "Test Request", Command = `/test-request`
3. Toggle scope to `.voiden` (local)
4. In Structure commands, check `/endpoint` and `/headers`
5. Click Create
6. Verify a file was created at `.voiden/blueprints/test-request.json`

Expected file contents:
```json
{
  "version": 1,
  "id": "...",
  "label": "Test Request",
  "slash": "/test-request",
  "description": "",
  "enabled": true,
  "scope": "local",
  "commands": ["/endpoint", "/headers"],
  "content": undefined
}
```
(content field omitted, commands populated)

- [ ] **Step 6: Verify slash command works**

1. Open a `.void` file
2. Type `/test-request` in the editor
3. Select "Test Request" from the slash menu
4. Verify an endpoint block and headers table are inserted
5. Verify the drag menu shows "Blueprint Operations" section when hovering the inserted blocks
6. Verify Copy/Duplicate/Cut/Delete Blueprint operations work

- [ ] **Step 7: Create a shared blueprint**

1. In the manager, create another blueprint with scope `.templates` (shared)
2. Verify a file was created at `.templates/blueprints/<slug>.json`
3. Restart Voiden
4. Verify the shared blueprint still loads after restart

- [ ] **Step 8: Test prefill**

1. Open a `.void` file and configure a request (endpoint, auth, headers)
2. Open the Blueprints manager → Create Blueprint
3. Expand "Edit prefill content" → click "Capture active document blocks"
4. Verify the textarea fills with JSON representing your blocks
5. Save the blueprint
6. Open another `.void` file, run the blueprint slash command
7. Verify the blocks insert with the prefilled values (including any `{{VARIABLE}}` placeholders)

- [ ] **Step 9: Commit**

```bash
git add plugins/voiden-blueprints/
git commit -m "feat: build and verify Void Blueprints community plugin"
```

---

## Task 12: Delete old files

Only run this after Task 11 verification passes.

**Files:**
- Delete: `core-extensions/src/voiden-voidbloks/` (entire directory)
- Delete: `apps/ui/src/core/voidblok/` (entire directory)

- [ ] **Step 1: Delete old directories**

```bash
git rm -r core-extensions/src/voiden-voidbloks/
git rm -r apps/ui/src/core/voidblok/
```

- [ ] **Step 2: Verify no remaining references to voiden-voidbloks**

```bash
grep -r "voiden-voidbloks\|voiden_voidbloks\|voidBlokGroup\|VoidBlokGroup\|voidBlokId\|voidBlokLabel" \
  apps/ui/src core-extensions/src \
  --include="*.ts" --include="*.tsx" -l
```
Expected: no output. If files are returned, open them and remove any stale references.

- [ ] **Step 3: Final TypeScript compile check**

```bash
cd apps/ui && npx tsc --noEmit 2>&1 | grep -v "node_modules"
cd ../../core-extensions && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```
Expected: no errors about the deleted files.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: remove voiden-voidbloks core extension (replaced by voiden-blueprints plugin)"
```

---

## Verification Checklist

Before calling this done, confirm all of the following manually:

- [ ] "Blueprints" appears in the status bar
- [ ] Clicking it opens the manager panel
- [ ] Creating a local blueprint writes to `.voiden/blueprints/<slug>.json`
- [ ] Toggling to shared moves/writes to `.templates/blueprints/<slug>.json`
- [ ] Shared blueprints survive Voiden restart
- [ ] Local blueprint overrides shared blueprint with same `/slash`
- [ ] Running a structure blueprint inserts the correct blocks
- [ ] Running a prefill blueprint inserts saved block content including `{{VARIABLE}}` placeholders
- [ ] Drag menu shows "Blueprint Operations" for inserted blueprint blocks
- [ ] Copy/Duplicate/Cut/Delete blueprint group operations work
- [ ] No `voidBlokId`, `voidBlokGroup`, or `voiden-voidbloks` references remain in core Voiden source
