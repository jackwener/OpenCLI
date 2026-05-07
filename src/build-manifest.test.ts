import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, getRegistry, Strategy } from './registry.js';
import {
  ManifestImportError,
  diffRemovedEntries,
  loadManifestEntries,
  normalizeManifestPath,
  parseBuildManifestArgs,
  scanClisDir,
  serializeManifest,
  type ManifestEntry,
} from './build-manifest.js';

describe('manifest helper rules', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips TS files that do not register a cli', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'utils.ts');
    fs.writeFileSync(file, `export function helper() { return 'noop'; }`);

    return expect(loadManifestEntries(file, 'demo', async () => ({}))).resolves.toEqual([]);
  });

  it('builds TS manifest entries from exported runtime commands', async () => {
    const site = `manifest-hydrate-${Date.now()}`;
    const key = `${site}/dynamic`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, `${site}.ts`);
    fs.writeFileSync(file, `export const command = cli({ site: '${site}', name: 'dynamic', access: 'read' });`);

    const entries = await loadManifestEntries(file, site, async () => ({
      command: cli({
        site,
        name: 'dynamic',
        access: 'read',
        description: 'dynamic command',
        strategy: Strategy.PUBLIC,
        browser: false,
        aliases: ['metadata'],
        args: [
          {
            name: 'model',
            required: true,
            positional: true,
            help: 'Choose a model',
            choices: ['auto', 'thinking'],
            default: '30',
          },
        ],
        domain: 'localhost',
        navigateBefore: 'https://example.com/session',
        defaultFormat: 'plain',
      }),
    }));

    expect(entries).toMatchObject([
      {
        site,
        name: 'dynamic',
        access: 'read',
        description: 'dynamic command',
        domain: 'localhost',
        strategy: 'public',
        browser: false,
        aliases: ['metadata'],
        args: [
          expect.objectContaining({
            name: 'model',
            type: 'str',
            required: true,
            positional: true,
            help: 'Choose a model',
            choices: ['auto', 'thinking'],
            default: '30',
          }),
        ],
        type: 'js',
        modulePath: `${site}/${site}.js`,
        navigateBefore: 'https://example.com/session',
        defaultFormat: 'plain',
      },
    ]);
    // Verify sourceFile is included and stable for manifest consumers.
    expect(entries[0].sourceFile).toBeDefined();
    expect(entries[0].sourceFile).not.toContain('\\');

    getRegistry().delete(key);
  });

  it('falls back to registry delta for side-effect-only cli modules', async () => {
    const site = `manifest-side-effect-${Date.now()}`;
    const key = `${site}/legacy`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, `${site}.ts`);
    fs.writeFileSync(file, `cli({ site: '${site}', name: 'legacy', access: 'read' });`);

    const entries = await loadManifestEntries(file, site, async () => {
      cli({
        site,
        name: 'legacy',
        access: 'read',
        description: 'legacy command',
      });
      return {};
    });

    expect(entries).toMatchObject([
      {
        site,
        name: 'legacy',
        access: 'read',
        description: 'legacy command',
        strategy: 'cookie',
        browser: true,
        args: [],
        type: 'js',
        modulePath: `${site}/${site}.js`,
      },
    ]);
    // Verify sourceFile is included
    expect(entries[0].sourceFile).toBeDefined();

    getRegistry().delete(key);
  });

  it('keeps every command a module exports instead of guessing by site', async () => {
    const site = `manifest-multi-${Date.now()}`;
    const screenKey = `${site}/screen`;
    const statusKey = `${site}/status`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, `${site}.ts`);
    fs.writeFileSync(file, `export const screen = cli({ site: '${site}', name: 'screen', access: 'read' });`);

    const entries = await loadManifestEntries(file, site, async () => ({
      screen: cli({
        site,
        name: 'screen',
        access: 'read',
        description: 'capture screen',
      }),
      status: cli({
        site,
        name: 'status',
        access: 'read',
        description: 'show status',
      }),
    }));

    expect(entries.map(entry => entry.name)).toEqual(['screen', 'status']);

    getRegistry().delete(screenKey);
    getRegistry().delete(statusKey);
  });

  it('normalizes manifest paths to POSIX separators', () => {
    expect(normalizeManifestPath('demo\\status.js')).toBe('demo/status.js');
    expect(normalizeManifestPath('demo/status.js')).toBe('demo/status.js');
  });

  it('serializes manifest json with a trailing newline', () => {
    const serialized = serializeManifest([{
      site: 'demo',
      name: 'status', access: 'read',
      description: '',
      strategy: 'public',
      browser: false,
      args: [],
      type: 'js',
    }]);

    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized).toContain('\n]');
  });

  it('throws ManifestImportError when an adapter looks like a CLI module but fails to import', async () => {
    // Reproduces the "stale dist drops adapters silently" incident: the file
    // matches the cli() pattern (so it's not just a helper), but the importer
    // throws — we want the failure surfaced, not swallowed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-fail-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'broken.ts');
    fs.writeFileSync(file, `export const command = cli({ site: 'demo', name: 'broken', access: 'read' });`);

    const importer = async () => { throw new Error('boom: stale dist'); };

    await expect(loadManifestEntries(file, 'demo', importer))
      .rejects.toBeInstanceOf(ManifestImportError);

    try {
      await loadManifestEntries(file, 'demo', importer);
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestImportError);
      const e = err as ManifestImportError;
      expect(e.filePath).toBe(file);
      expect(e.message).toContain('boom: stale dist');
    }
  });

  it('still silently skips files that do not call cli() even if the importer would have thrown', async () => {
    // The cli() pattern check happens before importing — we don't even ask
    // the importer about helper modules, so a thrown import does not turn
    // them into failures.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-helper-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'helper.ts');
    fs.writeFileSync(file, `export const helper = () => 42;`);
    const importer = async () => { throw new Error('should never be called'); };
    await expect(loadManifestEntries(file, 'demo', importer)).resolves.toEqual([]);
  });

  it('scanClisDir aggregates per-adapter import failures instead of silently dropping them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-clis-'));
    tempDirs.push(root);
    const siteDir = path.join(root, 'demo');
    fs.mkdirSync(siteDir);
    fs.writeFileSync(path.join(siteDir, 'good.js'),
      `export const cmd = cli({ site: 'demo', name: 'good', access: 'read' });`);
    fs.writeFileSync(path.join(siteDir, 'broken.js'),
      `export const cmd = cli({ site: 'demo', name: 'broken', access: 'read' });`);

    const importer = async (href: string): Promise<unknown> => {
      if (href.endsWith('broken.js')) throw new Error('stale dist drops broken');
      return { cmd: cli({ site: 'demo', name: 'good', access: 'read', description: 'ok' }) };
    };

    const result = await scanClisDir(root, importer);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toBeInstanceOf(ManifestImportError);
    expect(result.failures[0].filePath).toMatch(/broken\.js$/);
    expect(result.failures[0].message).toContain('stale dist drops broken');
    expect(result.entries.map(e => e.name)).toEqual(['good']);

    getRegistry().delete('demo/good');
  });

  it('diffRemovedEntries returns site/name keys present only in prev', () => {
    const prev: ManifestEntry[] = [
      { site: 'a', name: '1', access: 'read', description: '', strategy: 'public', browser: false, args: [], type: 'js' },
      { site: 'a', name: '2', access: 'read', description: '', strategy: 'public', browser: false, args: [], type: 'js' },
      { site: 'b', name: '3', access: 'read', description: '', strategy: 'public', browser: false, args: [], type: 'js' },
    ];
    const next: ManifestEntry[] = [
      { site: 'a', name: '1', access: 'read', description: '', strategy: 'public', browser: false, args: [], type: 'js' },
    ];
    expect(diffRemovedEntries(prev, next)).toEqual(['a/2', 'b/3']);
    expect(diffRemovedEntries(prev, prev)).toEqual([]);
    expect(diffRemovedEntries([], next)).toEqual([]);
  });

  it('parseBuildManifestArgs reads --allow-removals[=N]', () => {
    expect(parseBuildManifestArgs([]).allowRemovals).toBe(0);
    expect(parseBuildManifestArgs(['--allow-removals=5']).allowRemovals).toBe(5);
    expect(parseBuildManifestArgs(['--allow-removals=0']).allowRemovals).toBe(0);
    // Bare flag is the explicit "I know what I'm doing" escape hatch.
    expect(parseBuildManifestArgs(['--allow-removals']).allowRemovals).toBe(Number.POSITIVE_INFINITY);
    // Unknown flags are ignored.
    expect(parseBuildManifestArgs(['--something-else']).allowRemovals).toBe(0);
  });
});
