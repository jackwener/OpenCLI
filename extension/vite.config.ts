import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        offscreen: resolve(__dirname, 'src/offscreen.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
  },
});
