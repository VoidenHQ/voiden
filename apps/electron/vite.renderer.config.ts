import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig } from "vite";
import { pluginExposeRenderer } from "./vite.base.config";
import path from "path";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<"renderer">;
  const { root, mode, forgeConfigSelf } = forgeEnv;
  const name = forgeConfigSelf.name ?? "";

  return {
    root,
    mode,
    base: "./",
    build: {
      outDir: `.vite/renderer/${name}`,
      rollupOptions: {
        output: {
          format: "es",
        },
      },
    },
    plugins: [pluginExposeRenderer(name), nodePolyfills()],
    resolve: {
      preserveSymlinks: false,
      alias: {
        "@": path.resolve(__dirname, "../ui/src"),
        "voiden-wrapper": path.resolve(__dirname, "../../packages/voiden-wrapper/dist"),
      },
    },
    optimizeDeps: {
      exclude: [

        '@voiden/sdk',
        '@tiptap/core',
        '@tiptap/react',
        '@tiptap/pm',
      ],
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'lodash',
        'prosemirror-model',
        'markdown-it',
      ],
    },
    server: {
      fs: {
        strict: false,
      },
      watch: {
        // Prevent Vite from adding community/core plugin files to its HMR watch
        // graph. Without this, importing a plugin via absolute path (before the
        // Blob URL fix) would cause a full-page reload on the next file write
        // (e.g. reinstall). The Blob URL loader already bypasses Vite, but this
        // is defense-in-depth for any edge case where a path leaks through.
        ignored: [
          '**/plugins/community/**',
          '**/plugins/core/**',
        ],
      },
    },
    clearScreen: false,
    css: {
      postcss: {
        plugins: [
          tailwindcss({
            config: path.resolve(__dirname, "../ui/tailwind.config.js"),
          }),
          autoprefixer(),
        ],
      },
    },
  } as UserConfig;
});
