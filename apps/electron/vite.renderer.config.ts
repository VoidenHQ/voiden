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
      preserveSymlinks: false, // Allow Vite to follow symlinks for workspace packages
      alias: {
        "@": path.resolve(__dirname, "../ui/src"),
        "voiden-wrapper": path.resolve(__dirname, "../../packages/voiden-wrapper/dist"),
      },
    },
    optimizeDeps: {
      exclude: [
        '@voiden/core-extensions',
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
        // xlsx-js-style is CJS — pre-bundle it explicitly so it exposes a default export
        'xlsx-js-style',
      ],
    },
    server: {
      fs: {
        strict: false,
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
