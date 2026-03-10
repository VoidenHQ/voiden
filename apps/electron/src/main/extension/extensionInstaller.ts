interface ReleaseAsset {
  name: string;
  browser_download_url: string;
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

export async function getExtensionFiles(repo: string, version: string): Promise<{ manifest: string; main: string }> {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/v${version}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch release info: ${response.status}`);
  }

  const releaseInfo = await response.json();
  const assets: ReleaseAsset[] = releaseInfo.assets;

  const manifestAsset = assets.find((asset) => asset.name === "manifest.json");
  const mainAsset = assets.find((asset) => asset.name === "main.js");

  if (!manifestAsset || !mainAsset) {
    throw new Error("Required files not found in release assets");
  }

  const [manifestResponse, mainResponse] = await Promise.all([
    fetch(manifestAsset.browser_download_url),
    fetch(mainAsset.browser_download_url),
  ]);

  const [manifest, main] = await Promise.all([manifestResponse.text(), mainResponse.text()]);

  return { manifest, main };
}
