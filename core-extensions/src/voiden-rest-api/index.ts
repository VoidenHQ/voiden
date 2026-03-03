/**
 * Voiden REST API Extension
 *
 * Entry point for the REST API extension
 */

export { VoidenRestApiExtension } from './extension';

// Export converter utilities for other extensions
export * from './lib/converter';
export { restApiSlashGroup } from './lib/slashCommands';

// Export request population utilities
export * from './lib/requestPopulator';

// Export parser utilities
export * from './lib/parser/types';
export { convert as convertCurlToRequest } from './lib/parser/importers/curl';

// Export utilities
export * from './lib/utils';

// Export curl paste utilities
export { handleCurl, pasteCurl } from './nodes/curlPaste';

// Export plugin adapter for legacy plugin system (default export)
export { default } from './plugin';
