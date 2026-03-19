/**
 * Auto-generated main-process plugin map
 * DO NOT EDIT MANUALLY - run 'yarn generate-registry' to update
 * Generated on: 2026-03-04T19:37:08.178Z
 */

import voiden_advanced_authMainPlugin from './voiden-advanced-auth/main-process';
import voiden_scriptingMainPlugin from './voiden-scripting/main-process';

// Main-process plugin map (for Electron main process)
export const coreMainProcessPlugins: Record<string, any> = {
  'voiden-advanced-auth': voiden_advanced_authMainPlugin,
  'voiden-scripting': voiden_scriptingMainPlugin,
};
