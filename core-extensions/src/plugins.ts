/**
 * Auto-generated plugin map
 * DO NOT EDIT MANUALLY - run 'yarn generate-registry' to update
 * Generated on: 2026-03-04T19:37:08.178Z
 */

import voiden_rest_apiPlugin from './voiden-rest-api';
import voiden_graphqlPlugin from './voiden-graphql';
import simple_assertionsPlugin from './simple-assertions';
import voiden_advanced_authPlugin from './voiden-advanced-auth';
import voiden_socketsPlugin from './voiden-sockets';
import voiden_scriptingPlugin from './voiden-scripting';
import voiden_fakerPlugin from './voiden-faker';
import md_previewPlugin from './md-preview';
import openapi_importPlugin from './openapi-import';
import postman_importPlugin from './postman-import';

// Plugin map for UI app (has React/DOM access)
export const coreExtensionPlugins: Record<string, any> = {
  'voiden-rest-api': voiden_rest_apiPlugin,
  'voiden-graphql': voiden_graphqlPlugin,
  'simple-assertions': simple_assertionsPlugin,
  'voiden-advanced-auth': voiden_advanced_authPlugin,
  'voiden-sockets-grpcs': voiden_socketsPlugin,
  'voiden-scripting': voiden_scriptingPlugin,
  'voiden-faker': voiden_fakerPlugin,
  'md-preview': md_previewPlugin,
  'openapi-import': openapi_importPlugin,
  'postman-import': postman_importPlugin
};
