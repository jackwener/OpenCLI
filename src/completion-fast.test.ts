import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCompletionsFromManifest } from './completion-fast.js';
import { BUILTIN_COMMANDS } from './completion-shared.js';

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

  it('signals fallback when a manifest becomes unavailable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'missing-manifest.json');

    expect(getCompletionsFromManifest([], 1, [manifestPath])).toBeNull();
  });

  it('signals fallback when a manifest is not an array', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ site: 'twitter', name: 'search' }), 'utf-8');

    expect(getCompletionsFromManifest([], 1, [manifestPath])).toBeNull();
  });

  it('falls back instead of returning partial results when any manifest is invalid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-'));
    tempDirs.push(dir);
    const validPath = path.join(dir, 'valid-manifest.json');
    const invalidPath = path.join(dir, 'invalid-manifest.json');
    fs.writeFileSync(validPath, JSON.stringify([{ site: 'twitter', name: 'search' }]), 'utf-8');
    fs.writeFileSync(invalidPath, '{ not valid json', 'utf-8');

    expect(getCompletionsFromManifest([], 1, [validPath, invalidPath])).toBeNull();
  });

  it('keeps an empty valid manifest on the fast path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-completion-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, '[]', 'utf-8');

    expect(getCompletionsFromManifest([], 1, [manifestPath])).toEqual([...BUILTIN_COMMANDS].sort());
  });
});
