/**
 * Single source of truth for package version.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev: __dirname is src/ (one level to root).
// Prod: __dirname is dist/src/ (two levels to root).
let _pkgDir = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(_pkgDir, 'package.json'))) {
  _pkgDir = path.resolve(_pkgDir, '..');
}
const pkgJsonPath = path.join(_pkgDir, 'package.json');

export const PKG_VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).version;
  } catch {
    return '0.0.0';
  }
})();
