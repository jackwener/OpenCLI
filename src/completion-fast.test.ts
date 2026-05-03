import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCompletionsFromManifest, hasAllManifests } from './completion-fast.js';
import { hasCliSourceFiles } from './completion-shared.js';

describe('getCompletionsFromManifest', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('includes current built-ins on the manifest fast path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-fast-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify([{ site: 'demo', name: 'status' }]), 'utf8');

    const completions = getCompletionsFromManifest([], 1, [manifestPath]);

    expect(completions).not.toBeNull();
    expect(completions).toEqual(expect.arrayContaining(['adapter', 'daemon', 'profile', 'demo']));
    expect(completions).not.toContain('tab');
  });

  it('completes nested built-in subcommands on the manifest fast path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-fast-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify([]), 'utf8');

    expect(getCompletionsFromManifest(['browser'], 2, [manifestPath])).toEqual(
      expect.arrayContaining(['open', 'analyze', 'tab']),
    );
    expect(getCompletionsFromManifest(['browser', 'tab'], 3, [manifestPath])).toEqual(
      expect.arrayContaining(['list', 'new', 'select', 'close']),
    );
  });

  it('returns null when a manifest cannot be parsed so main can fall back to discovery', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-fast-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, '{ invalid json', 'utf8');

    expect(getCompletionsFromManifest([], 1, [manifestPath])).toBeNull();
  });
});

describe('hasCliSourceFiles', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects user adapter sources even without a manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-user-clis-'));
    tempDirs.push(dir);
    const siteDir = path.join(dir, 'coingecko');
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'top.js'), 'export default {};', 'utf8');

    expect(hasCliSourceFiles(dir)).toBe(true);
    expect(hasAllManifests([path.join(dir, 'missing-manifest.json')])).toBe(false);
  });
});
