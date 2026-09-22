import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vite';
import { getBuildConfig, getBuildDefine, external, pluginHotRestart } from './vite.base.config';

// Builds src/voiden-cli.ts (the `voiden agent`/`run`/`mcp-stdio` command
// surface) into .vite/build/voiden-cli.js — same output directory as
// main.js/preload.js, so it ends up inside app.asar at a predictable,
// asar-transparent-require-friendly path instead of as a separate
// extraResource outside the archive. bin/voiden (and bin/voiden.cmd)
// dispatch straight to that in-asar path via
// `ELECTRON_RUN_AS_NODE=1 <electron binary> <path> <args>`.
//
// Mirrors vite.main.config.ts exactly: real npm dependencies (commander,
// @modelcontextprotocol/sdk, and everything @voiden/runner itself pulls in
// — chalk, nodemailer, yaml, zod, @grpc/proto-loader) stay external,
// resolved from the packaged app's own node_modules at runtime, same as
// main.js already does for its own dependencies. Only @voiden/runner and
// @voiden/executors get bundled — see vite.base.config.ts's own comment on
// `workspacePackages` for why (workspace symlink + ESM-only export
// condition, both fatal to an external require() here).
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>;
  const { forgeConfigSelf } = forgeEnv;
  const define = getBuildDefine(forgeEnv);
  const config: UserConfig = {
    build: {
      lib: {
        entry: forgeConfigSelf.entry!,
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: {
        external,
      },
    },
    plugins: [pluginHotRestart('restart')],
    define,
    resolve: {
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
