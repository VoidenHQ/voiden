import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment:'jsdom',
    include: ['src/__test__/*.test.ts','src/**/__test__/*.test.ts'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    setupFiles: [],
    server: {
      deps: {
        inline: [
          '@voiden/sdk',

          '@voiden/shared',
        ],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@voiden/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
});
