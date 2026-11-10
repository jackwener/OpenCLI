import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const compatRange: string = pkg.opencli?.compatRange ?? '>=0.0.0';

const BUILD_ID_PLACEHOLDER = '__OPENCLI_BUILD_ID_PLACEHOLDER__';

// Stamps background.js with a hash of its own code (taken with the placeholder
// in place) and writes the same value to dist/build-id.txt. The CLI compares the
// two to tell whether a browser still runs an older build than the one on disk.
function buildIdStamp(): Plugin {
  return {
    name: 'opencli-build-id',
    generateBundle(_options, bundle) {
      const chunk = bundle['background.js'];
      if (!chunk || chunk.type !== 'chunk') throw new Error('build-id: background.js chunk missing');
      if (!chunk.code.includes(BUILD_ID_PLACEHOLDER)) throw new Error('build-id: placeholder missing from background.js');
      const buildId = createHash('sha256').update(chunk.code).digest('hex').slice(0, 16);
      chunk.code = chunk.code.split(BUILD_ID_PLACEHOLDER).join(buildId);
      this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: `${buildId}\n` });
    },
  };
}

export default defineConfig({
  define: {
    __OPENCLI_COMPAT_RANGE__: JSON.stringify(compatRange),
    __OPENCLI_BUILD_ID__: JSON.stringify(BUILD_ID_PLACEHOLDER),
  },
  plugins: [buildIdStamp()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/background.ts'),
      output: {
        entryFileNames: 'background.js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
  },
});
