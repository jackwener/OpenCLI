/**
 * Tests for plugin scaffold: create new plugin directories.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPluginScaffold } from './plugin-scaffold.js';
import { getRegistry } from './registry.js';

describe('createPluginScaffold', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    createdDirs.length = 0;
  });

  it('creates all expected files', () => {
    const dir = path.join(os.tmpdir(), `opencli-scaffold-${Date.now()}`);
    createdDirs.push(dir);

    const result = createPluginScaffold('my-test', { dir });
    expect(result.name).toBe('my-test');
    expect(result.dir).toBe(dir);
    expect(result.files).toContain('opencli-plugin.json');
    expect(result.files).toContain('package.json');
    expect(result.files).toContain('hello.ts');
    expect(result.files).toContain('greet.ts');
    expect(result.files).toContain('README.md');

    // All files exist
    for (const f of result.files) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
  });

  it('generates valid opencli-plugin.json', () => {
    const dir = path.join(os.tmpdir(), `opencli-scaffold-${Date.now()}`);
    createdDirs.push(dir);

    createPluginScaffold('test-manifest', { dir, description: 'Test desc' });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'opencli-plugin.json'), 'utf-8'));
    expect(manifest.name).toBe('test-manifest');
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.description).toBe('Test desc');
    expect(manifest.opencli).toMatch(/^>=/);
  });

  it('generates ESM package.json', () => {
    const dir = path.join(os.tmpdir(), `opencli-scaffold-${Date.now()}`);
    createdDirs.push(dir);

    createPluginScaffold('test-pkg', { dir });
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    expect(pkg.type).toBe('module');
    expect(pkg.peerDependencies?.['@jackwener/opencli']).toBeDefined();
  });

  it('generates a TS sample that matches the current plugin API', () => {
    const dir = path.join(os.tmpdir(), `opencli-scaffold-${Date.now()}`);
    createdDirs.push(dir);

    createPluginScaffold('test-ts', { dir });
    const tsSample = fs.readFileSync(path.join(dir, 'greet.ts'), 'utf-8');

    expect(tsSample).toContain(`import { cli, Strategy } from '@jackwener/opencli/registry';`);
    expect(tsSample).toContain(`strategy: Strategy.PUBLIC`);
    expect(tsSample).toContain(`help: 'Name to greet'`);
    expect(tsSample).toContain(`func: async (kwargs)`);
    expect(tsSample).not.toContain('async run(');
  });

  it('registers every generated sample command with access metadata', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-scaffold-access-'));
    createdDirs.push(dir);

    const pluginName = `test-access-${Date.now()}`;
    createPluginScaffold(pluginName, { dir });
    const registryImport = pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href;
    const registry = getRegistry();

    for (const commandName of ['hello', 'greet']) {
      const sourcePath = path.join(dir, `${commandName}.ts`);
      const modulePath = path.join(dir, `${commandName}.js`);
      const source = fs
        .readFileSync(sourcePath, 'utf-8')
        .replace("'@jackwener/opencli/registry'", `'${registryImport}'`);
      fs.writeFileSync(modulePath, source);

      const key = `${pluginName}/${commandName}`;
      try {
        await expect(import(`${pathToFileURL(modulePath).href}?${commandName}-${Date.now()}`)).resolves.toBeDefined();
        expect(registry.get(key)?.access).toBe('read');
      } finally {
        registry.delete(key);
      }
    }
  });

  it('documents a supported local install flow', () => {
    const dir = path.join(os.tmpdir(), `opencli-scaffold-${Date.now()}`);
    createdDirs.push(dir);

    createPluginScaffold('test-readme', { dir });
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf-8');

    expect(readme).toContain(`opencli plugin install file://${dir}`);
  });

  it('rejects invalid names', () => {
    expect(() => createPluginScaffold('Bad_Name')).toThrow('Invalid plugin name');
    expect(() => createPluginScaffold('123start')).toThrow('Invalid plugin name');
  });

  it('rejects non-empty directory', () => {
    const dir = path.join(os.tmpdir(), `opencli-scaffold-${Date.now()}`);
    createdDirs.push(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'existing.txt'), 'x');
    expect(() => createPluginScaffold('test', { dir })).toThrow('not empty');
  });
});
