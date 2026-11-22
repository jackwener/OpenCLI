import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Create a directory link that works without Windows symlink privileges.
 */
export function createDirLinkSync(target: string, linkPath: string): void {
  if (!path.isAbsolute(target)) {
    throw new TypeError(`Directory link target must be absolute: ${target}`);
  }

  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}
