import * as path from 'node:path';
import { PluginError } from './errors.js';

/** Resolve one portable directory name, never a path supplied by a manifest. */
export function managedPluginPath(root: string, name: unknown): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' ||
      name.trim() !== name || /[\\/:\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new PluginError(`Invalid plugin directory name: ${JSON.stringify(name)}`, 'Use a single directory name without path separators or Windows device names.');
  }
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  if (path.dirname(target) !== base) {
    throw new PluginError(`Plugin directory name escapes its managed directory: ${JSON.stringify(name)}`);
  }
  return target;
}
