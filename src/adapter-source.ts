import * as fs from 'node:fs';
import type { InternalCliCommand } from './registry.js';

/**
 * Resolve the editable source file path for an adapter.
 *
 * Priority:
 * 1. cmd.source (set for FS-scanned JS and manifest lazy-loaded JS)
 * 2. cmd._modulePath (set for manifest lazy-loaded JS)
 *
 * Skip manifest: prefixed pseudo-paths (YAML commands inlined in manifest).
 */
export function resolveAdapterSourcePath(cmd: InternalCliCommand): string | undefined {
  const candidates: string[] = [];

  if (cmd.source && !cmd.source.startsWith('manifest:')) {
    candidates.push(cmd.source);
  }
  if (cmd._modulePath) {
    candidates.push(cmd._modulePath);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}
