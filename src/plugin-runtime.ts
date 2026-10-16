/** Plugin runtime paths must resolve package imports against the running host. */

import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
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
  let stagedLink: string | undefined;
  try {
    const hostRoot = resolveHostOpencliRoot();
    const targetLink = path.join(pluginDir, 'node_modules', '@jackwener', 'opencli');
    const current = fs.lstatSync(targetLink, { throwIfNoEntry: false });
    if (current?.isSymbolicLink()) {
      try {
        if (fs.realpathSync(targetLink) === fs.realpathSync(hostRoot)) return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }

    fs.mkdirSync(path.dirname(targetLink), { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    stagedLink = `${targetLink}.host-${randomUUID()}`;
    fs.symlinkSync(hostRoot, stagedLink, linkType);
    // rename replaces stale or dangling symlinks without an unlink window.
    // A real npm-installed directory needs a one-time migration first.
    if (current?.isDirectory() && !current.isSymbolicLink()) {
      fs.rmSync(targetLink, { recursive: true, force: true });
    }
    try {
      fs.renameSync(stagedLink, targetLink);
    } catch (err) {
      // Another process may have published the same link on platforms that
      // do not allow rename to replace a junction. Never unlink a live link.
      if (fs.realpathSync(targetLink) !== fs.realpathSync(hostRoot)) throw err;
    }
    log.debug(`Linked host opencli into plugin: ${targetLink} → ${hostRoot}`);
    return true;
  } catch (err) {
    log.warn(`Failed to link host opencli into plugin: ${getErrorMessage(err)}`);
    return false;
  } finally {
    if (stagedLink) fs.rmSync(stagedLink, { force: true });
  }
}
