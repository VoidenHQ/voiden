import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import pkg from "./package.json";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  root: "apps/ui",
  base: process.env.VITE_BASE_PATH,
  envDir: "../../",
  cacheDir: "node_modules/.vite",
  plugins: [
    react(),
    TanStackRouterVite(),
    nodePolyfills(),
    // sentryVitePlugin({
    //   authToken: process.env.SENTRY_AUTH_TOKEN,
    //   org: "apyhub",
    //   project: "javascript-react",
    // }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@voiden/core-extensions": path.resolve(__dirname, "../../packages/core-extensions/src"),
      "@voiden/sdk": path.resolve(__dirname, "../../packages/sdk/src"),
      "@voiden/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Enable following symlinks to watch workspace dependencies
      followSymlinks: true,
    },
  },
  envPrefix: ["VITE_"],

  optimizeDeps: {
    exclude: [
      "js-big-decimal",
      // Exclude workspace packages to ensure fresh builds
      "@voiden/core-extensions",
      "@voiden/fuzzy-search",
      "@voiden/sdk",
      "@voiden/shared",
    ],
    // Force re-optimization on every start in development
    force: process.env.NODE_ENV !== 'production',
    // Explicitly include entries to ensure proper resolution
    entries: [
      './src/**/*.{ts,tsx}',
      '../../packages/**/*.{ts,tsx}',
    ],
  },

  build: {
    // Ensure workspace dependencies are always rebuilt
    commonjsOptions: {
      include: [/node_modules/, /packages/],
    },
  },
}));
