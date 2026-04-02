import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig, mergeConfig } from "vite";
import { getBuildConfig, external } from "./vite.base.config";

// Build config for the fileWatcher.worker.ts UtilityProcess script.
// Mirrors vite.main.config.ts but without hot-restart or renderer defines
// since the worker process is not the main Electron entry point.
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<"build">;
  const config: UserConfig = {
    build: {
      lib: {
        entry: forgeEnv.forgeConfigSelf.entry!,
        fileName: () => "[name].js",
        formats: ["cjs"],
      },
      rollupOptions: {
        external,
      },
    },
    resolve: {
      mainFields: ["module", "jsnext:main", "jsnext"],
    },
  };
  return mergeConfig(getBuildConfig(forgeEnv), config);
});
