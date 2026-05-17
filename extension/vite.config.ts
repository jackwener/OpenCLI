import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const compatRange: string = pkg.opencli?.compatRange ?? '>=0.0.0';

export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox';

  return {
    define: {
      __OPENCLI_COMPAT_RANGE__: JSON.stringify(compatRange),
      __OPENCLI_FIREFOX__: JSON.stringify(isFirefox),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/background.ts'),
        output: {
          entryFileNames: 'background.js',
          // Firefox event page uses IIFE format (no ES module support in background scripts)
          // Chrome service worker uses ES module format
          format: isFirefox ? 'iife' : 'es',
        },
      },
      target: isFirefox ? 'es2022' : 'esnext',
      minify: false,
    },
  };
});
