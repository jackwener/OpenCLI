/**
 * Tests for plugin management: install, uninstall, list, and lock file support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGINS_DIR } from './discovery.js';
import type { LockEntry } from './plugin.js';
import * as pluginModule from './plugin.js';

const { mockExecFileSync, mockExecSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

const {
  _getCommitHash,
  _installDependencies,
  _postInstallMonorepoLifecycle,
  listPlugins,
  _readLockFile,
  _resolveEsbuildBin,
  uninstallPlugin,
  updatePlugin,
  _parseSource,
  _updateAllPlugins,
  _validatePluginStructure,
  _writeLockFile,
  _isSymlinkSync,
  _getMonoreposDir,
  getLockFilePath,
  _installLocalPlugin,
  _isLocalPluginSource,
  _resolveStoredPluginSource,
  _toLocalPluginSource,
} = pluginModule;

describe('parseSource', () => {
  it('parses github:user/repo format', () => {
    const result = _parseSource('github:ByteYue/opencli-plugin-github-trending');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/ByteYue/opencli-plugin-github-trending.git',
      name: 'github-trending',
    });
  });

  it('parses https URL format', () => {
    const result = _parseSource('https://github.com/ByteYue/opencli-plugin-hot-digest');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/ByteYue/opencli-plugin-hot-digest.git',
      name: 'hot-digest',
    });
  });

  it('strips opencli-plugin- prefix from name', () => {
    const result = _parseSource('github:user/opencli-plugin-my-tool');
    expect(result!.name).toBe('my-tool');
  });

  it('keeps name without prefix', () => {
    const result = _parseSource('github:user/awesome-cli');
    expect(result!.name).toBe('awesome-cli');
  });

  it('returns null for invalid source', () => {
    expect(_parseSource('invalid')).toBeNull();
    expect(_parseSource('npm:some-package')).toBeNull();
  });

  it('parses file:// local plugin directories', () => {
    const localDir = path.join(os.tmpdir(), 'opencli-plugin-test');
    const fileUrl = pathToFileURL(localDir).href;
    const result = _parseSource(fileUrl);
    expect(result).toEqual({
      type: 'local',
      localPath: localDir,
      name: 'test',
    });
  });

  it('parses plain absolute local plugin directories', () => {
    const localDir = path.join(os.tmpdir(), 'my-plugin');
    const result = _parseSource(localDir);
    expect(result).toEqual({
      type: 'local',
      localPath: localDir,
      name: 'my-plugin',
    });
  });

  it('strips opencli-plugin- prefix for local paths', () => {
    const localDir = path.join(os.tmpdir(), 'opencli-plugin-foo');
    const result = _parseSource(localDir);
    expect(result!.name).toBe('foo');
  });
});

describe('validatePluginStructure', () => {
  const testDir = path.join(PLUGINS_DIR, '__test-validate__');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('returns invalid for non-existent directory', () => {
    const res = _validatePluginStructure(path.join(PLUGINS_DIR, '__does_not_exist__'));
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('does not exist');
  });

  it('returns invalid for empty directory', () => {
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('No command files found');
  });

  it('returns valid for YAML plugin', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.yaml'), 'site: test');
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns valid for JS plugin', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.js'), 'console.log("hi");');
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns invalid for TS plugin without package.json', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.ts'), 'console.log("hi");');
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('contains .ts files but no package.json');
  });

  it('returns invalid for TS plugin with missing type: module', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.ts'), 'console.log("hi");');
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('must have "type": "module"');
  });

  it('returns valid for TS plugin with correct package.json', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.ts'), 'console.log("hi");');
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ type: 'module' }));
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});

describe('lock file', () => {
  const backupPath = `${getLockFilePath()}.test-backup`;
  let hadOriginal = false;

  beforeEach(() => {
    hadOriginal = fs.existsSync(getLockFilePath());
    if (hadOriginal) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(getLockFilePath(), backupPath);
    }
  });

  afterEach(() => {
    if (hadOriginal) {
      fs.copyFileSync(backupPath, getLockFilePath());
      fs.unlinkSync(backupPath);
      return;
    }
    try { fs.unlinkSync(getLockFilePath()); } catch {}
  });

  it('reads empty lock when file does not exist', () => {
    try { fs.unlinkSync(getLockFilePath()); } catch {}
    expect(_readLockFile()).toEqual({});
  });

  it('round-trips lock entries', () => {
    const entries: Record<string, LockEntry> = {
      'test-plugin': {
        source: 'https://github.com/user/repo.git',
        commitHash: 'abc1234567890def',
        installedAt: '2025-01-01T00:00:00.000Z',
      },
      'another-plugin': {
        source: 'https://github.com/user/another.git',
        commitHash: 'def4567890123abc',
        installedAt: '2025-02-01T00:00:00.000Z',
        updatedAt: '2025-03-01T00:00:00.000Z',
      },
    };

    _writeLockFile(entries);
    expect(_readLockFile()).toEqual(entries);
  });

  it('handles malformed lock file gracefully', () => {
    fs.mkdirSync(path.dirname(getLockFilePath()), { recursive: true });
    fs.writeFileSync(getLockFilePath(), 'not valid json');
    expect(_readLockFile()).toEqual({});
  });
});

describe('getCommitHash', () => {
  it('returns a hash for a git repo', () => {
    const hash = _getCommitHash(process.cwd());
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns undefined for non-git directory', () => {
    expect(_getCommitHash(os.tmpdir())).toBeUndefined();
  });
});

describe('resolveEsbuildBin', () => {
  it('resolves a usable esbuild executable path', () => {
    const binPath = _resolveEsbuildBin();
    expect(binPath).not.toBeNull();
    expect(typeof binPath).toBe('string');
    expect(fs.existsSync(binPath!)).toBe(true);
    expect(binPath).toMatch(/esbuild(\.cmd)?$/);
  });
});

describe('listPlugins', () => {
  const testDir = path.join(PLUGINS_DIR, '__test-list-plugin__');

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('lists installed plugins', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'hello.yaml'), 'site: test\nname: hello\n');

    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-list-plugin__');
    expect(found).toBeDefined();
    expect(found!.commands).toContain('hello');
  });

  it('includes version metadata from the lock file', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'hello.yaml'), 'site: test\nname: hello\n');

    const lock = _readLockFile();
    lock['__test-list-plugin__'] = {
      source: 'https://github.com/user/repo.git',
      commitHash: 'abcdef1234567890abcdef1234567890abcdef12',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-list-plugin__');
    expect(found).toBeDefined();
    expect(found!.version).toBe('abcdef1');
    expect(found!.installedAt).toBe('2025-01-01T00:00:00.000Z');

    delete lock['__test-list-plugin__'];
    _writeLockFile(lock);
  });

  it('returns empty array when no plugins dir', () => {
    const plugins = listPlugins();
    expect(Array.isArray(plugins)).toBe(true);
  });

  it('prefers lockfile source for local symlink plugins', () => {
    const localTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-local-list-'));
    const linkPath = path.join(PLUGINS_DIR, '__test-list-plugin__');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.writeFileSync(path.join(localTarget, 'hello.yaml'), 'site: test\nname: hello\n');
    fs.symlinkSync(localTarget, linkPath, 'dir');

    const lock = _readLockFile();
    lock['__test-list-plugin__'] = {
      source: `local:${localTarget}`,
      commitHash: 'local',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-list-plugin__');
    expect(found?.source).toBe(`local:${localTarget}`);

    try { fs.unlinkSync(linkPath); } catch {}
    try { fs.rmSync(localTarget, { recursive: true, force: true }); } catch {}
    delete lock['__test-list-plugin__'];
    _writeLockFile(lock);
  });
});

describe('uninstallPlugin', () => {
  const testDir = path.join(PLUGINS_DIR, '__test-uninstall__');

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('removes plugin directory', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.yaml'), 'site: test');

    uninstallPlugin('__test-uninstall__');
    expect(fs.existsSync(testDir)).toBe(false);
  });

  it('removes lock entry on uninstall', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.yaml'), 'site: test');

    const lock = _readLockFile();
    lock['__test-uninstall__'] = {
      source: 'https://github.com/user/repo.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    uninstallPlugin('__test-uninstall__');
    expect(_readLockFile()['__test-uninstall__']).toBeUndefined();
  });

  it('throws for non-existent plugin', () => {
    expect(() => uninstallPlugin('__nonexistent__')).toThrow('not installed');
  });
});

describe('updatePlugin', () => {
  it('throws for non-existent plugin', () => {
    expect(() => updatePlugin('__nonexistent__')).toThrow('not installed');
  });

  it('refreshes local plugins without running git pull', () => {
    const localTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-local-update-'));
    const linkPath = path.join(PLUGINS_DIR, '__test-local-update__');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.writeFileSync(path.join(localTarget, 'hello.yaml'), 'site: test\nname: hello\n');
    fs.symlinkSync(localTarget, linkPath, 'dir');

    const lock = _readLockFile();
    lock['__test-local-update__'] = {
      source: `local:${localTarget}`,
      commitHash: 'local',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    mockExecFileSync.mockClear();
    updatePlugin('__test-local-update__');

    expect(
      mockExecFileSync.mock.calls.some(
        ([cmd, args, opts]) => cmd === 'git'
          && Array.isArray(args)
          && args[0] === 'pull'
          && opts?.cwd === linkPath,
      ),
    ).toBe(false);

    const updated = _readLockFile()['__test-local-update__'];
    expect(updated?.source).toBe(`local:${localTarget}`);
    expect(updated?.updatedAt).toBeDefined();

    try { fs.unlinkSync(linkPath); } catch {}
    try { fs.rmSync(localTarget, { recursive: true, force: true }); } catch {}
    const finalLock = _readLockFile();
    delete finalLock['__test-local-update__'];
    _writeLockFile(finalLock);
  });
});

vi.mock('node:child_process', () => {
  return {
    execFileSync: mockExecFileSync.mockImplementation((_cmd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        if (opts?.cwd === os.tmpdir()) {
          throw new Error('not a git repository');
        }
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      if (opts && opts.cwd && String(opts.cwd).endsWith('plugin-b')) {
        throw new Error('Network error');
      }
      return '';
    }),
    execSync: mockExecSync.mockImplementation(() => ''),
  };
});

describe('installDependencies', () => {
  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
  });

  it('throws when npm install fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-plugin-b-'));
    const failingDir = path.join(tmpDir, 'plugin-b');
    fs.mkdirSync(failingDir, { recursive: true });
    fs.writeFileSync(path.join(failingDir, 'package.json'), JSON.stringify({ name: 'plugin-b' }));

    expect(() => _installDependencies(failingDir)).toThrow('npm install failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('postInstallMonorepoLifecycle', () => {
  let repoDir: string;
  let subDir: string;

  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-monorepo-'));
    subDir = path.join(repoDir, 'packages', 'alpha');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
      name: 'opencli-plugins',
      private: true,
      workspaces: ['packages/*'],
    }));
    fs.writeFileSync(path.join(subDir, 'hello.yaml'), 'site: test\nname: hello\n');
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('installs dependencies once at the monorepo root, not in each sub-plugin', () => {
    _postInstallMonorepoLifecycle(repoDir, [subDir]);

    const npmCalls = mockExecFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'npm' && Array.isArray(args) && args[0] === 'install',
    );

    expect(npmCalls).toHaveLength(1);
    expect(npmCalls[0][2]).toMatchObject({ cwd: repoDir });
    expect(npmCalls.some(([, , opts]) => opts?.cwd === subDir)).toBe(false);
  });
});

describe('updateAllPlugins', () => {
  const testDirA = path.join(PLUGINS_DIR, 'plugin-a');
  const testDirB = path.join(PLUGINS_DIR, 'plugin-b');
  const testDirC = path.join(PLUGINS_DIR, 'plugin-c');

  beforeEach(() => {
    fs.mkdirSync(testDirA, { recursive: true });
    fs.mkdirSync(testDirB, { recursive: true });
    fs.mkdirSync(testDirC, { recursive: true });
    fs.writeFileSync(path.join(testDirA, 'cmd.yaml'), 'site: a');
    fs.writeFileSync(path.join(testDirB, 'cmd.yaml'), 'site: b');
    fs.writeFileSync(path.join(testDirC, 'cmd.yaml'), 'site: c');
  });

  afterEach(() => {
    try { fs.rmSync(testDirA, { recursive: true }); } catch {}
    try { fs.rmSync(testDirB, { recursive: true }); } catch {}
    try { fs.rmSync(testDirC, { recursive: true }); } catch {}
    vi.clearAllMocks();
  });

  it('collects successes and failures without throwing', () => {
    const results = _updateAllPlugins();

    const resA = results.find(r => r.name === 'plugin-a');
    const resB = results.find(r => r.name === 'plugin-b');
    const resC = results.find(r => r.name === 'plugin-c');

    expect(resA).toBeDefined();
    expect(resA!.success).toBe(true);

    expect(resB).toBeDefined();
    expect(resB!.success).toBe(false);
    expect(resB!.error).toContain('Network error');

    expect(resC).toBeDefined();
    expect(resC!.success).toBe(true);
  });
});

// ── Monorepo-specific tests ─────────────────────────────────────────────────

describe('parseSource with monorepo subplugin', () => {
  it('parses github:user/repo/subplugin format', () => {
    const result = _parseSource('github:ByteYue/opencli-plugins/polymarket');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/ByteYue/opencli-plugins.git',
      name: 'opencli-plugins',
      subPlugin: 'polymarket',
    });
  });

  it('strips opencli-plugin- prefix from repo name in subplugin format', () => {
    const result = _parseSource('github:user/opencli-plugin-collection/defi');
    expect(result!.name).toBe('collection');
    expect(result!.subPlugin).toBe('defi');
  });

  it('still parses github:user/repo without subplugin', () => {
    const result = _parseSource('github:user/my-repo');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/user/my-repo.git',
      name: 'my-repo',
    });
    expect(result!.subPlugin).toBeUndefined();
  });
});

describe('isSymlinkSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-symlink-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for a regular directory', () => {
    const dir = path.join(tmpDir, 'regular');
    fs.mkdirSync(dir);
    expect(_isSymlinkSync(dir)).toBe(false);
  });

  it('returns true for a symlink', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, 'dir');
    expect(_isSymlinkSync(link)).toBe(true);
  });

  it('returns false for non-existent path', () => {
    expect(_isSymlinkSync(path.join(tmpDir, 'nope'))).toBe(false);
  });
});

describe('monorepo uninstall with symlink', () => {
  let tmpDir: string;
  let pluginDir: string;
  let monoDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-mono-uninstall-'));
    pluginDir = path.join(PLUGINS_DIR, '__test-mono-sub__');
    monoDir = path.join(_getMonoreposDir(), '__test-mono__');

    const subDir = path.join(monoDir, 'packages', 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'cmd.yaml'), 'site: test');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.symlinkSync(subDir, pluginDir, 'dir');

    const lock = _readLockFile();
    lock['__test-mono-sub__'] = {
      source: 'https://github.com/user/test.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: '__test-mono__', subPath: 'packages/sub' },
    };
    _writeLockFile(lock);
  });

  afterEach(() => {
    try { fs.unlinkSync(pluginDir); } catch {}
    try { fs.rmSync(pluginDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(monoDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock['__test-mono-sub__'];
    _writeLockFile(lock);
  });

  it('removes symlink but keeps monorepo if other sub-plugins reference it', () => {
    const lock = _readLockFile();
    lock['__test-mono-other__'] = {
      source: 'https://github.com/user/test.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: '__test-mono__', subPath: 'packages/other' },
    };
    _writeLockFile(lock);

    uninstallPlugin('__test-mono-sub__');

    expect(fs.existsSync(pluginDir)).toBe(false);
    expect(fs.existsSync(monoDir)).toBe(true);
    expect(_readLockFile()['__test-mono-sub__']).toBeUndefined();
    expect(_readLockFile()['__test-mono-other__']).toBeDefined();

    const finalLock = _readLockFile();
    delete finalLock['__test-mono-other__'];
    _writeLockFile(finalLock);
  });

  it('removes symlink AND monorepo dir when last sub-plugin is uninstalled', () => {
    uninstallPlugin('__test-mono-sub__');

    expect(fs.existsSync(pluginDir)).toBe(false);
    expect(fs.existsSync(monoDir)).toBe(false);
    expect(_readLockFile()['__test-mono-sub__']).toBeUndefined();
  });
});

describe('listPlugins with monorepo metadata', () => {
  const testSymlinkTarget = path.join(os.tmpdir(), 'opencli-list-mono-target');
  const testLink = path.join(PLUGINS_DIR, '__test-mono-list__');

  beforeEach(() => {
    fs.mkdirSync(testSymlinkTarget, { recursive: true });
    fs.writeFileSync(path.join(testSymlinkTarget, 'hello.yaml'), 'site: test\nname: hello\n');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    try { fs.unlinkSync(testLink); } catch {}
    fs.symlinkSync(testSymlinkTarget, testLink, 'dir');

    const lock = _readLockFile();
    lock['__test-mono-list__'] = {
      source: 'https://github.com/user/test-mono.git',
      commitHash: 'def456def456def456def456def456def456def4',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: 'test-mono', subPath: 'packages/list' },
    };
    _writeLockFile(lock);
  });

  afterEach(() => {
    try { fs.unlinkSync(testLink); } catch {}
    try { fs.rmSync(testSymlinkTarget, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock['__test-mono-list__'];
    _writeLockFile(lock);
  });

  it('lists symlinked plugins with monorepoName', () => {
    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-mono-list__');
    expect(found).toBeDefined();
    expect(found!.monorepoName).toBe('test-mono');
    expect(found!.commands).toContain('hello');
    expect(found!.source).toBe('https://github.com/user/test-mono.git');
  });
});

describe('installLocalPlugin', () => {
  let tmpDir: string;
  const pluginName = '__test-local-plugin__';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-local-install-'));
    fs.writeFileSync(path.join(tmpDir, 'hello.yaml'), 'site: test\nname: hello\n');
  });

  afterEach(() => {
    const linkPath = path.join(PLUGINS_DIR, pluginName);
    try { fs.unlinkSync(linkPath); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock[pluginName];
    _writeLockFile(lock);
  });

  it('creates a symlink to the local directory', () => {
    const result = _installLocalPlugin(tmpDir, pluginName);
    expect(result).toBe(pluginName);
    const linkPath = path.join(PLUGINS_DIR, pluginName);
    expect(fs.existsSync(linkPath)).toBe(true);
    expect(_isSymlinkSync(linkPath)).toBe(true);
  });

  it('records local: source in lockfile', () => {
    _installLocalPlugin(tmpDir, pluginName);
    const lock = _readLockFile();
    expect(lock[pluginName]).toBeDefined();
    expect(lock[pluginName].source).toMatch(/^local:/);
  });

  it('lists the recorded local source', () => {
    _installLocalPlugin(tmpDir, pluginName);
    const plugins = listPlugins();
    const found = plugins.find(p => p.name === pluginName);
    expect(found).toBeDefined();
    expect(found!.source).toBe(`local:${path.resolve(tmpDir)}`);
  });

  it('throws for non-existent path', () => {
    expect(() => _installLocalPlugin('/does/not/exist', 'x')).toThrow('does not exist');
  });
});

describe('isLocalPluginSource', () => {
  it('detects lockfile local sources', () => {
    expect(_isLocalPluginSource('local:/tmp/plugin')).toBe(true);
    expect(_isLocalPluginSource('https://github.com/user/repo.git')).toBe(false);
    expect(_isLocalPluginSource(undefined)).toBe(false);
  });
});

describe('plugin source helpers', () => {
  it('formats local plugin sources consistently', () => {
    const dir = path.join(os.tmpdir(), 'opencli-plugin-source');
    expect(_toLocalPluginSource(dir)).toBe(`local:${path.resolve(dir)}`);
  });

  it('prefers lockfile source over git remote lookup', () => {
    const dir = path.join(os.tmpdir(), 'opencli-plugin-source');
    const source = _resolveStoredPluginSource({
      source: 'local:/tmp/plugin',
      commitHash: 'local',
      installedAt: '2025-01-01T00:00:00.000Z',
    }, dir);
    expect(source).toBe('local:/tmp/plugin');
  });
});
