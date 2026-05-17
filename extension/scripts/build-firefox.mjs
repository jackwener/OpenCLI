/**
 * Build Firefox extension into a self-contained directory.
 *
 * Output: extension/dist-firefox/
 *   - manifest.json       (Firefox MV3 manifest)
 *   - dist/background.js  (IIFE format)
 *   - popup.html
 *   - popup.js
 *   - icons/
 *
 * Load this directory in Firefox via about:debugging → Load Temporary Add-on.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, '..');
const outDir = path.join(extensionDir, 'dist-firefox');

async function main() {
  // 1. Build with Vite in Firefox mode (outputs to dist/)
  console.log('Building extension for Firefox...');
  execSync('npx vite build --mode firefox', {
    cwd: extensionDir,
    stdio: 'inherit',
  });

  // 2. Create output directory
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  // 3. Copy Firefox manifest as manifest.json
  await fs.copyFile(
    path.join(extensionDir, 'manifest.firefox.json'),
    path.join(outDir, 'manifest.json'),
  );

  // 4. Copy dist/background.js
  await fs.mkdir(path.join(outDir, 'dist'), { recursive: true });
  await fs.copyFile(
    path.join(extensionDir, 'dist', 'background.js'),
    path.join(outDir, 'dist', 'background.js'),
  );

  // 5. Copy popup files
  await fs.copyFile(
    path.join(extensionDir, 'popup.html'),
    path.join(outDir, 'popup.html'),
  );
  await fs.copyFile(
    path.join(extensionDir, 'popup.js'),
    path.join(outDir, 'popup.js'),
  );

  // 6. Copy icons directory
  await fs.cp(
    path.join(extensionDir, 'icons'),
    path.join(outDir, 'icons'),
    { recursive: true },
  );

  console.log(`\nFirefox extension built at: ${outDir}`);
  console.log('\nTo load in Firefox:');
  console.log('  1. Open about:debugging#/runtime/this-firefox');
  console.log('  2. Click "临时载入附加组件..."');
  console.log(`  3. Select: ${path.join(outDir, 'manifest.json')}`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
