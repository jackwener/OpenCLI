import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { managedPluginPath } from './plugin-path.js';

const fixture = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-plugin-containment-'));
  return { root, plugins: path.join(root, '.opencli', 'plugins'), repo: path.join(root, 'repository') };
});
vi.mock('./discovery.js', () => ({ PLUGINS_DIR: fixture.plugins }));
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn((command, args) => {
    if (command === 'git' && args[0] === 'clone') {
      fs.cpSync(fixture.repo, args.at(-1), { recursive: true });
    }
    return '1234567890abcdef1234567890abcdef12345678\n';
  }),
}));
import { installPlugin, uninstallPlugin, updatePlugin, readLockFile, writeLockFile } from './plugin.js';

beforeEach(() => {
  vi.stubEnv('HOME', fixture.root);
  fs.rmSync(path.join(fixture.root, '.opencli'), { recursive: true, force: true });
  fs.rmSync(fixture.repo, { recursive: true, force: true });
  fs.mkdirSync(fixture.plugins, { recursive: true });
  fs.mkdirSync(fixture.repo, { recursive: true });
  fs.writeFileSync(path.join(fixture.repo, 'hello.js'), 'export const value = 1;');
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(fixture.root, { recursive: true, force: true });
});
const invalidNames: unknown[] = ['', '.', '..', '../victim', 'a/b', '..\\victim', 'a\\b', '/tmp/victim', 'C:\\victim', 'C:victim', 'name:stream', '.. ', 'name.', 'name ', 'nul', 'CON.txt', 'LPT1', 'a\0b', 42, { name: 'foo' }];

function manifest(value: unknown) {
  fs.writeFileSync(path.join(fixture.repo, 'opencli-plugin.json'), JSON.stringify(value));
}
function sentinel() {
  const dir = path.join(fixture.root, '.opencli', 'victim');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'keep.txt');
  fs.writeFileSync(file, 'do not delete');
  return file;
}

describe('managed plugin names', () => {
  it.each(invalidNames)('rejects unsafe name %j', name => {
    expect(() => managedPluginPath(fixture.plugins, name)).toThrow('Invalid plugin directory name');
  });
  it.each(['ordinary-name', '__test-plugin__', '工具', 'plugin.v2'])('preserves valid name %s', name => {
    expect(managedPluginPath(fixture.plugins, name)).toBe(path.join(fixture.plugins, name));
  });
});

describe('plugin containment at mutation boundaries', () => {
  it.each(['../victim', '..\\victim', '.', '/tmp/victim'])('rejects uninstall/update path %s before touching a sibling', name => {
    const file = sentinel();
    expect(() => uninstallPlugin(name)).toThrow('Invalid plugin directory name');
    expect(() => updatePlugin(name)).toThrow('Invalid plugin directory name');
    expect(fs.readFileSync(file, 'utf8')).toBe('do not delete');
  });
  it.each(['local', 'remote'])('rejects a malicious %s manifest before publication', kind => {
    manifest({ name: '../escaped' });
    expect(() => installPlugin(kind === 'local' ? fixture.repo : 'github:test/repository')).toThrow('Invalid plugin directory name');
    expect(fs.existsSync(path.join(fixture.root, '.opencli', 'escaped'))).toBe(false);
    expect(fs.readdirSync(fixture.plugins)).toEqual([]);
  });
  it('rejects the entire monorepo batch before publishing any sibling', () => {
    manifest({ plugins: { good: { path: '.' }, '../escaped': { path: '.' } } });
    expect(() => installPlugin('github:test/repository')).toThrow('Invalid plugin directory name');
    expect(fs.readdirSync(fixture.plugins)).toEqual([]);
    expect(fs.existsSync(path.join(fixture.root, '.opencli', 'monorepos', 'repository'))).toBe(false);
  });
  it('rejects traversal in monorepo cleanup metadata before removing the installed plugin', () => {
    const file = sentinel();
    const installed = path.join(fixture.plugins, 'safe');
    fs.mkdirSync(installed);
    writeLockFile({ safe: { source: { kind: 'monorepo', url: 'https://example.test/repo.git', repoName: '../victim', subPath: '.' }, commitHash: 'a', installedAt: 'now' } });
    expect(() => uninstallPlugin('safe')).toThrow('Invalid plugin directory name');
    expect(() => updatePlugin('safe')).toThrow('Invalid plugin directory name');
    expect(fs.existsSync(installed)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('do not delete');
  });
  it('rejects an unsafe installed monorepo key before replacing the shared repository', () => {
    const file = sentinel();
    const repoDir = path.join(fixture.root, '.opencli', 'monorepos', 'repository');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'original repository');
    fs.mkdirSync(path.join(fixture.plugins, 'safe'));
    const entry = { source: { kind: 'monorepo' as const, url: 'https://example.test/repository.git', repoName: 'repository', subPath: '.' }, commitHash: 'a', installedAt: 'now' };
    writeLockFile({ safe: entry, '../victim': entry });
    manifest({ plugins: { safe: { path: '.' }, '../victim': { path: '.' } } });
    expect(() => updatePlugin('safe')).toThrow('Invalid plugin directory name');
    expect(fs.readFileSync(path.join(repoDir, 'keep.txt'), 'utf8')).toBe('original repository');
    expect(fs.readFileSync(file, 'utf8')).toBe('do not delete');
  });
  it.each(['ordinary-name', '__proto__', 'constructor'])('keeps local symlink install/update/uninstall working for %s', name => {
    manifest({ name });
    expect(installPlugin(fixture.repo)).toBe(name);
    expect(Object.hasOwn(readLockFile(), name)).toBe(true);
    expect(fs.realpathSync(path.join(fixture.plugins, name))).toBe(fs.realpathSync(fixture.repo));
    updatePlugin(name);
    uninstallPlugin(name);
    expect(fs.existsSync(path.join(fixture.plugins, name))).toBe(false);
    expect(fs.existsSync(path.join(fixture.repo, 'hello.js'))).toBe(true);
    expect(Object.hasOwn(readLockFile(), name)).toBe(false);
  });
});
