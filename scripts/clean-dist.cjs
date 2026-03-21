/**
 * Remove dist/ before a fresh build so deleted adapters do not leave stale
 * compiled files behind in dist/clis/.
 */
const { existsSync, rmSync } = require('fs');

if (existsSync('dist')) {
  rmSync('dist', { recursive: true, force: true });
}

if (existsSync('tsconfig.tsbuildinfo')) {
  rmSync('tsconfig.tsbuildinfo', { force: true });
}
