#!/usr/bin/env node
import prompts from 'prompts';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ─── Helpers ────────────────────────────────────────────────────────────────

const toKebab = (str) =>
  str.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const toCamel = (str) =>
  str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const toPascal = (str) => {
  const c = toCamel(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

const write = (path, content) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
};

// ─── Permission definitions (mirrors @voiden/sdk PluginPermission) ────────────
//
// Each entry: { value, title, description, apiNote }
// These match the PluginPermission union type in @voiden/sdk/shared exactly.

const PERMISSIONS = [
  {
    value: 'filesystem',
    title: 'File System  (context.fs.*)',
    description: 'Read, write, create, delete and list files relative to the active project root',
  },
  {
    value: 'settings',
    title: 'Settings  (context.settings.* + context.ui.registerSettings)',
    description: 'Persist per-plugin settings (plain JSON) and register a Settings panel section',
  },
  {
    value: 'events',
    title: 'Events  (context.events.on)',
    description: 'Subscribe to workspace lifecycle events: tab:changed, file:saved, project:changed, environment:changed, request:sent, response:received',
  },
  {
    value: 'commandPalette',
    title: 'Command Palette  (context.registerCommand)',
    description: 'Add entries to the command palette — shown when the user opens it',
  },
  {
    value: 'contextMenus',
    title: 'Context Menus  (context.registerContextMenu)',
    description: 'Inject items into right-click context menus on tabs, files, or editor blocks',
  },
];

// ─── CLI entry ───────────────────────────────────────────────────────────────

const argName = process.argv[2];

console.log('\n  @voiden/create-plugin\n');
console.log('  Usage: npm create @voiden/plugin\n');

const onCancel = () => { console.log('\nCancelled.'); process.exit(1); };

// ── Step 1: basic identity ───────────────────────────────────────────────────

const identity = await prompts([
  {
    type: 'text',
    name: 'name',
    message: 'Plugin display name',
    initial: argName ?? '',
    validate: (v) => v.trim().length > 0 || 'Required',
  },
  {
    type: 'text',
    name: 'id',
    message: 'Plugin ID (kebab-case)',
    initial: (prev) => toKebab(prev),
    validate: (v) => /^[a-z][a-z0-9-]*$/.test(v) || 'Must be kebab-case (e.g. my-plugin)',
  },
  {
    type: 'text',
    name: 'description',
    message: 'Description',
    initial: '',
  },
  {
    type: 'text',
    name: 'author',
    message: 'Author',
    initial: 'Voiden Team',
  },
  {
    type: 'text',
    name: 'icon',
    message: 'Icon (lucide-react icon name, e.g. "Plug", "Zap") — optional',
    initial: '',
  },
  {
    type: 'text',
    name: 'version',
    message: 'Initial version',
    initial: '1.0.0',
  },
  {
    type: 'text',
    name: 'voidenVersion',
    message: 'Minimum Voiden version required',
    initial: '>=2.0.0',
  },
  {
    type: 'number',
    name: 'priority',
    message: 'Load priority (lower = earlier)',
    initial: 30,
  },
], { onCancel });

// ── Step 2: capabilities ─────────────────────────────────────────────────────

const { caps } = await prompts({
  type: 'multiselect',
  name: 'caps',
  message: 'Select capabilities',
  choices: [
    { title: 'Blocks (TipTap nodes)',    value: 'blocks'          },
    { title: 'Request pipeline hooks',   value: 'requestPipeline' },
    { title: 'Slash commands',           value: 'slashCommands'   },
    { title: 'Sidebar tab',              value: 'sidebar'         },
    { title: 'Paste handler',            value: 'paste'           },
    { title: 'Main process (Electron)',  value: 'mainProcess'     },
  ],
  hint: '- Space to select, Enter to confirm',
}, { onCancel });

// ── Step 3: permissions ──────────────────────────────────────────────────────
//
// Permissions gate specific context APIs. Community plugins must declare them
// in manifest.json — the host app enforces them at call time.
// Maps 1-to-1 with the PluginPermission type in @voiden/sdk/shared.

const { permissions } = await prompts({
  type: 'multiselect',
  name: 'permissions',
  message: 'Select permissions your plugin needs',
  choices: PERMISSIONS.map((p) => ({
    title: p.title,
    value: p.value,
    description: p.description,
  })),
  hint: '- Space to select, Enter to confirm. Leave empty if no gated APIs are used.',
}, { onCancel });

// ── Step 4: capability-specific details ──────────────────────────────────────

let blockNames = [];
if (caps.includes('blocks')) {
  const { raw } = await prompts({
    type: 'text',
    name: 'raw',
    message: 'Block type names (comma-separated, e.g. my-node,my-node-body)',
    validate: (v) => v.trim().length > 0 || 'Required',
  }, { onCancel });
  blockNames = raw.split(',').map((s) => s.trim()).filter(Boolean).map(toKebab);
}

let slashGroups = [];
if (caps.includes('slashCommands')) {
  const { groupName } = await prompts({
    type: 'text',
    name: 'groupName',
    message: 'Slash command group name',
    initial: identity.id,
  }, { onCancel });
  const { rawCmds } = await prompts({
    type: 'text',
    name: 'rawCmds',
    message: 'Command labels (comma-separated)',
    initial: `Insert ${identity.name}`,
  }, { onCancel });
  slashGroups = [{ name: groupName, commands: rawCmds.split(',').map((s) => s.trim()) }];
}

let sidebarSide = 'right';
if (caps.includes('sidebar')) {
  const { side } = await prompts({
    type: 'select',
    name: 'side',
    message: 'Sidebar side',
    choices: [{ title: 'Right', value: 'right' }, { title: 'Left', value: 'left' }],
  }, { onCancel });
  sidebarSide = side;
}

// ── Step 5: output dir ────────────────────────────────────────────────────────

const { outDir } = await prompts({
  type: 'text',
  name: 'outDir',
  message: 'Output directory',
  initial: `./${identity.id}`,
}, { onCancel });

const dir = resolve(process.cwd(), outDir);
if (existsSync(dir)) {
  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message: `${outDir} already exists. Continue?`,
    initial: false,
  }, { onCancel });
  if (!ok) process.exit(1);
}

// ─── Generate files ──────────────────────────────────────────────────────────

const { id, name, description, author, icon, version, voidenVersion, priority } = identity;
const hasMainProcess = caps.includes('mainProcess');
const hasBlocks = caps.includes('blocks');
const hasPipeline = caps.includes('requestPipeline');
const hasSlash = caps.includes('slashCommands');
const hasSidebar = caps.includes('sidebar');
const hasPaste = caps.includes('paste');
const fnName = `create${toPascal(toCamel(id))}Plugin`;

// Permission flags
const needsFilesystem    = permissions.includes('filesystem');
const needsSettings      = permissions.includes('settings');
const needsEvents        = permissions.includes('events');
const needsCommandPalette = permissions.includes('commandPalette');
const needsContextMenus  = permissions.includes('contextMenus');

// ── manifest.json ─────────────────────────────────────────────────────────────

const capabilitiesObj = {};
if (hasBlocks && blockNames.length > 0) {
  capabilitiesObj.blocks = {
    owns: blockNames,
    allowExtensions: true,
    description: `Owns ${blockNames.length} block type${blockNames.length > 1 ? 's' : ''}`,
  };
}
if (hasPipeline) {
  capabilitiesObj.requestPipeline = {
    buildHandler: true,
    responseHandler: true,
    description: 'Registers handlers for building and processing requests',
  };
}
if (hasSlash && slashGroups.length > 0) {
  capabilitiesObj.slashCommands = {
    groups: slashGroups.map((g) => ({ name: g.name, commands: g.commands })),
  };
}
if (hasPaste) {
  capabilitiesObj.paste = { patterns: [] };
}

const manifest = {
  id,
  name,
  description,
  version,
  voidenVersion,
  author,
  ...(icon ? { icon } : {}),
  type: 'community',
  priority,
  readme: description,
  mainProcess: hasMainProcess,
  // Declared permissions — community plugins must list every gated API they use.
  // The host app (plugins.tsx) enforces these at call time using PluginPermission
  // from @voiden/sdk/shared. Missing a permission causes a PluginPermissionError
  // and shows an amber "Needs Permission" badge in the Extension Browser.
  permissions,
  capabilities: capabilitiesObj,
  features: [],
};

write(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ── changelog.json ────────────────────────────────────────────────────────────

const changelog = [
  {
    version,
    date: new Date().toISOString().slice(0, 10),
    title: 'Initial release',
    description: `First release of ${name}.`,
    changes: {
      Added: ['Initial plugin scaffold'],
    },
  },
];
write(join(dir, 'changelog.json'), JSON.stringify(changelog, null, 2));

// ── package.json ──────────────────────────────────────────────────────────────

const pkgJson = {
  name: `@voiden/plugin-${id}`,
  version,
  type: 'module',
  private: false,
  description,
  main: './src/plugin.ts',
  scripts: {
    build: 'node build.mjs',
    ...(hasMainProcess ? { 'build:main': 'node build-main.mjs' } : {}),
    zip: 'node zip.mjs',
    release: `node build.mjs${hasMainProcess ? ' && node build-main.mjs' : ''} && node zip.mjs && node generate-manifest.mjs`,
  },
  peerDependencies: {
    '@voiden/sdk': '>=1.0.10',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
  },
  devDependencies: {
    '@voiden/sdk': '1.0.10',
    esbuild: '^0.20.0',
    typescript: '^5.0.0',
    vite: '^5.0.0',
  },
};
write(join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));

// ── tsconfig.json ─────────────────────────────────────────────────────────────

const tsconfig = {
  compilerOptions: {
    target: 'ES2020',
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  },
  include: ['src'],
  exclude: ['node_modules', 'dist'],
};
write(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

// ── .gitignore ────────────────────────────────────────────────────────────────

write(join(dir, '.gitignore'), `node_modules/
dist/
*.tsbuildinfo
`);

// ── generate-manifest.mjs ─────────────────────────────────────────────────────

write(join(dir, 'generate-manifest.mjs'), `#!/usr/bin/env node
import { readFileSync } from 'fs'
const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
console.log(\`Manifest ready: \${manifest.id} v\${manifest.version}\`)
`);

// ── zip.mjs ───────────────────────────────────────────────────────────────────
// Packages the built plugin into a zip for local installation in Voiden.
// Zip format: manifest.json + main.js (+ optional skill.md, *-main.js) at root.
// Install in Voiden via Extensions → Install from file.

write(join(dir, 'zip.mjs'), `#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join, resolve } from 'path'

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
const pluginId = manifest.id

// Verify the renderer bundle was built
const mainSrc = \`dist/\${pluginId}.js\`
if (!existsSync(mainSrc)) {
  console.error(\`\\n  Error: dist/\${pluginId}.js not found. Run \\\`npm run build\\\` first.\\n\`)
  process.exit(1)
}

// Stage files into a temp dir so zip -j (junk paths) isn't needed
const staging = resolve(\`dist/__staging__\`)
if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

// Required: main.js + manifest.json
copyFileSync(mainSrc, join(staging, 'main.js'))
copyFileSync('manifest.json', join(staging, 'manifest.json'))

// Optional: skill.md
if (existsSync('src/skill.md')) {
  copyFileSync('src/skill.md', join(staging, 'skill.md'))
}

// Optional: main-process bundle
const mainProcessSrc = \`dist/\${pluginId}-main.cjs\`
if (existsSync(mainProcessSrc)) {
  copyFileSync(mainProcessSrc, join(staging, \`\${pluginId}-main.js\`))
}

// Create the zip
const outZip = resolve(\`dist/\${pluginId}.zip\`)
if (existsSync(outZip)) rmSync(outZip)

try {
  execSync(\`zip -r "\${outZip}" .\`, { cwd: staging, stdio: 'inherit' })
} catch {
  console.error('\\n  Error: zip command failed. Make sure zip is installed.\\n')
  process.exit(1)
} finally {
  rmSync(staging, { recursive: true, force: true })
}

const sizeKb = (readFileSync(outZip).length / 1024).toFixed(1)
console.log(\`
  ✓ dist/\${pluginId}.zip  (\${sizeKb} kB)

  To install in Voiden:
    Extensions → ⋯ → Install from file → select dist/\${pluginId}.zip
\`)
`);

// ── build.mjs (renderer — Vite + shim plugin) ─────────────────────────────────

write(join(dir, 'build.mjs'), `#!/usr/bin/env node
import { build } from 'vite'
import { readFileSync, existsSync } from 'fs'

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
const pluginId = manifest.id
const entry = existsSync('./src/plugin.ts') ? './src/plugin.ts' : './src/index.ts'

// Packages provided by the host app at runtime via window.__voiden_shims__
const STATIC_SHIMS = {
  'react': \`const _s=window.__voiden_shims__['react'];export default _s;export const {useState,useEffect,useCallback,useMemo,useRef,useContext,createContext,forwardRef,memo,Fragment,createElement,cloneElement,Children,StrictMode,Suspense,lazy,isValidElement,Component,PureComponent,createRef,startTransition,useReducer,useLayoutEffect,useImperativeHandle,useDebugValue,useTransition,useDeferredValue,useId}=_s;\`,
  // In Vite dev mode the host may expose jsxDEV instead of jsx — fall back gracefully.
  'react/jsx-runtime': \`const _s=window.__voiden_shims__?.['react/jsx-runtime']??{};const _r=window.__voiden_shims__?.['react']??{};export const jsx=_s.jsx??_s.jsxDEV??_r.createElement;export const jsxs=_s.jsxs??_s.jsxDEV??_r.createElement;export const Fragment=_s.Fragment??_r.Fragment;\`,
  'react-dom': \`const _s=window.__voiden_shims__['react-dom'];export default _s;export const {createPortal,flushSync,render,unmountComponentAtNode}=_s;\`,
  'react-dom/client': \`const _s=window.__voiden_shims__['react-dom/client'];export default _s;export const {createRoot,hydrateRoot}=_s;\`,
  '@tanstack/react-query': \`const _s=window.__voiden_shims__['@tanstack/react-query'];export default _s;export const {useQuery,useMutation,useQueryClient,useInfiniteQuery,QueryClient,QueryClientProvider,QueryCache,MutationCache,useIsFetching,useIsMutating,useSuspenseQuery,useSuspenseInfiniteQuery,useSuspenseQueries,useQueries,HydrationBoundary,dehydrate,hydrate,focusManager,onlineManager,replaceEqualDeep,hashKey}=_s;\`,
  '@tiptap/react': \`const _s=window.__voiden_shims__['@tiptap/react'];export default _s;export const {ReactNodeViewRenderer,NodeViewWrapper,NodeViewContent,useEditor,EditorContent,ReactRenderer,FloatingMenu,BubbleMenu,useReactNodeView,useCurrentEditor}=_s;\`,
  '@codemirror/state': \`const _s=window.__voiden_shims__['@codemirror/state'];export default _s;export const {Extension,RangeSetBuilder,StateField,EditorState,Prec,Annotation,AnnotationType,ChangeDesc,ChangeSet,Compartment,EditorSelection,Facet,Line,MapMode,Range,RangeSet,RangeValue,SelectionRange,StateEffect,StateEffectType,Text,Transaction,combineConfig,countColumn,findClusterBreak,findColumn}=_s;\`,
  '@codemirror/view': \`const _s=window.__voiden_shims__['@codemirror/view'];export default _s;export const {keymap,EditorView,Decoration,DecorationSet,WidgetType,ViewPlugin,ViewUpdate,MatchDecorator,GutterMarker,drawSelection,dropCursor,highlightActiveLine,highlightSpecialChars,lineNumbers,rectangularSelection,scrollPastEnd}=_s;\`,
  '@codemirror/autocomplete': \`const _s=window.__voiden_shims__['@codemirror/autocomplete'];export default _s;export const {CompletionContext,CompletionResult,autocompletion,completeAnyWord,closeBrackets,closeBracketsKeymap,completionKeymap,ifIn,ifNotIn,snippetCompletion}=_s;\`,
  '@tiptap/core': \`const _s=window.__voiden_shims__['@tiptap/core']||{};export default _s;export const {Editor,Extension,Node,NodeViewProps,Range,JSONContent,generateJSON,mergeAttributes,getSchema}=_s;\`,
  '@tiptap/pm/model': \`const _s=window.__voiden_shims__['@tiptap/pm/model']||{};export default _s;export const {DOMParser,Fragment,Node,Slice}=_s;\`,
  '@tiptap/pm/state': \`const _s=window.__voiden_shims__['@tiptap/pm/state']||{};export default _s;export const {EditorState,Plugin,PluginKey}=_s;\`,
  '@tiptap/pm/tables': \`const _s=window.__voiden_shims__['@tiptap/pm/tables']||{};export default _s;export const {CellSelection}=_s;\`,
  '@tiptap/pm/view': \`const _s=window.__voiden_shims__['@tiptap/pm/view']||{};export default _s;export const {EditorView}=_s;\`,
  '@tiptap/suggestion': \`const _s=window.__voiden_shims__['@tiptap/suggestion']||{};export default _s;\`,
  'lucide-react': \`const _s=window.__voiden_shims__['lucide-react']||{};export default _s;export const {AlertCircle,ArrowDown,ArrowLeft,ArrowRight,ArrowUp,BookOpen,Check,CheckCheck,ChevronDown,ChevronRight,ChevronsDownUp,ChevronsUpDown,Circle,CircleAlert,CircleX,Clock,Copy,CornerDownLeft,Download,ExternalLink,Eye,FileText,Folder,FolderOpen,History,Info,Link,Loader,Loader2,Play,Plus,Radio,Search,Sparkles,Trash2,X,XCircle}=_s;\`,
  'zustand': \`const _s=window.__voiden_shims__['zustand']||{};export default _s;export const {create}=_s;\`,
  '@voiden/sdk': \`const _s=window.__voiden_shims__['@voiden/sdk']||{};export default _s;export const {PipelineStage,PluginContext,RequestCompilationContext,SlashCommandGroup,UIExtension}=_s;\`,
  '@voiden/sdk/shared': \`const _s=window.__voiden_shims__['@voiden/sdk/shared']||{};export default _s;export const {Request,RequestParam,parseCookies}=_s;\`,
  'tippy.js': \`const _s=window.__voiden_shims__['tippy.js']||{};export default _s;\`,
  'buffer': \`export const Buffer=globalThis.Buffer;export default{Buffer:globalThis.Buffer};\`,
}

// Host app module exports — resolved to window.__voiden_shims__ at runtime
const CORE_EXPORTS = {
  '@voiden/sdk/ui': [
    'PluginContext','CorePluginContext','Plugin','SlashCommand','SlashCommandGroup',
    'Tab','EditorAction','StatusBarItem','PluginHelpers',
    'BlockPasteHandler','BlockExtension','PatternHandler',
    // New plugin API types (SDK >=1.0.11)
    'PluginCommand','PluginTopBarItem','PluginContextMenuItem',
    'PluginFS','PluginVault','PluginSettings','PluginSettingsSection',
    'PluginEventCallback','PluginEvents',
  ],
  '@/core/file-system/hooks/useFileSystem': ['prosemirrorToMarkdown'],
  '@/core/editors/voiden/extensions': ['voidenExtensions'],
  '@/core/editors/voiden/VoidenEditor': ['useEditorStore','useVoidenEditorStore','proseClasses'],
  '@/core/editors/voiden/utils/expandLinkedBlocks': ['expandLinkedBlocksInDoc'],
  '@/core/editors/voiden/markdownConverter': ['parseMarkdown'],
  '@/core/request-engine/getRequestFromJson': ['getTable','parseAuthNode','buildHeadersWithCookies','findNode','findNodes','createNewRequestObject','getRequest'],
  '@/core/request-engine/stores/responseStore': ['useResponseStore'],
  '@/core/request-engine/requestOrchestrator': ['requestOrchestrator'],
  '@/core/request-engine/runtimeVariables': ['replaceProcessVariablesInText'],
  '@/core/request-engine/pipeline': ['hookRegistry','PipelineStage'],
  '@/core/history/adapterRegistry': ['historyAdapterRegistry'],
  '@/core/stores/panelStore': ['usePanelStore'],
  '@/core/stores/responsePanelPosition': ['getResponsePanelPosition'],
  '@/core/environment/hooks': ['useActiveEnvironment','useEnvironments'],
  // @/plugins exports — usePluginStore, useEditorEnhancementStore, emitPluginEvent, getContextMenuItems
  '@/plugins': ['useEditorEnhancementStore','usePluginStore','emitPluginEvent','getContextMenuItems'],
  '@/main': ['getQueryClient'],
}

function shimPlugin() {
  return {
    name: 'voiden-shims',
    enforce: 'pre',
    resolveId(id) {
      if (id in STATIC_SHIMS) return \`\\0shim:\${id}\`
      if (id in CORE_EXPORTS) return \`\\0shim:\${id}\`
      return null
    },
    load(id) {
      if (!id.startsWith('\\0shim:')) return null
      const mod = id.slice('\\0shim:'.length)
      if (mod in STATIC_SHIMS) return STATIC_SHIMS[mod]
      const exports = CORE_EXPORTS[mod] || []
      const key = JSON.stringify(mod)
      const named = exports.map(n => \`export const \${n}=_s.\${n};\`).join('\\n')
      return \`const _s=(window.__voiden_shims__||{})[\\${key}]||{};export default _s;\\n\${named}\`
    },
    renderChunk(code) {
      const mfStr = JSON.stringify(manifest)
      return {
        code: \`globalThis["__voiden_bundle_version__"]=2;\\nexport const __voiden_bundle_version__=2;\\nexport const __voiden_manifest__=\${mfStr};\\n\${code}\`,
        map: null,
      }
    },
  }
}

await build({
  configFile: false,
  plugins: [
    shimPlugin(),
    { name: 'skip-css', resolveId(id) { if (id.endsWith('.css')) return '\\0empty' }, load(id) { if (id === '\\0empty') return 'export default {}' } },
    { name: 'node-buffer', enforce: 'pre', resolveId(id) { if (id === 'buffer') return '\\0buf' }, load(id) { if (id === '\\0buf') return 'export const Buffer=globalThis.Buffer;export default{Buffer:globalThis.Buffer}' } },
  ],
  esbuild: { jsx: 'automatic' },
  build: {
    lib: { entry, formats: ['es'], fileName: () => \`\${pluginId}.js\` },
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rollupOptions: {
      onwarn(w, warn) { if (w.code === 'MODULE_LEVEL_DIRECTIVE' || w.code === 'UNRESOLVED_IMPORT') return; warn(w) },
      output: { inlineDynamicImports: true },
    },
  },
  logLevel: 'info',
})
`);

// ── build-main.mjs (only if mainProcess) ─────────────────────────────────────

if (hasMainProcess) {
  write(join(dir, 'build-main.mjs'), `#!/usr/bin/env node
import { build } from 'esbuild'
import { existsSync, readFileSync } from 'fs'

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
const pluginId = manifest.id
const entry = './src/main-process.ts'

if (!existsSync(entry)) {
  console.log('No main-process.ts found — skipping')
  process.exit(0)
}

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: \`dist/\${pluginId}-main.cjs\`,
  external: [
    'electron',
    'node:*',
    'child_process', 'fs', 'path', 'os', 'http', 'https', 'net', 'crypto',
    'worker_threads', 'stream', 'events', 'util', 'url', 'buffer',
    '@voiden/sdk',
  ],
  minify: true,
})
console.log(\`Built dist/\${pluginId}-main.cjs\`)
`);
}

// ── src/plugin.ts ─────────────────────────────────────────────────────────────

const onloadLines = [];

if (hasBlocks && blockNames.length > 0) {
  blockNames.forEach((bn) => {
    const fn = toPascal(toCamel(bn));
    onloadLines.push(
      ``,
      `      // ${fn} node`,
      `      const ${fn}Node = Node.create({`,
      `        name: '${bn}',`,
      `        group: 'block',`,
      `        atom: true,`,
      `        addAttributes() { return {}; },`,
      `        parseHTML() { return [{ tag: 'div[data-type="${bn}"]' }]; },`,
      `        renderHTML({ HTMLAttributes }) {`,
      `          return ['div', mergeAttributes(HTMLAttributes, { 'data-type': '${bn}' })];`,
      `        },`,
      `      });`,
      `      context.registerVoidenExtension(${fn}Node);`,
    );
  });
}

if (hasPipeline) {
  onloadLines.push(
    ``,
    `      context.onBuildRequest(async (request, editor) => {`,
    `        // Inspect editor.getJSON() and build the request object`,
    `        return request;`,
    `      });`,
    ``,
    `      context.onProcessResponse(async (response) => {`,
    `        // Handle response — open a tab or process data`,
    `        // await context.openVoidenTab('Response', responseDoc, { readOnly: true });`,
    `      });`,
  );
}

if (hasSlash && slashGroups.length > 0) {
  const g = slashGroups[0];
  const cmds = g.commands.map((label) => {
    const cmdId = toKebab(label);
    return [
      `          {`,
      `            name: '${cmdId}',`,
      `            label: '${label}',`,
      `            slash: '/${cmdId}',`,
      `            description: '${label}',`,
      `            action: (editor) => {`,
      `              editor?.chain().focus().insertContent({ type: '${blockNames[0] ?? id}' }).run();`,
      `            },`,
      `          },`,
    ].join('\n');
  }).join('\n');

  onloadLines.push(
    ``,
    `      context.addVoidenSlashGroup({`,
    `        name: '${g.name}',`,
    `        title: '${name}',`,
    `        commands: [`,
    cmds,
    `        ],`,
    `      });`,
  );
}

if (hasSidebar) {
  onloadLines.push(
    ``,
    `      const SidebarView = () => React.createElement('div', { style: { padding: 16 } }, '${name} sidebar');`,
    ``,
    `      context.registerSidebarTab('${sidebarSide}', {`,
    `        id: '${id}',`,
    `        title: '${name}',`,
    `        icon: null,`,
    `        component: SidebarView,`,
    `      });`,
  );
}

if (hasPaste) {
  onloadLines.push(
    ``,
    `      // context.registerPasteHandler({`,
    `      //   pattern: /your-pattern/,`,
    `      //   transform: async (text) => ({ type: '${blockNames[0] ?? id}', attrs: { body: text } }),`,
    `      // });`,
  );
}

if (hasMainProcess) {
  onloadLines.push(
    ``,
    `      // Main-process IPC handlers are registered in src/main-process.ts`,
  );
}

// ── Permission-specific boilerplate ──────────────────────────────────────────
// Each block is only emitted when the user selected the corresponding permission.
// The APIs used here match @voiden/sdk PluginContext exactly.

if (needsCommandPalette) {
  onloadLines.push(
    ``,
    `      // Permission: commandPalette — register a command palette entry`,
    `      context.registerCommand({`,
    `        id: '${id}.example-command',`,
    `        label: '${name}: Example Command',`,
    `        description: 'Replace this with your command description',`,
    `        action: () => {`,
    `          context.ui.showToast?.('${name} command executed', 'info');`,
    `        },`,
    `      });`,
  );
}

if (needsContextMenus) {
  onloadLines.push(
    ``,
    `      // Permission: contextMenus — add a tab context menu item`,
    `      context.registerContextMenu({`,
    `        id: '${id}.tab-action',`,
    `        label: '${name}: Tab Action',`,
    `        surface: 'tab',`,
    `        when: (tab) => tab.type === 'document',`,
    `        action: (tab) => {`,
    `          console.log('${name} tab action on', tab);`,
    `        },`,
    `      });`,
  );
}

if (needsEvents) {
  onloadLines.push(
    ``,
    `      // Permission: events — subscribe to workspace lifecycle events`,
    `      // Supported: tab:changed, file:saved, project:changed, environment:changed,`,
    `      //            request:sent, response:received`,
    `      const unsubTab = context.events.on('tab:changed', ({ tabId, title }) => {`,
    `        console.log('${name}: tab changed to', title, tabId);`,
    `      });`,
    ``,
    `      // Store unsubscribers so onunload can clean up`,
    `      cleanupFns.push(unsubTab);`,
  );
}

if (needsFilesystem) {
  onloadLines.push(
    ``,
    `      // Permission: filesystem — read/write files relative to the active project root`,
    `      // const content = await context.fs.read('config.json');`,
    `      // await context.fs.write('output.txt', 'hello');`,
    `      // const entries = await context.fs.list();`,
  );
}

if (needsSettings) {
  onloadLines.push(
    ``,
    `      // Permission: settings — persistent per-plugin settings (plain JSON)`,
    `      // const value = await context.settings.get<string>('my-key');`,
    `      // await context.settings.set('my-key', 'value');`,
    `      // const unsub = context.settings.onChange((key, val) => console.log(key, val));`,
    `      // cleanupFns.push(unsub);`,
    ``,
    `      // Register a settings page section (requires 'settings' permission)`,
    `      // context.ui.registerSettings({`,
    `      //   id: '${id}-settings',`,
    `      //   title: '${name} Settings',`,
    `      //   component: MySettingsComponent,`,
    `      // });`,
  );
}

const blockImports = hasBlocks
  ? `import { Node, mergeAttributes } from '@tiptap/core';\n`
  : '';
const sidebarImport = hasSidebar ? `import React from 'react';\n` : '';
const needsCleanup = needsEvents || needsSettings;

const pluginTs = `import type { CorePluginContext } from '@voiden/sdk/ui';
${blockImports}${sidebarImport}import manifest from '../manifest.json';

type PluginContext = CorePluginContext;

export default function ${fnName}(context: PluginContext) {
  return {
    onload: async () => {
${needsCleanup ? `      const cleanupFns: Array<() => void> = [];\n` : ''}${onloadLines.join('\n')}
    },

    onunload: async () => {
${needsCleanup ? `      // Call all cleanup functions registered during onload\n      cleanupFns.forEach((fn) => fn());\n` : ''}    },

    metadata: manifest,
  };
}
`.replace(/\n{3,}/g, '\n\n');

write(join(dir, 'src', 'plugin.ts'), pluginTs);

// ── src/main-process.ts (only if mainProcess) ─────────────────────────────────

if (hasMainProcess) {
  write(join(dir, 'src', 'main-process.ts'), `import { ipcMain } from 'electron';

/**
 * Main-process entry for ${name}.
 * Register IPC handlers here. This file is bundled separately via build-main.mjs.
 */
export function register() {
  ipcMain.handle('${id}:example', async (_event, payload: any) => {
    return { ok: true, payload };
  });
}
`);
}

// ── src/skill.md ──────────────────────────────────────────────────────────────

const skillLines = [`# ${name}`, ``, description, ``];
if (hasBlocks) skillLines.push(`- Registers block types: ${blockNames.join(', ')}`);
if (hasPipeline) skillLines.push(`- Hooks into the request pipeline (build & response)`);
if (hasSlash) skillLines.push(`- Adds slash commands: ${slashGroups.flatMap((g) => g.commands).join(', ')}`);
if (hasSidebar) skillLines.push(`- Adds a ${sidebarSide} sidebar tab`);
if (permissions.length > 0) skillLines.push(`- Permissions: ${permissions.join(', ')}`);
write(join(dir, 'src', 'skill.md'), skillLines.join('\n') + '\n');

// ─── Done ─────────────────────────────────────────────────────────────────────

const permissionNote = permissions.length > 0
  ? `\n  Permissions declared: ${permissions.join(', ')}`
  : '';

console.log(`
  Plugin scaffolded at ${outDir}/${permissionNote}

  Files created:
    manifest.json        changelog.json
    package.json         tsconfig.json
    build.mjs            zip.mjs
    generate-manifest.mjs${hasMainProcess ? '\n    build-main.mjs' : ''}
    .gitignore
    src/plugin.ts${hasMainProcess ? '\n    src/main-process.ts' : ''}
    src/skill.md

  Next steps:
    cd ${outDir}
    npm install
    npm run build       # build the plugin
    npm run zip         # package to dist/${id}.zip

  Install locally:
    Extensions → ⋯ → Install from file → dist/${id}.zip
`);
