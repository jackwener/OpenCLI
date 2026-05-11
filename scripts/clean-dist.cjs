/**
 * Remove dist/ before a fresh build so deleted source modules do not leave
 * stale compiled files behind.
 */
const { existsSync, rmSync } = require('fs');

if (existsSync('dist')) {
  rmSync('dist', { recursive: true, force: true });
}

if (existsSync('tsconfig.tsbuildinfo')) {
  rmSync('tsconfig.tsbuildinfo', { force: true });
}
