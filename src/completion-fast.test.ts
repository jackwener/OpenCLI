import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCompletionsFromManifest } from './completion-fast.js';

describe('getCompletionsFromManifest', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it('signals fallback when a manifest cannot be parsed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, '{ not valid json', 'utf-8');

    expect(getCompletionsFromManifest([], 1, [manifestPath])).toBeNull();
  });
});
