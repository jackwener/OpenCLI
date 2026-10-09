/** Plugin runtime paths must resolve package imports against the running host. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';

export function resolveHostOpencliRoot(startFile = fileURLToPath(import.meta.url)): string {
  let dir = path.dirname(startFile);

  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg?.name === '@jackwener/opencli') {
          return dir;
        }
      } catch {
        // Keep walking; a malformed package.json should not hide an ancestor package root.
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`Could not resolve the host OpenCLI package root from ${startFile}.`);
}

export function linkHostOpencli(pluginDir: string): boolean {
  try {
    const hostRoot = resolveHostOpencliRoot();
    const targetLink = path.join(pluginDir, 'node_modules', '@jackwener', 'opencli');

    if (fs.existsSync(targetLink)) {
      fs.rmSync(targetLink, { recursive: true, force: true });
    }

    fs.mkdirSync(path.dirname(targetLink), { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(hostRoot, targetLink, linkType);
    log.debug(`Linked host opencli into plugin: ${targetLink} → ${hostRoot}`);
    return true;
  } catch (err) {
    log.warn(`Failed to link host opencli into plugin: ${getErrorMessage(err)}`);
    return false;
  }
}
