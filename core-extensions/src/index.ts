/**
 * @voiden/core-extensions
 *
 * Core extensions bundled with Voiden
 */

// Export metadata-only registry (safe for Electron main process - no React/DOM)
export * from './registry';

// Export plugin map (for UI only - has React/DOM dependencies)
export * from './plugins';

// Main-process plugin map is exported via "./main" subpath (not here)
// to avoid pulling Node.js-only deps (undici) into the renderer bundle.

// Export core extension modules
export { default as mdPreviewPlugin } from './md-preview';
export { default as postmanImportPlugin } from './postman-import';
export { default as openapiImportPlugin } from './openapi-import';
export { default as simpleAssertionsPlugin } from './simple-assertions';
export { default as createSocketPlugin } from './voiden-sockets';
export { default as createGraphQLPlugin } from './voiden-graphql';
export { default as voidenScriptingPlugin } from './voiden-scripting';

// Export REST API utilities (consolidated in voiden-rest-api)
export * from './voiden-rest-api';
export { VoidenRestApiExtension } from './voiden-rest-api';

