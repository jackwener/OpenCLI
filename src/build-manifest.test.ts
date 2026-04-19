import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, getRegistry, Strategy } from './registry.js';
import { loadManifestEntries } from './build-manifest.js';

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

  it('recognizes factory-style adapters (make*Command) without a literal cli( token', async () => {
    const site = `manifest-factory-${Date.now()}`;
    const key = `${site}/factory-cmd`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, `${site}.ts`);
    fs.writeFileSync(
      file,
      `export const cmd = makeFakeCommand('${site}', 'factory-cmd');`,
    );

    const entries = await loadManifestEntries(file, site, async () => ({
      cmd: cli({ site, name: 'factory-cmd', description: 'built via factory' }),
    }));

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('factory-cmd');

    getRegistry().delete(key);
  });

  it('builds TS manifest entries from exported runtime commands', async () => {
    const site = `manifest-hydrate-${Date.now()}`;
    const key = `${site}/dynamic`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, `${site}.ts`);
    fs.writeFileSync(file, `export const command = cli({ site: '${site}', name: 'dynamic' });`);

    const entries = await loadManifestEntries(file, site, async () => ({
      command: cli({
        site,
        name: 'dynamic',
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
        deprecated: 'legacy command',
        replacedBy: 'opencli demo new',
      }),
    }));

    expect(entries).toMatchObject([
      {
        site,
        name: 'dynamic',
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
        deprecated: 'legacy command',
        replacedBy: 'opencli demo new',
      },
    ]);
    // Verify sourceFile is included
    expect(entries[0].sourceFile).toBeDefined();

    getRegistry().delete(key);
  });

  it('falls back to registry delta for side-effect-only cli modules', async () => {
    const site = `manifest-side-effect-${Date.now()}`;
    const key = `${site}/legacy`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-'));
    tempDirs.push(dir);
    const file = path.join(dir, `${site}.ts`);
    fs.writeFileSync(file, `cli({ site: '${site}', name: 'legacy' });`);

    const entries = await loadManifestEntries(file, site, async () => {
      cli({
        site,
        name: 'legacy',
        description: 'legacy command',
        deprecated: 'legacy is deprecated',
        replacedBy: 'opencli demo new',
      });
      return {};
    });

    expect(entries).toMatchObject([
      {
        site,
        name: 'legacy',
        description: 'legacy command',
        strategy: 'cookie',
        browser: true,
        args: [],
        type: 'js',
        modulePath: `${site}/${site}.js`,
        deprecated: 'legacy is deprecated',
        replacedBy: 'opencli demo new',
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
    fs.writeFileSync(file, `export const screen = cli({ site: '${site}', name: 'screen' });`);

    const entries = await loadManifestEntries(file, site, async () => ({
      screen: cli({
        site,
        name: 'screen',
        description: 'capture screen',
      }),
      status: cli({
        site,
        name: 'status',
        description: 'show status',
      }),
    }));

    expect(entries.map(entry => entry.name)).toEqual(['screen', 'status']);

    getRegistry().delete(screenKey);
    getRegistry().delete(statusKey);
  });
});
