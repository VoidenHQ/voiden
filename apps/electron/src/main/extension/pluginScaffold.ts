import fs from "fs/promises";
import path from "path";

export interface ScaffoldResult {
  pluginId: string;
  created: string[];
  skipped: string[];
}

/** Turn a display name into a plugin id: lowercase, dash-separated. */
export const toPluginId = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-plugin";

const exists = (p: string) => fs.access(p).then(() => true, () => false);

export interface PluginProjectInfo {
  isPlugin: boolean;
  pluginId?: string;
  pluginName?: string;
}

/**
 * Whether a folder is a buildable plugin project: a manifest.json with id, name
 * and version, and a package.json with a "build" script.
 */
export async function checkPluginProject(dirPath: string): Promise<PluginProjectInfo> {
  try {
    const [manifestRaw, pkgRaw] = await Promise.all([
      fs.readFile(path.join(dirPath, "manifest.json"), "utf8"),
      fs.readFile(path.join(dirPath, "package.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestRaw);
    const pkg = JSON.parse(pkgRaw);
    if (!manifest.id || !manifest.name || !manifest.version) return { isPlugin: false };
    if (!pkg.scripts?.build) return { isPlugin: false };
    return { isPlugin: true, pluginId: manifest.id as string, pluginName: manifest.name as string };
  } catch {
    return { isPlugin: false };
  }
}

/**
 * Write the files a Voiden plugin project needs into `projectDir`.
 *
 * Never overwrites: a file that already exists is left alone and reported in
 * `skipped`. manifest.json and package.json are the exception — when present
 * they are merged, so only the fields the plugin build needs are filled in and
 * anything the user already has (scripts, deps, metadata) is kept.
 */
export async function scaffoldPluginProject(projectDir: string, name: string): Promise<ScaffoldResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  const put = async (rel: string, content: string) => {
    const target = path.join(projectDir, rel);
    if (await exists(target)) {
      skipped.push(rel);
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    created.push(rel);
  };

  // Fill in keys missing from an existing JSON file (one level deep for objects).
  // `freshOnly` keys are written only when the file is created, never merged in.
  const mergeJson = async (rel: string, defaults: Record<string, any>, freshOnly: Record<string, any> = {}) => {
    const target = path.join(projectDir, rel);
    if (!(await exists(target))) return put(rel, JSON.stringify({ ...defaults, ...freshOnly }, null, 2));
    const current = JSON.parse(await fs.readFile(target, "utf8"));
    const merged: Record<string, any> = { ...defaults, ...current };
    for (const [key, value] of Object.entries(defaults)) {
      if (value && typeof value === "object" && !Array.isArray(value) && current[key] && typeof current[key] === "object") {
        merged[key] = { ...value, ...current[key] };
      }
    }
    await fs.writeFile(target, JSON.stringify(merged, null, 2));
    created.push(`${rel} (updated)`);
  };

  await fs.mkdir(projectDir, { recursive: true });

  // An existing manifest keeps its id, so the plugin installs under the same id it always had.
  let pluginId = toPluginId(name);
  const manifestPath = path.join(projectDir, "manifest.json");
  if (await exists(manifestPath)) {
    const current = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (typeof current.id === "string" && current.id) pluginId = current.id;
  }

  // manifest.json at root (also read by build script)
  await mergeJson("manifest.json", {
    id: pluginId,
    name,
    description: "",
    version: "1.0.0",
    voidenVersion: ">=2.0.0",
    author: "",
    icon: "Plug",
    type: "community",
    priority: 30,
    permissions: [],
    capabilities: {},
    features: [],
  });

  // src/plugin.ts — entry point: a top-bar button plus a welcome tab, as a working example
  const fnSuffix = name.replace(/[^a-zA-Z0-9]/g, "") || "Plugin";
  await put("src/plugin.ts", PLUGIN_TS.replace("__FN__", fnSuffix));

  // src/WelcomePage.tsx — example React component rendered in that tab
  await put("src/WelcomePage.tsx", WELCOME_PAGE_TSX);

  // README.md — how to develop, build and publish the plugin
  await put("README.md", README_MD.split("__NAME__").join(name).split("__ID__").join(pluginId));

  await put(".gitignore", "node_modules/\ndist/\n");

  // src/voiden.d.ts — compile-time stubs for all packages shimmed by Voiden at runtime.
  // react, react-dom, and @voiden/sdk are ALL provided via window.__voiden_shims__
  // when the plugin is loaded, so none of them need to be installed from npm.
  await put("src/voiden.d.ts",
`// ── Voiden runtime shims ──────────────────────────────────────────────────────
// These packages are injected by Voiden at runtime via window.__voiden_shims__.
// They are externalized from the build and must NOT be installed from npm.

declare module 'react' {
  export = React;
  namespace React {
    type ReactNode = any;
    type FC<P = {}> = (props: P) => ReactNode;
    type CSSProperties = { [key: string]: any };
    function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
    function useEffect(fn: () => void | (() => void), deps?: any[]): void;
    function useRef<T>(init?: T): { current: T };
    function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
    function useMemo<T>(fn: () => T, deps: any[]): T;
    function useContext<T>(ctx: React.Context<T>): T;
    function createContext<T>(def: T): Context<T>;
    function createElement(type: any, props?: any, ...children: any[]): ReactNode;
    function forwardRef<T, P>(fn: (props: P, ref: any) => ReactNode): FC<P & { ref?: any }>;
    function memo<T extends FC<any>>(fn: T): T;
    interface Context<T> { Provider: FC<{ value: T; children?: ReactNode }> }
  }
}

declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react/jsx-dev-runtime' { export const jsxDEV: any; export const Fragment: any; }

declare module 'react-dom' {
  export function render(element: any, container: Element): void;
  export function unmountComponentAtNode(container: Element): boolean;
  export function createPortal(children: any, container: Element): any;
  export const version: string;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element): { render(el: any): void; unmount(): void };
}

declare module '@voiden/sdk/ui' {
  type ThemeTokens = Record<string, Record<string, string>>;
  export interface CorePluginContext {
    /** Open (or focus, if the id is already open) a tab rendering a React component. */
    addTab: (panelId: 'main', tab: { id: string; title: string; icon: string | null; props: Record<string, any>; component?: any }) => void;
    /** Register a tab's component without opening it. Call in onload so open tabs survive plugin reloads. */
    registerPanel: (panelId: 'main', panel: { id: string; title: string; icon?: string; component: any }) => void;
    registerSidebarTab: (side: 'left' | 'right', tab: { id: string; title: string; icon?: string; component: any }) => void;
    registerTopBarItem: (item: { id: string; icon: any; tooltip?: string; position?: 'left' | 'right'; onClick: () => void }) => void;
    registerVoidenExtension: (ext: any) => void;
    addVoidenSlashGroup: (group: any) => void;
    /** Needs the "commandPalette" permission. */
    registerCommand: (cmd: { id: string; label: string; description?: string; action: () => void; [k: string]: any }) => void;
    /** Needs the "contextMenus" permission. */
    registerContextMenu: (opts: any) => void;
    /** Needs the "events" permission. */
    events: { on: (event: string, handler: (...args: any[]) => void) => () => void };
    /** Needs the "filesystem" permission. */
    fs: { read: (p: string) => Promise<string>; write: (p: string, content: string) => Promise<void>; [k: string]: any };
    /** Needs the "settings" permission. */
    settings: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void>; [k: string]: any };
    ui: {
      showToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
      registerSettings: (opts: any) => void;
      [k: string]: any;
    };
    /** Tailwind class names that follow the active Voiden theme, e.g. theme.bg.panel, theme.text.muted. */
    theme: ThemeTokens;
    [key: string]: any;
  }
}

declare module '@voiden/sdk' { export * from '@voiden/sdk/ui'; }

// JSX element types. React's real typings aren't installed (React comes from Voiden at runtime).
declare namespace JSX {
  type Element = any;
  interface IntrinsicElements { [name: string]: any }
  interface IntrinsicAttributes { key?: string | number }
}
`
  );

  // package.json — only vite + typescript needed; @voiden/sdk is shimmed by Voiden at runtime
  // "type": "module" only on a fresh project — merged into an existing package
  // it would flip a CommonJS project to ESM. build.mjs doesn't need it.
  await mergeJson(
    "package.json",
    {
      name: pluginId,
      version: "1.0.0",
      scripts: { build: "node build.mjs" },
      devDependencies: { vite: "^6.0.0", typescript: "^5.0.0" },
    },
    { type: "module" },
  );

  // tsconfig.json
  await put("tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        declaration: true,
        resolveJsonModule: true,
      },
      include: ["src/**/*", "manifest.json"],
    }, null, 2)
  );

  // build.mjs — Vite build, copies manifest.json to dist/
  await put("build.mjs",
`import { build } from 'vite';
import { readFileSync, copyFileSync, mkdirSync } from 'fs';

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'));
const pluginId = manifest.id;

// All packages listed here are provided by Voiden's shim system at runtime.
// They must be externalized — do NOT bundle them.
const VOIDEN_SHIMS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@voiden/sdk',
  '@voiden/sdk/ui',
];

await build({
  // JSX compiles to react/jsx-runtime calls, which Voiden provides.
  esbuild: { jsx: 'automatic' },
  build: {
    lib: {
      entry: './src/plugin.ts',
      formats: ['es'],
      fileName: () => \`\${pluginId}.js\`,
    },
    outDir: './dist',
    rollupOptions: {
      external: VOIDEN_SHIMS,
    },
  },
});

mkdirSync('./dist', { recursive: true });
copyFileSync('./manifest.json', './dist/manifest.json');
console.log(\`Built \${pluginId} → dist/\${pluginId}.js\`);
`
  );

  // changelog.json
  await put("changelog.json",
    JSON.stringify([{
      version: "1.0.0",
      date: new Date().toISOString().split("T")[0],
      changes: ["Initial release"],
    }], null, 2)
  );

  return { pluginId, created, skipped };
}

// ── Templates ───────────────────────────────────────────────────────────────

const PLUGIN_TS = `import type { CorePluginContext } from '@voiden/sdk/ui';
import manifest from '../manifest.json';
import { createWelcomePage, PluginIcon } from './WelcomePage';

// Tabs are de-duplicated by id: opening the welcome tab again just focuses it.
const WELCOME_TAB_ID = manifest.id + '-welcome';
const WELCOMED_KEY = manifest.id + ':welcomed';

export default function create__FN__(context: CorePluginContext) {
  // Created once, so registerPanel and addTab hand Voiden the same component.
  const WelcomePage = createWelcomePage(context, manifest);
  const openWelcome = () =>
    context.addTab('main', {
      id: WELCOME_TAB_ID,
      title: manifest.name,
      icon: 'Rocket', // lucide icon name, shown in the tab bar (matches PluginIcon)
      props: {},
      component: WelcomePage,
    });

  return {
    onload: async () => {
      // Register the welcome tab's component on every load. Voiden clears plugin
      // components whenever plugins reload (live reload, Rebuild), so a tab that's
      // already open would otherwise show "Panel component not available".
      context.registerPanel('main', {
        id: WELCOME_TAB_ID,
        title: manifest.name,
        icon: 'Rocket',
        component: WelcomePage,
      });

      // A button in the top bar that opens the welcome tab.
      context.registerTopBarItem({
        id: manifest.id + '-open',
        icon: PluginIcon,
        tooltip: manifest.name,
        onClick: openWelcome,
      });

      // Show the welcome tab once per session, so you can see the plugin is
      // running. Plugins are reloaded together, so this avoids stealing focus
      // on every reload. Remove it once you've built something of your own.
      if (!sessionStorage.getItem(WELCOMED_KEY)) {
        sessionStorage.setItem(WELCOMED_KEY, '1');
        openWelcome();
      }

      // Register the rest of your plugin here: slash commands, sidebar tabs,
      // commands, event listeners… See README.md for examples.
    },

    onunload: async () => {
      // Clean up subscriptions and listeners here.
    },

    metadata: manifest,
  };
}
`;

const WELCOME_PAGE_TSX = `import { useState } from 'react';
import type { CorePluginContext } from '@voiden/sdk/ui';

type Manifest = { id: string; name: string; version: string; description?: string };

// Colours come from context.theme (Tailwind classes mapped to the active
// Voiden theme), so this page follows light/dark and custom themes.
// Layout uses inline styles so it doesn't depend on which utility classes
// the host app happens to ship.

/** Rocket mark, used for the top-bar button, the tab and the page logo.
 *  (Voiden's plugin dev mode uses a puzzle icon, so the starter uses something else.) */
export function PluginIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

const STEPS = [
  { title: 'Edit this page', body: 'Open src/WelcomePage.tsx and change some text.' },
  { title: 'Save and watch it reload', body: 'With live reload on (the ⚡ in the Plugin Dev toolbar), every save rebuilds and reloads the plugin.' },
  { title: 'Build something real', body: 'Register features in src/plugin.ts. README.md has examples for each API.' },
];

// Feature names only, no API identifiers: the build scans the bundle for API
// names to fill in manifest capabilities. README.md has the matching API calls.
const CAPABILITIES = [
  { feature: 'Slash commands', what: 'Insert your own blocks into .void files' },
  { feature: 'Sidebar tabs', what: 'A panel in the left or right sidebar' },
  { feature: 'Editor tabs', what: 'A full tab rendering a React component, like this one' },
  { feature: 'Command palette', what: 'Actions users can run from the palette', permission: 'commandPalette' },
  { feature: 'Workspace events', what: 'React to tab, file and project changes', permission: 'events' },
  { feature: 'Settings', what: 'A section in Voiden Settings', permission: 'settings' },
];

const join = (...classes: string[]) => classes.join(' ');

export function createWelcomePage(context: CorePluginContext, manifest: Manifest) {
  const t = context.theme;

  return function WelcomePage() {
    const [clicks, setClicks] = useState(0);

    const sayHello = () => {
      const next = clicks + 1;
      setClicks(next);
      context.ui.showToast?.('Hello from ' + manifest.name + '! (' + next + ')', 'success');
    };

    return (
      <div className={join(t.bg.editor, t.text.primary)} style={{ height: '100%', overflowY: 'auto' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
          {/* Hero */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
            <div className={join(t.bg.panel, t.border.DEFAULT, t.text.accent)} style={{ width: 72, height: 72, borderRadius: 18, borderWidth: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PluginIcon size={36} />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{manifest.name}</h1>
              <div className={t.text.muted} style={{ fontSize: 12, marginTop: 4, fontFamily: 'monospace' }}>
                {manifest.id} · v{manifest.version}
              </div>
            </div>
            <p className={t.text.muted} style={{ fontSize: 14, margin: 0 }}>
              {manifest.description || 'Your plugin is loaded and running inside Voiden.'}
            </p>
            <button
              onClick={sayHello}
              className={join(t.button.primary, 'text-white')}
              style={{ marginTop: 4, padding: '6px 14px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer' }}
            >
              Say hello{clicks > 0 ? ' (' + clicks + ')' : ''}
            </button>
          </div>

          {/* Get started */}
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, margin: '40px 0 12px' }} className={t.text.muted}>
            Get started
          </h2>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={join(t.bg.panel, t.border.DEFAULT)} style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'solid' }}>
                <span className={join(t.bg.accent, 'text-black')} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 999, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{step.title}</div>
                  <div className={t.text.muted} style={{ fontSize: 12, marginTop: 2 }}>{step.body}</div>
                </div>
              </li>
            ))}
          </ol>

          {/* What a plugin can do */}
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, margin: '32px 0 12px' }} className={t.text.muted}>
            What a plugin can do
          </h2>
          <div className={t.border.DEFAULT} style={{ borderWidth: 1, borderStyle: 'solid', borderRadius: 8, overflow: 'hidden' }}>
            {CAPABILITIES.map((cap, i) => (
              <div key={cap.feature} className={t.border.DEFAULT} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 12px', borderStyle: 'solid', borderWidth: 0, borderTopWidth: i === 0 ? 0 : 1 }}>
                <span style={{ fontSize: 12, fontWeight: 500, flexShrink: 0, width: 128 }}>{cap.feature}</span>
                <span className={t.text.muted} style={{ fontSize: 12, flex: 1 }}>{cap.what}</span>
                {cap.permission && (
                  <span className={join(t.bg.panel, t.text.muted)} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }} title="Add this to manifest.json permissions">
                    {cap.permission}
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className={t.text.muted} style={{ fontSize: 12, textAlign: 'center', marginTop: 32 }}>
            README.md in your project has the full guide: project layout, the dev loop, permissions and publishing.
          </p>
        </div>
      </div>
    );
  };
}
`;

const README_MD = `# __NAME__

A [Voiden](https://voiden.md) plugin.

## Getting started

1. Open this folder in Voiden.
2. Click the **puzzle icon** in the top bar to turn on **Plugin Dev Mode**. A floating toolbar appears.
3. Press **Run** (▶). Voiden runs \`npm install\` (only when dependencies changed) and \`npm run build\`, then loads the plugin.
4. A welcome tab opens. That's \`src/WelcomePage.tsx\` running inside Voiden.

With **live reload** on (⚡, the default), saving any file in \`src/\` rebuilds and reloads the plugin automatically. **Rebuild** (⟳) does the same on demand. **Stop** (■) unloads the plugin without deleting anything. **Show details** in the toolbar shows each step's log.

You only need Node.js and npm. React and \`@voiden/sdk\` are provided by Voiden at runtime, so they aren't installed from npm.

## Project layout

\`\`\`
manifest.json        Plugin id, name, version and permissions (read by Voiden)
package.json         Build scripts and dev dependencies (vite, typescript)
build.mjs            Builds src/plugin.ts → dist/__ID__.js and copies manifest.json
tsconfig.json
changelog.json       Shown in Voiden's extension details panel
src/
  plugin.ts          Entry point: onload / onunload
  WelcomePage.tsx    Example React component shown in a tab
  voiden.d.ts        Type stubs for the APIs Voiden injects at runtime
\`\`\`

## How a plugin works

\`src/plugin.ts\` default-exports a function. Voiden calls it with a \`context\` object and expects \`onload\`, \`onunload\` and \`metadata\` back:

\`\`\`ts
export default function createPlugin(context: CorePluginContext) {
  return {
    onload: async () => { /* register things */ },
    onunload: async () => { /* clean up */ },
    metadata: manifest,
  };
}
\`\`\`

Everything your plugin adds to Voiden goes through \`context\`.

## Examples

### A tab with a React component

\`\`\`tsx
context.addTab('main', {
  id: 'my-plugin-tab',          // same id = focus the existing tab
  title: 'My Tab',
  icon: 'Rocket',                // lucide icon name (or an icon component), shown on the tab
  props: {},
  component: MyComponent,
});
\`\`\`

Open tabs survive a plugin reload (live reload, Rebuild), but their components don't. Register the component in \`onload\` as well, with the same id, so an open tab keeps rendering instead of showing "Panel component not available":

\`\`\`ts
context.registerPanel('main', { id: 'my-plugin-tab', title: 'My Tab', icon: 'Rocket', component: MyComponent });
\`\`\`

### A sidebar tab

\`\`\`ts
context.registerSidebarTab('right', {
  id: 'my-plugin-sidebar',
  title: 'My Panel',
  icon: 'Rocket',               // any lucide-react icon name
  component: MyPanel,
});
\`\`\`

### A top-bar button

\`\`\`ts
context.registerTopBarItem({
  id: 'my-plugin-button',
  icon: MyIcon,                 // a React component
  tooltip: 'Do the thing',
  onClick: () => context.ui.showToast?.('Done!', 'success'),
});
\`\`\`

### Slash commands in .void files

\`\`\`ts
context.addVoidenSlashGroup({
  name: 'my-plugin',
  title: 'My Plugin',
  commands: [
    {
      name: 'hello',
      slash: '/hello',
      label: 'Insert hello',
      description: 'Insert a hello paragraph',
      action: (editor) => editor.chain().focus().insertContent('Hello!').run(),
    },
  ],
});
\`\`\`

### Command palette (needs the \`commandPalette\` permission)

\`\`\`ts
context.registerCommand({
  id: 'my-plugin.say-hello',
  label: 'My Plugin: Say hello',
  action: () => context.ui.showToast?.('Hello!', 'info'),
});
\`\`\`

### Workspace events (needs the \`events\` permission)

\`\`\`ts
const off = context.events.on('tab:changed', ({ tabId }) => console.log(tabId));
// call off() in onunload
\`\`\`

### Theme-aware styling

\`context.theme\` holds class names that follow the user's theme, for example \`context.theme.bg.panel\`, \`context.theme.text.muted\` and \`context.theme.button.primary\`. Use them instead of hard-coded colours. \`src/WelcomePage.tsx\` shows them in use.

## Permissions

Some APIs only work when listed in \`manifest.json\` under \`permissions\`:

| Permission | Unlocks |
|---|---|
| \`commandPalette\` | \`context.registerCommand\` |
| \`contextMenus\` | \`context.registerContextMenu\` |
| \`events\` | \`context.events.on\` |
| \`filesystem\` | \`context.fs.*\` (files in the active project) |
| \`settings\` | \`context.ui.registerSettings\`, \`context.settings.*\` |

\`\`\`json
"permissions": ["commandPalette", "events"]
\`\`\`

## Building

\`\`\`sh
npm install
npm run build
\`\`\`

This writes \`dist/__ID__.js\` and \`dist/manifest.json\`.

## Publishing

1. Push this project to a public GitHub repository.
2. Bump \`version\` in \`manifest.json\` and \`package.json\`, and add an entry to \`changelog.json\`.
3. Run \`npm run build\`, then create a GitHub release with these files as assets:
   - \`dist/__ID__.js\`
   - \`dist/manifest.json\`
   - \`changelog.json\` (optional, shown in the details panel)
4. Open a pull request to the [Voiden plugin registry](https://github.com/VoidenHQ/plugin-registry) adding a \`"type": "community"\` entry that points at your repository.

Once the entry is merged, your plugin shows up in Voiden's Extensions panel.
`;
