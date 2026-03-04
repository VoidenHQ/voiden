/**
 * Main-process entry point for @voiden/core-extensions
 *
 * Import via "@voiden/core-extensions/main" — only used by the Electron main process.
 * Separated from the default export to avoid pulling Node.js-only deps into the renderer.
 */
export * from './main-plugins';
