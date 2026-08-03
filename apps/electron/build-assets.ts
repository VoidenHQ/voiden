/// <reference path="./forge.env.d.ts" />

/**
 * build-assets.ts
 * 
 * Programmatically builds the Electron Vite assets (main, preload, and renderer) 
 * for production offline. By triggering Vite's build API directly, we completely 
 * bypass the network-bound 'electron-forge package' and 'electron-rebuild' phases 
 * which fail in sandboxed Nix environments.
 * 
 * To compile this file and run it safely across all environments, we bundle it with 
 * esbuild as a CommonJS module, which automatically provides standard Node.js globals 
 * like __dirname to the bundle.
 */

import { build } from 'vite';
import type { ConfigEnv } from 'vite';
import path from 'path';

import mainConfigFn from './vite.main.config';
import preloadConfigFn from './vite.preload.config';
import rendererConfigFn from './vite.renderer.config';

// Define type-safe environments extending Vite's ConfigEnv to satisfy 
// TypeScript structural subtyping requirements without type assertions.
interface CustomMainEnv extends ConfigEnv {
  root: string;
  forgeConfig: VitePluginConfig;
  forgeConfigSelf: VitePluginConfig['build'][number];
}

interface CustomPreloadEnv extends ConfigEnv {
  root: string;
  forgeConfig: VitePluginConfig;
  forgeConfigSelf: VitePluginConfig['build'][number];
}

interface CustomRendererEnv extends ConfigEnv {
  root: string;
  forgeConfig: VitePluginConfig;
  forgeConfigSelf: VitePluginConfig['renderer'][number];
}

async function run() {
  const root = __dirname;

  // Forge normally hands every build target (main, preload, renderer) the
  // same full plugin config, including the renderer list — vite.base.config's
  // getBuildDefine() reads forgeConfig.renderer to generate the
  // <NAME>_VITE_DEV_SERVER_URL / <NAME>_VITE_NAME globals main.ts (window.ts)
  // references at runtime. Leaving it empty for main/preload here meant those
  // globals were never defined, so referencing them threw a ReferenceError as
  // soon as a window was created.
  const rendererTargets = [{ name: 'main_window', config: 'vite.renderer.config.ts' }];

  // Main
  const mainEnv: CustomMainEnv = {
    command: 'build',
    mode: 'production',
    root: '',
    forgeConfig: {
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts' }
      ],
      renderer: rendererTargets
    },
    forgeConfigSelf: { entry: 'src/main.ts', config: 'vite.main.config.ts' }
  };
  console.log('Building main process...');
  const mainConfig = mainConfigFn(mainEnv);
  await build(mainConfig);

  // Preload
  const preloadEnv: CustomPreloadEnv = {
    command: 'build',
    mode: 'production',
    root: '',
    forgeConfig: {
      build: [
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts' }
      ],
      renderer: rendererTargets
    },
    forgeConfigSelf: { entry: 'src/preload.ts', config: 'vite.preload.config.ts' }
  };
  console.log('Building preload script...');
  const preloadConfig = preloadConfigFn(preloadEnv);
  await build(preloadConfig);

  // Renderer (main_window)
  const rendererEnv: CustomRendererEnv = {
    command: 'build',
    mode: 'production',
    root,
    forgeConfig: {
      build: [],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' }
      ]
    },
    forgeConfigSelf: { name: 'main_window', config: 'vite.renderer.config.ts' }
  };
  console.log('Building renderer process...');
  const rendererConfig = rendererConfigFn(rendererEnv);
  await build(rendererConfig);

  console.log('Build completed successfully!');
}

run().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
