import { build } from 'esbuild';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const manifestPath = join(__dirname, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const outDir = join(__dirname, 'dist');
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const SHIMS = {
  react: `
const _s = window.__voiden_shims__['react'];
export default _s;
export const { useState, useEffect, useCallback, useMemo, useRef, useContext,
  createContext, forwardRef, memo, Fragment, createElement, cloneElement,
  Children, StrictMode, Suspense, lazy, isValidElement, Component,
  PureComponent, createRef, startTransition, useReducer, useLayoutEffect,
  useImperativeHandle, useDebugValue, useTransition, useDeferredValue, useId } = _s;`,

  'react-dom': `
const _s = window.__voiden_shims__['react-dom'];
export default _s;
export const { createPortal, flushSync, render, unmountComponentAtNode } = _s;`,

  'react/jsx-runtime': `
const _s = window.__voiden_shims__['react/jsx-runtime'];
export const jsx = _s.jsx;
export const jsxs = _s.jsxs;
export const Fragment = _s.Fragment;`,

  'react-dom/client': `
const _s = window.__voiden_shims__['react-dom/client'];
export default _s;
export const { createRoot, hydrateRoot } = _s;`,

  '@voiden/sdk/ui': `
export default {};`,

  'lucide-react': `
const _s = window.__voiden_shims__['lucide-react'] || {};
export default _s;
export const { AlertCircle, Check, Copy, ChevronDown, ChevronRight, Search, Plus, Trash2, GitCompare, Activity } = _s;`,
};

const shimPlugin = {
  name: 'voiden-shims',
  setup(build) {
    for (const [pkg, code] of Object.entries(SHIMS)) {
      const filter = new RegExp(`^${pkg.replace('/', '\\/')}$`);
      build.onResolve({ filter }, () => ({ path: pkg, namespace: 'shim' }));
      build.onLoad({ filter: /.*/, namespace: 'shim' }, (args) => {
        if (SHIMS[args.path]) {
          return { contents: SHIMS[args.path], loader: 'js' };
        }
      });
    }
  },
};

const banner = `export const __voiden_bundle_version__ = 2;\nexport const __voiden_manifest__ = ${JSON.stringify(manifest)};\n`;

await build({
  entryPoints: [join(__dirname, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  outfile: join(outDir, 'schema-drift-detector.js'),
  minify: true,
  banner: { js: banner },
  plugins: [shimPlugin],
  jsx: 'automatic',
});

console.log('✓ Successfully built plugins/schema-drift-detector/dist/schema-drift-detector.js');
