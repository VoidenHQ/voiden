import * as https from "https";
import { app } from "electron";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

// Use Node.js https instead of fetch() to avoid crashing Chromium's network service.
function httpsGetText(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      headers: {
        'User-Agent': `Voiden/${app.getVersion()} (${process.platform}; ${process.arch})`,
        'Accept': 'application/vnd.github.v3+json',
      },
    };
    function doGet(u: string, redirects: number) {
      https.get(u, reqOptions, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects <= 0) { reject(new Error('Too many redirects')); return; }
          doGet(res.headers.location, redirects - 1);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    }
    doGet(url, maxRedirects);
  });
}

// All bare specifiers the Voiden runtime guarantees to provide via window.__voiden_shims__
const SUPPORTED_BARE_IMPORTS = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@voiden/sdk",
  "@voiden/sdk/ui",
]);

// Order matters: most-specific specifiers first to avoid partial string matches
const SHIM_MAP: Array<[specifier: string, file: string]> = [
  ["react/jsx-dev-runtime", "__voiden_shim_react_jsx_dev_runtime__.js"],
  ["react/jsx-runtime",     "__voiden_shim_react_jsx_runtime__.js"],
  ["react-dom/client",      "__voiden_shim_react_dom_client__.js"],
  ["react-dom",             "__voiden_shim_react_dom__.js"],
  ["react",                 "__voiden_shim_react__.js"],
  ["@voiden/sdk/ui",        "__voiden_shim_sdk_ui__.js"],
  ["@voiden/sdk",           "__voiden_shim_sdk__.js"],
];

function getBareImports(source: string): string[] {
  const found = new Set<string>();
  // Match only real ESM import/export…from lines (anchored to line start, no newline crossing)
  const re = /^(?:import|export)[^\n'"]*\bfrom\b\s*['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(re)) {
    const s = m[1];
    if (!s.startsWith(".") && !s.startsWith("/") && !/^[a-z][a-z0-9+\-.]*:/.test(s)) {
      found.add(s);
    }
  }
  return [...found];
}

function rewriteBareImports(source: string): string {
  let result = source;
  for (const [specifier, shimFile] of SHIM_MAP) {
    // Escape regex special chars in specifier (handles @voiden/sdk etc.)
    const escaped = specifier.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
    result = result
      .replace(new RegExp(`'${escaped}'`, "g"), `'./${shimFile}'`)
      .replace(new RegExp(`"${escaped}"`, "g"), `"./${shimFile}"`);
  }
  return result;
}

function createShimSources(bareImports: string[]): Record<string, string> {
  const shims: Record<string, string> = {};

  if (bareImports.includes("react")) {
    shims["__voiden_shim_react__.js"] = `\
const m = window.__voiden_shims__?.["react"];
export default m?.default ?? m;
export const {
  Children, Component, Fragment, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef,
  forwardRef, isValidElement, lazy, memo, startTransition,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect,
  useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useReducer, useRef, useState, useSyncExternalStore, useTransition,
} = m;
`;
  }

  if (bareImports.includes("react/jsx-runtime")) {
    shims["__voiden_shim_react_jsx_runtime__.js"] = `\
const m = window.__voiden_shims__?.["react/jsx-runtime"];
export const { Fragment, jsx, jsxs } = m;
`;
  }

  if (bareImports.includes("react/jsx-dev-runtime")) {
    shims["__voiden_shim_react_jsx_dev_runtime__.js"] = `\
const m = window.__voiden_shims__?.["react/jsx-runtime"];
export const { Fragment } = m;
export const jsx = m?.jsx;
export const jsxs = m?.jsxs;
export const jsxDEV = m?.jsxDEV ?? m?.jsx;
`;
  }

  if (bareImports.includes("react-dom")) {
    shims["__voiden_shim_react_dom__.js"] = `\
const m = window.__voiden_shims__?.["react-dom"];
export default m?.default ?? m;
export const { createPortal, findDOMNode, flushSync, render, unmountComponentAtNode } = m;
`;
  }

  if (bareImports.includes("react-dom/client")) {
    shims["__voiden_shim_react_dom_client__.js"] = `\
const m = window.__voiden_shims__?.["react-dom/client"];
export const { createRoot, hydrateRoot } = m;
`;
  }

  // SDK imports are type-only at runtime — empty shims are fine
  if (bareImports.includes("@voiden/sdk/ui")) {
    shims["__voiden_shim_sdk_ui__.js"] = `export default {};\n`;
  }
  if (bareImports.includes("@voiden/sdk")) {
    shims["__voiden_shim_sdk__.js"] = `export default {};\n`;
  }

  return shims;
}

export function prepareExtensionMain(main: string): { main: string; extraFiles: Record<string, string> } {
  const bareImports = getBareImports(main);
  const unsupported = bareImports.filter((s) => !SUPPORTED_BARE_IMPORTS.has(s));

  if (unsupported.length > 0) {
    throw new Error(
      `Extension has unsupported bare imports: ${unsupported.join(", ")}. ` +
        `Bundle all dependencies into main.js, or check the Voiden extension development guide.`,
    );
  }

  return {
    main: rewriteBareImports(main),
    extraFiles: createShimSources(bareImports),
  };
}

export async function getExtensionFiles(
  repo: string,
  version: string
): Promise<{ manifest: string; main: string; skill?: string }> {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/v${version}`;
  const releaseRaw = await httpsGetText(apiUrl);
  const releaseInfo = JSON.parse(releaseRaw);
  const assets: ReleaseAsset[] = releaseInfo.assets;

  const manifestAsset = assets.find((asset) => asset.name === "manifest.json");
  const mainAsset = assets.find((asset) => asset.name === "main.js");

  if (!manifestAsset || !mainAsset) {
    throw new Error("Required files not found in release assets");
  }

  const [manifest, main] = await Promise.all([
    httpsGetText(manifestAsset.browser_download_url),
    httpsGetText(mainAsset.browser_download_url),
  ]);

  // Attempt to fetch skill.md — best-effort, optional
  let skill: string | undefined;
  const skillAsset = assets.find((asset) => asset.name === "skill.md");
  if (skillAsset) {
    try {
      skill = await httpsGetText(skillAsset.browser_download_url);
    } catch {
      // skill.md is optional — continue without it
    }
  }

  return { manifest, main, skill };
}
