import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCompletionsFromManifest, hasAllManifests } from './completion-fast.js';

function writeTempManifest(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-fast-'));
  const file = path.join(dir, 'cli-manifest.json');
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('completion fast path', () => {
  it('does not use the manifest fast path when a manifest is invalid JSON', () => {
    const manifest = writeTempManifest('{ invalid json');

    expect(hasAllManifests([manifest])).toBe(false);
  });

  it('completes from valid manifests', () => {
    const manifest = writeTempManifest(JSON.stringify([
      { site: 'github', name: 'issues' },
    ]));

    expect(hasAllManifests([manifest])).toBe(true);
    expect(getCompletionsFromManifest([], 1, [manifest])).toContain('github');
    expect(getCompletionsFromManifest(['github'], 2, [manifest])).toEqual(['issues']);
  });
});
