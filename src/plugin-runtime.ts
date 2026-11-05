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

// Rename failures that mean "the destination exists and cannot be replaced".
// Windows refuses to rename over a directory junction (EPERM/EACCES); other
// platforms report a non-empty or existing destination.
const REPLACE_REFUSED = new Set(['EPERM', 'EACCES', 'EEXIST', 'ENOTEMPTY', 'EISDIR']);

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Remove a link itself. unlink never follows a symlink or junction into the host package. */
function removeLink(linkPath: string): void {
  try {
    fs.unlinkSync(linkPath);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err;
  }
}

export function linkHostOpencli(pluginDir: string): boolean {
  let stagedLink: string | undefined;
  let staleLink: string | undefined;
  try {
    const hostRoot = resolveHostOpencliRoot();
    const hostRealpath = fs.realpathSync(hostRoot);
    const targetLink = path.join(pluginDir, 'node_modules', '@jackwener', 'opencli');
    const resolvesToHost = (): boolean => {
      try {
        return fs.realpathSync(targetLink) === hostRealpath;
      } catch (err) {
        if (errorCode(err) === 'ENOENT') return false;
        throw err;
      }
    };
    const current = fs.lstatSync(targetLink, { throwIfNoEntry: false });
    if (current?.isSymbolicLink() && resolvesToHost()) return true;

    fs.mkdirSync(path.dirname(targetLink), { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    stagedLink = `${targetLink}.host-${randomUUID()}`;
    fs.symlinkSync(hostRoot, stagedLink, linkType);
    // A real npm-installed directory needs a one-time migration first.
    if (current?.isDirectory() && !current.isSymbolicLink()) {
      fs.rmSync(targetLink, { recursive: true, force: true });
    }
    publishHostLink(stagedLink, targetLink, resolvesToHost, (link) => { staleLink = link; });
    // Success means the plugin imports this host, not that some link exists.
    if (!resolvesToHost()) {
      throw new Error(`${targetLink} does not resolve to the running host ${hostRealpath}`);
    }
    log.debug(`Linked host opencli into plugin: ${targetLink} → ${hostRoot}`);
    return true;
  } catch (err) {
    log.warn(`Failed to link host opencli into plugin: ${getErrorMessage(err)}`);
    return false;
  } finally {
    for (const link of [stagedLink, staleLink]) {
      if (!link) continue;
      try { removeLink(link); } catch (err) {
        log.debug(`Could not remove temporary host link ${link}: ${getErrorMessage(err)}`);
      }
    }
  }
}

function publishHostLink(
  stagedLink: string,
  targetLink: string,
  resolvesToHost: () => boolean,
  setStaleLink: (link: string | undefined) => void,
): void {
  // rename replaces stale or dangling symlinks without an unlink window.
  try {
    fs.renameSync(stagedLink, targetLink);
    return;
  } catch (err) {
    // Another process may have already published a link to this host.
    if (resolvesToHost()) return;
    const existing = fs.lstatSync(targetLink, { throwIfNoEntry: false });
    if (!existing?.isSymbolicLink() || !REPLACE_REFUSED.has(errorCode(err) ?? '')) throw err;
  }

  // Windows cannot rename over a junction: move the stale link aside, then publish.
  const staleLink = `${targetLink}.stale-${randomUUID()}`;
  let movedAside = false;
  try {
    fs.renameSync(targetLink, staleLink);
    movedAside = true;
    setStaleLink(staleLink);
  } catch (err) {
    if (resolvesToHost()) return;
    // A concurrent repair may have moved it first; anything else is a real failure.
    if (fs.lstatSync(targetLink, { throwIfNoEntry: false })) throw err;
  }
  try {
    fs.renameSync(stagedLink, targetLink);
  } catch (err) {
    if (resolvesToHost()) return;
    if (movedAside && !fs.lstatSync(targetLink, { throwIfNoEntry: false })) {
      try {
        fs.renameSync(staleLink, targetLink);
        setStaleLink(undefined);
      } catch {}
    }
    throw err;
  }
}
