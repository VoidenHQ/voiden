#!/usr/bin/env node
/**
 * Builds plugin repos cloned in voiden/plugins/ into ESM bundles.
 * Output: plugins/<plugin-id>/dist/<plugin-id>.js (each plugin's own dist/)
 *
 * React and react-dom are NOT bundled — they are shimmed from window.__voiden_shims__
 * which the host app populates before any plugin loads.
 *
 * Usage:
 *   node scripts/build-plugins.mjs              # build all
 *   node scripts/build-plugins.mjs voiden-rest-api  # build one
 *   node scripts/build-plugins.mjs --watch       # rebuild on save + hot-reload app
 */

import { build } from 'vite'
import { readdirSync, existsSync, readFileSync, statSync, mkdirSync, copyFileSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const pluginsDir = resolve(__dirname, '../plugins')
const bundledPluginsDir = resolve(__dirname, '../apps/electron/bundled-plugins')
const bundledMainPluginsDir = resolve(__dirname, '../apps/electron/bundled-main-plugins')

/**
 * Rollup plugin that replaces host-app imports with inline shims reading from
 * window.__voiden_shims__ — populated by the host before any plugin loads.
 */
function voidenShimsPlugin() {
  const STATIC_SHIMS = {
    'react': `\
const _s = window.__voiden_shims__['react'];
export default _s;
export const { useState, useEffect, useCallback, useMemo, useRef, useContext,
  createContext, forwardRef, memo, Fragment, createElement, cloneElement,
  Children, StrictMode, Suspense, lazy, isValidElement, Component,
  PureComponent, createRef, startTransition, useReducer, useLayoutEffect,
  useImperativeHandle, useDebugValue, useTransition, useDeferredValue, useId } = _s;`,

    'react-dom': `\
const _s = window.__voiden_shims__['react-dom'];
export default _s;
export const { createPortal, flushSync, render, unmountComponentAtNode } = _s;`,

    'react/jsx-runtime': `\
const _s = window.__voiden_shims__['react/jsx-runtime'];
export const jsx = _s.jsx;
export const jsxs = _s.jsxs;
export const Fragment = _s.Fragment;`,

    'react-dom/client': `\
const _s = window.__voiden_shims__['react-dom/client'];
export default _s;
export const { createRoot, hydrateRoot } = _s;`,

    '@tanstack/react-query': `\
const _s = window.__voiden_shims__['@tanstack/react-query'];
export default _s;
export const { useQuery, useMutation, useQueryClient, useInfiniteQuery,
  QueryClient, QueryClientProvider, QueryCache, MutationCache,
  useIsFetching, useIsMutating, useSuspenseQuery, useSuspenseInfiniteQuery,
  useSuspenseQueries, useQueries, HydrationBoundary, dehydrate, hydrate,
  focusManager, onlineManager, replaceEqualDeep, hashKey } = _s;`,

    '@tiptap/react': `\
const _s = window.__voiden_shims__['@tiptap/react'];
export default _s;
export const { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent,
  useEditor, EditorContent, ReactRenderer, FloatingMenu, BubbleMenu,
  useReactNodeView, useCurrentEditor } = _s;`,

    '@codemirror/state': `\
const _s = window.__voiden_shims__['@codemirror/state'];
export default _s;
export const { Extension, RangeSetBuilder, StateField, EditorState, Prec,
  Annotation, AnnotationType, ChangeDesc, ChangeSet, Compartment, EditorSelection,
  Facet, Line, MapMode, Range, RangeSet, RangeValue, SelectionRange,
  StateEffect, StateEffectType, Text, Transaction, combineConfig,
  countColumn, findClusterBreak, findColumn } = _s;`,

    '@codemirror/view': `\
const _s = window.__voiden_shims__['@codemirror/view'];
export default _s;
export const { keymap, EditorView, Decoration, DecorationSet, WidgetType,
  ViewPlugin, ViewUpdate, MatchDecorator, GutterMarker,
  drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars,
  lineNumbers, rectangularSelection, scrollPastEnd } = _s;`,

    '@codemirror/autocomplete': `\
const _s = window.__voiden_shims__['@codemirror/autocomplete'];
export default _s;
export const { CompletionContext, CompletionResult, autocompletion,
  completeAnyWord, closeBrackets, closeBracketsKeymap,
  completionKeymap, ifIn, ifNotIn, snippetCompletion } = _s;`,

    '@tiptap/core': "const _s=window.__voiden_shims__['@tiptap/core']||{};export default _s;export const {Editor,Extension,Node,Mark,Command,NodeViewProps,Range,JSONContent,generateJSON,mergeAttributes,getSchema,getExtensionField,callOrReturn,findParentNode,findParentNodeClosestToPos,getChangedRanges,isActive,isNodeActive,isMarkActive,getHTMLFromFragment,getText,getTextBetween}=_s;",
    '@tiptap/pm/model': "const _s=window.__voiden_shims__['@tiptap/pm/model']||{};export default _s;export const {DOMParser,DOMSerializer,Fragment,Mark,Node,NodeRange,NodeType,ReplaceError,Schema,Slice}=_s;",
    '@tiptap/pm/state': "const _s=window.__voiden_shims__['@tiptap/pm/state']||{};export default _s;export const {EditorState,Plugin,PluginKey,TextSelection,NodeSelection,AllSelection,Selection,Transaction}=_s;",
    '@tiptap/pm/tables': "const _s=window.__voiden_shims__['@tiptap/pm/tables']||{};export default _s;export const {CellSelection,TableMap,addColumnAfter,addColumnBefore,addRowAfter,addRowBefore,deleteColumn,deleteRow,deleteTable,goToNextCell,mergeCells,splitCell,tableEditing}=_s;",
    '@tiptap/pm/view': "const _s=window.__voiden_shims__['@tiptap/pm/view']||{};export default _s;export const {EditorView,Decoration,DecorationSet,DecorationSource}=_s;",
    '@tiptap/suggestion': "const _s=window.__voiden_shims__['@tiptap/suggestion']||{};const _def=_s.default||_s.Suggestion||_s;export default _def;export const Suggestion=_s.Suggestion||_def;",
    'lucide-react': "const _s=window.__voiden_shims__['lucide-react']||{};export default _s;export const {AlertCircle,ArrowDown,ArrowDownLeft,ArrowLeft,ArrowLeftRight,ArrowRight,ArrowUp,ArrowUpRight,BookOpen,Check,CheckCheck,ChevronDown,ChevronRight,ChevronsDownUp,ChevronsUpDown,Circle,CircleAlert,CircleX,Clock,Copy,CornerDownLeft,CornerDownRight,Download,ExternalLink,Eye,FileDown,FileText,Folder,FolderOpen,History,Info,Link,Loader,Loader2,Mouse,Pen,Pencil,Play,Plus,Radio,Rows,Search,SkipForward,Sparkles,Square,Trash2,Unlink,Wifi,WifiOff,WrapText,X,XCircle}=_s;",
    'zustand': "const _s=window.__voiden_shims__['zustand']||{};export default _s;export const {create}=_s;",
    // tippy.js — used heavily by tiptap extensions; share host instance to avoid duplicate tooltip stacks
    'tippy.js': "const _s=window.__voiden_shims__['tippy.js'];export default (_s&&_s.default)||_s;",
    // react-dnd / react-dnd-html5-backend — shared instances prevent duplicate HTML5 backend
    'react-dnd': "const _s=window.__voiden_shims__['react-dnd']||{};export default _s;export const {DndContext,DndProvider,DragPreviewImage,DragSource,DropTarget,DragLayer,useDrag,useDrop,useDragLayer,useDragDropManager}=_s;",
    'react-dnd-html5-backend': "const _s=window.__voiden_shims__['react-dnd-html5-backend']||{};export default _s;export const {getEmptyImage,HTML5Backend,NativeTypes}=_s;",
    // @voiden/sdk is NOT shimmed — plugins bundle their own copy from devDependencies.
    // UIExtension is a base class that must be a real constructor (not {}). Shimming it
    // to {} causes "class extends undefined" TypeErrors that silently kill the bundle.
  }

  const CORE_EXPORTS = {
    '@/core/file-system/hooks/useFileSystem': ['prosemirrorToMarkdown'],
    '@/core/editors/voiden/extensions': ['voidenExtensions'],
    '@/core/editors/voiden/VoidenEditor': ['useEditorStore', 'useVoidenEditorStore', 'proseClasses'],
    '@/core/editors/voiden/utils/expandLinkedBlocks': ['expandLinkedBlocksInDoc'],
    '@/core/editors/voiden/markdownConverter': ['parseMarkdown'],
    '@/core/request-engine/getRequestFromJson': ['getTable', 'parseAuthNode', 'buildHeadersWithCookies', 'findNode', 'findNodes', 'createNewRequestObject', 'getRequest'],
    '@/core/request-engine/stores/responseStore': ['useResponseStore'],
    '@/core/request-engine/requestOrchestrator': ['requestOrchestrator'],
    '@/core/request-engine/runtimeVariables': ['replaceProcessVariablesInText'],
    '@/core/request-engine/pipeline': ['hookRegistry', 'PipelineStage'],
    '@/core/history/adapterRegistry': ['historyAdapterRegistry'],
    '@/core/stores/panelStore': ['usePanelStore'],
    '@/core/stores/responsePanelPosition': ['getResponsePanelPosition'],
    '@/core/environment/hooks': ['useActiveEnvironment', 'useEnvironments'],
    '@/plugins': ['useEditorEnhancementStore', 'usePluginStore'],
    '@/main': ['getQueryClient'],
  }

  return {
    name: 'voiden-shims',
    enforce: 'pre',
    resolveId(id) {
      if (id in STATIC_SHIMS) return `\0voiden-shim:${id}`
      if (id in CORE_EXPORTS) return `\0voiden-shim:${id}`
      // No catch-all: packages not listed above are bundled from the plugin's own
      // node_modules. This prevents host-unavailable packages from resolving to {}.
      return null
    },
    load(id) {
      if (!id.startsWith('\0voiden-shim:')) return null
      const mod = id.slice('\0voiden-shim:'.length)

      if (mod in STATIC_SHIMS) return STATIC_SHIMS[mod]

      if (mod in CORE_EXPORTS) {
        const exports = CORE_EXPORTS[mod] || []
        const key = JSON.stringify(mod)
        const namedLines = exports.map(name => `export const ${name} = _s.${name};`).join('\n')
        return `const _s = (window.__voiden_shims__ || {})[${key}] || {};\nexport default _s;\n${namedLines}`
      }

      return null
    },
  }
}

// ── Plugin discovery ─────────────────────────────────────────────────────────

const ENTRY_CANDIDATES = ['src/plugin.ts', 'src/index.ts']

const pluginFilter = process.argv.slice(2).find(a => !a.startsWith('--')) || null
const isDev = process.argv.includes('--dev')
const isWatch = process.argv.includes('--watch')

if (!existsSync(pluginsDir)) {
  console.error('plugins/ directory not found. Run: bash scripts/setup-plugins.sh')
  process.exit(1)
}

const plugins = readdirSync(pluginsDir)
  .filter(name => {
    try { return statSync(join(pluginsDir, name)).isDirectory() } catch { return false }
  })
  .flatMap(name => {
    const repoDir = join(pluginsDir, name)
    const manifestPath = join(repoDir, 'manifest.json')
    if (!existsSync(manifestPath)) return []
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const pluginId = manifest.id
    if (!pluginId) return []
    if (pluginFilter && pluginId !== pluginFilter) return []
    const entry = ENTRY_CANDIDATES.map(f => join(repoDir, f)).find(p => existsSync(p))
    if (!entry) return []
    return [{ repoDir, pluginId, entry, manifestPath }]
  })

if (plugins.length === 0) {
  const hint = pluginFilter
    ? `Plugin "${pluginFilter}" not found — check the id field in manifest.json`
    : 'No plugin repos found in plugins/ — run: bash scripts/setup-plugins.sh'
  console.error(hint)
  process.exit(1)
}

// ── Build ────────────────────────────────────────────────────────────────────

async function buildPlugin({ repoDir, pluginId, entry, manifestPath }, { silent = false } = {}) {
  const outDir = join(repoDir, 'dist')

  await build({
    configFile: false,
    root: repoDir,
    plugins: [
      {
        name: 'inject-bundle-version',
        renderChunk(code) {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
          const prefix = [
            `export const __voiden_bundle_version__ = 2;`,
            `export const __voiden_manifest__ = ${JSON.stringify(manifest)};`,
          ].join('\n')
          return { code: `${prefix}\n${code}`, map: null }
        },
      },
      voidenShimsPlugin(),
      {
        name: 'skip-css',
        resolveId(id) { if (id.endsWith('.css')) return '\0empty-css' },
        load(id) { if (id === '\0empty-css') return 'export default {}' },
      },
      {
        name: 'self-import-stub',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@voiden/core-extensions' || id.startsWith('@voiden/core-extensions/')) {
            return '\0self-voiden-ext'
          }
        },
        load(id) {
          if (id === '\0self-voiden-ext') return 'export default {}; export const coreExtensions = []; export const coreExtensionPlugins = {};'
        },
      },
    ],
    esbuild: { jsx: 'automatic' },
    build: {
      lib: {
        entry,
        formats: ['es'],
        fileName: () => `${pluginId}.js`,
      },
      outDir,
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
          warn(warning)
        },
        output: { inlineDynamicImports: true },
      },
    },
    logLevel: silent ? 'silent' : 'warn',
  })

}

/** Run build-main.mjs in the plugin's repo and optionally copy output to bundled-main-plugins/. */
async function buildMainPlugin({ repoDir, pluginId }, { silent = false, copy = false } = {}) {
  const buildMainScript = join(repoDir, 'build-main.mjs')
  if (!existsSync(buildMainScript)) return

  const result = spawnSync('node', [buildMainScript], {
    cwd: repoDir,
    stdio: silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    if (!silent) console.error(result.stderr || result.stdout || '')
    throw new Error(`build-main.mjs exited with status ${result.status}`)
  }

  if (copy) {
    const cjsSrc = join(repoDir, 'dist', `${pluginId}-main.cjs`)
    const jsSrc = join(repoDir, 'dist', `${pluginId}-main.js`)
    const src = existsSync(cjsSrc) ? cjsSrc : jsSrc
    const ext = src === cjsSrc ? '.cjs' : '.js'
    if (existsSync(src)) {
      mkdirSync(bundledMainPluginsDir, { recursive: true })
      copyFileSync(src, join(bundledMainPluginsDir, `${pluginId}-main${ext}`))
    }
  }
}

// ── Initial build pass ───────────────────────────────────────────────────────

const ids = plugins.map(p => p.pluginId)
console.log(`Building ${plugins.length} plugin(s): ${ids.join(', ')}\n`)

if (isDev) {
  mkdirSync(bundledPluginsDir, { recursive: true })
  mkdirSync(bundledMainPluginsDir, { recursive: true })
}

let failed = 0
for (const plugin of plugins) {
  process.stdout.write(`  Building ${plugin.pluginId}...`)
  try {
    await buildPlugin(plugin, { silent: true })

    // Copy UI bundle when in dev/forge mode
    if (isDev) {
      const src = join(plugin.repoDir, 'dist', `${plugin.pluginId}.js`)
      if (existsSync(src)) copyFileSync(src, join(bundledPluginsDir, `${plugin.pluginId}.js`))
    }

    // Build and optionally copy main-process bundle
    await buildMainPlugin(plugin, { silent: true, copy: isDev })

    console.log(' ✓')
  } catch (err) {
    console.log(' ✗')
    console.error(`    Error: ${err.message}\n`)
    failed++
  }
}

console.log(`\n${plugins.length - failed}/${plugins.length} bundles built → plugins/<id>/dist/`)
if (isDev && failed === 0) {
  console.log(`Dev: copied bundles → apps/electron/bundled-plugins/ + bundled-main-plugins/`)
}
if (failed > 0 && !isWatch) {
  console.error(`${failed} build(s) failed.`)
  process.exit(1)
}

// ── Watch mode ────────────────────────────────────────────────────────────────
// Watches each plugin repo's src/ for file changes. Rebuilds and copies to
// bundled-plugins/ on save. Electron main detects the change and hot-reloads
// plugins in the renderer without a full app restart.

if (isWatch) {
  const { watch } = await import('fs')
  const pending = new Map()

  const rebuildPlugin = async (plugin) => {
    process.stdout.write(`  [watch] ${plugin.pluginId} → rebuilding...`)
    try {
      await buildPlugin(plugin, { silent: true })
      if (isDev) {
        const src = join(plugin.repoDir, 'dist', `${plugin.pluginId}.js`)
        if (existsSync(src)) copyFileSync(src, join(bundledPluginsDir, `${plugin.pluginId}.js`))
      }
      await buildMainPlugin(plugin, { silent: true, copy: isDev })
      console.log(' ✓  (signaling hot-reload...)')
    } catch (err) {
      console.log(` ✗  ${err.message}`)
    }
  }

  console.log(`\nWatching ${plugins.length} plugin(s) — edit files in plugins/<repo>/src/ to rebuild.\n`)

  for (const plugin of plugins) {
    const watchDir = join(plugin.repoDir, 'src')
    if (!existsSync(watchDir)) continue
    watch(watchDir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith('.js') || filename.endsWith('.js.map')) return
      clearTimeout(pending.get(plugin.pluginId))
      pending.set(plugin.pluginId, setTimeout(() => rebuildPlugin(plugin), 300))
    })
  }

  await new Promise(() => {}) // keep alive
}
